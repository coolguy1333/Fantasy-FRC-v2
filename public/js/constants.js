export const LOCK_WINDOW_MS = 10 * 60 * 1000; // predictions lock 10 min before match start
export const POLL_INTERVAL_MS = 30000;
export const STREAK_THRESHOLD = 3;
export const STREAK_BONUS = 0.5;
export const SCORE_FULL_POINT_MARGIN = 5; // within this many points -> +1
export const SCORE_HALF_POINT_MARGIN = 25; // within this many points -> +0.5
export const GUEST_PROFILE_ID = "guest";

// Playoff bracket game order + point weight per correctly-picked game.
export const BRACKET_GAMES = [
  { id: "u1", round: "Upper Round 1" },
  { id: "u2", round: "Upper Round 1" },
  { id: "u3", round: "Upper Round 1" },
  { id: "u4", round: "Upper Round 1" },
  { id: "l1", round: "Lower Round 1" },
  { id: "l2", round: "Lower Round 1" },
  { id: "u5", round: "Upper Round 2" },
  { id: "u6", round: "Upper Round 2" },
  { id: "l3", round: "Lower Round 2" },
  { id: "l4", round: "Lower Round 2" },
  { id: "u7", round: "Upper Final" },
  { id: "l5", round: "Lower Round 3" },
  { id: "l6", round: "Lower Final" },
  { id: "f1", round: "Finals" },
  { id: "f2", round: "Finals" },
  { id: "f3", round: "Finals" }
];

export const BRACKET_POINTS_BY_GAME = {
  u1: 1, u2: 1, u3: 1, u4: 1,
  l1: 2, l2: 2, u5: 2, u6: 2,
  l3: 3, l4: 3,
  u7: 4, l5: 4, l6: 4,
  f1: 6, f2: 7, f3: 8
};
