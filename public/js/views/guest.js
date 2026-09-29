import { store, readGuestPicks, removeGuestPicks } from "../store.js";
import { runtime, onEventChange } from "../runtime.js";
import { confirmDialog, isLocked, teamNumbers, toast } from "../ui.js";
import { findGameMatch, isPlayed } from "../scoring.js";

const isOpen = (match) => Boolean(match) && !isPlayed(match) && !isLocked(match);
const teamsKnown = (match) => teamNumbers(match.alliances?.red).length > 0 || teamNumbers(match.alliances?.blue).length > 0;

// Picks made as a guest at the event on screen that can still be made. Anything already
// locked or played can't be moved (the server enforces the lock), and anything the
// account has already picked is left alone.
function eligiblePicks() {
  const { key: eventKey, matches } = runtime.event;
  const guest = readGuestPicks();
  const me = store.profileId;
  const mine = store.state.predictionsByProfile[me] || {};
  const byKey = new Map(matches.map((m) => [m.key, m]));
  const predictions = Object.entries(guest.predictions).filter(([key, p]) => p?.winner && isOpen(byKey.get(key)) && !mine[key]?.winner);

  const myBracket = store.state.bracketPicksByProfile[me] || {};
  const gameOpen = (key) => {
    const match = key.startsWith(`${eventKey}:`) ? findGameMatch(matches, key.slice(eventKey.length + 1)) : null;
    return isOpen(match) && teamsKnown(match);
  };
  const bracketPicks = Object.entries(guest.bracketPicks).filter(([key, v]) => v && gameOpen(key) && !myBracket[key]);
  const bracketScores = Object.entries(guest.bracketScores).filter(([key, v]) => typeof v === "number" && gameOpen(key) && !(store.state.bracketScoreByProfile[me] || {})[key]);
  return { predictions, bracketPicks, bracketScores };
}

const declinedKey = () => `ffrc_guest_offer_declined_${store.profileId}`;
const wasDeclined = () => {
  try {
    return localStorage.getItem(declinedKey()) === "1";
  } catch {
    return false;
  }
};

async function offer(found, count) {
  const ok = await confirmDialog(`You made ${count} pick${count === 1 ? "" : "s"} at ${runtime.event.name} as a guest. Add ${count === 1 ? "it" : "them"} to your account?`, {
    title: "Bring your guest picks",
    confirmLabel: `Add my pick${count === 1 ? "" : "s"}`
  });
  if (!ok) {
    try {
      localStorage.setItem(declinedKey(), "1"); // asked once; don't nag on every visit
    } catch {
      /* storage unavailable */
    }
    return;
  }
  const me = store.profileId;
  await store.mutate((state) => {
    state.predictionsByProfile[me] = { ...(state.predictionsByProfile[me] || {}), ...Object.fromEntries(found.predictions) };
    state.bracketPicksByProfile[me] = { ...(state.bracketPicksByProfile[me] || {}), ...Object.fromEntries(found.bracketPicks) };
    state.bracketScoreByProfile[me] = { ...(state.bracketScoreByProfile[me] || {}), ...Object.fromEntries(found.bracketScores) };
  });
  removeGuestPicks({ predictions: found.predictions.map(([k]) => k), bracketPicks: found.bracketPicks.map(([k]) => k), bracketScores: found.bracketScores.map(([k]) => k) });
  toast(`Added ${count} pick${count === 1 ? "" : "s"} to your account`);
}

// Offered when we know who they are, they've finished profile setup (so dialogs don't
// stack), and we have the event's matches - and only if there is something to move.
export function initGuestMigration() {
  let state = "idle"; // idle | asking | done
  const attempt = () => {
    if (!store.user) {
      state = "idle";
      return;
    }
    if (state !== "idle" || runtime.event.status !== "ready" || !store.state.profileSetupDone?.[store.profileId] || wasDeclined()) return;
    const found = eligiblePicks();
    const count = found.predictions.length + found.bracketPicks.length;
    if (!count) return;
    state = "asking";
    offer(found, count).finally(() => (state = "done"));
  };
  store.subscribe(attempt);
  onEventChange(attempt);
}
