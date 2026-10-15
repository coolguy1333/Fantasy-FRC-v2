# API Reference

All routes are mounted under `/api`. Responses are JSON and are never cached
(`Cache-Control: no-store`). An unknown `/api/*` path returns
`404 { "error": "not_found" }`.

## Authentication

The browser signs in once with Google (`POST /api/auth/verify`). The server
answers by setting a session cookie, `ffrc_session`: an opaque random id,
`HttpOnly`, `SameSite=Lax` (and `Secure` behind HTTPS), valid for 30 days and
renewed as long as it's used (`SESSION_TTL_DAYS`). Only a SHA-256 of the id is
stored, each account keeps at most 10 sessions, and signing out revokes it.

Routes marked **Auth** accept either that cookie or, for scripts,
`Authorization: Bearer <google-id-token>` (verified against Google on every
call). Writes made with the cookie must prove they are same-origin: an `Origin`
that matches the site, or `Sec-Fetch-Site: same-origin`. Otherwise `403
cross_origin_request_denied`.

## `POST /api/auth/verify`

Exchange a Google ID token (from Google Identity Services) for a session.

- **Auth:** No (the token is the credential, sent in the body)
- **Rate limit:** `auth` limiter
- **Body:** `{ "idToken": "<google id token>" }` (max 16 KB)
- **200:** `{ "ok": true, "user": { "sub", "email", "name", "picture" }, "isGlobalAdmin": false }`
  plus `Set-Cookie: ffrc_session=...`. `user.email` is empty unless Google
  marks the address verified.
- **401:** invalid/expired token (`error` is `invalid_token`, `detail` says why)

## `GET /api/auth/session`

Who is signed in right now? Used at page load, before anything else.

- **Auth:** No
- **200:** `{ "user": { ... } | null, "isGlobalAdmin": false }` - never a 401, so a
  signed-out visitor sees no console error.

## `POST /api/auth/logout`

Revokes the current session and clears the cookie. **200** `{ "ok": true }`.

## `GET /api/runtime-config`

Tells the client what's configured server-side, before any auth happens.

- **Auth:** No
- **200:** `{ "appVersion": "2.1.0", "googleClientId": "...", "authConfigured": true, "tbaConfigured": true, "announcement": "", "featuredEvent": "", "adminClaimAvailable": false }`
  - `announcement` - site-wide message set by an admin (shown to guests too)
  - `featuredEvent` - event key new visitors start on (empty = they choose)
  - `adminClaimAvailable` - true while the site has no admin in its data, so the
    setup code from the server log still works

## `GET /api/health`

Liveness check for monitoring, systemd and the WebManager health probe. Exempt
from the HTTPS requirement so a plain-HTTP probe works.

- **Auth:** No
- **200:** `{ "ok": true }`

## `GET /api/state`

Fetch the shared-state document.

- **Auth:** Yes
- **Rate limit:** `read` limiter
- **Query:** `since=<updatedAt>` (optional). If that is still the current
  version the answer is just `{ "unchanged": true, "updatedAt": N }`, which is what
  the browser's 30-second poll sends.
- **200:** `{ "payload": { ...shared state, see docs/ARCHITECTURE.md#data-model... }, "updatedAt": 1234567890 }`

For anyone who isn't a global admin, `feedback`, `globalAdminIds` and
`globalAdminEmails` come back empty, and `teamInviteCodes` only holds the codes of
teams they administer or belong to.

## `PUT /api/state`

Replace the shared-state document. The server diffs the incoming document
against the current one and rejects the write if any changed key falls
outside what the requester is allowed to touch - see
[`docs/ARCHITECTURE.md#authorization-model`](./ARCHITECTURE.md#authorization-model).

- **Auth:** Yes
- **Rate limit:** `write` limiter
- **Body:** `{ "payload": { ...full shared state... }, "updatedAt": <the updatedAt you last read> }` (max 8 MB)
- **200:** `{ "ok": true, "updatedAt": 1234567891 }`
- **400:** `missing_updated_at`, `invalid_payload` (`detail` says what, e.g.
  `duplicate_team_code`), or a bad prediction/bracket key (`invalid_prediction_key`,
  `invalid_bracket_key`, `unknown_match`, `unknown_event`, `too_many_events`)
- **401:** signed out (no/expired session) - sign in again
- **403:** `{ "error": "forbidden_state_change", "detail": "<domain>:<key>:<reason>" }` -
  the write touched something the caller isn't allowed to change (joining a team
  by writing it gives `profileTeams:<id>:join_requires_code`) - or
  `{ "error": "prediction_locked", "detail": "<match key>" }` - a prediction or
  bracket pick for a match that has been played or is within 10 minutes of
  starting (checked against live TBA data; global admins are exempt)
- **409:** `{ "error": "stale_state", "updatedAt": <current> }` - someone else saved
  since `updatedAt` was read. Reload the state, re-apply your change, retry.
- **503:** `lock_check_unavailable` - TBA couldn't be reached to verify match
  times; the write is refused rather than guessed. Retry later.

## Teams

A team's invite code is what lets someone join, so it is never sent to people who
aren't on the team, and joining is checked by the server (not by writing the
document).

- `POST /api/teams/preview` - body `{ "code": "K7QM2" }`; **200** `{ "ok", "teamId", "name" }`
  shows which team a code is for (used by invite links), **404** `invalid_code`.
- `POST /api/teams/join` - same body; puts the caller on that team. **200**
  `{ "ok", "teamId", "name", "updatedAt" }`, **404** `invalid_code`.

**Auth:** Yes. **Rate limit:** `code` limiter (20 a minute) so codes can't be guessed.

## Admin

- `POST /api/admin/claim` - body `{ "code": "ABCD-EFGH" }` (case and dashes don't
  matter). Makes the caller a site admin using the setup code printed in the server
  log. Only works while the data has no site admins. **200** `{ "ok", "updatedAt" }`,
  **403** `invalid_code`, **409** `already_claimed`. Rate limit: `code` limiter.
- `GET /api/admin/accounts` - everyone with a session: **200**
  `{ "accounts": [{ "sub", "email", "name", "lastActiveAt" }] }`. Emails aren't in the
  shared document, so this is how the admin console shows them.
- `POST /api/admin/revoke-sessions` - body `{ "sub": "..." }`; signs that person out
  everywhere. **200** `{ "ok", "revoked": <count> }`, **400** `missing_sub`.

**Auth:** Yes; the last two need a global admin (**403** `global_admin_required` otherwise).
Everything else the console edits (players, teams, picks, locks, announcement,
featured event, backup restore) is an ordinary `PUT /api/state` by a global admin.

## `POST /api/feedback`

Append a feedback entry, visible only to global admins.

- **Auth:** Yes
- **Rate limit:** `write` limiter
- **Body:** `{ "name": "", "contact": "", "message": "..." }` - `message` is required
  (max 2000 chars; name 100, contact 200)
- **200:** `{ "ok": true }`
- **429:** `feedback_limit_reached` (50 per account)

## TBA proxy

These proxy The Blue Alliance with the server's API key so it never reaches
the browser. They need **no sign-in** (guests use them too), so they are
rate limited per IP, restrict keys to the shape TBA uses (`^\d{4}[a-z0-9]{1,24}$`),
cache successes for 15 s and failures for 10-60 s, and time out after 10 s.
Errors: `400` for a malformed key, `404 tba_not_found`, `502 tba_upstream_error` /
`tba_unreachable`, `503 tba_not_configured`.

- `GET /api/tba/events/:year/simple` - the season's events
- `GET /api/tba/event/:eventKey/matches` - match list/results
- `GET /api/tba/event/:eventKey/teams/simple` - teams at the event
- `GET /api/tba/event/:eventKey/alliances` - playoff alliances

**Rate limit:** `tba` limiter.

## Errors

Error responses are always `{ "error": "<machine-readable code>" }`, sometimes
with a `detail`. Common codes: `authentication_required`, `https_required`,
`payload_too_large`, `bad_request`, `server_error`, plus the ones listed above.
Rate-limited requests get HTTP 429.
