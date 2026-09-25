import { api } from "../api.js";
import { store } from "../store.js";
import { $, el, notice, isLocked, msUntilLock, formatCountdown, matchLabel, teamList } from "../ui.js";
import { scorePredictions } from "../scoring.js";

let selectedEventKey = "";
let cachedMatches = [];
let tickHandle = null;

async function loadEventCatalog() {
  const select = $("eventRegionSelect");
  if (!select) return;
  const year = new Date().getFullYear();
  let events = [];
  try {
    events = await api.tbaEventsForYear(year);
  } catch {
    notice("eventHelp", "Could not load the event list right now.", "error");
    return;
  }
  const now = Date.now();
  const windowMs = 10 * 24 * 60 * 60 * 1000; // show events within ~10 days unless "show all" is on
  const showAll = Boolean(store.state.showAllEventsInCatalog);
  const filtered = events.filter((e) => {
    if (showAll) return true;
    const start = e.start_date ? new Date(e.start_date).getTime() : null;
    const end = e.end_date ? new Date(e.end_date).getTime() : start;
    if (!start) return false;
    return now >= start - windowMs && now <= end + windowMs;
  });
  filtered.sort((a, b) => {
    const country = (a.country || "").localeCompare(b.country || "");
    if (country) return country;
    const state = (a.state_prov || "").localeCompare(b.state_prov || "");
    if (state) return state;
    return (a.name || "").localeCompare(b.name || "");
  });

  select.innerHTML = "";
  select.append(el("option", { value: "" }, "Select this week's event (sorted by country/state)"));
  for (const e of filtered) {
    select.append(el("option", { value: e.key }, `${e.country || "?"} / ${e.state_prov || "?"} - ${e.name}`));
  }
  notice(
    "eventHelp",
    filtered.length ? "" : "No nearby events found for the current window. Ask an admin to enable 'show all events'."
  );
}

async function loadMatchesForEvent(eventKey) {
  if (!eventKey) {
    cachedMatches = [];
    render();
    return;
  }
  try {
    cachedMatches = await api.tbaEventMatches(eventKey);
  } catch {
    notice("eventHelp", "Could not load matches for that event.", "error");
    cachedMatches = [];
  }
  render();
}

function predictionsFor(profileId) {
  return store.state.predictionsByProfile[profileId] || {};
}

function setPrediction(matchKey, patch) {
  store.mutate((state) => {
    const profileId = store.profileId;
    state.predictionsByProfile[profileId] = state.predictionsByProfile[profileId] || {};
    const existing = state.predictionsByProfile[profileId][matchKey] || {};
    state.predictionsByProfile[profileId][matchKey] = { ...existing, ...patch, predictedAt: Date.now() };
  });
}

function renderMatchRow(match) {
  const locked = isLocked(match);
  const prediction = predictionsFor(store.profileId)[match.key] || {};
  const played = match.alliances?.red?.score >= 0 && match.alliances?.blue?.score >= 0;
  const isPractice = match.comp_level === "pm";

  const row = el("div", { class: `match-row ${played ? "played" : ""} ${locked ? "locked" : ""}` });
  row.append(
    el("div", { class: "match-meta" }, [
      el("span", { class: "match-label" }, matchLabel(match)),
      isPractice ? el("span", { class: "badge badge-muted" }, "Doesn't count") : null,
      match.time ? el("span", { class: "match-time" }, new Date(match.time * 1000).toLocaleString()) : null
    ])
  );

  const allianceRow = el("div", { class: "alliance-row" });
  for (const color of ["red", "blue"]) {
    const alliance = match.alliances?.[color];
    const score = played ? alliance.score : null;
    const picked = prediction.winner === color;
    const btn = el(
      "button",
      {
        class: `alliance-btn alliance-${color} ${picked ? "picked" : ""}`,
        disabled: locked || played ? "disabled" : null,
        onclick: () => setPrediction(match.key, { winner: color })
      },
      [
        el("span", { class: "alliance-teams" }, teamList(alliance) || "TBD"),
        score !== null ? el("span", { class: "alliance-score" }, String(score)) : null
      ]
    );
    allianceRow.append(btn);
  }
  row.append(allianceRow);

  if (!isPractice) {
    const scoreInput = el("input", {
      type: "number",
      class: "score-guess-input",
      placeholder: "Guess winner's score",
      value: prediction.score ?? "",
      disabled: locked || played ? "disabled" : null,
      onchange: (e) => setPrediction(match.key, { score: e.target.value === "" ? null : Number(e.target.value) })
    });
    row.append(el("div", { class: "score-guess-row" }, [scoreInput]));
  }

  if (!played && !isPractice) {
    const remaining = msUntilLock(match);
    if (remaining !== null && remaining > 0 && remaining < 60 * 60 * 1000) {
      row.append(el("div", { class: "lock-countdown" }, `Locks in ${formatCountdown(remaining)}`));
    } else if (locked) {
      row.append(el("div", { class: "lock-countdown locked-label" }, "Locked"));
    }
  }

  return row;
}

function render() {
  const current = $("currentMatches");
  const upcoming = $("upcomingMatches");
  const previous = $("previousMatches");
  if (!current) return;
  current.innerHTML = "";
  upcoming.innerHTML = "";
  previous.innerHTML = "";

  if (!selectedEventKey) return;

  const now = Date.now();
  const sorted = [...cachedMatches].sort((a, b) => (a.time || 0) - (b.time || 0));
  const played = sorted.filter((m) => m.alliances?.red?.score >= 0 && m.alliances?.blue?.score >= 0);
  const unplayed = sorted.filter((m) => !(m.alliances?.red?.score >= 0 && m.alliances?.blue?.score >= 0));
  const live = unplayed.filter((m) => m.time && m.time * 1000 <= now);
  const future = unplayed.filter((m) => !m.time || m.time * 1000 > now);

  current.append(
    el("h3", {}, "Live / Up Next"),
    ...(live.length ? live.map(renderMatchRow) : [el("p", { class: "muted" }, "No live matches right now.")])
  );
  upcoming.append(
    el("h3", {}, "Upcoming"),
    ...(future.length ? future.slice(0, 25).map(renderMatchRow) : [el("p", { class: "muted" }, "No upcoming matches loaded yet.")])
  );
  previous.append(
    el("h3", {}, "Completed"),
    ...(played.length ? played.slice(-25).reverse().map(renderMatchRow) : [el("p", { class: "muted" }, "No completed matches yet.")])
  );
}

export function currentScoreSummary() {
  return scorePredictions(cachedMatches, predictionsFor(store.profileId));
}

export function currentEventMatches() {
  return cachedMatches;
}

export function currentEventKey() {
  return selectedEventKey;
}

export function initMatchesView() {
  loadEventCatalog();
  $("eventRegionSelect")?.addEventListener("change", (e) => {
    selectedEventKey = e.target.value;
    loadMatchesForEvent(selectedEventKey);
  });
  store.subscribe(render);
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = setInterval(render, 1000); // keep lock countdowns fresh
  setInterval(() => selectedEventKey && loadMatchesForEvent(selectedEventKey), 30000);
}
