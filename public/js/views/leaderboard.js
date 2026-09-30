import { store } from "../store.js";
import { runtime, onEventChange } from "../runtime.js";
import { $, el, fill } from "../ui.js";
import { playerRows, rankRows, teamRowsFrom } from "../scoring.js";
import { openProfile } from "./profile.js";

const MODES = [
  ["players", "Players"],
  ["myteam", "My team"],
  ["teams", "Teams"]
];
const MAX_ROWS = 100;

let mode = "players";
let showAll = false;

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
  return table(
    [["#", "num"], ["Player"], ["Points", "num"]],
    rows,
    (row) => {
      const mine = row.id === store.profileId;
      const team = showTeam && row.teamId && groups[row.teamId] ? groups[row.teamId].name : "";
      return el("tr", { class: mine ? "me" : "" }, [
        rankCell(row),
        el("td", {}, [el("span", { class: "player-name" }, row.name), mine ? el("span", { class: "tag tag-pick you" }, "You") : null, team ? el("span", { class: "player-team" }, team) : null]),
        el("td", { class: "num" }, String(row.points))
      ]);
    }
  );
}

function render() {
  const host = $("leaderboardContent");
  const filters = $("leaderboardFilters");
  const heading = $("leaderboardEvent");
  if (!host || !filters) return;
  const { event } = runtime;

  fill(filters, 
    ...MODES.map(([value, label]) =>
      el("button", { type: "button", class: `seg-btn${mode === value ? " active" : ""}`, "aria-pressed": String(mode === value), onclick: () => ((mode = value), (showAll = false), render()) }, label)
    )
  );
  heading.textContent = event.key ? `Standings for ${event.name}` : "Standings";

  if (!event.key) {
    fill(host, emptyCard("Pick an event to see its standings", "The leaderboard is worked out per event, from the event you choose on the Matches tab.", el("button", { type: "button", class: "load-btn", onclick: () => document.querySelector('[data-tab="matchesTab"]')?.click() }, "Go to Matches")));
    return;
  }
  if (!store.user) {
    fill(host, emptyCard("Sign in to join the leaderboard", "Guests can make picks, but the leaderboard is for signed-in players. Sign in with Google to see how you compare.", el("button", { type: "button", class: "load-btn", onclick: goToSignIn }, "Sign in")));
    return;
  }

  const groups = store.state.groups || {};
  const players = rankRows(playerRows(store.state, event.matches, event.key));
  const myTeamId = store.state.profileTeams?.[store.profileId] || null;

  if (mode === "players") {
    const me = players.find((p) => p.id === store.profileId);
    fill(host, 
      me ? el("p", { class: "muted standings-me" }, ["You're ", el("strong", {}, `${me.tied ? "tied for " : ""}#${me.rank}`), ` of ${players.length} with `, el("strong", {}, `${me.points} pts`)]) : null,
      players.length ? playerTable(players, groups) : emptyCard("No scores yet", "Make some picks - points appear here as matches finish.")
    );
  } else if (mode === "myteam") {
    if (!myTeamId || !groups[myTeamId]) {
      fill(host, emptyCard("You're not on a team yet", "Join with a team code or create a team to compete with your teammates.", el("button", { type: "button", class: "load-btn", onclick: () => openProfile() }, "Join or create a team")));
      return;
    }
    const mates = rankRows(players.filter((p) => p.teamId === myTeamId).map((p) => ({ ...p })));
    fill(host, el("h4", { class: "team-heading" }, groups[myTeamId].name), mates.length ? playerTable(mates, groups, { showTeam: false }) : emptyCard("No scores yet", "Your teammates' points appear here as matches finish."));
  } else {
    const teams = rankRows(teamRowsFrom(players, groups));
    fill(host, 
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
  document.addEventListener("tabchange", (e) => e.detail === "leaderboardTab" && render());
  render();
}
