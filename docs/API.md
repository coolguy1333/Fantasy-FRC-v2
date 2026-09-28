# API Reference

All routes are mounted under `/api`. Responses are JSON and are never cached
(`Cache-Control: no-store`). Routes marked **Auth** require
`Authorization: Bearer <google-id-token>`; the server re-verifies that token
on every request. An unknown `/api/*` path returns `404 { "error": "not_found" }`.

## `POST /api/auth/verify`

Exchange a Google ID token (from Google Identity Services on the client) for
a verified user profile.

- **Auth:** No (the token itself is the credential, sent in the body)
- **Rate limit:** `auth` limiter
- **Body:** `{ "idToken": "<google id token>" }` (max 16 KB)
- **200:**
  ```json
  {
    "ok": true,
    "user": { "sub": "...", "email": "...", "name": "...", "picture": "..." },
    "isGlobalAdmin": false
  }
  ```
  `user.email` is empty unless Google marks the address verified.
- **401:** invalid/expired token (`error` is `invalid_token`, `detail` says why)

## `GET /api/runtime-config`

Tells the client what's configured server-side, before any auth happens.

- **Auth:** No
- **200:** `{ "appVersion": "2.0.0", "googleClientId": "...", "authConfigured": true, "tbaConfigured": true }`

## `GET /api/health`

Liveness check for monitoring, systemd and the WebManager health probe. Exempt
from the HTTPS requirement so a plain-HTTP probe works.

- **Auth:** No
- **200:** `{ "ok": true }`

## `GET /api/state`

Fetch the shared-state document.

- **Auth:** Yes
- **Rate limit:** `read` limiter
- **200:** `{ "payload": { ...shared state, see docs/ARCHITECTURE.md#data-model... }, "updatedAt": 1234567890 }`

For anyone who isn't a global admin, the admin-only domains (`feedback`,
`globalAdminIds`, `globalAdminEmails`) come back empty.

## `PUT /api/state`

Replace the shared-state document. The server diffs the incoming document
against the current one and rejects the write if any changed key falls
outside what the requester is allowed to touch - see
[`docs/ARCHITECTURE.md#authorization-model`](./ARCHITECTURE.md#authorization-model).

- **Auth:** Yes (and a same-origin `Origin`, if one is sent)
- **Rate limit:** `write` limiter
- **Body:** `{ "payload": { ...full shared state... }, "updatedAt": <the updatedAt you last read> }` (max 8 MB)
- **200:** `{ "ok": true, "updatedAt": 1234567891 }`
- **400:** `missing_updated_at`, `invalid_payload` (`detail` says what), or a bad
  prediction/bracket key (`invalid_prediction_key`, `invalid_bracket_key`,
  `unknown_match`, `unknown_event`, `too_many_events`)
- **401:** token expired/invalid - the client should renew or re-prompt sign-in
- **403:** `{ "error": "forbidden_state_change", "detail": "<domain>:<key>:<reason>" }` -
  the write touched something the caller isn't allowed to change - or
  `{ "error": "prediction_locked", "detail": "<match key>" }` - a prediction or
  bracket pick for a match that has been played or is within 10 minutes of
  starting (checked against live TBA data; global admins are exempt)
- **409:** `{ "error": "stale_state", "updatedAt": <current> }` - someone else saved
  since `updatedAt` was read. Reload the state, re-apply your change, retry.
- **503:** `lock_check_unavailable` - TBA couldn't be reached to verify match
  times; the write is refused rather than guessed. Retry later.

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
- `GET /api/tba/event/:eventKey/alliances` - playoff alliances (for the bracket)

**Rate limit:** `tba` limiter.

## Errors

Error responses are always `{ "error": "<machine-readable code>" }`, sometimes
with a `detail`. Common codes: `authentication_required`, `https_required`,
`payload_too_large`, `bad_request`, `server_error`, plus the ones listed above.
Rate-limited requests get HTTP 429.
