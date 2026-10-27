"""Browser integration tests with explicit API fixtures, never a production mock.

Run: python -m unittest discover -s frontend/tests -p 'test_*.py' -v
Requires Playwright for Python and Chromium (or Playwright's installed browser).
"""
import asyncio
import copy
import functools
import json
import shutil
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
SHOW = {"id": "show1", "title": "<img src=x onerror=alert(1)>", "summary": "A show worth sharing.", "posterUrl": None}
ROOM = {
    "code": "CIRCLE", "me": {"id": "u1", "nickname": "Alex", "isHost": True},
    "members": [{"id": "u1", "nickname": "Alex"}], "plan": None,
    "poll": {"yes": 0, "no": 0, "myVote": None}, "messages": [],
    "quiz": {"id": "q1", "title": "General TV Trivia", "submitted": False,
             "questions": [{"id": "question1", "text": "Which is a TV genre?", "choices": [{"id": "c1", "text": "Drama"}, {"id": "c2", "text": "A toaster"}]}]},
    "leaderboard": [], "announcement": None,
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class FrontendBrowserTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    async def asyncSetUp(self):
        self.playwright = await async_playwright().start()
        self.browser = await self.playwright.chromium.launch(executable_path=shutil.which("chromium") or None)
        self.page = await self.browser.new_page()
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.room = copy.deepcopy(ROOM)
        self.calls = []
        self.reads = 0
        self.room_status = 200

    async def asyncTearDown(self):
        await self.browser.close()
        await self.playwright.stop()
        self.assertEqual(self.errors, [])

    async def fixtures(self):
        async def route(handler):
            req = handler.request
            path = req.url.removeprefix(self.url).split("?")[0]
            method = req.method
            body = req.post_data_json if req.post_data else {}
            self.calls.append((method, path, body))
            data = {"ok": True}
            status = 200
            if path == "/api/shows":
                data = {"shows": [SHOW, {**SHOW, "id": "broken", "title": "Broken poster", "posterUrl": "/missing-poster.png"}]}
            elif path == "/api/rooms" or path.endswith("/join"):
                await asyncio.sleep(.15)
                data = {"code": "CIRCLE"}
            elif path == "/api/rooms/CIRCLE" and method == "GET":
                self.reads += 1
                status = self.room_status
                data = self.room if status == 200 else {"error": {"code": "ROOM_GONE", "message": "Room unavailable"}}
            elif path.endswith("/plan"):
                self.room["plan"] = {"show": SHOW, "watchAt": body["watchAt"], "note": body["note"]}
            elif path.endswith("/vote"):
                self.room["poll"] = {"yes": 1, "no": 0, "myVote": body["answer"]}
            elif path.endswith("/messages"):
                await asyncio.sleep(.2)
                self.room["messages"].append({"id": str(len(self.room["messages"])), "nickname": "Alex", "text": body["text"], "createdAt": "2026-10-27T12:00:00Z"})
            elif path.endswith("/quiz/answers"):
                self.room["quiz"]["submitted"] = True
                self.room["leaderboard"] = [{"participantId": "u1", "nickname": "Alex", "points": 10}]
            elif path.endswith("/announcements/preview"):
                data = {"text": body["text"]}
            elif path.endswith("/announcements"):
                self.room["announcement"] = {"text": body["text"], "publishedAt": "2026-10-27T12:00:00Z"}
            elif path.endswith("/leave"):
                await handler.fulfill(status=204)
                return
            else:
                raise AssertionError(f"Undocumented request: {method} {path}")
            await handler.fulfill(status=status, content_type="application/json", body=json.dumps(data))
        await self.page.route("**/api/**", route)

    async def join(self):
        await self.page.goto(self.url)
        await self.page.locator("#nickname").fill("Alex")
        await self.page.locator("#create-submit").click()
        await expect(self.page.locator("#room-status")).to_contain_text("You’re Alex")

    async def test_room_workflow_drafts_quiz_xss_and_leave(self):
        await self.fixtures()
        await self.join()
        self.assertEqual(sum(path == "/api/rooms" for _, path, _ in self.calls), 1)
        await self.page.locator("#show-search").fill("Example")
        await self.page.locator("#search-submit").click()
        await expect(self.page.locator(".show-card")).to_have_count(2)
        await expect(self.page.locator(".show-card h3").first).to_have_text(SHOW["title"])
        await expect(self.page.locator(".show-card h3 img")).to_have_count(0)
        await expect(self.page.locator(".poster-fallback").nth(1)).to_be_visible()
        await self.page.locator("[data-choose-show=show1]").click()
        await self.page.locator("#plan-note").fill("Bring popcorn")
        await self.page.locator("#save-plan").click()
        await expect(self.page.locator("#plan-display")).to_contain_text("Bring popcorn")
        await self.page.locator("#vote-yes").click()
        await expect(self.page.locator("#vote-yes")).to_have_attribute("aria-pressed", "true")
        await self.page.locator("#message-draft").fill("Keep my draft")
        await self.page.locator("input[value=c1]").check()
        await self.page.evaluate("window.originalChoice = document.querySelector('input[value=c1]')")
        reads_before = self.reads
        for _ in range(45):
            if self.reads > reads_before:
                break
            await asyncio.sleep(.1)
        self.assertGreater(self.reads, reads_before)
        await expect(self.page.locator("#message-draft")).to_have_value("Keep my draft")
        await expect(self.page.locator("input[value=c1]")).to_be_checked()
        self.assertTrue(await self.page.evaluate("window.originalChoice === document.querySelector('input[value=c1]')"))
        await self.page.locator("#message-draft").fill("<script>window.pwned=true</script>")
        await self.page.locator("#send-message").click()
        await self.page.locator("#message-form").evaluate("form => form.dispatchEvent(new Event('submit', {cancelable:true}))")
        await self.page.locator("#message-draft").fill("New draft while sending")
        await expect(self.page.locator("#discussion-feed")).to_contain_text("<script>window.pwned=true</script>")
        await expect(self.page.locator("#discussion-feed script")).to_have_count(0)
        await expect(self.page.locator("#message-draft")).to_have_value("New draft while sending")
        self.assertEqual(sum(path.endswith("/messages") for _, path, _ in self.calls), 1)
        await self.page.locator("#submit-quiz").click()
        await expect(self.page.locator("#leaderboard-body")).to_contain_text("10")
        await expect(self.page.locator("#submit-quiz")).to_be_disabled()
        await self.page.locator("#announcement-draft").fill("<b>Tonight at eight</b>")
        await self.page.locator("#preview-announcement").click()
        await expect(self.page.locator("#action-status")).to_have_text("Server preview ready.")
        await self.page.locator("#publish-announcement").click()
        await expect(self.page.locator("#published-announcement")).to_contain_text("<b>Tonight at eight</b>")
        await expect(self.page.locator("#published-announcement b")).to_have_count(0)
        await self.page.locator("#leave-room").click()
        await expect(self.page.locator("#room-status")).to_contain_text("Polling is stopped")
        reads_after = self.reads
        await asyncio.sleep(3.2)
        self.assertEqual(self.reads, reads_after)
        await expect(self.page.locator("#message-draft")).to_have_value("New draft while sending")

    async def test_expired_room_stops_polling(self):
        self.room_status = 410
        await self.fixtures()
        await self.page.goto(self.url)
        await self.page.locator("#nickname").fill("Alex")
        await self.page.locator("#join-tab").click()
        await self.page.locator("#room-code").fill("CIRCLE")
        await self.page.locator("#join-submit").click()
        await expect(self.page.locator("#room-status")).to_contain_text("expired")
        await asyncio.sleep(3.2)
        self.assertEqual(self.reads, 1)
        await expect(self.page.locator("#leave-room")).to_be_hidden()

    async def test_no_backend_reports_failure_and_keeps_drafts(self):
        await self.page.goto(self.url)
        await self.page.locator("#message-draft").fill("Unsent message")
        await self.page.locator("#show-search").fill("Anything")
        await self.page.locator("#search-submit").click()
        await expect(self.page.locator("#search-status")).to_contain_text("Search couldn’t load")
        await expect(self.page.locator("#search-submit")).to_be_enabled()
        await self.page.locator("#nickname").fill("Alex")
        await self.page.locator("#create-submit").click()
        await expect(self.page.locator("#action-status")).to_contain_text("Request failed")
        await expect(self.page.locator("#create-submit")).to_be_enabled()
        await expect(self.page.locator("#message-draft")).to_have_value("Unsent message")

    async def test_member_cannot_use_host_controls(self):
        self.room["me"]["isHost"] = False
        await self.fixtures()
        await self.join()
        await self.page.locator("#announcement-draft").fill("Hello")
        await expect(self.page.locator("#publish-announcement")).to_be_disabled()
        await expect(self.page.locator("#save-plan")).to_be_disabled()
        await self.page.locator("#preview-announcement").click()
        await expect(self.page.locator("#action-status")).to_contain_text("Local draft preview")
        self.assertFalse(any("announcements" in path for _, path, _ in self.calls))

    async def test_responsive_layout_and_keyboard_tabs(self):
        await self.page.goto(self.url)
        for width in [320, 375, 768, 1440]:
            await self.page.set_viewport_size({"width": width, "height": 1000})
            self.assertTrue(await self.page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), f"Overflow at {width}px")
        await self.page.locator("#create-tab").focus()
        await self.page.keyboard.press("ArrowRight")
        await expect(self.page.locator("#join-tab")).to_be_focused()
        await expect(self.page.locator("#join-panel")).to_be_visible()
        await self.page.screenshot(path="/tmp/watchcircle-desktop.png", full_page=True)
        await self.page.set_viewport_size({"width": 375, "height": 900})
        await self.page.screenshot(path="/tmp/watchcircle-mobile.png", full_page=True)

    async def test_downloadable_html_has_no_external_assets(self):
        # This managed browser blocks file:// URLs by administrator policy.
        # Serve the exact artifact to verify its embedded code and styles.
        assets = []
        self.page.on("request", lambda request: assets.append(request.url))
        await self.page.goto(self.url + "/watchcircle.html")
        await expect(self.page.locator("h1")).to_contain_text("group thing")
        await expect(self.page.locator('script[src], link[rel="stylesheet"]')).to_have_count(0)
        self.assertEqual(await self.page.locator("body").evaluate("node => getComputedStyle(node).backgroundColor"), "rgb(17, 17, 19)")
        await self.page.locator("#join-tab").click()
        await expect(self.page.locator("#join-panel")).to_be_visible()
        await self.page.locator("#announcement-draft").fill("Tonight with the circle")
        await self.page.locator("#preview-announcement").click()
        await expect(self.page.locator("#announcement-preview-text")).to_have_text("Tonight with the circle")
        self.assertEqual(assets, [self.url + "/watchcircle.html"])


if __name__ == "__main__":
    unittest.main()
