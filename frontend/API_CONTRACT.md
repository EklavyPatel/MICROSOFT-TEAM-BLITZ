# WatchCircle API — proposed v1

Implemented by `backend/` using Express 5 and persistent SQLite. The frontend and
backend are tested together by the live HTTP and browser smoke tests.
Serve `frontend/` and `/api/` from the same origin. All bodies and successful
responses use JSON, except the leave response. Errors use
`{ "error": { "code": "...", "message": "Safe user-facing explanation" } }`.
404 or 410 for an active room means the room has expired or been removed.
401/403 means a session or permission problem, not room expiration.

Authentication: the server sets an HttpOnly, Secure (HTTPS), SameSite session
cookie on create/join. It identifies the current participant and enforces host
permissions. Never trust a nickname or frontend host controls for authorization.
The backend should enforce same-origin/CSRF protection on mutations, validate
all inputs, cap message sizes, and store any Discord credentials server-side.

## Routes

| Method | Relative path                            | JSON body                                                                         | Success response           |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------- | -------------------------- | ---------------- |
| GET    | `/api/shows?q=<encoded query>`           | —                                                                                 | `{ "shows": Show[] }`      |
| POST   | `/api/rooms`                             | `{ "nickname": string }`                                                          | `{ "code": string }` (201) |
| POST   | `/api/rooms/:code/join`                  | `{ "nickname": string }`                                                          | `{ "code": string }`       |
| GET    | `/api/rooms/:code`                       | —                                                                                 | `Room`                     |
| POST   | `/api/rooms/:code/leave`                 | `{}`                                                                              | 204                        |
| PUT    | `/api/rooms/:code/plan`                  | `{ "showId": string, "watchAt": string                                            | null, "note": string }`    | `{ "ok": true }` |
| POST   | `/api/rooms/:code/vote`                  | `{ "answer": "yes"                                                                | "no" }`                    | `{ "ok": true }` |
| POST   | `/api/rooms/:code/messages`              | `{ "text": string }`                                                              | `{ "ok": true }`           |
| POST   | `/api/rooms/:code/quiz/answers`          | `{ "quizId": string, "answers": [{ "questionId": string, "choiceId": string }] }` | `{ "ok": true }`           |
| POST   | `/api/rooms/:code/announcements/preview` | `{ "text": string }`                                                              | `{ "text": string }`       |
| POST   | `/api/rooms/:code/announcements`         | `{ "text": string }`                                                              | `{ "ok": true }`           |

Room codes and IDs are opaque nonempty strings. Encode codes as a single URL
segment. `watchAt` is an ISO 8601 UTC instant or null. Plan and announcement
mutations are host-only; other members can vote, chat, and submit one quiz entry.
Quiz submissions are atomic, contain one answer for every question, and are
scored server-side. Duplicate submissions should return 409, never score twice.
Messages are ordered oldest to newest, and GET room returns the full current
feed. The original routes remain compatible; additive shared-video endpoints are documented below.

## Response shapes

```ts
type Show = {
  id: string;
  title: string;
  posterUrl: string | null; // HTTPS or same-origin root-relative image URL
  summary: string;
};

type Room = {
  code: string;
  me: { id: string; nickname: string; isHost: boolean };
  members: { id: string; nickname: string }[];
  plan: null | { show: Show; watchAt: string | null; note: string };
  poll: { yes: number; no: number; myVote: "yes" | "no" | null };
  messages: { id: string; nickname: string; text: string; createdAt: string }[];
  quiz: null | {
    id: string;
    title: string; // General TV Trivia
    submitted: boolean; // current participant has submitted
    questions: {
      id: string;
      text: string;
      choices: { id: string; text: string }[];
    }[];
  };
  leaderboard: { participantId: string; nickname: string; points: number }[];
  announcement: null | { text: string; publishedAt: string };
};
```

GET room is polled every three seconds, with no overlapping reads. Browser
visibility changes pause reads; leaving, expiration, or loss of session stops
them. A failed leave still exits the local room and reports that the server
could not confirm departure. The same room code can be rejoined.

Poster URLs are same-origin `/posters/:showId` paths. The backend resolves the
canonical TVmaze image and serves only validated image types with bounded caching.
No arbitrary URL is accepted. Attribution: show metadata and posters via TVmaze.

## Shared-screening extensions

Room state adds `screen: null | Screen` and the quiz adds `locked: boolean`.
Existing fields and routes are unchanged. Without a screening, the quiz is
immediately playable. With one, the host finishes the screening before submissions
are accepted. Submission history stays one per participant per room.

| Method | Route | JSON body | Result |
| --- | --- | --- | --- |
| PUT | `/api/rooms/:code/screen` | `{ "sample": true }` OR `{ "title": string, "url": HTTPS_URL, "duration": seconds }` | `{ "ok": true }`, host only |
| POST | `/api/rooms/:code/screen/control` | `{ "screenId": string, "action": "play" / "pause" / "seek" / "finish", "position"?: seconds }` | `{ "ok": true }`, host only; seek requires position |
| POST | `/api/rooms/:code/screen/heartbeat` | `{ "screenId": string, "position": seconds, "watching": boolean }` | `{ "ok": true }`, active member |
| GET | `/api/health` | — | `{ "ok": true }` after database check |

```ts
type Screen = {
  id: string;
  title: string;
  url: string; // bundled root-relative sample or host-supplied HTTPS media
  duration: number; // seconds, 10–14,400 for custom media
  position: number; // server-estimated position at the time of the response
  playing: boolean;
  finished: boolean;
  serverTime: string; // ISO UTC
  attendance: {
    seconds: number;
    requiredSeconds: number; // 80% of duration
    awarded: boolean; // one 5-point watch award per participant per room
  };
};
```

A heartbeat never accepts client-supplied points or participant IDs. The server
credits bounded elapsed time only while the timeline is playing and the client
reports active viewing near that timeline. Gaps over 15 seconds and control
changes invalidate a partial interval. Scores are friendly participation points,
not a proof of attention. New videos clear viewing progress but do not reset
previously earned watch or trivia points. The host can finish early to open
trivia; this does not grant watch points. Custom URLs are loaded only by browsers.
