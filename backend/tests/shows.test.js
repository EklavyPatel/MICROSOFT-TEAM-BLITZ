import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showProvider } from '../src/services/shows.js';
test('real provider mapping uses fixed URL, timeout, safe plain text and bounded cached results', async () => {
  let calls = 0;
  const provider = showProvider({ fetcher: async (url, options) => {
    calls++; assert.match(url, /^https:\/\/api.tvmaze.com\/search\/shows\?q=/); assert.ok(options.signal);
    return Response.json([{ show: { id: 1, name: 'A show', summary: '<p>Hello &amp; <b>friends</b></p><script>evil()</script>', image: { medium: 'http://unsafe.test/a.jpg' } } }]);
  } });
  const result = await provider.search('a & b'); await provider.search('a & b'); assert.equal(calls, 1);
  assert.deepEqual(result, [{ id: '1', title: 'A show', summary: 'Hello & friends', posterUrl: null }]);
});
test('empty search differs from upstream failure and unknown show returns 400', async () => {
  assert.deepEqual(await showProvider({ fetcher: async () => Response.json([]) }).search('none'), []);
  await assert.rejects(showProvider({ fetcher: async () => { throw Error('offline'); } }).search('x'), { status: 503 });
  await assert.rejects(showProvider({ fetcher: async () => new Response('', { status: 429 }) }).search('x'), { status: 502 });
  await assert.rejects(showProvider({ fetcher: async () => new Response('', { status: 404 }) }).resolve('999'), { status: 400 });
  await assert.rejects(showProvider({ fetcher: async () => Response.json({ invalid: true }) }).search('x'), { status: 502 });
});
test('missing summary and poster are explicit empty string and null', async () => {
  assert.deepEqual(await showProvider({ fetcher: async () => Response.json({ id: 1, name: 'Show' }) }).resolve('1'), { id: '1', title: 'Show', summary: '', posterUrl: null });
});
