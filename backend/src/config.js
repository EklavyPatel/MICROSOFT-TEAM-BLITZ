import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const integer = (name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
};
export function configuration(overrides = {}) {
  const port = integer('PORT', 3000, 1, 65535);
  const origin = process.env.APP_ORIGIN || `http://localhost:${port}`;
  if (new URL(origin).origin !== origin) throw new Error('APP_ORIGIN must be an origin without a trailing slash');
  const production = process.env.NODE_ENV === 'production';
  if (production && !origin.startsWith('https://')) throw new Error('Production requires HTTPS APP_ORIGIN');
  return {
    port, origin, production,
    host: process.env.HOST || '0.0.0.0',
    dbPath: path.resolve(root, process.env.DB_PATH || 'data/watchcircle.sqlite'),
    frontend: fileURLToPath(new URL('../../frontend', import.meta.url)),
    roomLifetimeMs: integer('ROOM_LIFETIME_HOURS', 24) * 3600000,
    sessionLifetimeMs: integer('SESSION_LIFETIME_DAYS', 7) * 86400000,
    capacity: integer('ROOM_CAPACITY', 50),
    messageLimit: integer('ROOM_MESSAGE_LIMIT', 1000),
    trustProxy: process.env.TRUST_PROXY || false,
    rateLimits: true,
    now: () => Date.now(),
    ...overrides,
  };
}
