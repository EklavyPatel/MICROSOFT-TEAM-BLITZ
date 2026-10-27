import test from "node:test";
import assert from "node:assert/strict";
import { createPoller, request, ApiError } from "../api.js";

const turn = () => new Promise((resolve) => setImmediate(resolve));
function clock() {
  const tasks = new Set();
  return {
    tasks,
    setInterval(fn, ms) {
      assert.equal(ms, 3000);
      tasks.add(fn);
      return fn;
    },
    clearInterval(fn) {
      tasks.delete(fn);
    },
    tick() {
      for (const fn of tasks) fn();
    },
  };
}
test("three-second polling never overlaps slow requests; stop aborts and discards late data", async () => {
  const timers = clock();
  let calls = 0,
    active = 0,
    peak = 0,
    resolveRead,
    signal;
  const results = [];
  const poller = createPoller(
    (s) => {
      signal = s;
      calls++;
      active++;
      peak = Math.max(active, peak);
      return new Promise((resolve) => {
        resolveRead = (value) => {
          active--;
          resolve(value);
        };
      });
    },
    { timers, onData: (d) => results.push(d) },
  );
  poller.start();
  timers.tick();
  timers.tick();
  assert.equal(calls, 1);
  resolveRead("first");
  await turn();
  timers.tick();
  assert.equal(calls, 2);
  assert.equal(peak, 1);
  poller.stop();
  assert.equal(signal.aborted, true);
  assert.equal(timers.tasks.size, 0);
  resolveRead("late");
  await turn();
  assert.deepEqual(results, ["first"]);
  timers.tick();
  assert.equal(calls, 2);
});
test("stop and immediate restart still waits for the old read; errors permit subsequent reads", async () => {
  const timers = clock();
  let calls = 0,
    rejectRead;
  const failures = [];
  const poller = createPoller(
    () => {
      calls++;
      return new Promise((_, reject) => {
        rejectRead = reject;
      });
    },
    { timers, onError: (e) => failures.push(e.message) },
  );
  poller.start();
  poller.stop();
  poller.start();
  assert.equal(calls, 1);
  rejectRead(new Error("old"));
  await turn();
  assert.deepEqual(failures, []);
  timers.tick();
  rejectRead(new Error("network"));
  await turn();
  assert.deepEqual(failures, ["network"]);
  timers.tick();
  assert.equal(calls, 3);
  poller.stop();
  rejectRead(new Error("stopped"));
  await turn();
});
test("request uses relative URLs and same-origin cookies with JSON bodies", async (t) => {
  t.mock.method(globalThis, "fetch", async (path, options) => {
    assert.equal(path, "/api/rooms");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), { nickname: "Alex" });
    return new Response(JSON.stringify({ code: "ABC" }), { status: 201 });
  });
  assert.deepEqual(
    await request("/api/rooms", { method: "POST", body: { nickname: "Alex" } }),
    { code: "ABC" },
  );
  await assert.rejects(
    request("https://elsewhere.test/api/rooms"),
    /Invalid API path/,
  );
});
test("non-JSON success is a contract error; structured errors preserve status", async (t) => {
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>not an API</html>"),
  );
  await assert.rejects(request("/api/rooms"), /invalid JSON/);
  mock.mock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ error: { message: "Room expired" } }), {
        status: 410,
      }),
  );
  await assert.rejects(
    request("/api/rooms"),
    (e) =>
      e instanceof ApiError && e.status === 410 && e.message === "Room expired",
  );
});
test("204 leave responses and cancelled requests are supported", async (t) => {
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 204 }),
  );
  assert.equal(
    await request("/api/rooms/A/leave", { method: "POST", body: {} }),
    null,
  );
  mock.mock.mockImplementation(async (_, options) => {
    options.signal.throwIfAborted();
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    request("/api/rooms/A", { signal: controller.signal }),
    (e) => e.name === "AbortError",
  );
});
