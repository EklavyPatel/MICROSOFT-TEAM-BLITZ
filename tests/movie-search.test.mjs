import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import net from 'node:net';

test('movie search requests poster artwork and preserves its Wikipedia destination', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cinematics-movies-'));
  // Keep this regression independent of public API availability. Wikipedia only
  // includes non-free film posters when PageImages explicitly requests them.
  const fixture = `globalThis.fetch = async input => {
    const url = new URL(input);
    if (url.hostname !== 'en.wikipedia.org') throw new Error('Unexpected provider');
    const thumbnail = url.searchParams.get('pilicense') === 'any'
      ? { source: 'https://upload.wikimedia.org/example-poster.jpg' } : undefined;
    return Response.json({query:{pages:{1:{pageid:1,title:'Arrival (film)',
      extract:'Arrival is a 2016 science fiction film directed by Denis Villeneuve.',
      fullurl:'https://en.wikipedia.org/wiki/Arrival_(film)',thumbnail}}}});
  };`;
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(fixture)}`, 'server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: directory, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  // Wait for the server to announce readiness before making the request.
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'exit').then(() => { throw new Error('Server exited before readiness'); }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Startup timeout')), 5000); timer.unref(); })
    ]);
    const response = await fetch(`http://127.0.0.1:${port}/api/movies?q=Arrival`);
    assert.equal(response.status, 200);
    const { movies } = await response.json();
    assert.equal(movies.length, 1);
    assert.equal(movies[0].image, 'https://upload.wikimedia.org/example-poster.jpg');
    assert.equal(movies[0].url, 'https://en.wikipedia.org/wiki/Arrival_(film)');
  } finally {
    if (child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    await rm(directory, { recursive: true, force: true });
  }
});
