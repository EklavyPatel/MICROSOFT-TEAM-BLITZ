export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export async function request(path, { method = "GET", body, signal } = {}) {
  // Accept only this origin's relative API URLs. Credentials belong on the server.
  if (!path.startsWith("/api/") || path.includes("://"))
    throw new Error("Invalid API path");
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    15000,
  );
  try {
    const response = await fetch(path, {
      method,
      signal: controller.signal,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 204 && response.ok) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        data?.error?.message || `Request failed (${response.status}).`,
        response.status,
      );
    if (!data || typeof data !== "object")
      throw new ApiError(
        "The server returned an invalid JSON response.",
        response.status,
      );
    return data;
  } catch (error) {
    if (signal?.aborted || error instanceof ApiError) throw error;
    if (controller.signal.aborted)
      throw new ApiError("The request timed out. Please try again.");
    throw new ApiError(
      "Unable to reach the server. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

// Tick every three seconds; a slow read is skipped, never overlapped. Restarting
// aborts and awaits the old read before another read can run.
export function createPoller(
  read,
  { interval = 3000, onData, onError, timers = globalThis } = {},
) {
  let timer = null,
    active = false,
    pending = false,
    controller = null,
    generation = 0;
  async function tick() {
    if (!active || pending) return;
    const current = generation;
    pending = true;
    controller = new AbortController();
    try {
      const data = await read(controller.signal);
      if (active && current === generation) onData?.(data);
    } catch (error) {
      if (active && current === generation && !controller.signal.aborted)
        onError?.(error);
    } finally {
      pending = false;
    }
  }
  return {
    start() {
      if (active) return;
      active = true;
      generation++;
      timer = timers.setInterval(tick, interval);
      void tick();
    },
    stop() {
      active = false;
      generation++;
      if (timer !== null) timers.clearInterval(timer);
      timer = null;
      controller?.abort();
    },
    refresh: tick,
  };
}
