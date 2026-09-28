# Architecture

## Overview

Fantasy FRC is a single Node.js process (Express) serving a static frontend
and a small JSON API, backed by one SQLite database holding one shared JSON
document ("shared state"). There's no build step, no ORM, and no separate
frontend framework - the frontend is plain ES modules loaded directly by the
browser.

```
Browser (public/) --fetch--> Express (server/) --better-sqlite3--> fantasyfrc.db
                                    |
                                    +--proxy--> The Blue Alliance API
```

## Why "one shared JSON document" instead of a normal relational schema

The original design goal was a small self-hosted app with almost no admin
burden: one table, one row per "shared-state" document, versioned by an
`updated_at` timestamp. This trades relational integrity for simplicity:

- No migrations to write when a new feature needs a new field - just add a
  key to the JSON shape in `server/state/schema.js`.
- One read (`GET /api/state`) gives the client everything it needs to render
  every tab.
- One write (`PUT /api/state`) replaces the whole document; the server
  diffs old vs. new to figure out what changed and whether the requester was
  allowed to change it (see [Authorization model](#authorization-model)
  below).

The tradeoff: every write ships the *entire* state document, and the server
has to do its own conflict/authorization bookkeeping instead of relying on
row-level SQL permissions. This is fine at "a few hundred players, one
team's homelab" scale; it would not scale to a large multi-tenant SaaS
without redesigning storage.

## Request flow

1. Browser loads `public/index.html`, which loads `public/js/main.js` as an
   ES module.
2. `main.js` calls `GET /api/runtime-config` (no auth) to learn whether
   Google sign-in and TBA are configured.
3. If Google sign-in is configured, `views/auth.js` renders the Google
   Identity Services button. A successful sign-in hands the browser a Google
   ID token, which `store.js` sends as `Authorization: Bearer <token>` on
   every subsequent API call. The server re-verifies that token against
   Google on **every** request (see `server/auth.js`) - there's no
   server-side session store to manage or expire.
4. Signed-in users pull `GET /api/state` once, then every 30s
   (`POLL_INTERVAL_MS` in `constants.js`), unless a local change hasn't been
   confirmed saved yet (`store.dirty` - see
   [Sync and offline-safety](#sync-and-offline-safety)). The Google ID token is
   kept in `sessionStorage` so a refresh restores the session, and renewed
   shortly before it expires (`views/auth.js`).
5. Any UI action that changes shared data (a prediction, a bracket pick, a
   feedback message, a team edit) calls `store.mutate(fn)`, which applies
   `fn` to the in-memory state immediately (so the UI updates instantly),
   then persists it - `PUT /api/state` (with the `updatedAt` it was based on)
   for signed-in users, `localStorage` for guests.
6. TBA match/event data is fetched through `/api/tba/*` proxy routes rather
   than directly from the browser, so the TBA API key never reaches the
   client, and a 15s in-memory cache (`server/tba.js`) keeps a room full of
   players polling the same event from hammering TBA's API.

## Data model

The shared-state document has one flat set of top-level keys ("domains"),
defined in `server/state/schema.js`:

| Domain | Shape | Purpose |
|---|---|---|
| `profiles` | `{ [profileId]: { name, teamNumber } }` | Display name / team number per player |
| `predictionsByProfile` | `{ [profileId]: { [matchKey]: { winner, score, predictedAt } } }` | Match predictions |
| `bracketPicksByProfile` | `{ [profileId]: { ["<eventKey>:<gameId>"]: "red"\|"blue" } }` | Playoff bracket winner picks, per event |
| `bracketScoreByProfile` | `{ [profileId]: { ["<eventKey>:<gameId>"]: number } }` | Playoff bracket score guesses, per event |
| `eventSummaries` | `{ [profileId]: {...} }` | Reserved for per-profile per-event summaries |
| `groups` | `{ [teamId]: { name, createdAt } }` | Team records |
| `profileTeams` | `{ [profileId]: teamId }` | Which team each player belongs to |
| `teamAdmins` | `{ [teamId]: [profileId, ...] }` | Who administers each team |
| `teamInviteCodes` | `{ [teamId]: "ABCDE" }` | 5-character join codes |
| `globalAdminIds` / `globalAdminEmails` | `string[]` | Global admins granted through the app (on top of the `.env` bootstrap list) |
| `pointAdjustments` | `{ [profileId]: number }` | Manual point corrections (admin tool, not yet wired into the leaderboard UI) |
| `adminByEvent` | `{ [eventKey]: {...} }` | Reserved for per-event match lock/unlock overrides |
| `profileSetupDone` | `{ [profileId]: boolean }` | Whether the onboarding modal has been completed |
| `showAllEventsInCatalog` | `boolean` | Admin toggle: show every TBA event, not just the ~10-day window |
| `feedback` | `Array<{ profileId, name, contact, message, at }>` | Append-only feedback inbox (admin-only; written via `POST /api/feedback`) |

`profileId` is the Google account's `sub` claim for signed-in users, or the
literal string `"guest"` for guest mode (guests never sync, so there's only
ever one guest "profile" per browser).

## Authorization model

Every `PUT /api/state` is checked in `server/state/authorize.js`. Because
the write is "replace the whole document," authorization works by **diffing**
the incoming document against the current one and asking, for each domain
key that actually changed, "was this user allowed to change *that* key?"

The rules, roughly in the order they're checked (`checkAuthorization`):

1. **Global admins** (bootstrapped via `GLOBAL_ADMIN_EMAILS`/`GLOBAL_ADMIN_IDS`
   in `.env`, or granted later through `globalAdminEmails`/`globalAdminIds`
   in the state itself) can change anything.
2. **Own-profile domains** (`profiles`, `predictionsByProfile`,
   `eventSummaries`, `bracketPicksByProfile`, `bracketScoreByProfile`,
   `profileSetupDone`) - a user may only change the entry keyed by their own
   `profileId`.
3. **Team creation** - a *new* key across `groups` + `teamAdmins` +
   `teamInviteCodes` is allowed for any signed-in user, but only if they are
   making themselves the team's *sole* admin (`isNewTeamCreation` in
   `authorize.js`). This is what lets "Create Team" work without needing a
   global admin to provision every team by hand. At most one new team may be
   created per write, to keep this narrow.
4. **Existing team records** - once a team exists, only its listed admins
   (`teamAdmins[teamId]`) may change its `groups`/`teamAdmins`/
   `teamInviteCodes` entries.
5. **`profileTeams`** (team membership) - anyone may set their *own* entry
   (this is how "join by code" works client-side - see
   [Known limitations](#known-limitations)). Nobody may set anyone else's,
   except that a team admin may *remove* a member of a team they administer.
6. **`feedback`** is append-only: a write may add exactly one new entry, and
   only if that entry's `profileId` matches the requester; existing entries
   must be byte-for-byte unchanged. In practice non-admins never touch it
   through `PUT /api/state` - see "Admin-only data" below.
7. **Everything else** (`globalAdminIds`, `globalAdminEmails`,
   `pointAdjustments`, `adminByEvent`, `showAllEventsInCatalog`) requires
   global admin.

These rules live in `server/state/authorize.js`; `test/api.test.js` exercises
them end to end, including escalation attempts that must be rejected.

On top of the diff-based rules, `PUT /api/state` also:

- **Rejects stale writes.** The body carries the `updatedAt` it was based on;
  if the stored document has moved on, the answer is `409` and the client
  reloads and re-applies its change (see below). Without this a stale copy is
  either refused forever (non-admins) or silently overwrites other people's
  data (admins).
- **Enforces prediction locks** (`server/state/locks.js`). Every changed
  prediction or bracket pick is checked against live TBA data; picks for a
  match that has been played or is within 10 minutes of starting are refused
  with `403 prediction_locked`. If TBA can't be reached the write is refused
  (`503`) rather than guessed. Global admins are exempt.
- **Hides admin-only data** (`server/state/redact.js`). `feedback`,
  `globalAdminIds` and `globalAdminEmails` are returned empty to non-admins,
  and on write the server restores the real values before diffing, so a
  non-admin's copy is never trusted.
- **Caps text sizes** (`validateState` in `schema.js`).

## Sync and offline-safety

`public/js/store.js` is the client-side state manager. Two things worth
understanding if you're touching it:

- **`dirty` flag**: any local mutation sets `store.dirty = true` until the
  server confirms the write. While dirty, the 30-second poll loop
  (`startPolling`) is a no-op - it will never overwrite `store.state` with
  server data while there's an unconfirmed local change in flight. This
  exists specifically to prevent a failed save (e.g. an expired Google
  token) from silently discarding a player's prediction on the next poll.
- **`pending` mutators and conflicts**: `store.mutate(fn)` also queues `fn`.
  If the server answers `409` (someone else saved first), the store reloads
  the document, re-applies the queued mutators on top of it and retries, so a
  busy room never loses or blocks anyone's save. Mutators must therefore only
  depend on the state they are handed.
- **Rejections**: a 4xx that will never succeed (`403` locked/forbidden, `400`,
  `413`) drops the queued change, reloads the real state and shows an
  explanation (`syncError = "rejected"`) instead of retrying forever.
- **Retry with backoff**: any other failure schedules a retry
  (`_scheduleRetry`), doubling the delay each time up to 60s, and sets
  `store.syncError` to `"session_expired"` (HTTP 401, which also triggers a
  silent token renewal) or `"save_failed"` so the UI (`main.js`'s
  `renderSyncStatus`) can show a banner instead of failing silently.
- **Rendering while typing**: views re-render on a timer and on every sync;
  `makeGuardedRender` (`ui.js`) holds a render back while a text field in the
  view has focus, so typing a score isn't wiped mid-keystroke.

## Known limitations

- **Team join codes aren't validated server-side.** The client looks up a
  team by its code (`teams.js`'s `findTeamByCode`), then writes the
  resulting `teamId` directly to `profileTeams`. The server only checks
  that you're setting your *own* membership, not that you presented a valid
  code - so knowing (or guessing) a `teamId` is functionally equivalent to
  knowing its join code. `teamId`s aren't secret (`team_<timestamp36><4 random chars>`),
  so this is a low-severity gap appropriate for a friendly homelab app, but
  it is not a real access-control boundary. Fixing it properly would mean
  adding a dedicated `/api/teams/join` endpoint that checks the code
  server-side, rather than routing joins through the generic state write.
- **`gameIdForMatch` (bracket scoring)** assumes the standard FRC
  double-elimination bracket's `match_number` ordering within TBA's `sf`/`f`
  comp levels. This holds for the common case but isn't validated against
  every possible event configuration.
- **The leaderboard is per event.** Standings are computed from the matches of
  the event currently selected on the Matches tab; there is no season-long
  total yet.
- **Guest predictions aren't carried over** when a guest signs in.
- **Rate limits are per client IP** as seen through the proxy. If several
  proxies sit in front of the app, only the last hop is trusted
  (`trust proxy` = 1), so everyone behind an outer proxy shares one budget.
- **`pointAdjustments` and `adminByEvent`** are modeled in the shared state
  and the admin authorization rules, but don't yet have UI wired up in
  `views/admin.js` beyond the domains that are actively used
  (Teams/Players/Feedback/Permissions).

## Testing

`npm test` runs the `node:test` suites in `test/`. They start the real server
in a child process with Google token verification and The Blue Alliance
stubbed out (`test/helpers/stub-external.js`), so they need no network or
credentials. If you change `server/state/authorize.js` or `locks.js`, add a
case for it in `test/api.test.js` - including one that should be rejected.
