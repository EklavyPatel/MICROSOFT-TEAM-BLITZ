import { createApplication } from './app.js';
const runtime = createApplication();
runtime.cleanup();
const server = runtime.app.listen(runtime.config.port, runtime.config.host, () => console.log(`WatchCircle listening on port ${runtime.config.port}`));
const maintenance = setInterval(runtime.cleanup, 60000);
maintenance.unref();
let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(maintenance);
  server.close(() => { runtime.close(); process.exit(0); });
  setTimeout(() => { server.closeAllConnections(); runtime.close(); process.exit(1); }, 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
