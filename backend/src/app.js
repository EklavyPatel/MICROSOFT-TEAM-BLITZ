import express from 'express';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import path from 'node:path';
import { configuration } from './config.js';
import { openDatabase, transaction, cleanup } from './db/index.js';
import { makeQuiz } from './trivia/bank.js';
import { showProvider, HttpError } from './services/shows.js';
import { posterProvider } from './services/posters.js';

const fail = (status, code, message) => { throw new HttpError(status, code, message); };
const text = (max) => z.string().trim().min(1).max(max);
const empty = z.object({}).strict();
const nicknameBody = z.object({ nickname: text(32) }).strict();
const announcementBody = z.object({ text: text(2000) }).strict();
const iso = value => new Date(value).toISOString();
const hash = token => createHash('sha256').update(token).digest('hex');
export const SAMPLE = { title: 'Sintel — official trailer', url: '/media/sintel-trailer.mp4', duration: 52.21 };

export function createApplication(options = {}) {
  const config = configuration(options);
  const db = options.db || openDatabase(config.dbPath);
  const shows = options.shows || showProvider();
  const posters = posterProvider();
  const publicShow = show => ({ ...show, posterUrl: show.posterUrl ? `/posters/${encodeURIComponent(show.id)}` : null });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);
  const tx = fn => transaction(db, fn);
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      imgSrc: ["'self'", 'https:', 'data:'], mediaSrc: ["'self'", 'https:'],
      connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.production ? [] : null,
    } },
    strictTransportSecurity: config.production ? undefined : false,
  }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      if (req.get('origin') && req.get('origin') !== config.origin) return next(new HttpError(403, 'CROSS_ORIGIN', 'This request must come from the WatchCircle application.'));
      if (req.get('sec-fetch-site') === 'cross-site') return next(new HttpError(403, 'CROSS_ORIGIN', 'Cross-site requests are not allowed.'));
      if (!req.is('application/json')) return next(new HttpError(400, 'JSON_REQUIRED', 'Send the request as application/json.'));
    }
    next();
  });
  app.use('/api', express.json({ limit: '32kb', strict: true }));
  app.use('/api', (req, res, next) => {
    const cookie = req.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith('watchcircle_session='));
    const token = cookie?.slice('watchcircle_session='.length);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const session = one('SELECT * FROM sessions WHERE id = ? AND expires > ?', hash(token), config.now());
      if (session) { req.session = session; req.sessionToken = token; }
    }
    next();
  });
  function limiter(limit, windowMs = 60000, bySession = false) {
    if (!config.rateLimits) return (req, res, next) => next();
    return rateLimit({ windowMs, limit, ...(bySession ? { keyGenerator: req => req.session?.id || ipKeyGenerator(req.ip) } : {}), standardHeaders: 'draft-8', legacyHeaders: false,
      handler: (req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment and try again.' } }) });
  }
  const entryLimit = limiter(30), searchLimit = limiter(60), messageLimit = limiter(60, 60000, true), announcementLimit = limiter(30, 60000, true), writeLimit = limiter(240, 60000, true);
  app.use('/api', (req, res, next) => req.method === 'GET' ? next() : writeLimit(req, res, next));
  function identity(req) {
    const token = req.sessionToken || randomBytes(32).toString('hex');
    const id = hash(token), expires = config.now() + config.sessionLifetimeMs;
    run('INSERT INTO sessions(id,expires) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET expires=excluded.expires', id, expires);
    return { id, token, expires };
  }
  function setCookie(res, session) {
    res.cookie('watchcircle_session', session.token, { httpOnly: true, sameSite: 'lax', secure: config.production, path: '/', maxAge: config.sessionLifetimeMs });
  }
  function room(code) {
    if (!/^[A-Z2-9]{8}$/.test(code)) fail(400, 'INVALID_ROOM_CODE', 'Enter the eight-character invitation code.');
    const value = one('SELECT * FROM rooms WHERE code = ?', code);
    if (value?.expires <= config.now() || one('SELECT code FROM expired_rooms WHERE code = ?', code)) fail(410, 'ROOM_EXPIRED', 'This room has expired. Create a new circle.');
    if (!value) fail(404, 'ROOM_NOT_FOUND', 'No room has that invitation code.');
    return value;
  }
  function member(req, { host = false, inactive = false } = {}) {
    room(req.params.code);
    if (!req.session || req.session.expires <= config.now()) fail(401, 'SESSION_REQUIRED', 'Your session has expired or is missing. Join the room again.');
    const person = one('SELECT * FROM participants WHERE room = ? AND session = ?', req.params.code, req.session.id);
    if (!person || (!inactive && !person.active)) fail(403, 'MEMBERSHIP_REQUIRED', 'Join this room before using it.');
    if (host && !person.host) fail(403, 'HOST_REQUIRED', 'Only the host can do that.');
    return person;
  }
  function quiz(roomCode) { return one('SELECT * FROM quizzes WHERE room = ?', roomCode); }
  function screenPosition(screen) {
    return Math.min(screen.duration, screen.position + (screen.playing ? Math.max(0, config.now() - screen.updated) / 1000 : 0));
  }
  function screenState(code, person) {
    const screen = one('SELECT * FROM screens WHERE room = ?', code);
    if (!screen) return null;
    const attendance = one('SELECT seconds FROM attendance WHERE participant = ? AND screen = ?', person.id, screen.id);
    return { id: screen.id, title: screen.title, url: screen.url, duration: screen.duration,
      position: screenPosition(screen), playing: !!screen.playing && screenPosition(screen) < screen.duration,
      finished: !!screen.finished, serverTime: iso(config.now()),
      attendance: { seconds: attendance?.seconds || 0, requiredSeconds: screen.duration * .8, awarded: !!one('SELECT participant FROM watch_awards WHERE participant = ?', person.id) } };
  }
  function readRoom(req) {
    return tx(() => {
      const person = member(req), code = req.params.code;
      const plan = one('SELECT * FROM plans WHERE room = ?', code);
      const voteCounts = all('SELECT v.answer, count(*) AS count FROM votes v JOIN participants p ON p.id=v.participant WHERE p.room=? AND p.active=1 GROUP BY v.answer', code);
      const selectedQuiz = quiz(code);
      const announcement = one('SELECT * FROM announcements WHERE room = ?', code);
      const screen = screenState(code, person);
      return {
        code, me: { id: person.id, nickname: person.nickname, isHost: !!person.host },
        members: all('SELECT id,nickname FROM participants WHERE room=? AND active=1 ORDER BY joined,id', code),
        plan: plan ? { show: publicShow(JSON.parse(plan.show)), watchAt: plan.watch_at, note: plan.note } : null,
        poll: { yes: voteCounts.find(v => v.answer === 'yes')?.count || 0, no: voteCounts.find(v => v.answer === 'no')?.count || 0,
          myVote: one('SELECT answer FROM votes WHERE participant=?', person.id)?.answer || null },
        messages: all('SELECT m.id,p.nickname,m.text,m.created FROM messages m JOIN participants p ON p.id=m.participant WHERE m.room=? ORDER BY m.created,m.rowid', code)
          .map(m => ({ id: m.id, nickname: m.nickname, text: m.text, createdAt: iso(m.created) })),
        quiz: selectedQuiz ? { id: selectedQuiz.id, title: 'General TV Trivia',
          submitted: !!one('SELECT participant FROM submissions WHERE participant=? AND quiz=?', person.id, selectedQuiz.id),
          questions: JSON.parse(selectedQuiz.questions), locked: !!screen && !screen.finished } : null,
        leaderboard: all(`SELECT p.id AS participantId,p.nickname,COALESCE(s.points,0)+COALESCE(w.points,0) AS points
          FROM participants p LEFT JOIN submissions s ON s.participant=p.id LEFT JOIN watch_awards w ON w.participant=p.id
          WHERE p.room=? AND (s.participant IS NOT NULL OR w.participant IS NOT NULL) ORDER BY points DESC,p.joined,p.id`, code),
        announcement: announcement ? { text: announcement.text, publishedAt: iso(announcement.published) } : null,
        screen,
      };
    });
  }
  app.get('/api/health', (req, res) => { one('SELECT 1'); res.json({ ok: true }); });
  app.get('/api/shows', searchLimit, async (req, res) => {
    const q = text(100).parse(req.query.q);
    res.json({ shows: (await shows.search(q)).map(publicShow) });
  });
  app.post('/api/rooms', entryLimit, (req, res) => {
    const { nickname } = nicknameBody.parse(req.body);
    const result = tx(() => {
      const session = identity(req);
      let code;
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for (let attempt = 0; attempt < 10; attempt++) {
        code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
        if (run('INSERT OR IGNORE INTO rooms VALUES(?,?,?)', code, config.now(), config.now() + config.roomLifetimeMs).changes) break;
        code = null;
      }
      if (!code) fail(503, 'ROOM_CODE_BUSY', 'Could not create an invitation. Please try again.');
      run('INSERT INTO participants(id,room,session,nickname,joined,host) VALUES(?,?,?,?,?,1)', randomUUID(), code, session.id, nickname, config.now());
      const selected = makeQuiz();
      run('INSERT INTO quizzes VALUES(?,?,?,?)', selected.id, code, JSON.stringify(selected.questions), JSON.stringify(selected.key));
      return { code, session };
    });
    setCookie(res, result.session);
    res.status(201).json({ code: result.code });
  });
  app.post('/api/rooms/:code/join', entryLimit, (req, res) => {
    const { nickname } = nicknameBody.parse(req.body);
    const session = tx(() => {
      room(req.params.code);
      const session = identity(req);
      const previous = one('SELECT * FROM participants WHERE room=? AND session=?', req.params.code, session.id);
      if (!previous?.active && one('SELECT count(*) AS n FROM participants WHERE room=? AND active=1', req.params.code).n >= config.capacity) fail(409, 'ROOM_FULL', 'This circle is full. Try another room.');
      const host = one('SELECT id FROM participants WHERE room=? AND host=1 AND active=1', req.params.code) ? 0 : 1;
      if (previous) run('UPDATE participants SET active=1,host=max(host,?) WHERE id=?', host, previous.id);
      else run('INSERT INTO participants(id,room,session,nickname,joined,host) VALUES(?,?,?,?,?,?)', randomUUID(), req.params.code, session.id, nickname, config.now(), host);
      return session;
    });
    setCookie(res, session);
    res.json({ code: req.params.code });
  });
  app.get('/api/rooms/:code', (req, res) => res.json(readRoom(req)));
  app.post('/api/rooms/:code/leave', (req, res) => {
    empty.parse(req.body);
    tx(() => {
      const person = member(req, { inactive: true });
      run('UPDATE participants SET active=0,host=0 WHERE id=?', person.id);
      run('UPDATE attendance SET heartbeat=NULL WHERE participant=?', person.id);
      if (person.host) {
        const next = one('SELECT id FROM participants WHERE room=? AND active=1 ORDER BY joined,rowid LIMIT 1', req.params.code);
        if (next) run('UPDATE participants SET host=1 WHERE id=?', next.id);
      }
    });
    res.status(204).end();
  });
  app.put('/api/rooms/:code/plan', async (req, res) => {
    member(req, { host: true });
    const body = z.object({ showId: z.string().regex(/^\d{1,12}$/), watchAt: z.iso.datetime({ offset: true }).nullable(), note: z.string().max(500) }).strict().parse(req.body);
    const show = await shows.resolve(body.showId);
    const watchAt = body.watchAt === null ? null : iso(Date.parse(body.watchAt));
    tx(() => {
      member(req, { host: true });
      const old = one('SELECT * FROM plans WHERE room=?', req.params.code);
      if (!old || JSON.parse(old.show).id !== show.id || old.watch_at !== watchAt) run('DELETE FROM votes WHERE participant IN (SELECT id FROM participants WHERE room=?)', req.params.code);
      run('INSERT INTO plans VALUES(?,?,?,?) ON CONFLICT(room) DO UPDATE SET show=excluded.show,watch_at=excluded.watch_at,note=excluded.note', req.params.code, JSON.stringify(show), watchAt, body.note);
    });
    res.json({ ok: true });
  });
  app.post('/api/rooms/:code/vote', (req, res) => {
    const { answer } = z.object({ answer: z.enum(['yes', 'no']) }).strict().parse(req.body);
    tx(() => {
      const person = member(req);
      if (!one('SELECT room FROM plans WHERE room=?', req.params.code)) fail(409, 'PLAN_REQUIRED', 'Wait for the host to choose a show.');
      run('INSERT INTO votes VALUES(?,?) ON CONFLICT(participant) DO UPDATE SET answer=excluded.answer', person.id, answer);
    }); res.json({ ok: true });
  });
  app.post('/api/rooms/:code/messages', messageLimit, (req, res) => {
    const { text } = announcementBody.parse(req.body);
    tx(() => {
      const person = member(req);
      if (one('SELECT count(*) AS n FROM messages WHERE room=?', req.params.code).n >= config.messageLimit) fail(409, 'ROOM_MESSAGE_LIMIT', 'This room has reached its message limit. Start a new circle to keep chatting.');
      run('INSERT INTO messages VALUES(?,?,?,?,?)', randomUUID(), req.params.code, person.id, text, config.now());
    }); res.json({ ok: true });
  });
  app.post('/api/rooms/:code/quiz/answers', (req, res) => {
    const body = z.object({ quizId: text(100), answers: z.array(z.object({ questionId: text(100), choiceId: text(100) }).strict()).length(5) }).strict().parse(req.body);
    tx(() => {
      const person = member(req), selected = quiz(req.params.code);
      if (selected.id !== body.quizId) fail(409, 'QUIZ_CHANGED', 'That quiz is not the current room quiz. Refresh the room.');
      const screen = one('SELECT finished FROM screens WHERE room=?', req.params.code);
      if (screen && !screen.finished) fail(409, 'QUIZ_LOCKED', 'Trivia opens after the host finishes the screening.');
      if (one('SELECT participant FROM submissions WHERE participant=? AND quiz=?', person.id, selected.id)) fail(409, 'QUIZ_SUBMITTED', 'You have already submitted this quiz.');
      const questions = JSON.parse(selected.questions), key = JSON.parse(selected.answer_key);
      if (new Set(body.answers.map(a => a.questionId)).size !== questions.length || !body.answers.every(a => questions.find(q => q.id === a.questionId)?.choices.some(c => c.id === a.choiceId))) fail(400, 'INVALID_ANSWERS', 'Choose exactly one valid answer for each question.');
      const points = body.answers.reduce((sum, answer) => sum + (key[answer.questionId] === answer.choiceId ? 10 : 0), 0);
      run('INSERT INTO submissions VALUES(?,?,?,?)', person.id, selected.id, JSON.stringify(body.answers), points);
    }); res.json({ ok: true });
  });
  app.post('/api/rooms/:code/announcements/preview', announcementLimit, (req, res) => {
    member(req, { host: true }); res.json(announcementBody.parse(req.body));
  });
  app.post('/api/rooms/:code/announcements', announcementLimit, (req, res) => {
    const { text } = announcementBody.parse(req.body);
    tx(() => { member(req, { host: true }); run('INSERT INTO announcements VALUES(?,?,?) ON CONFLICT(room) DO UPDATE SET text=excluded.text,published=excluded.published', req.params.code, text, config.now()); });
    res.json({ ok: true });
  });

  // Additive screening API. Media is loaded by the browser; the server never fetches user URLs.
  app.put('/api/rooms/:code/screen', (req, res) => {
    const body = z.union([z.object({ sample: z.literal(true) }).strict(), z.object({
      title: text(100), url: z.url().max(2000).refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; }),
      duration: z.number().finite().min(10).max(14400),
    }).strict()]).parse(req.body);
    const media = 'sample' in body ? SAMPLE : body;
    tx(() => {
      member(req, { host: true });
      run('DELETE FROM screens WHERE room=?', req.params.code);
      run('INSERT INTO screens(room,id,title,url,duration,updated) VALUES(?,?,?,?,?,?)', req.params.code, randomUUID(), media.title, media.url, media.duration, config.now());
    }); res.json({ ok: true });
  });
  app.post('/api/rooms/:code/screen/control', (req, res) => {
    const body = z.object({ screenId: text(100), action: z.enum(['play', 'pause', 'seek', 'finish']), position: z.number().finite().min(0).max(14400).optional() }).strict().parse(req.body);
    tx(() => {
      member(req, { host: true });
      const screen = one('SELECT * FROM screens WHERE room=?', req.params.code);
      if (!screen || screen.id !== body.screenId) fail(409, 'SCREEN_CHANGED', 'Refresh the room to use its current screening.');
      if (screen.finished) fail(409, 'SCREEN_FINISHED', 'This screening has ended. Choose a video for a new screening.');
      const position = body.position ?? screenPosition(screen);
      if (position > screen.duration) fail(400, 'INVALID_POSITION', 'Seek within the video duration.');
      if (body.action === 'seek' && body.position === undefined) fail(400, 'INVALID_POSITION', 'A seek position is required.');
      // Discard partial heartbeat intervals across controls to avoid counting pauses or seeks.
      run('UPDATE attendance SET heartbeat=NULL WHERE screen=?', screen.id);
      const playing = body.action === 'play' ? 1 : body.action === 'seek' ? screen.playing : 0;
      run('UPDATE screens SET position=?,playing=?,updated=?,finished=? WHERE room=?', position, playing, config.now(), body.action === 'finish' ? 1 : 0, req.params.code);
    }); res.json({ ok: true });
  });
  app.post('/api/rooms/:code/screen/heartbeat', (req, res) => {
    const body = z.object({ screenId: text(100), position: z.number().finite().min(0).max(14400), watching: z.boolean() }).strict().parse(req.body);
    tx(() => {
      const person = member(req), screen = one('SELECT * FROM screens WHERE room=?', req.params.code);
      if (!screen || screen.id !== body.screenId) fail(409, 'SCREEN_CHANGED', 'The current screening has changed.');
      const previous = one('SELECT * FROM attendance WHERE participant=? AND screen=?', person.id, screen.id);
      const watching = body.watching && !!screen.playing && !screen.finished && Math.abs(body.position - screenPosition(screen)) < 10;
      const elapsed = previous?.heartbeat != null && watching ? Math.max(0, (Math.min(config.now(), screen.updated + (screen.duration - screen.position) * 1000) - Math.max(previous.heartbeat, screen.updated)) / 1000) : 0;
      // Gaps over 15 seconds are unobserved and earn nothing. Repeated requests cannot accelerate time.
      const seconds = Math.min(screen.duration, (previous?.seconds || 0) + (elapsed <= 15 ? elapsed : 0));
      run('INSERT INTO attendance VALUES(?,?,?,?) ON CONFLICT(participant,screen) DO UPDATE SET seconds=excluded.seconds,heartbeat=excluded.heartbeat', person.id, screen.id, seconds, watching ? config.now() : null);
      if (seconds >= screen.duration * .8) run('INSERT OR IGNORE INTO watch_awards VALUES(?,5,?)', person.id, config.now());
    }); res.json({ ok: true });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: { code: 'API_NOT_FOUND', message: 'That API route does not exist.' } }));
  // Serve only public application assets, never tests, documentation, credentials or databases.
  app.get('/posters/:showId', limiter(120), async (req, res) => {
    const id = z.string().regex(/^\d{1,12}$/).parse(req.params.showId);
    const show = await shows.resolve(id);
    const poster = await posters(show.posterUrl);
    res.set('Cache-Control', 'public, max-age=1800').type(poster.type).send(poster.bytes);
  });
  app.get('/media/sintel-trailer.mp4', (req, res) => res.sendFile(path.join(config.frontend, 'media/sintel-trailer.mp4')));
  const publicFiles = new Set(['index.html', 'styles.css', 'app.js', 'api.js', 'watchcircle.html']);
  app.get(['/', '/:file'], (req, res, next) => {
    const file = req.params.file || 'index.html';
    if (!publicFiles.has(file)) return next();
    if (file === 'watchcircle.html') res.set('Content-Disposition', 'attachment; filename="watchcircle.html"');
    res.sendFile(path.join(config.frontend, file));
  });
  app.use((req, res) => res.status(404).type('text').send('Not found'));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    let status = error.status || 500, code = error.code || 'INTERNAL_ERROR', message = error.message;
    if (error instanceof ZodError) { status = 400; code = 'VALIDATION_ERROR'; message = 'Check the required fields and their lengths, then try again.'; }
    else if (error.type === 'entity.too.large') { status = 413; code = 'BODY_TOO_LARGE'; message = 'This request is too large.'; }
    else if (error.type === 'entity.parse.failed') { status = 400; code = 'INVALID_JSON'; message = 'The request contains invalid JSON.'; }
    else if (!(error instanceof HttpError)) { status = 500; code = 'INTERNAL_ERROR'; message = 'Something went wrong. Please try again.'; }
    res.status(status).json({ error: { code, message } });
  });
  return { app, db, config, cleanup: () => cleanup(db, config.now()), close: () => db.close() };
}
