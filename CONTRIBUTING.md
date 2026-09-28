# Contributing

This is a small homelab project, so the bar here is "keep it simple and
keep it working," not enterprise process.

## Local setup

```bash
npm install
cp .env.example .env   # fill in TBA_API_KEY / GOOGLE_CLIENT_ID if you have them
npm run dev
```

Serves on `http://127.0.0.1:3000`. No build step - the frontend is plain ES
modules loaded directly by the browser, so editing a file under `public/js`
and reloading is the whole feedback loop.

## Project layout

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for how the pieces fit
together, and [`docs/API.md`](./docs/API.md) for the REST API.

## Before opening a PR

- **Run `npm test`.** If you touched `server/state/authorize.js` or
  `locks.js` - the access-control model - add a case to `test/api.test.js`
  covering your change, including at least one that *should* be rejected.
- **If you touched anything in `public/`**: don't add `onclick=`/`onsubmit=`
  or other inline event-handler attributes to `index.html` - the CSP
  (`server/security.js`) blocks inline script by design. Wire new
  interactivity with `addEventListener` from a `.js` file instead, following
  the pattern in `public/js/main.js`.
- **If you touched `public/js/store.js`**: be careful around the `dirty`
  flag and polling - it exists specifically to stop a failed/expired save
  from being silently overwritten by the next poll. See
  [`docs/ARCHITECTURE.md#sync-and-offline-safety`](./docs/ARCHITECTURE.md#sync-and-offline-safety).
- Run the app locally and click through the flow you changed. The tests cover
  the server only; the frontend is checked by hand (see
  [Testing](./docs/ARCHITECTURE.md#testing) in the architecture doc).
- If a view has text inputs, render through `makeGuardedRender` (`ui.js`) so a
  timer or sync doesn't wipe what someone is typing.

## Reporting bugs / security issues

Since this is typically self-hosted for a single team, just open a GitHub
issue. If you find something that could let one user read or write another
user's data, please still open an issue - there's no dedicated security
contact for a project this size, but it will get looked at.
