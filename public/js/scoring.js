import {
  STREAK_THRESHOLD,
  STREAK_BONUS,
  SCORE_FULL_POINT_MARGIN,
  SCORE_HALF_POINT_MARGIN,
  BRACKET_POINTS_BY_GAME
} from "./constants.js";

export function matchWinner(match) {
  const red = match?.alliances?.red?.score ?? -1;
  const blue = match?.alliances?.blue?.score ?? -1;
  if (red < 0 || blue < 0) return null; // not yet played
  if (red === blue) return "tie";
  return red > blue ? "red" : "blue";
}

export function scorePredictions(matches, predictionsByMatch = {}) {
  let points = 0;
  let correct = 0;
  let graded = 0;
  let currentStreak = 0;
  let longestStreak = 0;

  const played = matches
    .filter((m) => m.comp_level !== "pm" && matchWinner(m))
    .sort((a, b) => (a.actual_time || a.time || 0) - (b.actual_time || b.time || 0));

  for (const match of played) {
    const prediction = predictionsByMatch[match.key];
    if (!prediction || !prediction.winner) continue;
    graded += 1;
    const winner = matchWinner(match);
    const allianceCorrect = prediction.winner === winner;

    if (allianceCorrect) {
      points += 1;
      correct += 1;
      currentStreak += 1;
      if (currentStreak >= STREAK_THRESHOLD) points += STREAK_BONUS;
    } else {
      currentStreak = 0;
    }
    longestStreak = Math.max(longestStreak, currentStreak);

    if (typeof prediction.score === "number" && winner !== "tie") {
      const actualWinnerScore = winner === "red" ? match.alliances.red.score : match.alliances.blue.score;
      const diff = Math.abs(prediction.score - actualWinnerScore);
      if (diff <= SCORE_FULL_POINT_MARGIN) points += 1;
      else if (diff <= SCORE_HALF_POINT_MARGIN) points += 0.5;
    }
  }

  return {
    points: Math.round(points * 10) / 10,
    correct,
    graded,
    total: Object.keys(predictionsByMatch).length,
    accuracy: graded ? Math.round((correct / graded) * 1000) / 10 : null,
    currentStreak,
    longestStreak
  };
}

// Maps a TBA playoff match to this app's bracket game id (u1..u7, l1..l6, f1..f3),
// following the standard FRC 2023+ double-elimination bracket structure.
export function gameIdForMatch(match) {
  if (!match) return null;
  if (match.comp_level === "sf") {
    const map = { 1: "u1", 2: "u2", 3: "u3", 4: "u4", 5: "l1", 6: "l2", 7: "u5", 8: "u6", 9: "l3", 10: "l4", 11: "u7", 12: "l5", 13: "l6" };
    return map[match.match_number] || null;
  }
  if (match.comp_level === "f") {
    const map = { 1: "f1", 2: "f2", 3: "f3" };
    return map[match.match_number] || null;
  }
  return null;
}

export function scoreBracket(matches, picksByGame = {}, scoresByGame = {}) {
  let points = 0;
  let correctPicks = 0;
  let gradedGames = 0;

  for (const match of matches) {
    const gameId = gameIdForMatch(match);
    if (!gameId) continue;
    const winner = matchWinner(match);
    if (!winner || winner === "tie") continue;
    gradedGames += 1;
    const weight = BRACKET_POINTS_BY_GAME[gameId] || 1;
    const pick = picksByGame[gameId];
    if (pick && pick === winner) {
      points += weight;
      correctPicks += 1;
    }
    const scoreGuess = scoresByGame[gameId];
    if (typeof scoreGuess === "number") {
      const actualWinnerScore = winner === "red" ? match.alliances.red.score : match.alliances.blue.score;
      const diff = Math.abs(scoreGuess - actualWinnerScore);
      if (diff <= SCORE_FULL_POINT_MARGIN) points += 1;
      else if (diff <= SCORE_HALF_POINT_MARGIN) points += 0.5;
    }
  }

  return { points: Math.round(points * 10) / 10, correctPicks, gradedGames };
}
