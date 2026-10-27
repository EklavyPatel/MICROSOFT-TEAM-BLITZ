import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { once } from 'node:events';

test('production host, health, HTTPS cookies, CSRF, media ranges and persistent restarts', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cinematics-deployment-'));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  let process;
  async function start() {
    process = spawn('node', ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...globalThis.process.env, PORT: String(port), HOST: '0.0.0.0', DATA_DIR: directory, NODE_ENV: 'production', APP_ORIGIN: 'https://cinematics.example' }, stdio: ['ignore', 'pipe', 'pipe'] });
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
      if (process.exitCode !== null) throw Error('Server exited before becoming healthy');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Server did not become healthy');
  }
  async function stop() { if (process && process.exitCode === null) { const exited = once(process, 'exit'); process.kill('SIGTERM'); await exited; } }
  const url = route => `http://127.0.0.1:${port}${route}`;
  const signup = (origin, email = 'member@example.test') => fetch(url('/api/signup'), { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ name: 'Member', email, password: 'Test-password-123' }) });
  try {
    await start();
    assert.deepEqual(await (await fetch(url('/api/health'))).json(), { ok: true });
    assert.equal((await fetch(url('/'))).status, 200);
    assert.equal((await signup('https://evil.example')).status, 403);
    const result = await signup('https://cinematics.example'); assert.equal(result.status, 200);
    assert.match(result.headers.get('set-cookie'), /; Secure/); assert.match(result.headers.get('set-cookie'), /HttpOnly/);
    const range = await fetch(url('/assets/sintel-trailer.mp4'), { headers: { range: 'bytes=0-99' } });
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100);
    const cookie = result.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await fetch(url('/api/me'), { headers: { cookie } })).json()).user.name, 'Member');
    await stop();
    assert.equal(JSON.parse(await readFile(path.join(directory, 'cinematics.json'), 'utf8')).users.length, 1);
    await start();
    const login = await fetch(url('/api/signin'), { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://cinematics.example' }, body: JSON.stringify({ email: 'member@example.test', password: 'Test-password-123' }) });
    assert.equal(login.status, 200);
  } finally { await stop(); await rm(directory, { recursive: true, force: true }); }
});
