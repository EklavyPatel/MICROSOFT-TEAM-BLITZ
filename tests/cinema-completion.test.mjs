import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';

test('natural screening completion settles watch time and opens trivia without Wikipedia', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cinematics-completion-'));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  // Advance only the server clock to exercise playback boundaries without waiting
  // for a full movie. Application routes, storage and reward logic run normally.
  const fixture = `const now = Date.now; let offset = 0;
    Date.now = () => now() + offset;
    process.on('message', message => { offset += message.advance; process.send('advanced'); });
    globalThis.fetch = async () => { throw new Error('Wikipedia unavailable'); };`;
  const child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(fixture)}`, 'server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: directory, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let cookie = '';
  const request = (route, data, method = 'POST') => fetch(`http://127.0.0.1:${port}${route}`, {
    method, headers: { cookie, 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(data || {}) })
  });
  async function advance(milliseconds) { const changed = once(child, 'message'); child.send({ advance: milliseconds }); await changed; }
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await request('/api/health', null, 'GET')).ok) break; } catch {}
      if (child.exitCode !== null) throw new Error('Server exited before readiness');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const signup = await request('/api/signup', { name: 'Host', email: 'host@example.test', password: 'test-password-123' });
    assert.equal(signup.status, 200); cookie = signup.headers.get('set-cookie').split(';')[0];
    const { room } = await (await request('/api/rooms', { name: 'Completion test' })).json();
    const cinema = `/api/rooms/${room.id}/cinema`;
    const { screen } = await (await request(`${cinema}/screen`, { title: 'Sintel', url: '/assets/sintel-trailer.mp4', duration: 10 }, 'PUT')).json();
    assert.equal((await request(`${cinema}/trivia/start`)).status, 409);
    await request(`${cinema}/control`, { action: 'play' });
    await request(`${cinema}/heartbeat`, { screenId: screen.id, watching: true });
    await advance(5000);
    await request(`${cinema}/heartbeat`, { screenId: screen.id, watching: true });
    await advance(5000);
    let state = await (await request(cinema, null, 'GET')).json();
    assert.equal(state.screen.finished, true);
    assert.equal(state.screen.playing, false);
    assert.equal(state.screen.position, 10);
    // At the natural end the browser is already paused. Credit its last interval.
    const progress = await (await request(`${cinema}/heartbeat`, { screenId: screen.id, watching: false })).json();
    assert.equal(progress.awarded, true);
    assert.ok(progress.seconds >= 8);
    const start = await request(`${cinema}/trivia/start`);
    assert.equal(start.status, 200);
    const { quiz } = await start.json();
    assert.ok(quiz.questions.length > 0);
    assert.equal(quiz.title, 'Sintel Movie Trivia');
    await advance(5000);
    await request(`${cinema}/heartbeat`, { screenId: screen.id, watching: false });
    state = await (await request(cinema, null, 'GET')).json();
    assert.equal(state.leaderboard[0].points, 10, 'watch reward is granted once');
    assert.equal(state.progress.seconds, progress.seconds, 'finished movies earn no extra watch time');
  } finally {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
    await rm(directory, { recursive: true, force: true });
  }
});
