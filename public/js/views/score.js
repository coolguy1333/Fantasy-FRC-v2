import { $ } from "../ui.js";
import { store } from "../store.js";
import { STREAK_THRESHOLD, STREAK_BONUS } from "../constants.js";
import { currentScoreSummary } from "./matches.js";
import { currentBracketSummary } from "./bracket.js";

function set(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function render() {
  if (!$("points")) return;
  const match = currentScoreSummary();
  const bracket = currentBracketSummary();
  const totalPoints = Math.round((match.points + bracket.points) * 10) / 10;

  set("points", totalPoints);
  set("streakBonus", match.currentStreak >= STREAK_THRESHOLD ? `+${STREAK_BONUS} / pick` : "-");
  set("totalPredictions", match.total);
  set("completedMatches", match.graded);
  set("accuracy", match.accuracy === null ? "-" : `${match.accuracy}%`);
  set("currentStreak", match.currentStreak);
  set("longestStreak", match.longestStreak);

  const fill = $("accuracyFill");
  if (fill) fill.style.width = `${match.accuracy || 0}%`;
}

export function initScoreView() {
  store.subscribe(render);
  setInterval(render, 5000);
}
