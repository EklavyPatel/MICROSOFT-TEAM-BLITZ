import assert from 'node:assert/strict';
const origin = process.env.SMOKE_ORIGIN || 'http://localhost:3000';
function client() {
  let cookie;
  return async (route, method = 'GET', body) => {
    const response = await fetch(origin + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json', origin }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    const data = response.status === 204 ? null : await response.json();
    assert.ok(response.ok, `${method} ${route}: ${response.status} ${data?.error?.message || ''}`);
    return data;
  };
}
const host = client(), guest = client();
let base;
try {
  const { code } = await host('/api/rooms', 'POST', { nickname: 'Smoke host' }); base = `/api/rooms/${code}`;
  await guest(`${base}/join`, 'POST', { nickname: 'Smoke guest' });
  const { shows } = await host('/api/shows?q=Dark'); assert.ok(shows.length);
  await host(`${base}/plan`, 'PUT', { showId: shows[0].id, watchAt: null, note: 'Live HTTP smoke test' });
  await guest(`${base}/vote`, 'POST', { answer: 'yes' });
  await guest(`${base}/messages`, 'POST', { text: 'Hello circle 🍿' });
  let room = await guest(base); assert.equal(room.poll.yes, 1); assert.equal(room.messages[0].text, 'Hello circle 🍿');
  await guest(`${base}/quiz/answers`, 'POST', { quizId: room.quiz.id, answers: room.quiz.questions.map(q => ({ questionId: q.id, choiceId: q.choices[0].id })) });
  room = await guest(base); assert.equal(room.quiz.submitted, true); assert.equal(room.leaderboard.length, 1);
  const preview = await host(`${base}/announcements/preview`, 'POST', { text: 'Watch night starts now!' });
  await host(`${base}/announcements`, 'POST', { text: preview.text });
  assert.equal((await guest(base)).announcement.text, preview.text);
  await host(`${base}/screen`, 'PUT', { sample: true });
  room = await host(base); assert.equal(room.screen.url, '/media/sintel-trailer.mp4');
  const video = await fetch(new URL(room.screen.url, origin), { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15000) });
  assert.ok(video.ok); assert.match(video.headers.get('content-type'), /video/); await video.body.cancel();
  await host(`${base}/screen/control`, 'POST', { screenId: room.screen.id, action: 'play' });
  assert.equal((await guest(base)).screen.playing, true);
  await host(`${base}/screen/control`, 'POST', { screenId: room.screen.id, action: 'finish' });
  assert.equal((await guest(base)).quiz.locked, false);
  console.log('PASS: live HTTP create/join, TVmaze search and plan, vote, Unicode chat, trivia, leaderboard, preview/publish, sample video access and playback control.');
} finally {
  if (base) {
    await guest(`${base}/leave`, 'POST', {});
    await host(`${base}/leave`, 'POST', {});
    console.log('PASS: both participants left the room.');
  }
}
