# Publish CineMaTicS on Render

[Deploy this repository on Render](https://render.com/deploy?repo=https://github.com/EklavyPatel/MICROSOFT-TEAM-BLITZ)

1. Sign in to Render and connect GitHub. Grant access to `EklavyPatel/MICROSOFT-TEAM-BLITZ`.
2. Open the link above. Render reads `render.yaml` from `main`.
3. Review the service and disk pricing before confirming. The Blueprint uses a
   **paid Starter web service and a 1 GB persistent disk**. No service is created
   and no hosting charge is authorized merely by saving these files to GitHub.
4. Create the Blueprint and wait for the service status to become **Live**.
5. Open the HTTPS URL displayed on the service dashboard. Share that URL with
   friends. Frontend, API, accounts and cinema rooms use the same public origin.

Render supplies `PORT` and `RENDER_EXTERNAL_URL` automatically. The server binds
all interfaces and uses the Render HTTPS URL to validate browser mutations.
For a custom domain, set `APP_ORIGIN` to its exact HTTPS origin without a trailing
slash and configure the domain in Render. Secure session cookies are enabled in
production. No API keys are needed for the public discovery services.

`DATA_DIR=/var/data/cinematics` places the JSON store on the persistent disk.
The server serializes writes and atomically replaces the data file. Deploy only
one instance: this file-based database does not support multiple service replicas.
Do not remove the disk when redeploying. Sessions remain in memory; deployment
or restart signs people out, while accounts, rooms and scores remain on disk.
Back up the disk before making significant changes to stored data.

Health check: `GET /api/health` must return HTTP 200 and `{"ok":true}`. After
launch, verify signup/signin, a room shared between two browsers, chat and video.
The bundled sample is served by this Node server, including video Range requests.
External discovery depends on TVmaze, Wikipedia, iTunes and Open Trivia DB uptime.

Local deployment checks: `node --test tests/deployment.test.mjs`. These run a real
production-mode HTTP server on a temporary port with an isolated data directory;
no hosting account or external provider is contacted.

This publishes the uploaded starter application, with its existing feature scope.
It has no password recovery, email verification or moderation tooling. Use a
small-community launch; a larger public service needs abuse controls and a shared
production database. The Render setup is prepared in GitHub; only the Render
dashboard can confirm the actual public URL and successful deployment.
