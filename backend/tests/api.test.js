import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createApplication } from '../src/app.js';
import { HttpError } from '../src/services/shows.js';

let directory, runtime, host, guest, outsider, clock;
const show = { id: '1', title: 'Under the Dome', posterUrl: null, summary: 'A real show, represented by a test fixture.' };
const provider = { search: async () => [show], resolve: async id => { if (id === '999') throw new HttpError(400, 'INVALID_SHOW', 'Unknown show'); return { ...show, id }; } };
function start(extra = {}) {
  runtime = createApplication({ dbPath: path.join(directory, 'test.sqlite'), shows: provider, now: () => clock, rateLimits: false, ...extra });
  host = request.agent(runtime.app); guest = request.agent(runtime.app); outsider = request.agent(runtime.app);
}
beforeEach(() => { directory = mkdtempSync(path.join(os.tmpdir(), 'watchcircle-api-')); clock = Date.now(); start(); });
afterEach(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
async function create(client = host, nickname = 'Alex') { return (await client.post('/api/rooms').send({ nickname }).expect(201)).body.code; }
async function join(code, client = guest, nickname = 'Sam') { await client.post(`/api/rooms/${code}/join`).send({ nickname }).expect(200); }
const get = async (code, client = host) => (await client.get(`/api/rooms/${code}`).expect(200)).body;
async function plan(code, body = {}) { await host.put(`/api/rooms/${code}/plan`).send({ showId: '1', watchAt: null, note: '', ...body }).expect(200); }
function answers(code) {
  const selected = runtime.db.prepare('SELECT * FROM quizzes WHERE room=?').get(code);
  return { quizId: selected.id, answers: Object.entries(JSON.parse(selected.answer_key)).map(([questionId, choiceId]) => ({ questionId, choiceId })) };
}
test('room creation issues opaque HttpOnly SameSite cookie and complete initial state', async () => {
  const response = await host.post('/api/rooms').send({ nickname: '  Alex  ' }).expect(201);
  assert.match(response.headers['set-cookie'][0], /watchcircle_session=[a-f0-9]{64}/);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/); assert.match(response.headers['set-cookie'][0], /SameSite=Lax/);
  const code = response.body.code; assert.match(code, /^[A-Z2-9]{8}$/);
  const state = await get(code);
  assert.equal(state.me.nickname, 'Alex'); assert.equal(state.me.isHost, true);
  assert.equal(state.members.length, 1); assert.equal(state.plan, null);
  assert.deepEqual(state.poll, { yes: 0, no: 0, myVote: null }); assert.deepEqual(state.messages, []);
  assert.deepEqual(state.leaderboard, []); assert.equal(state.announcement, null); assert.equal(state.screen, null);
  assert.equal(state.quiz.questions.length, 5); assert.equal(state.quiz.submitted, false);
  assert.equal(JSON.stringify(state).includes('answer_key'), false);
  assert.equal((await host.get(`/api/rooms/${code}`)).headers['cache-control'], 'no-store');
});
test('identical nicknames are distinct identities; rejoin preserves participant and nickname', async () => {
  const code = await create(); await join(code, guest, 'Alex');
  const before = await get(code, guest); assert.notEqual(before.me.id, (await get(code)).me.id);
  await join(code, guest, 'Different'); const after = await get(code, guest);
  assert.equal(after.me.id, before.me.id); assert.equal(after.me.nickname, 'Alex'); assert.equal(after.members.length, 2);
});
test('requires membership and host permission; one identity may belong to multiple rooms', async () => {
  const code = await create(); await request(runtime.app).get(`/api/rooms/${code}`).expect(401);
  const another = await create(outsider); await outsider.get(`/api/rooms/${code}`).expect(403);
  await join(code); await guest.put(`/api/rooms/${code}/plan`).send({ showId: '1', watchAt: null, note: '' }).expect(403);
  for (const suffix of ['announcements', 'announcements/preview']) await guest.post(`/api/rooms/${code}/${suffix}`).send({ text: 'No' }).expect(403);
  await join(another, host); await host.post(`/api/rooms/${code}/leave`).send({}).expect(204);
  await host.get(`/api/rooms/${another}`).expect(200); await host.get(`/api/rooms/${code}`).expect(403);
});
test('departure is idempotent and transfers host to earliest active participant', async () => {
  const code = await create(); clock += 1; await join(code); clock += 1; await join(code, outsider, 'Pat');
  await host.post(`/api/rooms/${code}/leave`).send({}).expect(204);
  await host.post(`/api/rooms/${code}/leave`).send({}).expect(204);
  assert.equal((await get(code, guest)).me.isHost, true); assert.equal((await get(code, outsider)).me.isHost, false);
  await join(code, host); assert.equal((await get(code)).me.isHost, false);
  await guest.post(`/api/rooms/${code}/leave`).send({}).expect(204);
  await outsider.post(`/api/rooms/${code}/leave`).send({}).expect(204);
  await host.post(`/api/rooms/${code}/leave`).send({}).expect(204);
  await join(code, guest); assert.equal((await get(code, guest)).me.isHost, true);
});
test('plan normalizes UTC; votes upsert, ignore inactive members and reset only meaningful changes', async () => {
  const code = await create(); await join(code);
  await host.post(`/api/rooms/${code}/vote`).send({ answer: 'yes' }).expect(409);
  await plan(code, { watchAt: '2026-12-01T20:00:00+05:30', note: 'Popcorn' });
  assert.equal((await get(code)).plan.watchAt, '2026-12-01T14:30:00.000Z');
  const vote = answer => guest.post(`/api/rooms/${code}/vote`).send({ answer }).expect(200);
  await vote('yes'); await vote('yes'); await vote('no');
  assert.deepEqual((await get(code, guest)).poll, { yes: 0, no: 1, myVote: 'no' });
  await plan(code, { watchAt: '2026-12-01T14:30:00Z', note: 'Different note' });
  assert.equal((await get(code)).poll.no, 1);
  await plan(code); assert.equal((await get(code)).poll.no, 0);
  await vote('yes'); await plan(code, { showId: '2' }); assert.equal((await get(code)).poll.yes, 0);
  await vote('yes'); await guest.post(`/api/rooms/${code}/leave`).send({}).expect(204);
  assert.equal((await get(code)).poll.yes, 0);
});
test('unknown show is 400, never a misleading room expiry; search validates query', async () => {
  const code = await create(); await host.put(`/api/rooms/${code}/plan`).send({ showId: '999', watchAt: null, note: '' }).expect(400);
  await host.get(`/api/rooms/${code}`).expect(200);
  assert.equal((await host.get('/api/shows?q=Dark').expect(200)).body.shows[0].title, show.title);
  await host.get('/api/shows?q=%20').expect(400); await host.get('/api/shows?q=a&q=b').expect(400);
});
test('messages preserve Unicode and literal HTML in stable insertion order with a hard feed limit', async () => {
  runtime.config.messageLimit = 2;
  const code = await create(); await join(code);
  const messages = ['नमस्ते 🍿', '<script>alert(1)</script>'];
  for (const text of messages) await guest.post(`/api/rooms/${code}/messages`).send({ text }).expect(200);
  const state = await get(code); assert.deepEqual(state.messages.map(m => m.text), messages);
  assert.equal(state.messages[0].nickname, 'Sam'); assert.match(state.messages[0].createdAt, /Z$/);
  const response = await guest.post(`/api/rooms/${code}/messages`).send({ text: 'Third' }).expect(409);
  assert.equal(response.body.error.code, 'ROOM_MESSAGE_LIMIT'); assert.equal((await get(code)).messages.length, 2);
});
test('invalid inputs, malformed JSON, excessive bodies, unknown APIs and private static paths', async () => {
  await host.post('/api/rooms').send({ nickname: ' ' }).expect(400);
  await host.post('/api/rooms').send({ nickname: 'x'.repeat(33) }).expect(400);
  await host.post('/api/rooms').send({ nickname: 'Alex', isHost: true }).expect(400);
  await host.post('/api/rooms').type('json').send('{broken').expect(400);
  await host.post('/api/rooms').send({ nickname: 'x'.repeat(40000) }).expect(413);
  await host.post('/api/rooms').type('form').send('nickname=Alex').expect(400);
  const code = await create();
  for (const text of ['', '  ', 'x'.repeat(2001)]) await host.post(`/api/rooms/${code}/messages`).send({ text }).expect(400);
  const missing = await host.get('/api/unknown').expect(404); assert.equal(missing.body.error.code, 'API_NOT_FOUND');
  for (const url of ['/.env', '/src/app.js', '/data/watchcircle.sqlite', '/tests/test_browser.py', '/API_CONTRACT.md']) await host.get(url).expect(404);
  await host.get('/').expect(200); await host.get('/app.js').expect(200);
});
test('CSRF rejects other origins and cross-site metadata, accepts configured origin and CLI without Origin', async () => {
  await host.post('/api/rooms').set('Origin', 'https://evil.test').send({ nickname: 'No' }).expect(403);
  await host.post('/api/rooms').set('Sec-Fetch-Site', 'cross-site').send({ nickname: 'No' }).expect(403);
  await host.post('/api/rooms').set('Origin', 'http://localhost:3000').send({ nickname: 'Yes' }).expect(201);
  await create();
});
test('room expiry, unknown code, session expiry and cleanup tombstones are distinct', async () => {
  const code = await create();
  await host.get('/api/rooms/ZZZZZZZZ').expect(404); await host.get('/api/rooms/bad').expect(400);
  clock += runtime.config.roomLifetimeMs + 1;
  await host.get(`/api/rooms/${code}`).expect(410); runtime.cleanup(); await host.get(`/api/rooms/${code}`).expect(410);
  const next = await create(); runtime.db.prepare('UPDATE sessions SET expires=?').run(clock - 1);
  await host.get(`/api/rooms/${next}`).expect(401);
});
test('capacity counts only active people and permits repeat joins', async () => {
  runtime.config.capacity = 2;
  const code = await create(); await join(code); await join(code);
  await outsider.post(`/api/rooms/${code}/join`).send({ nickname: 'Pat' }).expect(409);
  await guest.post(`/api/rooms/${code}/leave`).send({}).expect(204); await join(code, outsider);
});
test('quiz rejects incomplete, duplicate, unknown choices and mismatched quiz without expiring room', async () => {
  const code = await create(); const valid = answers(code); const route = `/api/rooms/${code}/quiz/answers`;
  await host.post(route).send({ ...valid, answers: valid.answers.slice(1) }).expect(400);
  await host.post(route).send({ ...valid, answers: [valid.answers[0], ...valid.answers.slice(0, 4)] }).expect(400);
  await host.post(route).send({ ...valid, answers: valid.answers.map((a, i) => i ? a : { ...a, choiceId: 'unknown' }) }).expect(400);
  await host.post(route).send({ ...valid, quizId: 'unknown' }).expect(409);
  assert.equal((await get(code)).quiz.submitted, false);
});
test('concurrent quiz submissions score once, requester state stays private and rejoining cannot repeat', async () => {
  const code = await create(); await join(code);
  const payload = answers(code), route = `/api/rooms/${code}/quiz/answers`;
  const responses = await Promise.all([host.post(route).send(payload), host.post(route).send(payload)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await get(code)).quiz.submitted, true); assert.equal((await get(code, guest)).quiz.submitted, false);
  assert.equal((await get(code)).leaderboard[0].points, 50);
  await host.post(`/api/rooms/${code}/leave`).send({}).expect(204); await join(code, host);
  await host.post(route).send(payload).expect(409);
  await guest.post(route).send(payload).expect(200);
  const board = (await get(code)).leaderboard; assert.deepEqual(board.map(p => p.points), [50, 50]);
  assert.deepEqual((await get(code)).leaderboard, board);
});
test('preview has no side effects; publication stores canonical plain text', async () => {
  const code = await create(), text = '<b>Movie night</b> 🎬';
  assert.equal((await host.post(`/api/rooms/${code}/announcements/preview`).send({ text: ` ${text} ` }).expect(200)).body.text, text);
  assert.equal((await get(code)).announcement, null);
  await host.post(`/api/rooms/${code}/announcements`).send({ text: ` ${text} ` }).expect(200);
  assert.deepEqual((await get(code)).announcement, { text, publishedAt: new Date(clock).toISOString() });
});
test('database restart preserves sessions, quiz order, plans, messages, votes, scores and announcements', async () => {
  const entry = await host.post('/api/rooms').send({ nickname: 'Alex' }).expect(201);
  const cookie = entry.headers['set-cookie'][0].split(';')[0], code = entry.body.code;
  await plan(code); await host.post(`/api/rooms/${code}/vote`).send({ answer: 'yes' }).expect(200);
  await host.post(`/api/rooms/${code}/messages`).send({ text: 'Persistent' }).expect(200);
  await host.post(`/api/rooms/${code}/quiz/answers`).send(answers(code)).expect(200);
  await host.post(`/api/rooms/${code}/announcements`).send({ text: 'Persistent too' }).expect(200);
  const before = await get(code); runtime.close(); start();
  const after = (await request(runtime.app).get(`/api/rooms/${code}`).set('Cookie', cookie).expect(200)).body;
  assert.deepEqual(after, before);
});
test('screening enforces host controls, locks trivia and awards 5 points once based on elapsed heartbeats', async () => {
  const code = await create(); await join(code); const base = `/api/rooms/${code}`;
  await guest.put(`${base}/screen`).send({ sample: true }).expect(403);
  await host.put(`${base}/screen`).send({ sample: true }).expect(200);
  let state = await get(code), screenId = state.screen.id;
  await host.post(`${base}/quiz/answers`).send(answers(code)).expect(409);
  await guest.post(`${base}/screen/control`).send({ screenId, action: 'play' }).expect(403);
  await host.post(`${base}/screen/control`).send({ screenId, action: 'play' }).expect(200);
  const beat = (position, watching = true) => host.post(`${base}/screen/heartbeat`).send({ screenId, position, watching }).expect(200);
  await beat(0);
  for (let t = 3; t <= 45; t += 3) { clock += 3000; await beat(t); }
  state = await get(code); assert.equal(state.screen.attendance.awarded, true); assert.equal(state.leaderboard[0].points, 5);
  await beat(45); assert.equal((await get(code)).leaderboard[0].points, 5);
  assert.equal((await get(code, guest)).screen.attendance.awarded, false);
  await host.post(`${base}/screen/control`).send({ screenId, action: 'finish' }).expect(200);
  assert.equal((await get(code)).quiz.locked, false);
  await host.post(`${base}/quiz/answers`).send(answers(code)).expect(200);
  assert.equal((await get(code)).leaderboard[0].points, 55);
  await host.put(`${base}/screen`).send({ sample: true }).expect(200);
  assert.equal((await get(code)).screen.attendance.awarded, true);
});
test('seeking, hidden playback, long gaps and stale screening IDs cannot invent watch time', async () => {
  const code = await create(), base = `/api/rooms/${code}`;
  await host.put(`${base}/screen`).send({ title: 'Test', url: 'http://unsafe.test/a.mp4', duration: 20 }).expect(400);
  await host.put(`${base}/screen`).send({ sample: true }).expect(200);
  const screenId = (await get(code)).screen.id;
  await host.post(`${base}/screen/control`).send({ screenId, action: 'play' }).expect(200);
  const beat = (position, watching) => host.post(`${base}/screen/heartbeat`).send({ screenId, position, watching }).expect(200);
  await beat(0, true); clock += 20000; await beat(20, true);
  assert.equal((await get(code)).screen.attendance.seconds, 0);
  clock += 3000; await beat(23, false); clock += 3000; await beat(26, true);
  assert.equal((await get(code)).screen.attendance.seconds, 0);
  await host.post(`${base}/screen/control`).send({ screenId, action: 'seek', position: 50 }).expect(200);
  await beat(50, true); assert.equal((await get(code)).screen.attendance.seconds, 0);
  await host.put(`${base}/screen`).send({ sample: true }).expect(200);
  await host.post(`${base}/screen/control`).send({ screenId, action: 'play' }).expect(409);
});
test('entry rate limits return useful JSON without penalizing room polling', async () => {
  runtime.close(); start({ rateLimits: true });
  let code;
  for (let i = 0; i < 30; i++) code = await create();
  await host.post('/api/rooms').send({ nickname: 'Alex' }).expect(429);
  for (let i = 0; i < 25; i++) await host.get(`/api/rooms/${code}`).expect(200);
});
