"""Live browser smoke: real Express/SQLite, TVmaze and sample video; no API or media mocks.
Start npm start first, then: python backend/tests/test_live_browser.py
"""
import asyncio
import os
import shutil
import unittest
from playwright.async_api import async_playwright, expect

ORIGIN = os.environ.get('TEST_APP_ORIGIN', 'http://localhost:3000')

async def wait_media(page, predicate, timeout=30):
    # Poll through DevTools evaluation; do not weaken the app's CSP for test helpers.
    for _ in range(timeout * 4):
        if await page.locator('#watch-player').evaluate(predicate):
            return
        await asyncio.sleep(.25)
    state = await page.locator('#watch-player').evaluate('video => ({ready:video.readyState, error:video.error?.message, time:video.currentTime, paused:video.paused})')
    raise AssertionError(f'Media did not become ready: {state}')

class LiveCommunityTest(unittest.IsolatedAsyncioTestCase):
    async def test_two_people_watch_chat_score_and_play_trivia(self):
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(executable_path=shutil.which('chromium') or None)
            host_context = await browser.new_context(viewport={'width': 1440, 'height': 1000})
            guest_context = await browser.new_context(viewport={'width': 1440, 'height': 1000})
            host, guest = await host_context.new_page(), await guest_context.new_page()
            errors = []
            for page in [host, guest]:
                page.on('pageerror', lambda error: errors.append(str(error)))
            try:
                await host.goto(ORIGIN)
                await host.locator('#nickname').fill('Cinema host')
                await host.locator('#create-submit').click()
                await expect(host.locator('#room-status')).to_contain_text('Cinema host (host)')
                code = (await host.locator('#room-badge').inner_text()).removeprefix('Room ')
                await guest.goto(f'{ORIGIN}/?room={code}')
                await guest.locator('#nickname').fill('Movie friend')
                await guest.locator('#join-submit').click()
                await expect(guest.locator('#room-status')).to_contain_text('Movie friend')
                await expect(host.locator('#members')).to_contain_text('Movie friend', timeout=10000)
                await expect(guest.locator('#load-sample')).to_be_disabled()
                await host.locator('#show-search').fill('Dark')
                await host.locator('#search-submit').click()
                await expect(host.locator('.show-card').first).to_be_visible(timeout=15000)
                await host.locator('[data-choose-show]').first.click()
                await host.locator('#plan-note').fill('Watch together tonight')
                await host.locator('#save-plan').click()
                await expect(guest.locator('#plan-display')).to_contain_text('Watch together tonight', timeout=10000)
                await guest.locator('#vote-yes').click()
                await expect(host.locator('#poll-counts')).to_contain_text('1 Yes', timeout=10000)
                await guest.locator('#message-draft').fill('Ready for the film 🍿 <script>bad()</script>')
                await guest.locator('#send-message').click()
                await expect(host.locator('#discussion-feed')).to_contain_text('Ready for the film 🍿', timeout=10000)
                self.assertEqual(await host.locator('#discussion-feed script').count(), 0)
                await host.locator('#load-sample').click()
                await expect(host.locator('#screen-name')).to_have_text('Sintel — official trailer', timeout=10000)
                await expect(guest.locator('#quiz-content')).to_contain_text('afterparty', timeout=10000)
                await expect(guest.locator('#submit-quiz')).to_be_disabled()
                for page in [host, guest]:
                    await wait_media(page, 'video => video.readyState >= 3')
                await host.locator('#screen-play').click()
                for page in [host, guest]:
                    await wait_media(page, 'video => video.currentTime > 1 && !video.paused', timeout=15)
                times = [await page.locator('#watch-player').evaluate('video => video.currentTime') for page in [host, guest]]
                self.assertLess(abs(times[0] - times[1]), 2.5)
                print('PASS: real video is playing in two independent browser sessions.', flush=True)
                await expect(guest.locator('#watch-progress-label')).to_contain_text('+5 watch points earned', timeout=65000)
                await expect(host.locator('#watch-progress-label')).to_contain_text('+5 watch points earned', timeout=10000)
                await host.locator('#finish-screen').click()
                await expect(guest.locator('#quiz-content fieldset')).to_have_count(5, timeout=10000)
                for fieldset in await guest.locator('#quiz-content fieldset').all():
                    await fieldset.locator('input').first.check()
                await guest.locator('#submit-quiz').click()
                await expect(guest.locator('#submit-quiz')).to_be_disabled()
                await expect(host.locator('#leaderboard-body')).to_contain_text('Movie friend', timeout=10000)
                await host.locator('#announcement-draft').fill('Great screening! Trivia time.')
                await host.locator('#preview-announcement').click()
                await expect(host.locator('#action-status')).to_have_text('Server preview ready.')
                await host.locator('#publish-announcement').click()
                await expect(guest.locator('#published-announcement')).to_contain_text('Great screening!', timeout=10000)
                await host.screenshot(path='/tmp/watchcircle-live-desktop.png', full_page=True)
                for width in [320, 375, 768, 1440]:
                    await host.set_viewport_size({'width': width, 'height': 1000})
                    self.assertTrue(await host.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}px')
                await host.set_viewport_size({'width': 375, 'height': 900})
                await host.screenshot(path='/tmp/watchcircle-live-mobile.png', full_page=True)
                await host.locator('#leave-room').click()
                await expect(guest.locator('#room-status')).to_contain_text('Movie friend (host)', timeout=10000)
                await guest.locator('#leave-room').click()
                await expect(guest.locator('#room-status')).to_contain_text('Polling is stopped')
                self.assertEqual(errors, [])
                print('PASS: watch rewards, post-screening trivia, leaderboard, announcements, host transfer and responsive layouts.', flush=True)
            finally:
                await browser.close()

if __name__ == '__main__':
    unittest.main(verbosity=2)
