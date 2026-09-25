import { store } from "../store.js";
import { $, el } from "../ui.js";
import { scorePredictions, scoreBracket } from "../scoring.js";
import { currentEventMatches } from "./matches.js";

let mode = "player"; // player | team | teamvs

function totalPointsFor(profileId) {
  const matches = currentEventMatches();
  const match = scorePredictions(matches, store.state.predictionsByProfile[profileId] || {});
  const bracket = scoreBracket(matches, store.state.bracketPicksByProfile[profileId] || {}, store.state.bracketScoreByProfile[profileId] || {});
  const adjustment = Number(store.state.pointAdjustments?.[profileId] || 0);
  return Math.round((match.points + bracket.points + adjustment) * 10) / 10;
}

function playerRows() {
  const profiles = store.state.profiles || {};
  return Object.keys(profiles)
    .map((id) => ({ id, name: profiles[id]?.name || "Player", points: totalPointsFor(id) }))
    .sort((a, b) => b.points - a.points);
}

function teamRows() {
  const groups = store.state.groups || {};
  const profileTeams = store.state.profileTeams || {};
  const totals = {};
  for (const [profileId, teamId] of Object.entries(profileTeams)) {
    totals[teamId] = (totals[teamId] || 0) + totalPointsFor(profileId);
  }
  return Object.keys(groups)
    .map((id) => ({ id, name: groups[id]?.name || id, points: Math.round((totals[id] || 0) * 10) / 10 }))
    .sort((a, b) => b.points - a.points);
}

function renderFilters() {
  const container = $("leaderboardFilters");
  if (!container) return;
  container.innerHTML = "";
  const options = [
    ["player", "Global Player"],
    ["team", "Local Team"],
    ["teamvs", "Team vs Team"]
  ];
  for (const [value, label] of options) {
    container.append(
      el(
        "button",
        {
          class: `nav-btn small ${mode === value ? "active" : ""}`,
          onclick: () => {
            mode = value;
            render();
          }
        },
        label
      )
    );
  }
}

function renderRows(rows, label) {
  const content = $("leaderboardContent");
  content.innerHTML = "";
  if (!rows.length) {
    content.append(el("p", { class: "muted" }, "No data yet."));
    return;
  }
  const table = el("table", { class: "leaderboard-table" });
  table.append(el("thead", {}, el("tr", {}, [el("th", {}, "#"), el("th", {}, label), el("th", {}, "Points")])));
  const body = el("tbody");
  rows.forEach((row, idx) => {
    body.append(el("tr", {}, [el("td", {}, String(idx + 1)), el("td", {}, row.name), el("td", {}, String(row.points))]));
  });
  table.append(body);
  content.append(table);
}

function render() {
  if (!$("leaderboardContent")) return;
  renderFilters();
  if (mode === "player") renderRows(playerRows(), "Player");
  else renderRows(teamRows(), "Team");
}

export function initLeaderboardView() {
  store.subscribe(render);
  setInterval(render, 15000);
}
