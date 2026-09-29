import { store } from "../store.js";
import { runtime, onEventChange } from "../runtime.js";
import { $, el, fill } from "../ui.js";
import { playerRows, rankRows, totalsFor } from "../scoring.js";
import { buildHowToPlay } from "./help.js";

const tile = (label, value, sub, accent = false) =>
  el("div", { class: `score-card${accent ? " accent" : ""}` }, [
    el("span", { class: "score-label" }, label),
    el("span", { class: "score-value" }, String(value)),
    sub ? el("span", { class: "score-sub" }, sub) : null
  ]);

const signedOutRank = () => el("a", { href: "#", class: "score-sub link", onclick: (e) => (e.preventDefault(), document.querySelector(".auth-panel")?.scrollIntoView({ behavior: "smooth" })) }, "Sign in to be ranked");

function render() {
  const host = $("scoreContent");
  if (!host) return;
  const { event } = runtime;
  if (!event.key) {
    fill(host, 
      el("div", { class: "empty-card" }, [
        el("h3", {}, "Pick an event to see your score"),
        el("p", { class: "muted" }, "Scores are worked out per event, from the event you choose on the Matches tab."),
        el("button", { type: "button", class: "load-btn", onclick: () => document.querySelector('[data-tab="matchesTab"]')?.click() }, "Go to Matches")
      ])
    );
    return;
  }

  const totals = totalsFor(store.state, store.profileId, event.matches, event.key);
  const { match } = totals;
  let rankTile = tile("Rank", "-", null);
  if (store.user) {
    const rows = rankRows(playerRows(store.state, event.matches, event.key));
    const me = rows.find((r) => r.id === store.profileId);
    rankTile = me ? tile("Rank", `${me.tied ? "T" : ""}${me.rank}`, `of ${rows.length} players`) : tile("Rank", "-", "make a pick to join");
  } else {
    rankTile = el("div", { class: "score-card" }, [el("span", { class: "score-label" }, "Rank"), el("span", { class: "score-value" }, "-"), signedOutRank()]);
  }

  const breakdown = [
    ["Match picks", totals.matchPoints],
    ["Playoff bracket", totals.bracketPoints],
    totals.adjustment ? ["Adjustments from an admin", totals.adjustment] : null
  ].filter(Boolean);

  fill(host, 
    el("p", { class: "muted score-event" }, ["Your score at ", el("strong", {}, event.name)]),
    el("div", { class: "score-grid" }, [
      tile("Total points", totals.points, null, true),
      rankTile,
      tile("Correct picks", totals.correct, totals.graded ? `of ${totals.graded} finished` : "none finished yet"),
      tile("Accuracy", match.accuracy === null ? "-" : `${match.accuracy}%`, "match winners"),
      tile("Current streak", match.currentStreak, match.currentStreak >= 3 ? "streak bonus active" : "3 in a row starts a bonus"),
      tile("Best streak", match.longestStreak, null)
    ]),
    el("div", { class: "breakdown" }, [
      el("h4", {}, "Where your points came from"),
      ...breakdown.map(([label, value]) => el("div", { class: "breakdown-row" }, [el("span", {}, label), el("strong", {}, String(value))])),
      el("div", { class: "breakdown-row muted" }, [el("span", {}, "Picks made at this event"), el("span", {}, String(match.total))])
    ]),
    el("div", { class: "accuracy-wrap" }, [
      el("div", { class: "accuracy-bar-label" }, "Prediction accuracy"),
      el("div", { class: "accuracy-track", role: "img", "aria-label": `Accuracy ${match.accuracy ?? 0} percent` }, el("div", { class: "accuracy-fill", style: `width:${match.accuracy || 0}%` }))
    ]),
    el("details", { class: "how-to-play" }, [el("summary", {}, "How scoring works"), buildHowToPlay()])
  );
}

export function initScoreView() {
  store.subscribe(render);
  onEventChange(render);
  document.addEventListener("tabchange", (e) => e.detail === "scoreTab" && render());
  render();
}
