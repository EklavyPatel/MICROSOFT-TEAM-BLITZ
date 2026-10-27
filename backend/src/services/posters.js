import { HttpError } from './shows.js';
// The browser sees same-origin posters. Only canonical TVmaze image paths can be fetched.
export function posterProvider({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  let cachedBytes = 0;
  return async function loadPoster(url) {
    if (typeof url !== 'string' || !/^https:\/\/static\.tvmaze\.com\/uploads\/images\/(medium_portrait|original_untouched)\/\d+\/\d+\.(jpg|jpeg|png|webp)$/.test(url))
      throw new HttpError(404, 'POSTER_UNAVAILABLE', 'No poster is available.');
    const cached = cache.get(url);
    if (cached && cached.until > now()) return cached;
    if (cached) { cache.delete(url); cachedBytes -= cached.bytes.length; }
    let response;
    try { response = await fetcher(url, { signal: AbortSignal.timeout(8000), redirect: 'error' }); }
    catch { throw new HttpError(503, 'POSTER_UNAVAILABLE', 'The poster provider is temporarily unavailable.'); }
    const type = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type)) {
      await response.body?.cancel();
      throw new HttpError(502, 'POSTER_UNAVAILABLE', 'The poster provider returned an invalid image.');
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) throw new Error('Image exceeds size limit');
        chunks.push(chunk);
      }
    } catch { throw new HttpError(502, 'POSTER_UNAVAILABLE', 'The poster could not be loaded.'); }
    const item = { bytes: Buffer.concat(chunks), type, until: now() + 1800000 };
    while (cachedBytes + size > 20 * 1024 * 1024 && cache.size) {
      const oldest = cache.keys().next().value;
      cachedBytes -= cache.get(oldest).bytes.length;
      cache.delete(oldest);
    }
    cache.set(url, item); cachedBytes += size;
    return item;
  };
}
