import { store } from "../store.js";
import { runtime } from "../runtime.js";
import { el, fill, isLocked, matchLabel, matchStartMs, showModal } from "../ui.js";
import { isMatchPickable, isPlayed, playerRows, rankRows, totalsFor } from "../scoring.js";

const SHOWN = 12;
const cap = (color) => (color === "red" ? "Red" : color === "blue" ? "Blue" : "-");

const tile = (label, value, sub) =>
  el("div", { class: "score-card" }, [el("span", { class: "score-label" }, label), el("span", { class: "score-value" }, String(value)), sub ? el("span", { class: "score-sub" }, sub) : null]);

// Someone's picks on matches that can't be changed any more - never open ones,
// so nobody can copy a rival's picks before a match locks.
function lockedPicks(profileId, matches, scored) {
  const picks = store.state.predictionsByProfile?.[profileId] || {};
  return matches
    .filter((m) => isMatchPickable(m) && picks[m.key]?.winner && (isPlayed(m) || isLocked(m)))
    .sort((a, b) => (matchStartMs(b) ?? 0) - (matchStartMs(a) ?? 0))
    .map((m) => ({ match: m, pick: picks[m.key], result: scored.byMatch[m.key] }));
}

function pickRow({ match, pick, result }) {
  const outcome = !result ? "Locked" : result.correct ? `+${result.points}` : result.points ? `+${result.points}` : "Missed";
  const kind = !result ? "muted" : result.correct ? "good" : "bad";
  return el("div", { class: "pick-row" }, [
    el("span", { class: "pick-row-label" }, matchLabel(match)),
    el("span", { class: `pick-row-pick pick-${pick.winner}` }, [cap(pick.winner), typeof pick.score === "number" ? ` · ${pick.score}` : ""]),
    el("span", { class: `pick-row-result result-text-${kind}` }, outcome)
  ]);
}

export function openPlayerCard(profileId) {
  const { event } = runtime;
  if (!event.key) return;
  const name = store.state.profiles?.[profileId]?.name || "Player";
  const teamId = store.state.profileTeams?.[profileId];
  const team = teamId ? store.state.groups?.[teamId]?.name : "";
  let showAll = false;

  showModal({
    title: name,
    render: (body, close) => {
      const draw = () => {
        const totals = totalsFor(store.state, profileId, event.matches, event.key);
        const rows = rankRows(playerRows(store.state, event.matches, event.key));
        const me = rows.find((r) => r.id === profileId);
        const picks = lockedPicks(profileId, event.matches, totals.match);
        const listed = showAll ? picks : picks.slice(0, SHOWN);
        fill(
          body,
          el("p", { class: "muted small" }, [team ? `${team} · ` : "", `at ${event.name}`]),
          el("div", { class: "score-grid compact" }, [
            tile("Points", totals.points, totals.adjustment ? `incl. ${totals.adjustment > 0 ? "+" : ""}${totals.adjustment} from an admin` : null),
            tile("Rank", me ? `${me.tied ? "T" : ""}${me.rank}` : "-", me ? `of ${rows.length}` : null),
            tile("Correct", totals.correct, totals.graded ? `of ${totals.graded} finished` : null),
            tile("Accuracy", totals.match.accuracy === null ? "-" : `${totals.match.accuracy}%`, null),
            tile("Best streak", totals.match.longestStreak, null),
            tile("Bracket", totals.bracketPoints, "points")
          ]),
          el("h4", { class: "pick-list-heading" }, "Picks on locked and finished matches"),
          picks.length ? el("div", { class: "pick-list" }, listed.map(pickRow)) : el("p", { class: "muted" }, "None yet. Picks on open matches stay private until they lock."),
          picks.length > listed.length ? el("button", { type: "button", class: "secondary-btn show-more", onclick: () => ((showAll = true), draw()) }, `Show all ${picks.length}`) : null,
          el("div", { class: "modal-actions" }, [el("button", { type: "button", class: "load-btn", onclick: close }, "Close")])
        );
      };
      draw();
    }
  });
}
