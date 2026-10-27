# WatchCircle · MSTC

A community cinema website: find a show, invite your friends, watch a sample film
in sync, discuss it, earn watch points, play trivia and climb the room leaderboard.
The frontend uses your original WatchCircle design, with an MSTC hillside sign
inspired by Hollywood and a connected community player.

## Run the whole website

Requires Node 24 LTS (24.5+):

```sh
cd backend
npm ci
npm start
```

The app runs on port **3000** with the frontend and API on the same origin.
Create a room, share its code, load the sample film and press **Play together**.
Use separate browsers/profiles to try two participants. The host finishes the
screening to open trivia. Watch 80% with the tab visible for **5 points**; each
correct trivia answer adds **10 points**. Progress, messages and scores persist
in SQLite across application restarts.

TV search uses real TVmaze metadata. The bundled CC BY 3.0 **Sintel trailer**
is the sample film; hosts can supply their own shareable HTTPS video.
Commercial streaming services remain separate; this app does not stream their
catalogs. Trivia is a curated general-TV quiz, not movie-specific generated trivia.

See [backend/README.md](backend/README.md) for configuration, tests, deployment,
API examples, scoring details, security and limitations. See
[frontend/API_CONTRACT.md](frontend/API_CONTRACT.md) for API integration.

## Validate

```sh
npm test --prefix backend
node --test frontend/tests/api.test.mjs
python -m unittest discover -s frontend/tests -p 'test_*.py' -v
# With npm start running:
npm run test:smoke --prefix backend
python backend/tests/test_live_browser.py
```

The two live tests exercise the real backend, real search and bundled video.
The other suites isolate external services with explicit test fixtures.
