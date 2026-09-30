import { el } from "../ui.js";

const cap = (color) => (color === "red" ? "Red" : "Blue");

// One side of a match. The colour is never the only cue: it says Red/Blue, and
// says "Your pick" / "Won" in words.
export function allianceButton({ color, teams, score = null, picked = false, won = false, disabled = false, onPick }) {
  const tags = [];
  if (picked) tags.push(el("span", { class: "tag tag-pick" }, "Your pick"));
  if (won) tags.push(el("span", { class: "tag tag-won" }, "Won"));
  const spoken = `${cap(color)} alliance${teams.length ? `, teams ${teams.join(", ")}` : ", teams to be decided"}${picked ? ", your pick" : ""}${won ? ", winner" : ""}`;
  return el(
    "button",
    {
      type: "button",
      class: `alliance-btn alliance-${color}${picked ? " picked" : ""}${won ? " won" : ""}`,
      disabled,
      "aria-pressed": String(picked),
      "aria-label": spoken,
      onclick: onPick
    },
    [
      el("span", { class: "alliance-top" }, [el("span", { class: "alliance-name" }, cap(color)), ...tags]),
      el("span", { class: "alliance-teams" }, teams.length ? teams.join(" · ") : "TBD"),
      score !== null ? el("span", { class: "alliance-score" }, String(score)) : null
    ]
  );
}

// The optional "guess the winning score" box. Only saves when the value really changed,
// so tabbing past it (or tapping straight onto a button) doesn't trigger a rebuild.
export function scoreGuessField({ value, label, onCommit }) {
  const input = el("input", {
    type: "number",
    min: "0",
    max: "999",
    inputmode: "numeric",
    class: "score-guess-input",
    placeholder: "e.g. 85",
    "aria-label": label,
    value: value ?? "",
    onchange: (e) => {
      const next = e.target.value === "" ? null : Math.min(999, Math.max(0, Math.round(Number(e.target.value))));
      if (next !== (value ?? null)) onCommit(next);
    }
  });
  return el("label", { class: "score-guess" }, [el("span", { class: "score-guess-label" }, "Winning score guess (optional)"), input]);
}

export const chip = (text, kind = "muted") => el("span", { class: `chip chip-${kind}` }, text);

// What a finished match earned, in plain words. `made` = they picked a winner or
// guessed a score.
export function resultLine({ made, breakdown, scoreGuess }) {
  if (!made) return el("div", { class: "result result-none" }, "You didn't pick this one");
  const parts = [];
  if (breakdown.pickPoints) parts.push(`winner +${breakdown.pickPoints}`);
  if (breakdown.scorePoints) parts.push(`score guess +${breakdown.scorePoints}`);
  if (breakdown.streakBonus) parts.push(`streak +${breakdown.streakBonus}`);
  const points = `+${breakdown.points} pt${breakdown.points === 1 ? "" : "s"}`;
  const head = breakdown.correct ? `Correct \u00b7 ${points}` : breakdown.points ? `Missed the winner \u00b7 ${points}` : "Missed \u00b7 0 pts";
  return el("div", { class: `result ${breakdown.correct ? "result-good" : "result-bad"}` }, [
    el("strong", {}, head),
    parts.length ? el("span", { class: "result-detail" }, parts.join(", ")) : null,
    typeof scoreGuess === "number" && !breakdown.scorePoints ? el("span", { class: "result-detail" }, `your score guess: ${scoreGuess}`) : null
  ]);
}
