# API Reference

All routes are mounted under `/api`. Responses are JSON. Routes marked
**Auth** require `Authorization: Bearer <google-id-token>`; the server
re-verifies that token against Google on every request.

## `POST /api/auth/verify`

Exchange a Google ID token (from Google Identity Services on the client) for
a verified user profile.

- **Auth:** No (the token itself is the credential, sent in the body)
- **Rate limit:** `auth` limiter (strict - a handful of attempts per minute)
- **Body:** `{ "idToken": "<google id token>" }`
- **200:**
  ```json
  {
    "user": { "sub": "...", "email": "...", "name": "...", "picture": "..." },
    "isGlobalAdmin": false
  }
  ```
- **401:** invalid/expired token

## `GET /api/runtime-config`

Tells the client what's configured server-side, before any auth happens.

- **Auth:** No
- **200:** `{ "googleSignInEnabled": true, "tbaEnabled": true }`

## `GET /api/health`

Liveness check for monitoring / the systemd unit.

- **Auth:** No
- **200:** `{ "ok": true }`

## `GET /api/state`

Fetch the current shared-state document.

- **Auth:** Yes
- **Rate limit:** `read` limiter
- **200:** `{ "payload": { ...full shared state, see docs/ARCHITECTURE.md#data-model... }, "updatedAt": 1234567890 }`

## `PUT /api/state`

Replace the shared-state document. The server diffs the incoming document
against the current one and rejects the write if any changed key falls
outside what the requester is allowed to touch - see
[`docs/ARCHITECTURE.md#authorization-model`](./ARCHITECTURE.md#authorization-model).

- **Auth:** Yes
- **Rate limit:** `write` limiter
- **Body:** `{ "payload": { ...full shared state... }, "updatedAt": <the updatedAt you last read> }`
- **200:** `{ "updatedAt": 1234567891 }`
- **401:** token expired/invalid - client should re-prompt sign-in
- **403:** `{ "error": "<domain>:<key>:<reason>" }` - the write touched something
  the caller isn't allowed to change (e.g. `profiles:someoneElsesId:not_own_profile`)
- **409:** the document has changed since `updatedAt` was read (stale write) -
  the client should reload state and retry

## `GET /api/tba/events/:year/simple`

Proxy for The Blue Alliance's event list for a season, with a 15s
in-memory cache to keep a room full of players from hammering TBA directly.

- **Auth:** Yes
- **Rate limit:** `tba` limiter
- **Params:** `year` - 4-digit year, validated against `YEAR_RE`

## `GET /api/tba/event/:eventKey/matches`

Proxy for an event's match list/results.

- **Auth:** Yes
- **Rate limit:** `tba` limiter
- **Params:** `eventKey` - validated against `EVENT_KEY_RE`

## `GET /api/tba/event/:eventKey/teams/simple`

Proxy for an event's team list.

- **Auth:** Yes
- **Rate limit:** `tba` limiter
- **Params:** `eventKey` - validated against `EVENT_KEY_RE`

## `GET /api/tba/event/:eventKey/alliances`

Proxy for an event's playoff alliance selections (used to build the bracket).

- **Auth:** Yes
- **Rate limit:** `tba` limiter
- **Params:** `eventKey` - validated against `EVENT_KEY_RE`

## Errors

Error responses are always `{ "error": "<machine-readable code>" }`. Common
codes: `authentication_required`, `https_required`, `rate_limited`, plus the
`<domain>:<key>:<reason>` shape from `PUT /api/state` above.
