import {
  STREAK_THRESHOLD,
  STREAK_BONUS,
  SCORE_FULL_POINT_MARGIN,
  SCORE_HALF_POINT_MARGIN,
  BRACKET_GAMES,
  BRACKET_POINTS_BY_GAME
} from "./constants.js";

const round1 = (n) => Math.round(n * 10) / 10;

// Bracket picks/score guesses are stored per event as "<eventKey>:<gameId>", so
// picks made at one event can never be scored against another event's bracket.
export const bracketKey = (eventKey, gameId) => `${eventKey}:${gameId}`;

export function bracketEntriesForEvent(entries = {}, eventKey) {
  const out = {};
  if (!eventKey) return out;
  const prefix = `${eventKey}:`;
  for (const [key, value] of Object.entries(entries || {})) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
  }
  return out;
}

export function matchWinner(match) {
  const red = match?.alliances?.red?.score ?? -1;
  const blue = match?.alliances?.blue?.score ?? -1;
  if (red < 0 || blue < 0) return null; // not yet played
  if (red === blue) return "tie";
  return red > blue ? "red" : "blue";
}

export const isPlayed = (match) => matchWinner(match) !== null;

function winnerScore(match, winner) {
  return winner === "red" ? match.alliances.red.score : match.alliances.blue.score;
}

function scoreGuessPoints(guess, actual) {
  const diff = Math.abs(guess - actual);
  if (diff <= SCORE_FULL_POINT_MARGIN) return 1;
  if (diff <= SCORE_HALF_POINT_MARGIN) return 0.5;
  return 0;
}

// byMatch[matchKey] explains what each graded pick earned, so the UI can show
// "Correct, +1.5" on a finished match instead of leaving people to work it out.
export function scorePredictions(matches, predictionsByMatch = {}) {
  let points = 0;
  let correct = 0;
  let graded = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  const byMatch = {};

  const played = matches
    .filter((m) => m.comp_level !== "pm" && matchWinner(m))
    .sort((a, b) => (a.actual_time || a.time || 0) - (b.actual_time || b.time || 0));

  for (const match of played) {
    const prediction = predictionsByMatch[match.key];
    if (!prediction || !prediction.winner) continue;
    graded += 1;
    const winner = matchWinner(match);
    const allianceCorrect = prediction.winner === winner;
    let earned = 0;
    let streakBonus = 0;
    let scorePoints = 0;

    if (allianceCorrect) {
      earned += 1;
      correct += 1;
      currentStreak += 1;
      if (currentStreak >= STREAK_THRESHOLD) streakBonus = STREAK_BONUS;
    } else {
      currentStreak = 0;
    }
    longestStreak = Math.max(longestStreak, currentStreak);

    if (typeof prediction.score === "number" && winner !== "tie") {
      scorePoints = scoreGuessPoints(prediction.score, winnerScore(match, winner));
    }

    const total = earned + streakBonus + scorePoints;
    points += total;
    byMatch[match.key] = { correct: allianceCorrect, points: round1(total), streakBonus, scorePoints };
  }

  const eventKeys = new Set(matches.map((m) => m.key));
  const total = Object.entries(predictionsByMatch).filter(([key, p]) => eventKeys.has(key) && p?.winner).length;

  return {
    points: round1(points),
    correct,
    graded,
    total,
    accuracy: graded ? Math.round((correct / graded) * 1000) / 10 : null,
    currentStreak,
    longestStreak,
    byMatch
  };
}

// TBA numbers the double-elimination bracket (2023+) by *set*: every bracket game
// is comp_level "sf" with set_number 1-13 and match_number 1 (2 would be a
// replay), e.g. key 2023cmptx_sf5m1. Finals are set 1, match_number 1-3.
const SF_GAMES = { 1: "u1", 2: "u2", 3: "u3", 4: "u4", 5: "l1", 6: "l2", 7: "u5", 8: "u6", 9: "l3", 10: "l4", 11: "u7", 12: "l5", 13: "l6" };
const F_GAMES = { 1: "f1", 2: "f2", 3: "f3" };
const DOUBLE_ELIM_FIRST_YEAR = 2023;

export function setNumberOf(match) {
  if (Number.isInteger(match?.set_number)) return match.set_number;
  const m = /_(?:qm|ef|qf|sf|f)(\d+)m\d+$/.exec(match?.key || "");
  return m ? Number(m[1]) : null;
}

export function isDoubleElimEvent(match) {
  const year = Number(String(match?.key || "").slice(0, 4));
  return !year || year >= DOUBLE_ELIM_FIRST_YEAR;
}

// Maps a TBA playoff match to this app's bracket game id (u1..u7, l1..l6, f1..f3).
export function gameIdForMatch(match) {
  if (!match || !isDoubleElimEvent(match)) return null;
  if (match.comp_level === "sf") return SF_GAMES[setNumberOf(match)] || null;
  if (match.comp_level === "f") return F_GAMES[match.match_number] || null;
  return null;
}

// A replayed game reuses its set with a higher match_number; the replay counts.
export function findGameMatch(matches, gameId) {
  let found = null;
  for (const m of matches) {
    if (gameIdForMatch(m) === gameId && (!found || m.match_number > found.match_number)) found = m;
  }
  return found;
}

export const hasPlayoffs = (matches) => matches.some((m) => gameIdForMatch(m) !== null);

export function scoreBracket(matches, picksByGame = {}, scoresByGame = {}) {
  let points = 0;
  let correctPicks = 0;
  let gradedGames = 0;
  const byGame = {};

  for (const { id: gameId } of BRACKET_GAMES) {
    const match = findGameMatch(matches, gameId);
    if (!match) continue;
    const winner = matchWinner(match);
    if (!winner || winner === "tie") continue;
    gradedGames += 1;
    let earned = 0;
    const pick = picksByGame[gameId];
    const correct = Boolean(pick) && pick === winner;
    if (correct) {
      earned += BRACKET_POINTS_BY_GAME[gameId] || 1;
      correctPicks += 1;
    }
    const scoreGuess = scoresByGame[gameId];
    if (typeof scoreGuess === "number") earned += scoreGuessPoints(scoreGuess, winnerScore(match, winner));
    points += earned;
    byGame[gameId] = { correct, picked: Boolean(pick), points: round1(earned) };
  }

  return { points: round1(points), correctPicks, gradedGames, byGame };
}

// Everything the score tab and leaderboard need about one player at one event.
export function totalsFor(state, profileId, matches, eventKey) {
  const match = scorePredictions(matches, state.predictionsByProfile?.[profileId] || {});
  const bracket = scoreBracket(
    matches,
    bracketEntriesForEvent(state.bracketPicksByProfile?.[profileId], eventKey),
    bracketEntriesForEvent(state.bracketScoreByProfile?.[profileId], eventKey)
  );
  const adjustment = Number(state.pointAdjustments?.[profileId] || 0);
  return {
    points: round1(match.points + bracket.points + adjustment),
    matchPoints: match.points,
    bracketPoints: bracket.points,
    adjustment,
    correct: match.correct + bracket.correctPicks,
    graded: match.graded + bracket.gradedGames,
    match,
    bracket
  };
}

// Competition ranking: equal points share a rank (1, 1, 3), highest first, then by name.
export function rankRows(rows) {
  const sorted = [...rows].sort((a, b) => b.points - a.points || String(a.name).localeCompare(String(b.name)));
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || row.points !== sorted[index - 1].points) rank = index + 1;
    const tied = sorted.some((other, i) => i !== index && other.points === row.points);
    return { ...row, rank, tied };
  });
}
