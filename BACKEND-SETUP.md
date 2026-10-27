# Run CineMaTicS with its backend

The downloaded `outputs/CineMaTicS.html` is a portable front-end demo. A single HTML file cannot run a server, so it keeps its profile and activity in the current browser. For accounts, room chat, synchronized community cinema, trivia, and leaderboards, run the project site below.

## Step 1: Install Node.js

Install Node.js 20 or newer from [nodejs.org](https://nodejs.org/). Node runs the website server on your computer. CineMaTicS does not need paid services, API keys, or secrets for local development.

## Step 2: Open the project in Terminal

Open Terminal and go to the project folder:

```sh
cd "/Users/kisalayshukla/Documents/Codex/2026-10-27/build-the-complete-cinematics-website-in"
```

Check that Node is available:

```sh
node --version
```

The version should be `v20` or newer.

## Step 3: Start the server

Run:

```sh
npm run dev
```

The terminal should say that CineMaTicS is ready at `http://localhost:3000`. Keep that terminal window open while you use the site.

## Step 4: Open the backend-connected site

Visit [http://localhost:3000](http://localhost:3000) in your browser. Sign up from the top-right button, create a room under Community Cinema, and copy its invite link for other members. The host can load the sample film, start and control shared playback, and open General TV Trivia after the screening. Every member can chat, enable sound locally, and earn room points. Everyone must open the same hosted website; a `localhost` invite only works on the host's computer. TV search, music search, and Open Trivia DB rounds need an internet connection to reach their public APIs.

Press `Ctrl+C` in the Terminal window to stop the server. Run `npm run dev` again whenever you want to use the site.

## Where the backend is

- `server.js` serves the frontend and its `/api/...` routes.
- `public/index.html`, `public/styles.css`, and `public/app.js` are the server-connected website.
- User accounts, watchlists, cinema rooms, room membership, chat, playback position, watch points, trivia scores, and discussions are saved in `data/cinematics.json`. The server creates this file the first time it starts. It is local to this project and excluded from Git.
- Passwords are saved as salted scrypt hashes. Sign-in cookies are held in server memory, so stopping or restarting the server signs accounts out; saved data stays on disk.

## Local version versus public website

This backend is for running the site on your own computer. Other people cannot use your `localhost` address. Publishing it online requires a hosting provider, a production database, persistent secure sessions, HTTPS, email verification and password recovery, and abuse protections. Do not put real customer data into this local starter version.
