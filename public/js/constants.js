export const LOCK_WINDOW_MS = 10 * 60 * 1000; // predictions lock 10 min before match start
export const POLL_INTERVAL_MS = 30000;
export const STREAK_THRESHOLD = 3;
export const STREAK_BONUS = 0.5;
export const SCORE_FULL_POINT_MARGIN = 5; // within this many points -> +1
export const SCORE_HALF_POINT_MARGIN = 25; // within this many points -> +0.5
export const GUEST_PROFILE_ID = "guest";

// Playoff bracket game order (2023+ double elimination). `label` is the game's
// number in the official bracket - what people see on the field and on TBA.
export const BRACKET_GAMES = [
  { id: "u1", round: "Upper Round 1", label: "Match 1" },
  { id: "u2", round: "Upper Round 1", label: "Match 2" },
  { id: "u3", round: "Upper Round 1", label: "Match 3" },
  { id: "u4", round: "Upper Round 1", label: "Match 4" },
  { id: "l1", round: "Lower Round 1", label: "Match 5" },
  { id: "l2", round: "Lower Round 1", label: "Match 6" },
  { id: "u5", round: "Upper Round 2", label: "Match 7" },
  { id: "u6", round: "Upper Round 2", label: "Match 8" },
  { id: "l3", round: "Lower Round 2", label: "Match 9" },
  { id: "l4", round: "Lower Round 2", label: "Match 10" },
  { id: "u7", round: "Upper Final", label: "Match 11" },
  { id: "l5", round: "Lower Round 3", label: "Match 12" },
  { id: "l6", round: "Lower Final", label: "Match 13" },
  { id: "f1", round: "Finals", label: "Final 1" },
  { id: "f2", round: "Finals", label: "Final 2" },
  { id: "f3", round: "Finals", label: "Final 3" }
];

export const BRACKET_POINTS_BY_GAME = {
  u1: 1, u2: 1, u3: 1, u4: 1,
  l1: 2, l2: 2, u5: 2, u6: 2,
  l3: 3, l4: 3,
  u7: 4, l5: 4, l6: 4,
  f1: 6, f2: 7, f3: 8
};
