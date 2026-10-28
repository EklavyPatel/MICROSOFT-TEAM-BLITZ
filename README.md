website link - https://microsoft-team-blitz.onrender.com/
we uploaded a small video in that dashboard given in api blitz but you want full detailed video link that's here
video link - https://youtu.be/15S88n0QHyw
# CineMaTicS

CineMaTicS is a responsive entertainment discovery and community website. The homepage follows the supplied cinematic mockup and includes show search, soundtrack discovery, trivia, community cinema rooms, discussion areas, accounts, and a saved-title list.

For beginner-friendly instructions to start the server-backed version, see [BACKEND-SETUP.md](BACKEND-SETUP.md).

## Publish on Render

[Deploy to Render](https://render.com/deploy?repo=https://github.com/EklavyPatel/MICROSOFT-TEAM-BLITZ)

The repository includes a Render Blueprint with a Node web service and persistent
storage for accounts and rooms. Review Render's paid service and disk pricing
before creating it. See [DEPLOY.md](DEPLOY.md) for the exact steps, custom-domain
settings and deployment checks. The public site is live only after Render reports
**Live** and provides its HTTPS URL.

## Run it locally

1. Install [Node.js 20 or newer](https://nodejs.org/) if it is not already installed.
2. Open a terminal in this folder.
3. Start the site:

   ```sh
   npm run dev
   ```

4. Visit [http://localhost:3000](http://localhost:3000). Press `Ctrl+C` in the terminal to stop it.

There are no package installs, API keys, or secrets to configure. To use another port, set `PORT` before starting the server, for example `PORT=4000 npm run dev`.

## What is connected

- **TV search:** the server looks up shows through the public [TVmaze API](https://www.tvmaze.com/api). Search results include show details and a link to the TVmaze listing.
- **Movie search:** film searches use Wikipedia’s public search API to find film descriptions and available artwork. A movie result opens a Hotstar catalog search for that title; actual availability depends on Hotstar’s catalog and region. TV show results continue to link to their TVmaze listings. CineMaTicS does not use a private Hotstar API or stream its catalog.
- **Trivia:** each round requests ten multiple-choice questions from the [Open Trivia Database](https://opentdb.com/).
- **Music:** searches the public [Apple iTunes Search API](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/iTuneSearchAPI/) for tracks and provides preview clips and links to Apple. CineMaTicS does not stream or claim ownership of Apple’s full catalog.
- **Community cinema:** the host can load the bundled Sintel sample or a direct HTTPS MP4/WebM video URL. Play, pause, seek, and screening progress sync through the local server. Members earn 10 points after watching at least 80% of the screening; the host unlocks movie-specific trivia after the screening finishes, worth 5 points per correct answer. Members can chat and see the room leaderboard. Sound starts muted and each participant can enable it. This feature does not play commercial streaming-service catalogs.
- **Sample film:** the Sintel trailer in `public/assets/sintel-trailer.mp4` is distributed under CC BY 3.0. Attribution and license details are in `public/assets/SINTEL-LICENSE.txt` and in the cinema room.
- **Community:** signed-in members can post and reply in discussion rooms.
- **Accounts and lists:** members can sign up, sign in, edit a small profile, and save or remove shows. Passwords are stored as salted scrypt hashes. The local session is held in server memory, so restarting the server signs everyone out.
- **Viewing progress:** update any saved title from 0% to 100%. Your list shows the progress bar and marks a title finished at 100%; the progress is saved with that account's watchlist.
- **Crowd check-ins:** members can check in as watching a title. The page displays active check-ins (up to 90 minutes) and picks from the last hour; these are voluntary check-ins, not playback telemetry.
- **Title trivia and CineCoins:** quizzes use a saved title's listing details (synopsis, year, and genre where available). The local demo awards virtual CineCoins for correct answers. They have no cash value and are not a paid subscription.

The mockup and its logo are in `outputs/`; the site serves its working copies of the logo and hero artwork from `public/assets/`. The original reference artwork is not used as the finished page: its visual style is recreated with responsive HTML and CSS.

The downloadable `outputs/CineMaTicS.html` is a local preview. Its demo profile, rooms, messages, and CineCoins stay in that browser. In a standalone room, members self-report watching; marking the movie watched adds 10 local CineCoins and unlocks one five-question film trivia round worth 5 CineCoins per correct answer. For multi-user room chat, playback tracking, and server-backed points, start the server with `npm run dev`, open `http://localhost:3000`, sign in, and create or enter a cinema room. Other people need to use the same hosted server to join it.

## Local data and scope

Member accounts, rooms, room chat, screening state, watch points, trivia scores, and discussion posts are stored in `data/cinematics.json` while the app runs. This file is created automatically and is ignored by Git. The local server syncs playback by polling every few seconds. This is a local starter application, not a hardened public deployment: it has no email verification, password reset, external database, distributed sessions, abuse moderation, or production rate limiting. Add those before launching it for a public audience.

## Troubleshooting

- If an outside API is unavailable, the rest of the site still loads and the relevant area shows an error you can retry later.
- Public APIs require an internet connection. If the browser cannot reach TVmaze, iTunes, or Open Trivia DB through this server, check the connection and try again.
- `EADDRINUSE` means another process already uses port 3000. Stop that process or start with a different `PORT`.
