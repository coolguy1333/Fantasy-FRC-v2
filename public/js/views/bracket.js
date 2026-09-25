import { store } from "../store.js";
import { $, el } from "../ui.js";
import { BRACKET_GAMES, BRACKET_POINTS_BY_GAME } from "../constants.js";
import { currentEventMatches } from "./matches.js";
import { gameIdForMatch, matchWinner, scoreBracket } from "../scoring.js";

function picksFor(profileId) {
  return store.state.bracketPicksByProfile[profileId] || {};
}

function scoresFor(profileId) {
  return store.state.bracketScoreByProfile[profileId] || {};
}

function isBracketLocked(gameId) {
  const matches = currentEventMatches();
  const match = matches.find((m) => gameIdForMatch(m) === gameId);
  if (!match || !match.time) return false;
  return Date.now() >= match.time * 1000 - 10 * 60 * 1000;
}

function setPick(gameId, winner) {
  if (isBracketLocked(gameId)) return;
  store.mutate((state) => {
    const id = store.profileId;
    state.bracketPicksByProfile[id] = state.bracketPicksByProfile[id] || {};
    state.bracketPicksByProfile[id][gameId] = winner;
  });
}

function setScoreGuess(gameId, value) {
  if (isBracketLocked(gameId)) return;
  store.mutate((state) => {
    const id = store.profileId;
    state.bracketScoreByProfile[id] = state.bracketScoreByProfile[id] || {};
    state.bracketScoreByProfile[id][gameId] = value === "" ? null : Number(value);
  });
}

function renderGameCard(game) {
  const matches = currentEventMatches();
  const match = matches.find((m) => gameIdForMatch(m) === game.id);
  const winner = match ? matchWinner(match) : null;
  const locked = isBracketLocked(game.id);
  const pick = picksFor(store.profileId)[game.id];
  const scoreGuess = scoresFor(store.profileId)[game.id];

  const card = el("div", { class: `bracket-card ${winner ? "decided" : ""}` });
  card.append(el("div", { class: "bracket-card-head" }, [el("span", {}, game.id.toUpperCase()), el("span", { class: "muted" }, `+${BRACKET_POINTS_BY_GAME[game.id]} pts`)]));

  const btnRow = el("div", { class: "alliance-row" });
  for (const color of ["red", "blue"]) {
    btnRow.append(
      el(
        "button",
        {
          class: `alliance-btn alliance-${color} ${pick === color ? "picked" : ""}`,
          disabled: locked || winner ? "disabled" : null,
          onclick: () => setPick(game.id, color)
        },
        color === "red" ? "Red" : "Blue"
      )
    );
  }
  card.append(btnRow);

  if (winner && winner !== "tie") {
    card.append(el("div", { class: `bracket-result result-${winner}` }, `${winner === "red" ? "Red" : "Blue"} won`));
  } else if (!match) {
    card.append(el("div", { class: "muted small" }, "Not yet in bracket"));
  }

  card.append(
    el("input", {
      type: "number",
      class: "score-guess-input",
      placeholder: "Winner score guess",
      value: scoreGuess ?? "",
      disabled: locked || winner ? "disabled" : null,
      onchange: (e) => setScoreGuess(game.id, e.target.value)
    })
  );

  return card;
}

function render() {
  const container = $("playoffBracket");
  if (!container) return;
  container.innerHTML = "";
  if (!currentEventMatches().length) return;

  container.append(el("h3", {}, "Playoff Bracket Pick'em"));
  const rounds = [...new Set(BRACKET_GAMES.map((g) => g.round))];
  for (const round of rounds) {
    const games = BRACKET_GAMES.filter((g) => g.round === round);
    container.append(el("div", { class: "bracket-round" }, [el("h4", {}, round), el("div", { class: "bracket-round-cards" }, games.map(renderGameCard))]));
  }
}

export function currentBracketSummary() {
  return scoreBracket(currentEventMatches(), picksFor(store.profileId), scoresFor(store.profileId));
}

export function initBracketView() {
  store.subscribe(render);
  setInterval(render, 30000);
}
