import { store } from "../store.js";
import { runtime } from "../runtime.js";
import { el, fill, confirmDialog, showModal, isLocked, lockOverride, matchLabel, matchStartMs, formatMatchTime } from "../ui.js";
import { bracketKey, gameIdForMatch, isPlayed, matchWinner } from "../scoring.js";
import { allPlayerIds, button, card, change, nameOf, row } from "./admin-common.js";

function setOverride(eventKey, matchKey, value) {
  return (state) => {
    const current = state.adminByEvent[eventKey] || {};
    const locks = { ...(current.locks || {}) };
    if (value) locks[matchKey] = value;
    else delete locks[matchKey];
    state.adminByEvent[eventKey] = { ...current, locks };
  };
}

function statusText(match) {
  if (isPlayed(match)) {
    const w = matchWinner(match);
    return `Final · ${match.alliances.red.score}-${match.alliances.blue.score}${w === "tie" ? " tie" : ` ${w === "red" ? "Red" : "Blue"} won`}`;
  }
  return isLocked(match) ? "Locked" : "Open";
}

// Every player's pick for one match, editable. Admins aren't bound by locks, so
// this is also how a pick lost to a bad schedule gets fixed.
function openMatchPicks(match) {
  const eventKey = runtime.event.key;
  const gameId = gameIdForMatch(match);
  const players = allPlayerIds();
  showModal({
    title: `${matchLabel(match)} - picks`,
    render: (body, close) => {
      const rows = players.map((sub) => {
        const p = store.state.predictionsByProfile?.[sub]?.[match.key] || {};
        const winner = el("select", { class: "field-input", "aria-label": `${nameOf(sub)}'s pick` }, [
          el("option", { value: "" }, "No pick"),
          el("option", { value: "red", selected: p.winner === "red" }, "Red"),
          el("option", { value: "blue", selected: p.winner === "blue" }, "Blue")
        ]);
        const score = el("input", { class: "field-input", type: "number", min: "0", max: "999", value: p.score ?? "", placeholder: "score", "aria-label": `${nameOf(sub)}'s score guess` });
        const bracket = gameId
          ? el("select", { class: "field-input", "aria-label": `${nameOf(sub)}'s bracket pick` }, [
              el("option", { value: "" }, "No bracket pick"),
              ...["red", "blue"].map((c) => el("option", { value: c, selected: store.state.bracketPicksByProfile?.[sub]?.[bracketKey(eventKey, gameId)] === c }, `Bracket: ${c === "red" ? "Red" : "Blue"}`))
            ])
          : null;
        return { sub, winner, score, bracket, node: el("div", { class: "pick-edit-row" }, [el("strong", { class: "pick-edit-name" }, nameOf(sub)), winner, score, bracket]) };
      });

      const save = () => {
        const edits = rows.map((r) => ({ sub: r.sub, winner: r.winner.value, score: r.score.value === "" ? null : Math.max(0, Math.min(999, Math.round(Number(r.score.value)))), bracket: r.bracket?.value ?? null }));
        change((state) => {
          for (const e of edits) {
            const mine = { ...(state.predictionsByProfile[e.sub] || {}) };
            const before = mine[match.key];
            if (!e.winner && e.score === null) delete mine[match.key];
            else if (!before || before.winner !== (e.winner || undefined) || before.score !== e.score) {
              mine[match.key] = { ...(before || {}), winner: e.winner || undefined, score: e.score, predictedAt: before?.predictedAt || Date.now(), editedByAdmin: true };
            }
            if (Object.keys(mine).length) state.predictionsByProfile[e.sub] = mine;
            else delete state.predictionsByProfile[e.sub];
            if (gameId) {
              const picks = { ...(state.bracketPicksByProfile[e.sub] || {}) };
              if (e.bracket) picks[bracketKey(eventKey, gameId)] = e.bracket;
              else delete picks[bracketKey(eventKey, gameId)];
              if (Object.keys(picks).length) state.bracketPicksByProfile[e.sub] = picks;
              else delete state.bracketPicksByProfile[e.sub];
            }
          }
        }, "Picks saved");
        close();
      };

      const clearAll = async () => {
        if (!(await confirmDialog(`Clear every pick for ${matchLabel(match)}? Use this after a match is replayed or voided.`, { title: "Clear picks", confirmLabel: "Clear picks", danger: true }))) return;
        change((state) => {
          for (const sub of Object.keys(state.predictionsByProfile)) delete state.predictionsByProfile[sub]?.[match.key];
          if (gameId) for (const sub of Object.keys(state.bracketPicksByProfile)) delete state.bracketPicksByProfile[sub]?.[bracketKey(eventKey, gameId)];
        }, "Picks cleared");
        close();
      };

      fill(
        body,
        el("p", { class: "muted small" }, [statusText(match), ". Changes here aren't limited by the lock."]),
        rows.length ? el("div", { class: "pick-edit-list" }, rows.map((r) => r.node)) : el("p", { class: "muted" }, "No players yet."),
        el("div", { class: "modal-actions" }, [button("Save", save, "load-btn"), button("Cancel", close), button("Clear all picks", clearAll, "danger-btn")])
      );
    }
  });
}

export function picksSection() {
  const { event } = runtime;
  if (!event.key) {
    return [card("Picks", el("p", { class: "muted" }, "Choose an event on the Matches tab first; this section works on that event."), button("Go to Matches", () => document.querySelector('[data-tab="matchesTab"]')?.click(), "load-btn"))];
  }
  if (!event.matches.length) return [card(`Picks at ${event.name}`, el("p", { class: "muted" }, "This event has no matches yet."))];

  const players = allPlayerIds();
  const matches = [...event.matches].sort((a, b) => (matchStartMs(a) ?? Infinity) - (matchStartMs(b) ?? Infinity));
  const rows = matches.map((match) => {
    let red = 0;
    let blue = 0;
    for (const sub of players) {
      const w = store.state.predictionsByProfile?.[sub]?.[match.key]?.winner;
      if (w === "red") red += 1;
      if (w === "blue") blue += 1;
    }
    const played = isPlayed(match);
    const override = lockOverride(match) || "";
    const lockSelect = el(
      "select",
      {
        class: "field-input lock-select",
        disabled: played,
        "aria-label": `Lock for ${matchLabel(match)}`,
        onchange: (e) => change(setOverride(event.key, match.key, e.target.value), e.target.value ? `${matchLabel(match)} ${e.target.value === "open" ? "kept open" : "locked"}` : `${matchLabel(match)} back to automatic`)
      },
      [
        el("option", { value: "", selected: !override }, "Lock: automatic"),
        el("option", { value: "open", selected: override === "open" }, "Keep open"),
        el("option", { value: "locked", selected: override === "locked" }, "Lock now")
      ]
    );
    const start = matchStartMs(match);
    return row(
      el("div", { class: "grow" }, [
        el("strong", {}, matchLabel(match)),
        el("div", { class: "muted small" }, [start ? `${formatMatchTime(start)} · ` : "", statusText(match), ` · picks: ${red} Red, ${blue} Blue`])
      ]),
      played ? el("span", { class: "chip chip-muted" }, "Final") : lockSelect,
      button("Picks", () => openMatchPicks(match))
    );
  });

  return [
    card(
      `Picks at ${event.name}`,
      el("p", { class: "muted small" }, "\"Keep open\" lets people keep picking a match that is running late; \"Lock now\" closes one early. Finished matches are always locked. Use Picks to fix or clear anyone's pick."),
      ...rows
    )
  ];
}
