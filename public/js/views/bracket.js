import { store } from "../store.js";
import { $, el, isLocked, makeGuardedRender } from "../ui.js";
import { BRACKET_GAMES, BRACKET_POINTS_BY_GAME } from "../constants.js";
import { currentEventMatches, currentEventKey } from "./matches.js";
import { bracketEntriesForEvent, bracketKey, gameIdForMatch, matchWinner, scoreBracket } from "../scoring.js";

// Picks and score guesses are stored per event ("<eventKey>:<gameId>").
function picksFor(profileId) {
  return bracketEntriesForEvent(store.state.bracketPicksByProfile[profileId], currentEventKey());
}

function scoresFor(profileId) {
  return bracketEntriesForEvent(store.state.bracketScoreByProfile[profileId], currentEventKey());
}

// Same lock rule as match predictions (the server enforces it too).
function isBracketLocked(gameId) {
  const match = currentEventMatches().find((m) => gameIdForMatch(m) === gameId);
  return Boolean(match) && isLocked(match);
}

function setPick(gameId, winner) {
  const eventKey = currentEventKey();
  if (!eventKey || isBracketLocked(gameId)) return;
  store.mutate((state) => {
    const id = store.profileId;
    state.bracketPicksByProfile[id] = state.bracketPicksByProfile[id] || {};
    state.bracketPicksByProfile[id][bracketKey(eventKey, gameId)] = winner;
  });
}

function setScoreGuess(gameId, value) {
  const eventKey = currentEventKey();
  if (!eventKey || isBracketLocked(gameId)) return;
  const guess = value === "" ? null : Math.min(999, Math.max(0, Math.round(Number(value))));
  if (guess === (scoresFor(store.profileId)[gameId] ?? null)) return;
  store.mutate((state) => {
    const id = store.profileId;
    state.bracketScoreByProfile[id] = state.bracketScoreByProfile[id] || {};
    state.bracketScoreByProfile[id][bracketKey(eventKey, gameId)] = guess;
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
      min: "0",
      max: "999",
      inputmode: "numeric",
      "aria-label": `Guess the winning score for game ${game.id.toUpperCase()}`,
      class: "score-guess-input",
      placeholder: "Winner score guess",
      value: scoreGuess ?? "",
      disabled: locked || winner ? "disabled" : null,
      onchange: (e) => setScoreGuess(game.id, e.target.value)
    })
  );

  return card;
}

function renderNow() {
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

const render = makeGuardedRender(() => [$("playoffBracket")], renderNow);

export function currentBracketSummary() {
  return scoreBracket(currentEventMatches(), picksFor(store.profileId), scoresFor(store.profileId));
}

export function initBracketView() {
  store.subscribe(render);
  setInterval(render, 30000);
}
