const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Database = require("better-sqlite3");
const { startServer, token } = require("./helpers/server");

const cookieOf = (setCookie) => setCookie.split(";")[0];

async function withServer(env, fn) {
  const s = await startServer(env);
  try {
    await fn(s);
  } finally {
    await s.stop();
    s.cleanup();
  }
}

async function signIn(s, sub, extra = {}, headers = {}) {
  const res = await s.call("POST", "/api/auth/verify", { body: { idToken: token(sub, extra) }, headers });
  assert.equal(res.status, 200);
  return res;
}

test("signing in sets a long-lived, HttpOnly, SameSite cookie and identifies the user", async () => {
  await withServer({ GLOBAL_ADMIN_EMAILS: "boss@example.com" }, async (s) => {
    const res = await signIn(s, "boss");
    assert.match(res.setCookie, /^ffrc_session=/);
    assert.match(res.setCookie, /HttpOnly/);
    assert.match(res.setCookie, /SameSite=Lax/);
    assert.match(res.setCookie, /Max-Age=2592000/);
    assert.doesNotMatch(res.setCookie, /Secure/); // plain http in dev
    const cookie = cookieOf(res.setCookie);

    const me = await s.call("GET", "/api/auth/session", { cookie });
    assert.equal(me.json.user.sub, "boss");
    assert.equal(me.json.isGlobalAdmin, true);
    assert.equal((await s.call("GET", "/api/state", { cookie })).status, 200);
  });
});

test("no session is a plain 'signed out', not an error", async () => {
  await withServer({}, async (s) => {
    const res = await s.call("GET", "/api/auth/session");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { user: null, isGlobalAdmin: false });
    assert.equal((await s.call("GET", "/api/state", { cookie: "ffrc_session=nonsense" })).status, 401);
    assert.equal((await s.call("GET", "/api/state", { cookie: "ffrc_session=%E0%A4%A" })).status, 401);
  });
});

test("the cookie is Secure behind an HTTPS proxy", async () => {
  await withServer({ TRUST_PROXY: "true" }, async (s) => {
    const res = await signIn(s, "alice", {}, { "x-forwarded-proto": "https" });
    assert.match(res.setCookie, /; Secure/);
  });
});

test("cookie-authenticated writes must prove they are same-origin", async () => {
  await withServer({}, async (s) => {
    const cookie = cookieOf((await signIn(s, "alice")).setCookie);
    const { payload, updatedAt } = (await s.call("GET", "/api/state", { cookie })).json;
    payload.profiles.alice = { name: "Alice" };
    const put = (headers) => s.call("PUT", "/api/state", { cookie, body: { payload, updatedAt }, headers });

    assert.equal((await put({})).status, 403); // no Origin, no Sec-Fetch-Site: can't tell where it came from
    assert.equal((await put({ origin: "https://evil.example" })).status, 403);
    assert.equal((await put({ "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await put({ origin: s.base })).status, 200);
    payload.profiles.alice = { name: "Alice 2" };
    const fresh = (await s.call("GET", "/api/state", { cookie })).json;
    const ok = await s.call("PUT", "/api/state", { cookie, body: { payload, updatedAt: fresh.updatedAt }, headers: { "sec-fetch-site": "same-origin" } });
    assert.equal(ok.status, 200);
    // Logging out via a foreign site must not work either.
    assert.equal((await s.call("POST", "/api/auth/logout", { cookie, headers: { origin: "https://evil.example" } })).status, 403);
  });
});

test("signing out revokes the session for real", async () => {
  await withServer({}, async (s) => {
    const cookie = cookieOf((await signIn(s, "alice")).setCookie);
    const out = await s.call("POST", "/api/auth/logout", { cookie, headers: { origin: s.base } });
    assert.equal(out.status, 200);
    assert.match(out.setCookie, /Max-Age=0/);
    // The old cookie is dead even if someone kept a copy.
    assert.equal((await s.call("GET", "/api/state", { cookie })).status, 401);
    assert.equal((await s.call("GET", "/api/auth/session", { cookie })).json.user, null);
  });
});

test("sessions expire", async () => {
  await withServer({ SESSION_TTL_DAYS: "0.00002" }, async (s) => {
    const cookie = cookieOf((await signIn(s, "alice")).setCookie);
    assert.equal((await s.call("GET", "/api/state", { cookie })).status, 200);
    await new Promise((r) => setTimeout(r, 2200));
    assert.equal((await s.call("GET", "/api/state", { cookie })).status, 401);
  });
});

test("only a hash of the session id is stored, and each user keeps at most 10", async () => {
  await withServer({}, async (s) => {
    const first = cookieOf((await signIn(s, "alice")).setCookie);
    for (let i = 0; i < 11; i += 1) await signIn(s, "alice");
    // The very first one was pushed out by the newer ones.
    assert.equal((await s.call("GET", "/api/state", { cookie: first })).status, 401);
    const db = new Database(path.join(s.dataDir, "fantasyfrc.db"), { readonly: true });
    const rows = db.prepare("SELECT id_hash FROM sessions WHERE sub = 'alice'").all();
    db.close();
    assert.equal(rows.length, 10);
    const rawId = decodeURIComponent(first.split("=")[1]);
    assert.ok(rows.every((r) => r.id_hash !== rawId && /^[0-9a-f]{64}$/.test(r.id_hash)));
  });
});

test("an unverified email over a cookie session never grants admin", async () => {
  await withServer({ GLOBAL_ADMIN_EMAILS: "boss@example.com" }, async (s) => {
    const spoof = await signIn(s, "mallory", { email: "boss@example.com", email_verified: false });
    const me = await s.call("GET", "/api/auth/session", { cookie: cookieOf(spoof.setCookie) });
    assert.equal(me.json.isGlobalAdmin, false);
    assert.equal(me.json.user.email, "");
  });
});

test("polling with the current version costs a few bytes", async () => {
  await withServer({}, async (s) => {
    const alice = token("alice");
    const full = (await s.call("GET", "/api/state", { tok: alice })).json;
    const same = await s.call("GET", `/api/state?since=${full.updatedAt}`, { tok: alice });
    assert.deepEqual(same.json, { unchanged: true, updatedAt: full.updatedAt });
    const stale = await s.call("GET", `/api/state?since=${full.updatedAt - 1}`, { tok: alice });
    assert.ok(stale.json.payload);
  });
});
