import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posterProvider } from '../src/services/posters.js';
const url = 'https://static.tvmaze.com/uploads/images/medium_portrait/504/1262352.jpg';
test('posters fetch only canonical HTTPS TVmaze image paths and reuse cached bytes', async () => {
  let calls = 0;
  const load = posterProvider({ fetcher: async (request, options) => {
    calls++; assert.equal(request, url); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'content-type': 'image/jpeg' } });
  } });
  assert.equal((await load(url)).type, 'image/jpeg'); assert.equal((await load(url)).bytes.length, 4); assert.equal(calls, 1);
  for (const value of ['http://localhost/image.jpg', 'https://evil.test/file.jpg', 'https://static.tvmaze.com@evil.test/file.jpg', 'https://static.tvmaze.com/uploads/images/medium_portrait/../secret', null]) await assert.rejects(load(value), { status: 404 });
  assert.equal(calls, 1);
});
test('posters reject HTML, oversized responses, and network failures', async () => {
  await assert.rejects(posterProvider({ fetcher: async () => new Response('<script>bad()</script>', { headers: { 'content-type': 'text/html' } }) })(url), { status: 502 });
  await assert.rejects(posterProvider({ fetcher: async () => new Response(new Uint8Array(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'image/png' } }) })(url), { status: 502 });
  await assert.rejects(posterProvider({ fetcher: async () => { throw Error('offline'); } })(url), { status: 503 });
});
