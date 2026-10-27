import { convert } from 'html-to-text';
export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function showProvider({ fetcher = fetch, now = Date.now } = {}) {
  const cache = new Map();
  const map = (show) => {
    if (!show || !Number.isInteger(show.id) || typeof show.name !== 'string') throw new Error('Invalid provider data');
    const image = show.image?.medium || show.image?.original;
    return { id: String(show.id), title: show.name,
      posterUrl: typeof image === 'string' && image.startsWith('https://') ? image : null,
      summary: convert(show.summary || '', { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }] }) };
  };
  async function get(path, unknownShow = false) {
    const cached = cache.get(path);
    if (cached && cached.until > now()) return cached.data;
    let response;
    try { response = await fetcher(`https://api.tvmaze.com${path}`, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { Accept: 'application/json' } }); }
    catch { throw new HttpError(503, 'SHOW_PROVIDER_UNAVAILABLE', 'Show search is temporarily unavailable. Please try again shortly.'); }
    if (response.status === 404 && unknownShow) throw new HttpError(400, 'INVALID_SHOW', 'That show is unavailable. Search for another title.');
    if (!response.ok) throw new HttpError(502, 'SHOW_PROVIDER_ERROR', 'The show provider could not complete this request.');
    let data;
    try { data = await response.json(); }
    catch { throw new HttpError(502, 'SHOW_PROVIDER_ERROR', 'The show provider returned an invalid response.'); }
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    cache.set(path, { data, until: now() + 300000 });
    return data;
  }
  return {
    async search(query) {
      const data = await get(`/search/shows?q=${encodeURIComponent(query)}`);
      try { return data.map(item => map(item.show)); }
      catch { throw new HttpError(502, 'SHOW_PROVIDER_ERROR', 'The show provider returned invalid show details.'); }
    },
    async resolve(id) {
      const data = await get(`/shows/${encodeURIComponent(id)}`, true);
      try { return map(data); }
      catch { throw new HttpError(502, 'SHOW_PROVIDER_ERROR', 'The show provider returned invalid show details.'); }
    },
  };
}
