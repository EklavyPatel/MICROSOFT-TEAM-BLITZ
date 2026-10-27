import { request, ApiError, createPoller } from "./api.js";

const $ = (id) => document.getElementById(id);
const state = {
  code: null,
  room: null,
  chosenShow: null,
  planDirty: false,
  savedPlan: null,
  submittedQuiz: null,
  quizKey: null,
  feedKey: null,
  poller: null,
  controller: null,
  pending: new Set(),
  preview: null,
};
const actionStatus = (message, failed = false) => {
  $("action-status").textContent = message;
  $("action-status").classList.toggle("error", failed);
};
function store(key, value) {
  try {
    value === null
      ? sessionStorage.removeItem(key)
      : sessionStorage.setItem(key, value);
  } catch {
    /* Storage may be disabled. */
  }
}
function load(key) {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function setEmpty(target, title, detail) {
  target.replaceChildren(element("h4", title), element("p", detail));
}
const validString = (value) => typeof value === "string";
const nonempty = (value) => validString(value) && value.length > 0;
const validDate = (value) =>
  value === null || (validString(value) && Number.isFinite(Date.parse(value)));
const isShow = (show) =>
  show &&
  nonempty(show.id) &&
  nonempty(show.title) &&
  validString(show.summary) &&
  (show.posterUrl === null || validString(show.posterUrl));
const mismatch = (detail) =>
  new ApiError(
    `Backend contract mismatch: ${detail}. See frontend/API_CONTRACT.md.`,
  );
const arrayOf = (value, check) =>
  Array.isArray(value) && value.every((item) => item != null && check(item));
function validateRoom(room) {
  if (
    !(
      room &&
      room.code === state.code &&
      nonempty(room.me?.id) &&
      validString(room.me.nickname) &&
      typeof room.me.isHost === "boolean" &&
      arrayOf(room.members, (m) => nonempty(m.id) && validString(m.nickname)) &&
      (room.plan === null ||
        (isShow(room.plan?.show) &&
          validDate(room.plan.watchAt) &&
          validString(room.plan.note))) &&
      Number.isInteger(room.poll?.yes) &&
      room.poll.yes >= 0 &&
      Number.isInteger(room.poll.no) &&
      room.poll.no >= 0 &&
      [null, "yes", "no"].includes(room.poll.myVote) &&
      arrayOf(
        room.messages,
        (m) =>
          nonempty(m.id) &&
          validString(m.nickname) &&
          validString(m.text) &&
          validString(m.createdAt) &&
          validDate(m.createdAt),
      ) &&
      (room.quiz === null ||
        (nonempty(room.quiz?.id) &&
          validString(room.quiz.title) &&
          typeof room.quiz.submitted === "boolean" &&
          arrayOf(
            room.quiz.questions,
            (q) =>
              nonempty(q.id) &&
              validString(q.text) &&
              Array.isArray(q.choices) &&
              q.choices.length > 0 &&
              arrayOf(q.choices, (c) => nonempty(c.id) && validString(c.text)),
          ))) &&
      arrayOf(
        room.leaderboard,
        (p) =>
          nonempty(p.participantId) &&
          validString(p.nickname) &&
          Number.isFinite(p.points),
      ) &&
      (room.announcement === null ||
        (validString(room.announcement?.text) &&
          validString(room.announcement.publishedAt) &&
          validDate(room.announcement.publishedAt)))
    )
  )
    throw mismatch("invalid room state");
  return room;
}

function controls() {
  screeningControls();
  const joined = !!state.code,
    host = !!state.room?.me.isHost,
    ready = !!state.room;
  $("search-submit").disabled = state.pending.has("search");
  const pendingButtons = {
    entry: ["create-submit", "join-submit"],
    search: ["search-submit"],
    plan: ["save-plan"],
    vote: ["vote-yes", "vote-no"],
    message: ["send-message"],
    quiz: ["submit-quiz"],
    preview: ["preview-announcement"],
    announcement: ["publish-announcement"],
    leave: ["leave-room"],
  };
  for (const [key, ids] of Object.entries(pendingButtons))
    for (const id of ids)
      $(id).setAttribute("aria-busy", String(state.pending.has(key)));
  for (const kind of ["create", "join"])
    $(kind + "-submit").disabled =
      joined || state.pending.has("entry") || state.pending.has("leave");
  $("nickname").disabled =
    joined || state.pending.has("entry") || state.pending.has("leave");
  $("room-code").disabled =
    joined || state.pending.has("entry") || state.pending.has("leave");
  $("leave-room").hidden = !joined;
  $("leave-room").disabled = state.pending.has("leave");
  $("save-plan").disabled =
    !host || !state.chosenShow || state.pending.has("plan");
  $("plan-time").disabled = !host;
  $("plan-note").disabled = !host;
  for (const answer of ["yes", "no"])
    $("vote-" + answer).disabled =
      !ready || !state.room.plan || state.pending.has("vote");
  $("send-message").disabled =
    !ready || state.pending.has("message") || !$("message-draft").value.trim();
  $("submit-quiz").disabled =
    !ready ||
    !state.room.quiz ||
    !state.room.quiz.questions.length ||
    state.room.quiz.locked ||
    state.room.quiz.submitted ||
    state.submittedQuiz === state.room.quiz.id ||
    state.pending.has("quiz");
  $("publish-announcement").disabled =
    !host ||
    state.pending.has("announcement") ||
    !$("announcement-draft").value.trim();
  $("preview-announcement").disabled =
    state.pending.has("preview") || !$("announcement-draft").value.trim();
  $("quiz-content")
    .querySelectorAll("input")
    .forEach((input) => {
      input.disabled =
        state.pending.has("quiz") ||
        !!state.room?.quiz?.submitted ||
        state.submittedQuiz === state.room?.quiz?.id;
    });
  document.querySelectorAll("[data-choose-show]").forEach((button) => {
    button.disabled = !host || state.pending.has("plan");
  });
}
async function busy(key, fn) {
  if (state.pending.has(key)) return;
  state.pending.add(key);
  controls();
  try {
    await fn();
  } catch (error) {
    if (error.name !== "AbortError") {
      if (
        [404, 410].includes(error.status) &&
        state.code &&
        key !== "entry" &&
        key !== "search" &&
        key !== "leave"
      )
        expireRoom();
      else actionStatus(error.message, true);
    }
  } finally {
    state.pending.delete(key);
    controls();
  }
}
function roomPath(suffix = "") {
  return `/api/rooms/${encodeURIComponent(state.code)}${suffix}`;
}
async function mutate(suffix, body, method = "POST") {
  const result = await request(roomPath(suffix), {
    method,
    body,
    signal: state.controller.signal,
  });
  if (result?.ok !== true)
    throw mismatch("mutation response must contain ok: true");
  void state.poller?.refresh();
  return result;
}
function stopRoom(message) {
  state.poller?.stop();
  state.controller?.abort();
  state.code = null;
  state.room = null;
  clearScreen();
  state.poller = null;
  state.controller = null;
  state.chosenShow = null;
  state.quizKey = null;
  state.feedKey = null;
  state.planDirty = false;
  state.savedPlan = null;
  state.submittedQuiz = null;
  state.preview = null;
  store("watchcircle.room", null);
  $("room-badge").textContent = "No active room";
  $("room-status").textContent = message;
  $("room-status").classList.remove("error");
  $("plan-display").replaceChildren(
    element("span", "▶", "mini-poster"),
    element("p", "Choose a show once you’re in a room."),
  );
  $("plan-time").value = "";
  $("plan-note").value = "";
  $("poll-counts").textContent = "Room votes will appear here.";
  for (const answer of ["yes", "no"])
    $("vote-" + answer).setAttribute("aria-pressed", "false");
  setEmpty(
    $("discussion-feed"),
    "Your conversation starts here.",
    "Join a room to share your take.",
  );
  $("quiz-content").textContent = "Join a room to play General TV Trivia.";
  renderLeaderboard([]);
  $("published-announcement").hidden = true;
  // Message and announcement drafts deliberately survive room exit and polling.
  controls();
}
function expireRoom() {
  stopRoom(
    "This room has expired or was removed. Create a new room or join another.",
  );
  actionStatus(
    "The room is no longer available. Your message and announcement drafts have been kept.",
    true,
  );
}
function enterRoom(code) {
  state.code = code;
  state.controller = new AbortController();
  store("watchcircle.room", code);
  $("room-badge").textContent = `Room ${code}`;
  $("room-status").textContent = "Loading room…";
  state.poller = createPoller(
    async (signal) => validateRoom(await request(roomPath(), { signal })),
    {
      onData: renderRoom,
      onError(error) {
        if ([404, 410].includes(error.status)) {
          expireRoom();
          return;
        }
        if ([401, 403].includes(error.status)) {
          stopRoom("Your room session is unavailable. Please join again.");
          actionStatus(error.message, true);
          return;
        }
        $("room-status").textContent =
          `${error.message} Retrying every three seconds; drafts are preserved.`;
        $("room-status").classList.add("error");
      },
    },
  );
  if (!document.hidden) state.poller.start();
  controls();
}
function localTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function renderRoom(room) {
  state.room = room;
  renderScreen(room);
  showMembers(room);
  $("room-status").textContent =
    `${room.members.length} in the circle · You’re ${room.me.nickname}${room.me.isHost ? " (host)" : ""} · Updates every 3 seconds`;
  $("room-status").classList.remove("error");
  const plan = room.plan;
  const info = element("div");
  info.append(
    element("h4", plan?.show.title || "No show selected yet."),
    element(
      "p",
      plan
        ? `${plan.watchAt ? new Date(plan.watchAt).toLocaleString() : "Time to be decided"}${plan.note ? " · " + plan.note : ""}`
        : "The host can pick a show from search.",
    ),
  );
  $("plan-display").replaceChildren(element("span", "▶", "mini-poster"), info);
  if (
    state.savedPlan &&
    plan &&
    plan.show.id === state.savedPlan.showId &&
    plan.watchAt === state.savedPlan.watchAt &&
    plan.note === state.savedPlan.note
  ) {
    if (
      state.chosenShow?.id === state.savedPlan.showId &&
      $("plan-time").value === localTime(state.savedPlan.watchAt) &&
      $("plan-note").value === state.savedPlan.note
    )
      state.planDirty = false;
    state.savedPlan = null;
  }
  if (!state.planDirty) {
    state.chosenShow = plan?.show || null;
    $("plan-time").value = localTime(plan?.watchAt);
    $("plan-note").value = plan?.note || "";
  }
  $("poll-counts").textContent = `${room.poll.yes} Yes · ${room.poll.no} No`;
  for (const answer of ["yes", "no"])
    $("vote-" + answer).setAttribute(
      "aria-pressed",
      String(room.poll.myVote === answer),
    );
  renderFeed(room.messages);
  renderQuiz(room.quiz);
  renderLeaderboard(room.leaderboard);
  $("published-announcement").hidden = !room.announcement;
  $("published-announcement").textContent = room.announcement
    ? `Published: ${room.announcement.text}`
    : "";
  controls();
}
function renderFeed(messages) {
  const key = JSON.stringify(messages);
  if (state.feedKey === key) return;
  state.feedKey = key;
  const feed = $("discussion-feed");
  const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 50;
  if (!messages.length) {
    setEmpty(
      feed,
      "No hot takes yet.",
      "Be the first to start the conversation.",
    );
    return;
  }
  const nodes = messages.map((message) => {
    const item = element("article", undefined, "message");
    const meta = element("div", undefined, "message-meta");
    const time = element(
      "time",
      new Date(message.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    );
    time.dateTime = message.createdAt;
    meta.append(element("strong", message.nickname), time);
    item.append(meta, element("p", message.text));
    return item;
  });
  feed.replaceChildren(...nodes);
  if (atBottom) feed.scrollTop = feed.scrollHeight;
}
function renderQuiz(quiz) {
  // Keep existing radio nodes (focus and checked choices) across routine updates.
  const key = quiz ? JSON.stringify([quiz.id, quiz.questions, quiz.locked]) : null;
  if (key === state.quizKey) return;
  const previous = new Map(
    [...$("quiz-content").querySelectorAll("input:checked")].map((input) => [
      input.name,
      input.value,
    ]),
  );
  state.quizKey = key;
  if (!quiz || !quiz.questions.length) {
    $("quiz-content").textContent =
      "No quiz is available yet. Check back with your circle.";
    return;
  }
  if (quiz.locked) {
    $("quiz-content").replaceChildren(element("p", "The afterparty starts when the credits roll. The host will open trivia after the screening.", "quiz-lock"));
    return;
  }
  const fragment = document.createDocumentFragment();
  fragment.append(element("h4", quiz.title));
  quiz.questions.forEach((question, index) => {
    const fieldset = element("fieldset");
    fieldset.append(element("legend", `${index + 1}. ${question.text}`));
    question.choices.forEach((choice) => {
      const label = element("label", undefined, "quiz-choice"),
        input = document.createElement("input");
      input.type = "radio";
      input.name = JSON.stringify([quiz.id, question.id]);
      input.value = choice.id;
      input.required = true;
      input.dataset.question = question.id;
      input.checked = previous.get(input.name) === choice.id;
      label.append(input, element("span", choice.text));
      fieldset.append(label);
    });
    fragment.append(fieldset);
  });
  $("quiz-content").replaceChildren(fragment);
}
function renderLeaderboard(players) {
  const rows = [...players]
    .sort((a, b) => b.points - a.points)
    .map((player, index) => {
      const row = element("tr");
      row.append(
        element("td", String(index + 1)),
        element("td", player.nickname),
        element("td", String(player.points)),
      );
      return row;
    });
  if (!rows.length) {
    const row = element("tr"),
      cell = element(
        "td",
        "The top spot is waiting. Play a quiz to see scores.",
        "table-empty",
      );
    cell.colSpan = 3;
    row.append(cell);
    rows.push(row);
  }
  $("leaderboard-body").replaceChildren(...rows);
}
function safePoster(url) {
  if (!url || url.startsWith("//")) return null;
  try {
    const parsed = new URL(url, location.href);
    return parsed.protocol === "https:" ||
      (url.startsWith("/") && parsed.origin === location.origin)
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}
function renderShows(shows) {
  const fragment = document.createDocumentFragment();
  for (const show of shows) {
    const card = $("show-card-template").content.cloneNode(true),
      image = card.querySelector("img"),
      fallback = card.querySelector(".poster-fallback");
    const src = safePoster(show.posterUrl);
    if (src) {
      image.alt = `${show.title} poster`;
      image.addEventListener("load", () => {
        fallback.hidden = true;
        image.hidden = false;
      });
      image.addEventListener("error", () => {
        fallback.hidden = false;
        image.hidden = true;
      });
      // Lazy images must participate in layout before the browser starts loading.
      image.hidden = false;
      image.src = src;
    }
    card.querySelector("h3").textContent = show.title;
    card.querySelector("p").textContent = show.summary;
    const button = card.querySelector("button");
    button.dataset.chooseShow = show.id;
    button.addEventListener("click", () => {
      state.chosenShow = show;
      state.planDirty = true;
      actionStatus(
        `Selected ${show.title}. Set a time and save the watch plan.`,
      );
      $("plan-title").scrollIntoView({ block: "center", behavior: "smooth" });
      controls();
    });
    fragment.append(card);
  }
  $("show-results").replaceChildren(fragment);
  controls();
}

$("nickname").value = load("watchcircle.nickname");
$("nickname").addEventListener("input", () =>
  store("watchcircle.nickname", $("nickname").value),
);
const tabs = [$("create-tab"), $("join-tab")];
function switchTab(index) {
  tabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(index === i));
    tab.tabIndex = index === i ? 0 : -1;
    $(i ? "join-panel" : "create-panel").hidden = index !== i;
  });
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => switchTab(index));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
    switchTab(next);
    tabs[next].focus();
  });
});
for (const kind of ["create", "join"])
  $(kind + "-panel").addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.code) return;
    const nickname = $("nickname").value.trim();
    if (!nickname) {
      $("nickname").focus();
      actionStatus("Enter a nickname to join the circle.", true);
      return;
    }
    const code = $("room-code").value.trim().toUpperCase();
    if (kind === "join" && !code) {
      $("room-code").focus();
      return;
    }
    void busy("entry", async () => {
      actionStatus(
        kind === "create" ? "Creating your room…" : "Joining the room…",
      );
      const data = await request(
        kind === "create"
          ? "/api/rooms"
          : `/api/rooms/${encodeURIComponent(code)}/join`,
        { method: "POST", body: { nickname } },
      );
      if (!nonempty(data.code)) throw mismatch("room entry must return a code");
      enterRoom(data.code);
      actionStatus(
        `Joined room ${data.code}. Share this code with your circle.`,
      );
    });
  });
let searchController = null;
$("show-search").addEventListener("input", () => {
  $("clear-search").hidden = !$("show-search").value;
});
$("clear-search").addEventListener("click", () => {
  searchController?.abort();
  $("show-search").value = "";
  $("clear-search").hidden = true;
  $("show-results").replaceChildren();
  $("search-status").hidden = false;
  setEmpty(
    $("search-status"),
    "Your next favorite is out there.",
    "Search for a TV show.",
  );
  $("show-search").focus();
});
$("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const query = $("show-search").value.trim();
  if (!query) {
    $("show-search").focus();
    return;
  }
  void busy("search", async () => {
    searchController = new AbortController();
    $("search-status").hidden = false;
    $("search-status").textContent = "Searching shows…";
    $("show-results").replaceChildren();
    try {
      const data = await request(`/api/shows?q=${encodeURIComponent(query)}`, {
        signal: searchController.signal,
      });
      if (!arrayOf(data.shows, isShow))
        throw mismatch("search must return shows");
      renderShows(data.shows);
      $("search-status").hidden = data.shows.length > 0;
      if (!data.shows.length)
        setEmpty(
          $("search-status"),
          "No shows found.",
          "Try another title or a shorter search.",
        );
    } catch (error) {
      if (error.name !== "AbortError") {
        setEmpty($("search-status"), "Search couldn’t load.", error.message);
        throw error;
      }
    }
  });
});
for (const id of ["plan-time", "plan-note"])
  $(id).addEventListener("input", () => {
    state.planDirty = true;
  });
$("save-plan").addEventListener(
  "click",
  () =>
    void busy("plan", async () => {
      if (!state.room?.me.isHost || !state.chosenShow) return;
      const show = state.chosenShow;
      const time = $("plan-time").value;
      const note = $("plan-note").value;
      const watchAt = time ? new Date(time) : null;
      if (watchAt && !Number.isFinite(watchAt.getTime()))
        throw new Error("Choose a valid watch time.");
      await mutate(
        "/plan",
        { showId: show.id, watchAt: watchAt?.toISOString() || null, note },
        "PUT",
      );
      // Keep the editor until a subsequent poll confirms the saved plan.
      state.savedPlan = {
        showId: show.id,
        watchAt: watchAt?.toISOString() || null,
        note,
      };
      actionStatus(`Watch plan for ${show.title} saved.`);
    }),
);
for (const answer of ["yes", "no"])
  $("vote-" + answer).addEventListener(
    "click",
    () =>
      void busy("vote", async () => {
        if (!state.room?.plan) return;
        await mutate("/vote", { answer });
        actionStatus(`Your vote is ${answer}.`);
      }),
  );
$("message-draft").addEventListener("input", controls);
$("message-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const draft = $("message-draft").value;
  if (!draft.trim() || !state.room) return;
  void busy("message", async () => {
    await mutate("/messages", { text: draft.trim() });
    if ($("message-draft").value === draft) $("message-draft").value = "";
    actionStatus("Message sent.");
  });
});
$("submit-quiz").addEventListener(
  "click",
  () =>
    void busy("quiz", async () => {
      const quiz = state.room?.quiz;
      if (!quiz || quiz.submitted || state.submittedQuiz === quiz.id) return;
      const inputs = [...$("quiz-content").querySelectorAll("input:checked")];
      if (inputs.length !== quiz.questions.length)
        throw new Error(
          "Choose an answer for every question before submitting.",
        );
      await mutate("/quiz/answers", {
        quizId: quiz.id,
        answers: inputs.map((input) => ({
          questionId: input.dataset.question,
          choiceId: input.value,
        })),
      });
      quiz.submitted = true;
      state.submittedQuiz = quiz.id;
      actionStatus(
        "Answers submitted. The leaderboard will update with your score.",
      );
    }),
);
$("announcement-draft").addEventListener("input", () => {
  state.preview = null;
  controls();
});
$("preview-announcement").addEventListener(
  "click",
  () =>
    void busy("preview", async () => {
      const text = $("announcement-draft").value.trim();
      if (!text) return;
      $("announcement-preview-text").textContent = text;
      if (!state.room?.me.isHost) {
        actionStatus(
          "Local draft preview. Join as host to request a server preview.",
        );
        return;
      }
      const result = await request(roomPath("/announcements/preview"), {
        method: "POST",
        body: { text },
        signal: state.controller.signal,
      });
      if (!validString(result.text))
        throw mismatch("announcement preview must return text");
      if ($("announcement-draft").value.trim() !== text) return;
      state.preview = { input: text, output: result.text };
      $("announcement-preview-text").textContent = result.text;
      actionStatus("Server preview ready.");
    }),
);
$("publish-announcement").addEventListener(
  "click",
  () =>
    void busy("announcement", async () => {
      if (!state.room?.me.isHost) return;
      const text = $("announcement-draft").value.trim();
      if (!text) return;
      if (state.preview?.input !== text)
        throw new Error(
          "Preview the current announcement with the server before publishing.",
        );
      await mutate("/announcements", { text });
      actionStatus("Announcement published.");
    }),
);
$("leave-room").addEventListener(
  "click",
  () =>
    void busy("leave", async () => {
      const path = roomPath("/leave");
      stopRoom("You left the room. Polling is stopped.");
      try {
        await request(path, { method: "POST", body: {} });
      } catch (error) {
        throw new Error(
          `You left locally, but the server could not confirm departure. ${error.message}`,
        );
      }
      actionStatus("You left the room.");
    }),
);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) state.poller?.stop();
  else state.poller?.start();
});
window.addEventListener("pagehide", () => {
  state.poller?.stop();
  state.controller?.abort();
  searchController?.abort();
});
window.addEventListener("pageshow", () => {
  if (state.code) {
    state.controller = new AbortController();
    if (!document.hidden) state.poller?.start();
  }
});
// Synchronized playback shares the server's timeline; native media UI does not control the room.
let currentScreenId = null;
let latestScreen = null;
let screenReceivedAt = 0;
let heartbeatPending = false;
const player = $("watch-player");
player.muted = true;
function screeningControls() {
  const host = !!state.room?.me.isHost;
  const screen = state.room?.screen;
  const pending = state.pending.has("screen");
  for (const id of ["load-sample", "save-media"]) $(id).disabled = !host || pending;
  for (const id of ["screen-play", "screen-pause", "finish-screen", "screen-seek"])
    $(id).disabled = !host || !screen || screen.finished || pending;
  for (const id of ["enable-audio", "sync-video", "screen-fullscreen"]) $(id).disabled = !screen;
  $("copy-invite").disabled = !state.room;
  for (const id of ["media-title", "media-url", "media-duration"]) $(id).disabled = !host;
}
function timeLabel(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(value / 60).toString().padStart(2, "0")}:${(value % 60).toString().padStart(2, "0")}`;
}
function desiredPosition() {
  if (!latestScreen) return 0;
  return Math.min(latestScreen.duration, latestScreen.position + (latestScreen.playing ? (performance.now() - screenReceivedAt) / 1000 : 0));
}
async function synchronizePlayer(force = false) {
  const screen = latestScreen;
  if (!screen || !player.readyState) return;
  const expected = desiredPosition();
  if (force || Math.abs(player.currentTime - expected) > 1.25) player.currentTime = expected;
  if (screen.playing && !screen.finished && expected < screen.duration) {
    try { await player.play(); }
    catch { $("screen-status").textContent = "Your browser paused playback. Click Rejoin playback to start."; }
  } else player.pause();
}
function renderScreen(room) {
  const screen = room?.screen;
  latestScreen = screen || null;
  screenReceivedAt = performance.now();
  if (!screen) {
    if (currentScreenId) { player.pause(); player.removeAttribute("src"); player.load(); }
    currentScreenId = null;
    $("screen-empty").hidden = false;
    $("screen-name").textContent = "The best seat is next to your friends.";
    $("screen-badge").textContent = "READY WHEN YOU ARE";
    $("screen-status").textContent = room ? "The host can load the sample film or a shareable video." : "Join your circle to start a screening.";
    $("watch-progress").value = 0;
    $("watch-progress-label").textContent = "Your watch progress appears here.";
    $("screen-time").textContent = "00:00 / 00:00";
    $("screen-seek").value = 0;
    return;
  }
  $("screen-empty").hidden = true;
  if (currentScreenId !== screen.id) {
    currentScreenId = screen.id;
    player.src = screen.url;
    player.load();
  }
  $("screen-name").textContent = screen.title;
  $("screen-badge").textContent = screen.finished ? "THE AFTERPARTY IS OPEN" : screen.playing ? "NOW WATCHING TOGETHER" : "LIGHTS DOWN. READY TO PLAY.";
  $("screen-status").textContent = player.error ? "This video couldn’t load. Check the URL and try Rejoin playback." : screen.finished ? "Screening finished. Your trivia is ready below." : room.me.isHost ? "You’re hosting. Play, pause and seek for everyone in the circle." : "You’re watching with the host. Playback stays in sync automatically.";
  const progress = screen.attendance;
  $("watch-progress").value = Math.min(100, progress.seconds / progress.requiredSeconds * 100);
  $("watch-progress-label").textContent = progress.awarded ? "+5 watch points earned. See your place on the leaderboard." : `${Math.floor(progress.seconds)} / ${Math.ceil(progress.requiredSeconds)} seconds watched toward +5 points`;
  void synchronizePlayer();
}
function clearScreen() {
  renderScreen(null);
  $("members").replaceChildren();
}
function showMembers(room) {
  $("members").replaceChildren(...room.members.map(member => element("span", `${member.nickname}${member.id === room.me.id ? " · you" : ""}`, "member-chip")));
}
for (const suggestion of document.querySelectorAll("[data-search]")) suggestion.addEventListener("click", () => {
  $("show-search").value = suggestion.dataset.search;
  $("clear-search").hidden = false;
  $("search-form").requestSubmit();
});
$("copy-invite").addEventListener("click", () => void busy("invite", async () => {
  if (!state.code) return;
  const url = new URL(location.href);
  url.search = ""; url.hash = "room-entry";
  url.searchParams.set("room", state.code);
  try { await navigator.clipboard.writeText(url.href); actionStatus("Invitation link copied. Send it to your circle."); }
  catch { actionStatus(`Share this invitation code: ${state.code}`); }
}));
const invitation = new URLSearchParams(location.search).get("room");
if (invitation) { $("room-code").value = invitation.toUpperCase(); switchTab(1); }
$("load-sample").addEventListener("click", () => void busy("screen", async () => {
  await mutate("/screen", { sample: true }, "PUT");
  actionStatus("Sample film loaded. Press Play together when your circle is ready.");
}));
$("media-form").addEventListener("submit", event => {
  event.preventDefault();
  void busy("screen", async () => {
    await mutate("/screen", { title: $("media-title").value.trim(), url: $("media-url").value.trim(), duration: Number($("media-duration").value) }, "PUT");
    $("custom-media").open = false;
    actionStatus("Video loaded for the circle.");
  });
});
function playbackAction(action, position) {
  void busy("screen", async () => {
    const screen = state.room?.screen;
    if (!screen || !state.room.me.isHost) return;
    await mutate("/screen/control", { screenId: screen.id, action, ...(position === undefined ? {} : { position }) });
    actionStatus(action === "finish" ? "The afterparty is open. Scroll down for trivia!" : "Shared playback updated.");
  });
}
$("screen-play").addEventListener("click", () => playbackAction("play"));
$("screen-pause").addEventListener("click", () => playbackAction("pause"));
$("finish-screen").addEventListener("click", () => playbackAction("finish"));
$("screen-seek").addEventListener("change", () => playbackAction("seek", Number($("screen-seek").value) / 100 * (latestScreen?.duration || 0)));
$("sync-video").addEventListener("click", () => {
  if (player.error) player.load();
  else void synchronizePlayer(true);
});
$("enable-audio").addEventListener("click", () => {
  player.muted = !player.muted;
  $("enable-audio").textContent = player.muted ? "Enable sound" : "Mute sound";
  void synchronizePlayer();
});
$("screen-fullscreen").addEventListener("click", () => {
  const operation = player.requestFullscreen?.();
  operation?.catch(() => actionStatus("Fullscreen isn’t available in this browser.", true));
});
player.addEventListener("loadedmetadata", () => void synchronizePlayer(true));
player.addEventListener("error", () => { if (latestScreen) $("screen-status").textContent = "This video couldn’t load. Check the video URL or network access, then try Rejoin playback. Room chat and planning are still available."; });
player.addEventListener("timeupdate", () => {
  if (!latestScreen) return;
  $("screen-time").textContent = `${timeLabel(player.currentTime)} / ${timeLabel(latestScreen.duration)}`;
  if (document.activeElement !== $("screen-seek")) $("screen-seek").value = player.currentTime / latestScreen.duration * 100;
});
async function sendHeartbeat() {
  const screen = state.room?.screen;
  if (!screen || screen.finished || heartbeatPending || !state.code) return;
  heartbeatPending = true;
  try {
    await request(roomPath("/screen/heartbeat"), { method: "POST", signal: state.controller.signal,
      body: { screenId: screen.id, position: player.currentTime, watching: !document.hidden && !player.paused && !player.ended && player.readyState >= 3 } });
  } catch (error) {
    if (error.name !== "AbortError") $("screen-status").textContent = "Watch progress couldn’t sync. Reconnecting on the next update.";
  } finally { heartbeatPending = false; }
}
setInterval(() => void sendHeartbeat(), 3000);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) void sendHeartbeat();
  else void synchronizePlayer(true);
});

controls();
const savedRoom = load("watchcircle.room");
if (savedRoom) enterRoom(savedRoom);
