import { api } from "../api.js";
import { store } from "../store.js";
import { runtime, setEvent } from "../runtime.js";
import { $, el, formatCountdown, formatMatchTime, isLocked, makeGuardedRender, matchLabel, matchStartMs, teamNumbers, fill } from "../ui.js";
import { hasPlayoffs, isPlayed, matchWinner, playerRows, rankRows, scorePredictions, totalsFor } from "../scoring.js";
import { LOCK_WINDOW_MS } from "../constants.js";
import { allianceButton, chip, resultLine, scoreGuessField } from "./cards.js";
import { renderBracket } from "./bracket.js";
import { buildHowToPlay } from "./help.js";

const EVENT_STORAGE_KEY = "ffrc_selected_event";
const SHOW_ALL_KEY = "ffrc_show_all_events";
const HELP_SEEN_KEY = "ffrc_help_seen";
const SEARCH_THRESHOLD = 8; // only show the event search box when the list is long enough to need it
const WINDOW_MS = 10 * 24 * 60 * 60 * 1000; // events within ~10 days count as "happening now"
const REFRESH_MS = 30000;

let events = [];
let eventsStatus = "idle"; // idle | loading | ready | error
let tbaConfigured = true;
let selectedEventKey = "";
let loadingMatchesFor = "";
let refreshFailed = false;
let lastUpdatedAt = 0;
let viewMode = null; // "matches" | "bracket" | null (null = pick automatically)
const shown = { open: 8, done: 6 };

const prefs = {
  get(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  },
  set(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
};

/* ---------------------------------------------------------------- events */

function eventPlace(e) {
  return [e.city, e.state_prov].filter(Boolean).join(", ");
}

function localDate(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return y ? new Date(y, m - 1, d) : null;
}

function eventDates(e) {
  const start = localDate(e.start_date);
  const end = localDate(e.end_date);
  if (!start) return "";
  const fmt = (d) => d.toLocaleDateString([], { month: "short", day: "numeric" });
  if (!end || end.getTime() === start.getTime()) return fmt(start);
  // Same month reads "Mar 12-14"; across a month boundary "Mar 30 - Apr 1".
  return start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear() ? `${fmt(start)}-${end.getDate()}` : `${fmt(start)} - ${fmt(end)}`;
}

function eventLabel(e) {
  return [e.name, eventPlace(e), eventDates(e)].filter(Boolean).join(" · ");
}

function happeningNow(e, now) {
  const start = localDate(e.start_date);
  const end = localDate(e.end_date) || start;
  if (!start) return false;
  return now >= start.getTime() - WINDOW_MS && now <= end.getTime() + WINDOW_MS;
}

function showAllEvents() {
  return Boolean(store.state.showAllEventsInCatalog) || prefs.get(SHOW_ALL_KEY) === "1";
}

function visibleEvents() {
  const now = Date.now();
  const query = ($("eventSearch")?.value || "").trim().toLowerCase();
  return events
    .filter((e) => showAllEvents() || happeningNow(e, now))
    .filter((e) => !query || eventLabel(e).toLowerCase().includes(query) || String(e.key).toLowerCase().includes(query));
}

function rebuildEventSelect() {
  const select = $("eventRegionSelect");
  if (!select) return;
  const list = visibleEvents();
  const groups = new Map();
  for (const e of [...list].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)) || String(a.name).localeCompare(String(b.name)))) {
    const label = `${e.country || "?"} / ${e.state_prov || "?"}`;
    groups.set(label, [...(groups.get(label) || []), e]);
  }
  const placeholder = eventsStatus === "loading" ? "Loading events..." : list.length ? "Choose an event..." : "No events to show";
  fill(select, el("option", { value: "" }, placeholder));
  const stay = selectedEventKey && !list.some((e) => e.key === selectedEventKey) ? events.find((e) => e.key === selectedEventKey) : null;
  if (stay) select.append(el("option", { value: stay.key }, eventLabel(stay)));
  for (const [label, group] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    select.append(el("optgroup", { label }, group.map((e) => el("option", { value: e.key }, eventLabel(e)))));
  }
  select.value = selectedEventKey;
  $("eventSearch")?.classList.toggle("hidden", events.length <= SEARCH_THRESHOLD);
}

async function loadEvents() {
  eventsStatus = "loading";
  rebuildEventSelect();
  render();
  try {
    events = await api.tbaEventsForYear(new Date().getFullYear());
    eventsStatus = "ready";
  } catch {
    eventsStatus = "error";
  }
  rebuildEventSelect();
  if (eventsStatus === "ready" && !selectedEventKey) {
    const saved = prefs.get(EVENT_STORAGE_KEY);
    const only = visibleEvents();
    if (saved && events.some((e) => e.key === saved)) selectEvent(saved, { remember: false });
    else if (only.length === 1) selectEvent(only[0].key);
  }
  render();
}

function selectEvent(key, { remember = true } = {}) {
  selectedEventKey = key;
  if (remember) prefs.set(EVENT_STORAGE_KEY, key);
  viewMode = null;
  const help = $("howToPlay");
  if (key && help?.open) help.open = false;
  shown.open = 8;
  shown.done = 6;
  refreshFailed = false;
  lastUpdatedAt = 0;
  const found = events.find((e) => e.key === key);
  setEvent({ key, name: found ? found.name : key, matches: [], status: key ? "loading" : "idle" });
  rebuildEventSelect();
  render();
  loadMatches();
}

async function loadMatches() {
  const key = selectedEventKey;
  if (!key || loadingMatchesFor === key) return;
  loadingMatchesFor = key;
  let matches = null;
  try {
    matches = await api.tbaEventMatches(key);
  } catch {
    matches = null;
  }
  if (loadingMatchesFor === key) loadingMatchesFor = "";
  // The player may have picked a different event while this was loading.
  if (key !== selectedEventKey) return;
  if (matches) {
    refreshFailed = false;
    lastUpdatedAt = Date.now();
    setEvent({ matches, status: "ready" });
  } else {
    refreshFailed = true;
    setEvent({ status: runtime.event.matches.length ? "ready" : "error" });
  }
  render();
}

/* --------------------------------------------------------------- render */

const predictionsFor = (profileId) => store.state.predictionsByProfile[profileId] || {};

function setPrediction(matchKey, patch) {
  store.mutate((state) => {
    const profileId = store.profileId;
    state.predictionsByProfile[profileId] = state.predictionsByProfile[profileId] || {};
    const existing = state.predictionsByProfile[profileId][matchKey] || {};
    state.predictionsByProfile[profileId][matchKey] = { ...existing, ...patch, predictedAt: Date.now() };
  });
}

function lockChipText(lockAt, now) {
  const remaining = lockAt - now;
  return remaining < 60 * 60 * 1000 ? `Locks in ${formatCountdown(remaining)}` : `Locks ${formatMatchTime(lockAt, now)}`;
}

function startChipText(start, now) {
  const minutes = Math.ceil((start - now) / 60000);
  if (start <= now) return "Locked · in progress";
  return minutes < 60 ? `Locked · starts in ${minutes} min` : `Locked · starts ${formatMatchTime(start, now)}`;
}

function matchCard(match, ctx) {
  const now = Date.now();
  const start = matchStartMs(match);
  const played = isPlayed(match);
  const practice = match.comp_level === "pm";
  const locked = !played && isLocked(match, now);
  const open = !played && !locked && !practice;
  const prediction = ctx.predictions[match.key] || {};
  const winner = matchWinner(match);
  const breakdown = ctx.scored.byMatch[match.key];

  let status;
  if (played) status = chip("Final", "muted");
  else if (locked && start) status = el("span", { class: "chip chip-locked", "data-start-at": String(start) }, startChipText(start, now));
  else if (locked) status = chip("Locked", "locked");
  else if (start && !practice) status = el("span", { class: "chip chip-open", "data-lock-at": String(start - LOCK_WINDOW_MS) }, lockChipText(start - LOCK_WINDOW_MS, now));
  else status = chip(practice ? "Doesn't count" : "Open", practice ? "muted" : "open");

  const card = el("article", { class: `match-row state-${played ? "played" : locked ? "locked" : "open"}` });
  card.append(el("div", { class: "match-meta" }, [el("span", { class: "match-label" }, matchLabel(match)), start ? el("span", { class: "match-time" }, formatMatchTime(start, now)) : null, status]));

  const row = el("div", { class: "alliance-row" });
  for (const color of ["red", "blue"]) {
    row.append(
      allianceButton({
        color,
        teams: teamNumbers(match.alliances?.[color]),
        score: played ? match.alliances[color].score : null,
        picked: prediction.winner === color,
        won: played && winner === color,
        disabled: !open,
        onPick: () => setPrediction(match.key, { winner: color })
      })
    );
  }
  card.append(row);

  if (open) {
    card.append(scoreGuessField({ value: prediction.score, label: `Winning score guess for ${matchLabel(match)}`, onCommit: (score) => setPrediction(match.key, { score }) }));
  } else if (played) {
    card.append(
      winner === "tie"
        ? el("div", { class: "result result-none" }, "Tie - no points either way")
        : resultLine({ made: Boolean(prediction.winner), breakdown: breakdown || { correct: false, points: 0, pickPoints: 0, scorePoints: 0, streakBonus: 0 }, scoreGuess: prediction.score })
    );
  } else if (locked) {
    card.append(
      el("div", { class: "result result-none" }, prediction.winner ? (typeof prediction.score === "number" ? `Locked in · score guess ${prediction.score}` : "Locked in") : "No pick made")
    );
  }
  return card;
}

function section({ title, count, cards, empty, more }) {
  const node = el("section", { class: "match-section" }, [el("h3", {}, [title, el("span", { class: "count" }, String(count))])]);
  if (!cards.length) node.append(el("p", { class: "muted" }, empty));
  else node.append(el("div", { class: "match-grid" }, cards));
  if (more) node.append(more);
  return node;
}

function showMore(key, total, step) {
  if (shown[key] >= total) return null;
  return el(
    "button",
    {
      type: "button",
      class: "secondary-btn show-more",
      onclick: () => {
        shown[key] += step;
        renderNow();
      }
    },
    `Show ${Math.min(step, total - shown[key])} more`
  );
}

function summaryStrip(ctx, openMatches) {
  const { event } = runtime;
  const totals = totalsFor(store.state, store.profileId, event.matches, event.key);
  const chips = [el("span", { class: "stat" }, [el("strong", {}, String(totals.points)), " pts"])];
  if (store.user) {
    const rows = rankRows(playerRows(store.state, event.matches, event.key));
    const me = rows.find((r) => r.id === store.profileId);
    if (me) chips.push(el("span", { class: "stat" }, [el("strong", {}, `${me.tied ? "Tied for " : ""}#${me.rank}`), ` of ${rows.length}`]));
  }
  const picked = openMatches.filter((m) => ctx.predictions[m.key]?.winner).length;
  if (openMatches.length) chips.push(el("span", { class: "stat" }, [el("strong", {}, `${picked} of ${openMatches.length}`), " open matches picked"]));
  return el("div", { class: "summary-strip" }, chips);
}

function emptyState() {
  const { event } = runtime;
  if (!tbaConfigured) return el("div", { class: "empty-card" }, [el("h3", {}, "Live matches aren't available yet"), el("p", { class: "muted" }, "The server needs a TBA_API_KEY before it can load events. If you run this app, set it in your settings.")]);
  if (eventsStatus === "loading" || eventsStatus === "idle") return el("div", { class: "empty-card" }, [el("p", { class: "muted" }, "Loading events...")]);
  if (eventsStatus === "error") {
    return el("div", { class: "empty-card" }, [
      el("h3", {}, "Couldn't load the event list"),
      el("p", { class: "muted" }, "Check your connection and try again."),
      el("button", { type: "button", class: "load-btn", onclick: loadEvents }, "Try again")
    ]);
  }
  if (!event.key) {
    const none = visibleEvents().length === 0;
    return el("div", { class: "empty-card" }, [
      el("h3", {}, none ? "No events to show" : "Choose an event to start predicting"),
      el("p", { class: "muted" }, none ? "Nothing is happening around now. Tick \"Show all events\" above to browse the whole season." : "Pick the event you're watching from the list above. Your choice is remembered.")
    ]);
  }
  if (event.status === "loading") return el("div", { class: "empty-card" }, [el("p", { class: "muted" }, "Loading matches...")]);
  if (event.status === "error") {
    return el("div", { class: "empty-card" }, [
      el("h3", {}, "Couldn't load this event's matches"),
      el("p", { class: "muted" }, "It will retry automatically, or you can try now."),
      el("button", { type: "button", class: "load-btn", onclick: loadMatches }, "Try again")
    ]);
  }
  if (!event.matches.length) {
    return el("div", { class: "empty-card" }, [el("h3", {}, "No match schedule yet"), el("p", { class: "muted" }, "The schedule usually appears shortly before the event. Check back soon.")]);
  }
  return null;
}

function renderEventBar() {
  const updated = $("eventUpdated");
  const showAll = $("eventShowAll");
  if (showAll) showAll.checked = showAllEvents();
  if (updated) {
    if (!runtime.event.key || !lastUpdatedAt) updated.textContent = "";
    else updated.textContent = refreshFailed ? `Couldn't refresh - showing data from ${formatMatchTime(lastUpdatedAt)}` : `Updated ${formatMatchTime(lastUpdatedAt)}`;
    updated.classList.toggle("warn", refreshFailed);
  }
  $("eventTools")?.classList.toggle("hidden", !tbaConfigured || eventsStatus === "error");
}

function renderNow() {
  renderEventBar();
  const { event } = runtime;
  const empty = $("matchesEmpty");
  const summary = $("matchesSummary");
  const switcher = $("viewSwitch");
  const list = $("matchesView");
  const bracket = $("playoffBracket");
  if (!empty || !list) return;

  const emptyNode = emptyState();
  fill(empty, ...(emptyNode ? [emptyNode] : []));
  if (emptyNode) {
    for (const node of [summary, switcher, list, bracket]) node?.classList.add("hidden");
    return;
  }

  const playoffs = hasPlayoffs(event.matches);
  const qualsLeft = event.matches.some((m) => m.comp_level === "qm" && !isPlayed(m));
  const mode = playoffs ? viewMode || (qualsLeft ? "matches" : "bracket") : "matches";
  switcher.classList.toggle("hidden", !playoffs);
  for (const btn of switcher.querySelectorAll("button")) {
    const active = btn.dataset.view === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  }
  list.classList.toggle("hidden", mode !== "matches");
  bracket.classList.toggle("hidden", mode !== "bracket");
  summary.classList.remove("hidden");

  const ctx = { predictions: predictionsFor(store.profileId) };
  ctx.scored = scorePredictions(event.matches, ctx.predictions);
  const now = Date.now();
  const byStart = (a, b) => (matchStartMs(a) ?? Infinity) - (matchStartMs(b) ?? Infinity);
  const upcoming = event.matches.filter((m) => !isPlayed(m));
  const openMatches = upcoming.filter((m) => m.comp_level !== "pm" && !isLocked(m, now)).sort(byStart);
  const lockedMatches = upcoming.filter((m) => m.comp_level === "pm" || isLocked(m, now)).sort(byStart);
  const done = event.matches.filter(isPlayed).sort((a, b) => (b.actual_time || b.time || 0) - (a.actual_time || a.time || 0));

  fill(summary, summaryStrip(ctx, openMatches));

  if (mode === "matches") {
    fill(list, 
      section({
        title: "Open for picks",
        count: openMatches.length,
        cards: openMatches.slice(0, shown.open).map((m) => matchCard(m, ctx)),
        empty: playoffs && !qualsLeft ? "Qualification matches are over. Head to the playoff bracket to make picks." : "Nothing is open right now - new matches open as the schedule fills in.",
        more: showMore("open", openMatches.length, 8)
      }),
      lockedMatches.length ? section({ title: "Locked or in progress", count: lockedMatches.length, cards: lockedMatches.map((m) => matchCard(m, ctx)), empty: "" }) : null,
      section({
        title: "Completed",
        count: done.length,
        cards: done.slice(0, shown.done).map((m) => matchCard(m, ctx)),
        empty: "No matches have finished yet.",
        more: showMore("done", done.length, 12)
      })
    );
  } else {
    renderBracket(bracket, { eventKey: event.key, matches: event.matches });
  }
}

const render = makeGuardedRender(() => [$("matchesTab")], renderNow);

// Countdowns tick every second without rebuilding the page (which would steal focus
// from a score box); a full render happens only when a match actually locks.
function tick() {
  const now = Date.now();
  let lockedSomething = false;
  for (const node of document.querySelectorAll("[data-lock-at]")) {
    const lockAt = Number(node.dataset.lockAt);
    if (now >= lockAt) lockedSomething = true;
    else node.textContent = lockChipText(lockAt, now);
  }
  for (const node of document.querySelectorAll("[data-start-at]")) node.textContent = startChipText(Number(node.dataset.startAt), now);
  if (lockedSomething) render();
}

function buildHelp() {
  const host = $("helpHost");
  if (!host) return;
  const details = el("details", { class: "how-to-play", id: "howToPlay" }, [el("summary", {}, "How to play & scoring"), buildHowToPlay()]);
  // First visit, before an event is chosen: show the rules once. Choosing an event tucks them away.
  if (!prefs.get(HELP_SEEN_KEY) && !prefs.get(EVENT_STORAGE_KEY)) details.open = true;
  details.addEventListener("toggle", () => {
    if (!details.open) prefs.set(HELP_SEEN_KEY, "1");
  });
  fill(host, details);
}

export function initMatchesView({ tbaConfigured: configured = true } = {}) {
  tbaConfigured = configured;
  buildHelp();

  const select = $("eventRegionSelect");
  select?.addEventListener("change", (e) => selectEvent(e.target.value));
  $("eventSearch")?.addEventListener("input", rebuildEventSelect);
  $("eventShowAll")?.addEventListener("change", (e) => {
    prefs.set(SHOW_ALL_KEY, e.target.checked ? "1" : "");
    rebuildEventSelect();
    render();
  });
  $("refreshBtn")?.addEventListener("click", () => {
    if (selectedEventKey) loadMatches();
    else loadEvents();
  });
  $("viewSwitch")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (!btn) return;
    viewMode = btn.dataset.view;
    renderNow();
  });

  let lastShowAll = showAllEvents();
  store.subscribe(() => {
    // Signing in as an admin can flip the global "show all events" setting.
    if (showAllEvents() !== lastShowAll) {
      lastShowAll = showAllEvents();
      rebuildEventSelect();
    }
    render();
  });

  setInterval(tick, 1000);
  setInterval(() => selectedEventKey && !document.hidden && loadMatches(), REFRESH_MS);
  document.addEventListener("visibilitychange", () => !document.hidden && selectedEventKey && loadMatches());

  if (!tbaConfigured) {
    // Nothing to load: say so instead of showing "Loading events..." forever.
    fill(select, el("option", { value: "" }, "Events unavailable"));
    if (select) select.disabled = true;
    if ($("refreshBtn")) $("refreshBtn").disabled = true;
    render();
    return;
  }
  loadEvents();
}
