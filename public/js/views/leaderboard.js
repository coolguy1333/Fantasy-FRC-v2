import { api } from "../api.js";
import { store } from "../store.js";
import { runtime, onEventChange } from "../runtime.js";
import { $, el, fill } from "../ui.js";
import { playerRows, rankRows, teamRowsFrom } from "../scoring.js";
import { openProfile } from "./profile.js";
import { openPlayerCard } from "./player-card.js";

const MODES = [
  ["players", "Players"],
  ["myteam", "My team"],
  ["teams", "Teams"]
];
const SCOPES = [
  ["event", "This event"],
  ["season", "Season"]
];
const MAX_ROWS = 100;
const SEASON_REFRESH_MS = 5 * 60 * 1000;
const SEASON_FETCHES_AT_ONCE = 4;

let mode = "players";
let scope = "event";
let showAll = false;

/* ---------------------------------------------------------------- season */

// Every event this season that anyone made picks at, with its matches from TBA.
const season = { year: 0, matches: new Map(), loading: false, failed: [], fetchedAt: 0 };
const round1 = (n) => Math.round(n * 10) / 10;
const seasonYear = () => Number(String(runtime.event.key || "").slice(0, 4)) || new Date().getFullYear();

function seasonEventKeys(state, year) {
  const keys = new Set();
  const add = (eventKey) => eventKey.startsWith(String(year)) && keys.add(eventKey);
  for (const picks of Object.values(state.predictionsByProfile || {})) for (const key of Object.keys(picks || {})) add(key.split("_")[0]);
  for (const picks of Object.values(state.bracketPicksByProfile || {})) for (const key of Object.keys(picks || {})) add(key.split(":")[0]);
  return [...keys];
}

async function loadSeason() {
  if (season.loading || !store.user) return;
  const year = seasonYear();
  if (season.year !== year) Object.assign(season, { year, matches: new Map(), failed: [], fetchedAt: 0 });
  const keys = seasonEventKeys(store.state, year);
  const stale = Date.now() - season.fetchedAt > SEASON_REFRESH_MS;
  const todo = keys.filter((key) => stale || !season.matches.has(key));
  if (!todo.length) return;
  season.loading = true;
  render();
  const failed = [];
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: SEASON_FETCHES_AT_ONCE }, async () => {
      while (queue.length) {
        const key = queue.shift();
        try {
          season.matches.set(key, await api.tbaEventMatches(key));
        } catch {
          if (!season.matches.has(key)) failed.push(key);
        }
      }
    })
  );
  Object.assign(season, { loading: false, failed, fetchedAt: Date.now() });
  render();
}

// One row per player: their points summed over every event they played this season.
function seasonPlayerRows(state) {
  const byId = new Map();
  for (const [eventKey, cached] of season.matches) {
    const matches = eventKey === runtime.event.key && runtime.event.matches.length ? runtime.event.matches : cached;
    for (const row of playerRows(state, matches, eventKey)) {
      const total = byId.get(row.id) || { id: row.id, name: row.name, teamId: row.teamId, points: 0, events: 0 };
      total.points = round1(total.points + row.points);
      total.events += 1;
      byId.set(row.id, total);
    }
  }
  return [...byId.values()];
}

const goToSignIn = () => document.querySelector(".auth-panel")?.scrollIntoView({ behavior: "smooth" });

function emptyCard(title, text, action) {
  return el("div", { class: "empty-card" }, [el("h3", {}, title), text ? el("p", { class: "muted" }, text) : null, action || null]);
}

function rankCell(row) {
  return el("td", { class: "rank-cell" }, `${row.tied ? "T" : ""}${row.rank}`);
}

function table(head, rows, renderRow) {
  const limited = showAll ? rows : rows.slice(0, MAX_ROWS);
  const node = el("div", { class: "table-wrap" }, [
    el("table", { class: "leaderboard-table" }, [el("thead", {}, el("tr", {}, head.map(([label, cls]) => el("th", { class: cls || "" }, label)))), el("tbody", {}, limited.map(renderRow))])
  ]);
  if (rows.length > limited.length) {
    node.append(
      el("button", { type: "button", class: "secondary-btn show-more", onclick: () => ((showAll = true), render()) }, `Show all ${rows.length}`)
    );
  }
  return node;
}

function playerTable(rows, groups, { showTeam = true } = {}) {
  const seasonView = scope === "season";
  return table(
    seasonView ? [["#", "num"], ["Player"], ["Events", "num"], ["Points", "num"]] : [["#", "num"], ["Player"], ["Points", "num"]],
    rows,
    (row) => {
      const mine = row.id === store.profileId;
      const team = showTeam && row.teamId && groups[row.teamId] ? groups[row.teamId].name : "";
      // At one event, a name opens that player's stats and locked picks.
      const name = seasonView
        ? el("span", { class: "player-name" }, row.name)
        : el("button", { type: "button", class: "player-name player-link", onclick: () => openPlayerCard(row.id), "aria-label": `${row.name} - see their stats and picks` }, row.name);
      return el("tr", { class: mine ? "me" : "" }, [
        rankCell(row),
        el("td", {}, [name, mine ? el("span", { class: "tag tag-pick you" }, "You") : null, team ? el("span", { class: "player-team" }, team) : null]),
        seasonView ? el("td", { class: "num" }, String(row.events)) : null,
        el("td", { class: "num" }, String(row.points))
      ]);
    }
  );
}

const segButtons = (options, current, choose) =>
  options.map(([value, label]) => el("button", { type: "button", class: `seg-btn${current === value ? " active" : ""}`, "aria-pressed": String(current === value), onclick: () => choose(value) }, label));

function render() {
  const host = $("leaderboardContent");
  const filters = $("leaderboardFilters");
  const scopes = $("leaderboardScope");
  const heading = $("leaderboardEvent");
  if (!host || !filters) return;
  const { event } = runtime;

  fill(filters, ...segButtons(MODES, mode, (value) => ((mode = value), (showAll = false), render())));
  if (scopes) {
    scopes.classList.toggle("hidden", !store.user);
    fill(scopes, ...segButtons(SCOPES, scope, (value) => ((scope = value), (showAll = false), render(), value === "season" && loadSeason())));
  }

  if (scope === "season" && store.user) {
    heading.textContent = `${seasonYear()} season standings`;
    renderSeason(host);
    return;
  }
  heading.textContent = event.key ? `Standings for ${event.name}` : "Standings";

  if (!event.key) {
    fill(host, emptyCard("Pick an event to see its standings", "The leaderboard is worked out per event, from the event you choose on the Matches tab.", el("button", { type: "button", class: "load-btn", onclick: () => document.querySelector('[data-tab="matchesTab"]')?.click() }, "Go to Matches")));
    return;
  }
  if (!store.user) {
    fill(host, emptyCard("Sign in to join the leaderboard", "Guests can make picks, but the leaderboard is for signed-in players. Sign in with Google to see how you compare.", el("button", { type: "button", class: "load-btn", onclick: goToSignIn }, "Sign in")));
    return;
  }

  renderStandings(host, rankRows(playerRows(store.state, event.matches, event.key)));
}

function renderSeason(host) {
  const keys = seasonEventKeys(store.state, seasonYear());
  if (!keys.length) {
    fill(host, emptyCard("No picks this season yet", "Season standings add up every event this year that people made picks at."));
    return;
  }
  if (!season.matches.size) {
    fill(host, emptyCard(season.loading ? "Adding up the season..." : "Couldn't load the season", season.loading ? `Loading results from ${keys.length} event${keys.length === 1 ? "" : "s"}.` : "Check your connection and try again.", season.loading ? null : el("button", { type: "button", class: "load-btn", onclick: () => ((season.fetchedAt = 0), loadSeason()) }, "Try again")));
    return;
  }
  renderStandings(host, rankRows(seasonPlayerRows(store.state)), [
    el("p", { class: "muted small" }, [
      `Across ${season.matches.size} event${season.matches.size === 1 ? "" : "s"} with picks this season.`,
      season.loading ? " Updating..." : "",
      season.failed.length ? ` ${season.failed.length} couldn't load right now and aren't counted.` : ""
    ])
  ]);
}

function renderStandings(host, players, preface = []) {
  const groups = store.state.groups || {};
  const myTeamId = store.state.profileTeams?.[store.profileId] || null;
  const where = scope === "season" ? "this season" : "this event";

  if (mode === "players") {
    const me = players.find((p) => p.id === store.profileId);
    fill(host,
      ...preface,
      me
        ? el("p", { class: "muted standings-me" }, ["You're ", el("strong", {}, `${me.tied ? "tied for " : ""}#${me.rank}`), ` of ${players.length} with `, el("strong", {}, `${me.points} pts`)])
        : el("p", { class: "muted standings-me" }, `You haven't made a pick ${where} yet - make one on the Matches tab to join the standings.`),
      players.length ? playerTable(players, groups) : emptyCard("No scores yet", "Make some picks - points appear here as matches finish.")
    );
  } else if (mode === "myteam") {
    if (!myTeamId || !groups[myTeamId]) {
      fill(host, emptyCard("You're not on a team yet", "Join with a team code or create a team to compete with your teammates.", el("button", { type: "button", class: "load-btn", onclick: () => openProfile() }, "Join or create a team")));
      return;
    }
    const mates = rankRows(players.filter((p) => p.teamId === myTeamId).map((p) => ({ ...p })));
    fill(host, ...preface, el("h4", { class: "team-heading" }, groups[myTeamId].name), mates.length ? playerTable(mates, groups, { showTeam: false }) : emptyCard("No scores yet", "Your teammates' points appear here as matches finish."));
  } else {
    const teams = rankRows(teamRowsFrom(players, groups));
    fill(host,
      ...preface,
      teams.length
        ? table(
            [["#", "num"], ["Team"], ["Players", "num"], ["Average", "num"], ["Points", "num"]],
            teams,
            (row) =>
              el("tr", { class: row.id === myTeamId ? "me" : "" }, [
                rankCell(row),
                el("td", {}, [el("span", { class: "player-name" }, row.name), row.id === myTeamId ? el("span", { class: "tag tag-pick you" }, "Your team") : null]),
                el("td", { class: "num" }, String(row.members)),
                el("td", { class: "num" }, String(row.average)),
                el("td", { class: "num" }, String(row.points))
              ])
          )
        : emptyCard("No teams have points yet", "Teams appear here once their members make picks.")
    );
  }
}

export function initLeaderboardView() {
  store.subscribe(render);
  onEventChange(render);
  document.addEventListener("tabchange", (e) => {
    if (e.detail !== "leaderboardTab") return;
    render();
    if (scope === "season") loadSeason();
  });
  render();
}
