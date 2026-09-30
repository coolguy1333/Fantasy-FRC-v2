import { el } from "../ui.js";
import { BRACKET_GAMES, BRACKET_POINTS_BY_GAME, LOCK_WINDOW_MS, SCORE_FULL_POINT_MARGIN, SCORE_HALF_POINT_MARGIN, STREAK_BONUS, STREAK_THRESHOLD } from "../constants.js";

const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

// Written from the same constants the scoring uses, so it can't drift from the real rules.
export function buildHowToPlay() {
  const byPoints = new Map();
  for (const game of BRACKET_GAMES) {
    const pts = BRACKET_POINTS_BY_GAME[game.id];
    byPoints.set(pts, [...(byPoints.get(pts) || []), game.id.toUpperCase()]);
  }
  const lockMinutes = LOCK_WINDOW_MS / 60000;
  return el("div", { class: "how-to-play-body" }, [
    el("ol", {}, [
      el("li", {}, [el("strong", {}, "Pick the winner"), " of each match (Red or Blue) for +1 point."]),
      el("li", {}, [
        el("strong", {}, "Guess the winning score"),
        ` if you like: +1 within ${SCORE_FULL_POINT_MARGIN} points, +0.5 within ${SCORE_HALF_POINT_MARGIN}.`
      ]),
      el("li", {}, [
        el("strong", {}, "Build a streak."),
        ` From your ${ordinal(STREAK_THRESHOLD)} correct pick in a row, every correct pick in the streak earns +${STREAK_BONUS} extra.`
      ]),
      el("li", {}, [el("strong", {}, `Picks lock ${lockMinutes} minutes before a match starts`), " - after that they can't be changed."]),
      el("li", {}, [el("strong", {}, "Playoffs:"), " once the bracket is set, pick each game's winner. Later games are worth more."])
    ]),
    el("p", { class: "muted small" }, [
      "Playoff points per correct pick: ",
      [...byPoints.entries()].map(([pts, games]) => `${games.join(", ")} = ${pts}`).join(" · "),
      "."
    ]),
    el("p", { class: "muted small" }, "Playing as a guest keeps your picks on this device only. Sign in with Google to sync them, join a team and appear on the leaderboard.")
  ]);
}
