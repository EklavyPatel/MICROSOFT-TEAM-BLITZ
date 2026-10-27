# WatchCircle API — proposed v1

This is a **new frontend-defined contract**, authorized for this empty repository.
It has not been agreed with or verified against a backend. Backend owners must
confirm or implement it. No backend, mock server, or Discord credentials are included.
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
feed. No streaming, pagination, or extra endpoints are assumed.

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

No endpoint availability has been verified because this repository has no backend.
