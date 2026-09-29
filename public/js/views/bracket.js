import { store } from "../store.js";
import { el, formatMatchTime, isLocked, matchStartMs, teamNumbers, fill } from "../ui.js";
import { BRACKET_GAMES, BRACKET_POINTS_BY_GAME } from "../constants.js";
import { bracketEntriesForEvent, bracketKey, findGameMatch, isPlayed, matchWinner, scoreBracket } from "../scoring.js";
import { allianceButton, chip, resultLine, scoreGuessField } from "./cards.js";

function setPick(eventKey, gameId, color) {
  store.mutate((state) => {
    const id = store.profileId;
    state.bracketPicksByProfile[id] = state.bracketPicksByProfile[id] || {};
    state.bracketPicksByProfile[id][bracketKey(eventKey, gameId)] = color;
  });
}

function setScoreGuess(eventKey, gameId, guess) {
  store.mutate((state) => {
    const id = store.profileId;
    state.bracketScoreByProfile[id] = state.bracketScoreByProfile[id] || {};
    state.bracketScoreByProfile[id][bracketKey(eventKey, gameId)] = guess;
  });
}

function gameCard(game, ctx) {
  const { eventKey, matches, picks, scores, graded } = ctx;
  const match = findGameMatch(matches, game.id);
  const red = teamNumbers(match?.alliances?.red);
  const blue = teamNumbers(match?.alliances?.blue);
  const decided = match ? isPlayed(match) : false;
  // A game can't be picked until we know who is playing in it, and not once it's close to starting.
  const teamsKnown = red.length > 0 || blue.length > 0;
  const locked = Boolean(match) && !decided && isLocked(match);
  const open = Boolean(match) && teamsKnown && !decided && !locked;
  const winner = match ? matchWinner(match) : null;
  const pick = picks[game.id];
  const result = graded.byGame[game.id];
  const start = match ? matchStartMs(match) : null;

  const status = decided ? chip("Final", "muted") : locked ? chip("Locked", "locked") : open ? chip(start ? `Starts ${formatMatchTime(start)}` : "Open", "open") : chip("Waiting for earlier games", "muted");

  const card = el("div", { class: `bracket-card state-${decided ? "played" : locked ? "locked" : open ? "open" : "tbd"}` });
  card.append(
    el("div", { class: "bracket-card-head" }, [
      el("span", { class: "bracket-game-label" }, game.label),
      el("span", { class: "muted small" }, `+${BRACKET_POINTS_BY_GAME[game.id]} pts`)
    ]),
    el("div", { class: "bracket-status" }, status)
  );

  const buttons = el("div", { class: "alliance-row" });
  for (const color of ["red", "blue"]) {
    buttons.append(
      allianceButton({
        color,
        teams: color === "red" ? red : blue,
        score: decided ? match.alliances[color].score : null,
        picked: pick === color,
        won: decided && winner === color,
        disabled: !open,
        onPick: () => setPick(eventKey, game.id, color)
      })
    );
  }
  card.append(buttons);

  if (open) {
    card.append(
      scoreGuessField({
        value: scores[game.id],
        label: `Winning score guess for ${game.label}`,
        onCommit: (guess) => setScoreGuess(eventKey, game.id, guess)
      })
    );
  } else if (decided && winner !== "tie") {
    const made = Boolean(pick) || typeof scores[game.id] === "number";
    card.append(resultLine({ made, breakdown: result || { correct: false, points: 0, pickPoints: 0, scorePoints: 0, streakBonus: 0 }, scoreGuess: scores[game.id] }));
  } else if (locked && pick) {
    card.append(el("div", { class: "result result-none" }, "Locked in"));
  }
  return card;
}

export function renderBracket(container, { eventKey, matches }) {
  const me = store.profileId;
  const picks = bracketEntriesForEvent(store.state.bracketPicksByProfile[me], eventKey);
  const scores = bracketEntriesForEvent(store.state.bracketScoreByProfile[me], eventKey);
  const graded = scoreBracket(matches, picks, scores);
  const ctx = { eventKey, matches, picks, scores, graded };

  fill(container, 
    el("p", { class: "muted bracket-intro" }, "Pick each playoff game's winner once its alliances are set. Picks lock 10 minutes before a game starts, and later rounds are worth more points.")
  );
  const rounds = [...new Set(BRACKET_GAMES.map((g) => g.round))];
  for (const round of rounds) {
    const games = BRACKET_GAMES.filter((g) => g.round === round);
    container.append(el("section", { class: "bracket-round" }, [el("h4", {}, round), el("div", { class: "bracket-round-cards" }, games.map((g) => gameCard(g, ctx)))]));
  }
}
