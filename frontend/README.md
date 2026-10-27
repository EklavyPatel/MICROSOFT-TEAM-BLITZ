# WatchCircle frontend

Responsive dark cinema interface built with HTML, CSS, and vanilla JavaScript.
There is no build step, framework, runtime dependency, production mock, or
backend implementation in this directory.

## Download a single HTML file

Download [watchcircle.html](watchcircle.html) using GitHub's **Download raw file**
button. Its CSS and JavaScript are embedded, so it can be opened directly from
your computer. Search, live rooms, scoring, and publishing still need the backend;
the file does not include fake room data or a backend.

The normal source entry is `index.html`. Regenerate the downloadable copy after
editing HTML, CSS, or JavaScript:

```sh
python frontend/build_standalone.py
```

## Run

From the repository root:

```sh
python -m http.server 8000 --directory frontend
```

This serves the interface for inspection. API actions will report failures on
this static server. For functional use, serve these files from the same origin
as a backend implementing [API_CONTRACT.md](API_CONTRACT.md), routing `/api/` to
that backend. The browser uses root-relative `fetch()` requests and same-origin
session cookies. Opening `index.html` as a `file:` URL does not support modules.

## Contract status

The repository was empty and contained no agreed contract. After the user
authorized defining one, the frontend proposed the contract in this directory.
It is **not verified against a backend**. Unexpected response shapes produce
explicit contract errors rather than fabricated data. Real room workflows,
scoring, session handling, permissions, and announcement delivery require the
backend. Discord credentials and delivery logic must remain on that server.

## Behavior

- Search cards use text-safe rendering and missing/broken-poster fallbacks.
- Create or join a room with a nickname. Share the returned room code.
- The host selects a show, edits a time/note, and saves the shared plan.
- Participants vote Yes/No, send discussion messages, and answer General TV Trivia.
- Scores are supplied by the server. No correct quiz answers ship in frontend code.
- Host announcements require a successful server preview before publishing.
- Polls run every three seconds, skipping ticks while a read is pending. They
  pause in hidden tabs, resume on return, and stop on exit, expiration, or loss
  of session. Transient failures retain the last valid room and retry.
- Polling preserves message/announcement drafts, unsaved plan fields, and quiz
  choices. Sending a message clears its draft only if the user has not edited
  it during the request. Quiz radio nodes stay intact during normal updates.
- Pending actions are disabled and guarded against repeated submissions.
- Nickname and the current room code are retained in session storage when
  available. Message and announcement drafts stay in memory, not persistent
  storage, and do not survive a page reload.

## Validation

Request/polling tests (Node 24 was used):

```sh
node --test frontend/tests/api.test.mjs
```

Browser integration tests require Python's `playwright` package and Chromium.
They use the system `chromium` binary if present, otherwise Playwright's browser.
Install browser test tooling separately if needed with `python -m pip install
playwright` and `python -m playwright install chromium`.

```sh
python -m unittest discover -s frontend/tests -p 'test_*.py' -v
```

Browser tests explicitly intercept the documented API with test fixtures. They
exercise the full room workflow, request failures with no backend, host controls,
expiration, preserved drafts/answers, duplicate submits, XSS-safe content,
keyboard tab navigation, and layouts at 320, 375, 768, and 1440 pixels. These
tests validate the frontend, not live backend compatibility.
