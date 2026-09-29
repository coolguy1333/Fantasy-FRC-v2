import { api } from "../api.js";
import { store } from "../store.js";
import { el, showModal, toast, copyText, confirmDialog, fill } from "../ui.js";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to misread
const NAME_MAX = 40;

export const myTeamId = () => store.state.profileTeams?.[store.profileId] || null;
export const inviteLinkFor = (code) => `${location.origin}/?team=${encodeURIComponent(code)}`;

// The invite code from an invite link (?team=CODE), remembered until it's been dealt with.
let pendingInvite = new URLSearchParams(location.search).get("team") || "";
export const pendingInviteCode = () => pendingInvite;
export function clearInvite() {
  pendingInvite = "";
  if (new URLSearchParams(location.search).has("team")) history.replaceState(null, "", location.pathname + location.hash);
}

function genCode(existingCodes) {
  const taken = new Set(Object.values(existingCodes || {}).map((c) => String(c).toUpperCase()));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    let code = "";
    for (let i = 0; i < 5; i += 1) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!taken.has(code)) return code;
  }
  throw new Error("could_not_generate_unique_code");
}

export async function createTeam(name) {
  const teamId = `team_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const code = genCode(store.state.teamInviteCodes);
  const result = await store.mutate((state) => {
    state.groups[teamId] = { name, createdAt: Date.now() };
    state.teamInviteCodes[teamId] = code;
    state.teamAdmins[teamId] = [store.profileId];
    state.profileTeams[store.profileId] = teamId;
  });
  return { ok: result.ok, teamId, code };
}

// The server checks the code, so a team can't be joined by guessing its id.
export async function joinTeamByCode(code) {
  try {
    const team = await api.joinTeam(String(code).trim());
    await store.reload();
    return { ok: true, teamId: team.teamId, name: team.name };
  } catch (err) {
    return { ok: false, error: err.status === 404 ? "invalid_code" : err.status === 429 ? "slow_down" : "failed" };
  }
}

const JOIN_ERRORS = {
  invalid_code: "That code wasn't found. Check it with your team admin.",
  slow_down: "Too many tries - wait a minute and try again.",
  failed: "Couldn't join right now. Please try again."
};

export function leaveTeam() {
  return store.mutate((state) => {
    delete state.profileTeams[store.profileId];
  });
}

function saveProfile({ name, teamNumber }) {
  return store.mutate((state) => {
    state.profiles[store.profileId] = { ...(state.profiles[store.profileId] || {}), name, teamNumber };
    state.profileSetupDone[store.profileId] = true;
  });
}

function skipSetup() {
  return store.mutate((state) => {
    const existing = state.profiles[store.profileId] || {};
    state.profiles[store.profileId] = { ...existing, name: existing.name || store.user?.name || "Player" };
    state.profileSetupDone[store.profileId] = true;
  });
}

function field(label, hint, input) {
  return el("label", { class: "field" }, [el("span", { class: "field-label" }, label), input, hint ? el("span", { class: "field-hint" }, hint) : null]);
}

function inviteRow(code) {
  const link = inviteLinkFor(code);
  const input = el("input", { class: "field-input", readonly: true, value: link, "aria-label": "Invite link", onfocus: (e) => e.target.select() });
  return el("div", { class: "invite-row" }, [
    input,
    el("button", { type: "button", class: "secondary-btn", onclick: async () => toast((await copyText(link)) ? "Invite link copied" : "Couldn't copy - select the link and copy it", "success") }, "Copy link")
  ]);
}

function teamSection({ draft, redraw }) {
  const teamId = myTeamId();
  const team = teamId ? store.state.groups?.[teamId] : null;

  if (team) {
    const admins = store.state.teamAdmins?.[teamId] || [];
    const isAdmin = admins.includes(store.profileId);
    const code = store.state.teamInviteCodes?.[teamId];
    return el("div", { class: "team-card" }, [
      el("h4", {}, "Your team"),
      el("div", { class: "team-name" }, [team.name, isAdmin ? el("span", { class: "tag tag-pick" }, "Admin") : null]),
      code ? el("p", { class: "muted small" }, `Share this link with teammates - code ${code}`) : null,
      code ? inviteRow(code) : null,
      el(
        "button",
        {
          type: "button",
          class: "secondary-btn",
          onclick: async () => {
            const alone = isAdmin && admins.length === 1;
            const ok = await confirmDialog(alone ? `Leave ${team.name}? You're its only admin, so it will be left without one.` : `Leave ${team.name}?`, { title: "Leave team", confirmLabel: "Leave team", danger: true });
            if (ok) {
              await leaveTeam();
              toast("You left the team", "success");
              redraw();
            }
          }
        },
        "Leave team"
      )
    ]);
  }

  const joinError = el("p", { class: "field-error hidden", role: "alert" });
  const codeInput = el("input", {
    class: "field-input code-input",
    maxlength: "5",
    autocapitalize: "characters",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: "5-character code",
    "aria-label": "Team code",
    value: draft.code,
    oninput: (e) => (draft.code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
  });
  const createError = el("p", { class: "field-error hidden", role: "alert" });
  const nameInput = el("input", { class: "field-input", maxlength: String(NAME_MAX), placeholder: "Team name", "aria-label": "New team name", value: draft.newTeam, oninput: (e) => (draft.newTeam = e.target.value) });
  const show = (node, text) => {
    node.textContent = text;
    node.classList.toggle("hidden", !text);
  };

  return el("div", { class: "team-card" }, [
    el("h4", {}, "Join a team"),
    el("p", { class: "muted small" }, "Enter the code your team admin gave you, or open their invite link."),
    el("div", { class: "inline-form" }, [
      codeInput,
      el(
        "button",
        {
          type: "button",
          class: "load-btn",
          onclick: async (e) => {
            if (draft.code.length !== 5) return show(joinError, "Team codes are 5 characters.");
            e.target.disabled = true;
            const result = await joinTeamByCode(draft.code);
            e.target.disabled = false;
            if (!result.ok) return show(joinError, JOIN_ERRORS[result.error]);
            draft.code = "";
            toast(`Joined ${result.name}`);
            redraw();
          }
        },
        "Join"
      )
    ]),
    joinError,
    el("h4", { class: "or-heading" }, "Or create a team"),
    el("div", { class: "inline-form" }, [
      nameInput,
      el(
        "button",
        {
          type: "button",
          class: "secondary-btn",
          onclick: async (e) => {
            const name = draft.newTeam.trim();
            if (!name) return show(createError, "Give your team a name.");
            e.target.disabled = true;
            const result = await createTeam(name).catch(() => ({ ok: false }));
            e.target.disabled = false;
            if (!result.ok) return show(createError, "Couldn't create the team. Please try again.");
            draft.newTeam = "";
            toast("Team created - share the invite link with your teammates");
            redraw();
          }
        },
        "Create team"
      )
    ]),
    createError
  ]);
}

export function openProfile({ firstRun = false, prefillCode = "" } = {}) {
  if (!store.user) return;
  const existing = store.state.profiles?.[store.profileId] || {};
  const draft = { name: existing.name || store.user.name || "", number: existing.teamNumber || "", code: prefillCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5), newTeam: "" };
  let saved = false;

  showModal({
    title: firstRun ? "Welcome! Set up your profile" : "Your profile",
    // Closing the welcome dialog counts as "skip", so it doesn't come back every visit.
    onClose: () => firstRun && !saved && skipSetup(),
    render: (body, close) => {
      const draw = () => {
        const error = el("p", { class: "field-error hidden", role: "alert" });
        const nameInput = el("input", { class: "field-input", maxlength: String(NAME_MAX), value: draft.name, autocomplete: "nickname", oninput: (e) => (draft.name = e.target.value) });
        const numberInput = el("input", { class: "field-input", maxlength: "5", inputmode: "numeric", value: draft.number, placeholder: "e.g. 254", oninput: (e) => (draft.number = e.target.value.replace(/\D/g, "")) });
        fill(body, 
          firstRun ? el("p", { class: "muted" }, "Choose the name others see on the leaderboard. You can change any of this later from the menu in the top right.") : null,
          field("Display name", "Shown on the leaderboard.", nameInput),
          field("FRC team number (optional)", null, numberInput),
          teamSection({ draft, redraw: draw }),
          error,
          el("div", { class: "modal-actions" }, [
            el(
              "button",
              {
                type: "button",
                class: "load-btn",
                onclick: async () => {
                  const name = draft.name.trim();
                  if (!name) {
                    error.textContent = "Please enter a display name.";
                    error.classList.remove("hidden");
                    nameInput.focus();
                    return;
                  }
                  saved = true;
                  await saveProfile({ name, teamNumber: draft.number });
                  close();
                  toast("Profile saved");
                }
              },
              "Save"
            ),
            el("button", { type: "button", class: "secondary-btn", onclick: close }, firstRun ? "Skip for now" : "Cancel")
          ])
        );
      };
      draw();
    }
  });
}

export function maybeShowOnboarding() {
  if (!store.user || store.state.profileSetupDone?.[store.profileId]) return;
  const code = pendingInvite;
  if (code) clearInvite();
  openProfile({ firstRun: true, prefillCode: code });
}

// An invite link for someone who has already set up: confirm, then join.
export async function handleInviteLink() {
  const code = pendingInvite;
  if (!code || !store.user || !store.state.profileSetupDone?.[store.profileId]) return;
  clearInvite();
  let team;
  try {
    team = await api.previewTeam(code);
  } catch {
    toast("That invite link isn't valid any more", "error");
    return;
  }
  if (myTeamId() === team.teamId) return toast(`You're already on ${team.name}`, "success");
  const ok = await confirmDialog(`You've been invited to join ${team.name}.`, { title: "Join team", confirmLabel: "Join team" });
  if (!ok) return;
  const result = await joinTeamByCode(code);
  toast(result.ok ? `Joined ${team.name}` : JOIN_ERRORS[result.error], result.ok ? "success" : "error");
}
