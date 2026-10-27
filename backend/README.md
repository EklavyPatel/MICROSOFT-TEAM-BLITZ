# WatchCircle backend

A runnable Node 24 / Express 5 application serving the WatchCircle frontend and
JSON API from one origin, with persistent SQLite storage. No accounts, API keys,
or external database are needed for local development.

## Start

From the repository root:

```sh
cd backend
npm ci
npm run db:init       # optional: startup also initializes schema version 1
npm run dev          # watches backend source; default port 3000
# or npm start
```

Use Node **24.5 or newer within the 24 LTS line** (validated with 24.19.0).
`node:sqlite` supplies SQLite without native package compilation. Startup enables
Node's supported environment-proxy handling so provider requests use configured
HTTPS proxies. TLS verification stays enabled.

The server defaults to port **3000**, serving `frontend/index.html`. Open the
application using the hostname configured by `APP_ORIGIN`. Create a room and
share its invitation link or eight-character code. Each friend needs their own
browser profile/session; tabs in the same browser share one anonymous identity.
The Node server must be reachable by both people for invitations to work.

Load the sample film, press **Play together**, and use the room discussion.
The host can pause, seek, and finish the screening. Finishing opens trivia.
Search TVmaze to plan other shows; search results are metadata, not licensed
video streams. The sample trailer is bundled under `frontend/media/`, with its
CC BY 3.0 attribution in `LICENSE.txt` and in the player. Hosts can also supply
a shareable HTTPS MP4/WebM URL with its duration. Browser codec support and the
media host's access policy still apply; streaming-service page URLs aren't media.

## Configuration

Copy `.env.example` to `.env` only if changing defaults. Never commit `.env`.
The npm scripts load it when present. Relative database paths resolve from
`backend/`, independently of the shell working directory.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | development | `production` requires an HTTPS application origin and Secure cookies |
| `HOST` | `0.0.0.0` | Listener interface |
| `PORT` | `3000` | Listener port |
| `APP_ORIGIN` | `http://localhost:3000` | Exact browser origin, no trailing slash |
| `DB_PATH` | `data/watchcircle.sqlite` | Writable persistent database file |
| `ROOM_LIFETIME_HOURS` | `24` | Fixed lifetime from creation; reads never extend it |
| `SESSION_LIFETIME_DAYS` | `7` | Session expiry, refreshed at successful room entry |
| `ROOM_CAPACITY` | `50` | Active memberships per room |
| `ROOM_MESSAGE_LIMIT` | `1000` | Entire feed retained; further posts fail with `ROOM_MESSAGE_LIMIT` |
| `TRUST_PROXY` | unset / false | Only an explicitly trusted proxy IP/CIDR or named subnet such as `loopback` |

No secrets are required. Discord delivery is **not implemented**; announcements
are saved in the room only. The app never claims to notify Discord.

Outbound HTTPS: `api.tvmaze.com` for real search and canonical show details;
`static.tvmaze.com` for canonical posters fetched by the backend and served from
`/posters/:showId`. This keeps clients on the same origin; poster fetches retain
TLS verification, allow only fixed TVmaze image paths, time out after 8 seconds,
and cap images at 2 MiB with a 20 MiB in-memory cache. `media.w3.org` was the source
of the bundled sample; normal playback is same-origin and needs no external
video request. Custom video URLs are loaded by browsers; the server never
fetches user-supplied URLs. No permissive CORS is enabled.

## Identity, security and lifecycle

- Cryptographically random cookie tokens are HttpOnly, SameSite=Lax, Path=/,
  and Secure in HTTPS production. SQLite stores SHA-256 token hashes.
- One session can join many rooms. Nicknames are display text, never identity.
  Rejoining reactivates the same participant, preserving nickname and quiz history.
- Every room operation checks active membership; plan, announcements and shared
  playback controls additionally require the host. Leaving transfers hosting to
  the earliest-joined active member. Repeated departures are safe.
- JSON mutations require `application/json`. Present Origin headers must exactly
  match `APP_ORIGIN`; cross-site Fetch Metadata is rejected. Non-browser clients
  without Origin are allowed with JSON and valid cookies. No custom CSRF header
  or frontend login flow is required.
- Entry/search limits are per IP. Message/announcement/mutation limits use the
  session when authenticated, allowing many watchers behind one network. Default
  limits per minute: entry 30, search 60, messages 60, announcements 30, all
  mutations 240. Three-second GET polling is not rate-limited.
- Requests are limited to 32 KiB. Length limits: nickname 32, query 100, note 500,
  message and announcement 2,000. Inputs are validated; database queries are
  parameterized; frontend rendering uses plain text. Helmet supplies headers and
  a CSP without inline scripts or unsafe eval.
- Only explicitly public frontend files and the sample video are served; tests,
  source, database, environment files and docs are never exposed by static routes.
- Lazy expiry returns 410 for known expired rooms. Minute cleanup deletes expired
  room data and retains code tombstones until seven days after expiry. Unknown
  codes return 404. Session expiry returns 401. Polling has no mutation side effects.
- SQLite uses foreign keys, WAL, a 5-second busy timeout, uniqueness constraints
  and transactions. External provider requests happen outside transactions.
  Persisted quizzes store five selected questions and choice order from a private
  24-question bank. Restarting does not reshuffle questions or clear sessions.
- Shutdown on SIGTERM/SIGINT stops accepting requests, drains connections and
  closes SQLite; a 10-second timeout handles stuck connections.

## Points and playback

The room leaderboard totals **5 watch points** plus **10 per correct trivia
answer**, up to 55 points. A zero-score quiz submission is still listed. Ties
are deterministic. Scores remain visible after departure and cannot be earned
again by leaving/rejoining. Each room has one quiz submission and at most one
watch award per participant, even when the host changes videos.

Video sync uses the server's playback timeline, refreshed every three seconds.
The host controls play/pause/seek and opens trivia with Finish screening. Guests
can enable sound or rejoin playback without changing the shared timeline.
The browser starts muted to satisfy autoplay rules. Sync is approximate, not
frame-accurate, and is designed for a small community.

Watch progress uses three-second heartbeats while the tab is visible, the video
is playing and buffered, and its position is close to the server timeline.
The server credits elapsed time, not the number of requests. Pauses, seeks,
unobserved gaps longer than 15 seconds, and repeat submissions do not manufacture
watch seconds. The reward is granted once after 80% of the video's duration.
The host supplies custom-media duration; the bundled sample has a measured
52.208-second duration. Heartbeats are participation evidence, **not DRM or
proof of human attention**. A determined client or host can misrepresent playback;
these points are intended for friendly community competition.

With no screening loaded, the original General TV Trivia workflow remains
available. Loading a screening locks submissions until the host finishes it;
already-earned scores remain unchanged. Finishing early opens trivia but does
not grant anyone watch points. Trivia is general TV knowledge, not generated
questions about the selected film.

## Tests

From the repository root:

```sh
npm test --prefix backend
node --test frontend/tests/api.test.mjs
python -m unittest discover -s frontend/tests -p 'test_*.py' -v
```

The backend suite uses isolated on-disk temporary SQLite databases and
cookie-preserving HTTP clients. Only its TVmaze service is replaced with fixtures.
It covers identity, permissions, expiry, persistence, input validation, CSRF,
votes, chat, quizzes, atomic duplicate scoring, playback controls and rewards.
Provider tests separately check mapping, timeouts and errors using HTTP fixtures.
The existing frontend suite intercepts API requests with explicit test fixtures.

For **live** HTTP and two-browser integration tests, start `npm start` first:

```sh
npm run test:smoke --prefix backend
python backend/tests/test_live_browser.py
```

These use the running Express/SQLite app, **real TVmaze requests and the real
bundled Sintel video**, without API/media mocks. The browser test watches enough
of the trailer to earn points in two independent cookie contexts, then tests
trivia, announcements, host transfer and 320/375/768/1440px layouts. Expect about
90 seconds. Screenshots are saved to `/tmp/watchcircle-live-desktop.png` and
`/tmp/watchcircle-live-mobile.png`. Use a development/test database; smoke tests
create rooms that expire normally and leave participants afterward on success.
Set `SMOKE_ORIGIN` or `TEST_APP_ORIGIN` if using a different configured origin.

Python browser tooling: `python -m pip install playwright`, then
`python -m playwright install chromium` if no system `chromium` is installed.
The prepared cloud environment already includes both. No tooling is needed in
the shipped application runtime.

## Example requests

These shell commands are for a machine running the application locally:

```sh
curl -c /tmp/watchcircle-host.cookies -H 'Content-Type: application/json' \
  -d '{"nickname":"Alex"}' http://localhost:3000/api/rooms
# Substitute the returned invitation code below.
curl -b /tmp/watchcircle-host.cookies http://localhost:3000/api/rooms/ROOMCODE
curl 'http://localhost:3000/api/shows?q=Dark'
curl -b /tmp/watchcircle-host.cookies -H 'Content-Type: application/json' \
  -X PUT -d '{"sample":true}' http://localhost:3000/api/rooms/ROOMCODE/screen
curl -b /tmp/watchcircle-host.cookies -H 'Content-Type: application/json' \
  -d '{"text":"Ready for movie night!"}' http://localhost:3000/api/rooms/ROOMCODE/messages
```

The original endpoints are listed in `frontend/API_CONTRACT.md`. Room-state
extensions add `screen` and `quiz.locked` without changing existing fields.

## Deploying

Use a Node-capable host/container and a **persistent local volume** for SQLite.
Serve frontend and `/api` on the same HTTPS origin through a reverse proxy,
set `NODE_ENV=production`, `APP_ORIGIN` to that exact public origin, and
`TRUST_PROXY` only to the actual proxy address/subnet. Forward requests including
cookies and video Range requests. Keep database backups outside the public
frontend directory. Use SQLite's backup API or stop the app before copying the
database and its WAL; copying only an active `.sqlite` file is not a safe backup.

Run a single application instance for the supported small-community deployment.
Do not share SQLite over network filesystems; a larger multi-instance service
needs a shared database and distributed rate limiting. The application does not
include video transcoding, HLS/DASH, DRM, a licensed commercial catalog, paid
subscriptions, global accounts or Discord notifications. Search metadata does
not grant streaming rights. GitHub Pages cannot run this backend or store SQLite.
