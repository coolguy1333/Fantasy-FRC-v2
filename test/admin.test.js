const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, token } = require("./helpers/server");

let s;
const boss = token("boss", { email: "First.Last@gmail.com" });
const alice = token("alice");

test.before(async () => {
  // Deliberately messy, like a real settings field: quotes, semicolons, a googlemail alias, a +tag.
  s = await startServer({ GLOBAL_ADMIN_EMAILS: '"firstlast+ffrc@googlemail.com"; someone@example.com' });
});
test.after(async () => {
  await s.stop();
  s.cleanup();
});

const getState = async (tok) => (await s.call("GET", "/api/state", { tok })).json;
async function save(tok, mutate) {
  const { payload, updatedAt } = await getState(tok);
  mutate(payload);
  return s.call("PUT", "/api/state", { tok, body: { payload, updatedAt } });
}

test("admin emails match however the address was written", async () => {
  const res = await s.call("POST", "/api/auth/verify", { body: { idToken: boss } });
  assert.equal(res.json.isGlobalAdmin, true);
  assert.match(s.log(), /Global admins from GLOBAL_ADMIN_EMAILS: f\*\*\*@gmail\.com, s\*\*\*@example\.com/);
  const other = await s.call("POST", "/api/auth/verify", { body: { idToken: alice } });
  assert.equal(other.json.isGlobalAdmin, false);
});

test("admin-only endpoints refuse everyone else", async () => {
  assert.equal((await s.call("GET", "/api/admin/accounts", { tok: alice })).status, 403);
  assert.equal((await s.call("POST", "/api/admin/revoke-sessions", { tok: alice, body: { sub: "boss" } })).status, 403);
  assert.equal((await s.call("GET", "/api/admin/accounts")).status, 401);
});

test("admins can list accounts and sign someone out everywhere", async () => {
  const signedIn = await s.call("POST", "/api/auth/verify", { body: { idToken: token("carl") } });
  const cookie = signedIn.setCookie.split(";")[0];
  const accounts = (await s.call("GET", "/api/admin/accounts", { tok: boss })).json.accounts;
  const carl = accounts.find((a) => a.sub === "carl");
  assert.equal(carl.email, "carl@example.com");
  assert.ok(Math.abs(carl.lastActiveAt - Date.now()) < 60000);
  const revoked = await s.call("POST", "/api/admin/revoke-sessions", { tok: boss, body: { sub: "carl" } });
  assert.equal(revoked.json.revoked, 1);
  assert.equal((await s.call("GET", "/api/state", { cookie })).status, 401);
});

test("an admin can force a match open or locked", async () => {
  const predict = (key) =>
    save(alice, (p) => {
      p.predictionsByProfile.alice = { ...(p.predictionsByProfile.alice || {}), [key]: { winner: "red", predictedAt: Date.now() } };
    });
  // qm2 starts in 5 minutes (inside the lock window); qm4 is hours away; qm1 is already played.
  assert.equal((await predict("2099test_qm2")).status, 403);
  const set = await save(boss, (p) => {
    p.adminByEvent["2099test"] = { locks: { "2099test_qm2": "open", "2099test_qm4": "locked", "2099test_qm1": "open" } };
  });
  assert.equal(set.status, 200);
  assert.equal((await predict("2099test_qm2")).status, 200);
  assert.equal((await predict("2099test_qm4")).status, 403);
  assert.equal((await predict("2099test_qm1")).status, 403); // a played match never reopens
  // ...and only global admins may set overrides.
  const sneaky = await save(alice, (p) => {
    p.adminByEvent["2099test"] = { locks: { "2099test_qm4": "open" } };
  });
  assert.equal(sneaky.status, 403);
});

test("the announcement is admin-only to set and public to read", async () => {
  assert.equal((await save(alice, (p) => { p.announcement = { text: "hi", updatedAt: 1 }; })).status, 403);
  assert.equal((await save(boss, (p) => { p.announcement = { text: "Picks reset at noon", updatedAt: 2 }; })).status, 200);
  assert.equal((await s.call("GET", "/api/runtime-config")).json.announcement, "Picks reset at noon");
  assert.equal((await save(boss, (p) => { p.announcement = { text: "x".repeat(600), updatedAt: 3 }; })).status, 400);
});

test("a tab from before an update (missing new domains) neither wipes them nor gets refused", async () => {
  const old = (p) => { delete p.announcement; delete p.siteSettings; };
  assert.equal((await save(alice, (p) => { old(p); p.profiles.alice = { name: "Alice" }; })).status, 200);
  assert.equal((await save(boss, (p) => { old(p); p.profiles.boss = { name: "Boss" }; })).status, 200);
  assert.equal((await s.call("GET", "/api/runtime-config")).json.announcement, "Picks reset at noon");
});

test("point adjustments are per event and validated", async () => {
  assert.equal((await save(boss, (p) => { p.pointAdjustments.alice = { "2099test": { points: 2.5, reason: "Replayed match" } }; })).status, 200);
  assert.equal((await save(boss, (p) => { p.pointAdjustments.alice = { "2099test": { points: "lots" } }; })).status, 400);
  assert.equal((await save(alice, (p) => { p.pointAdjustments.alice = { "2099test": { points: 99 } }; })).status, 403);
});

test("the featured event is admin-only and public to read", async () => {
  assert.equal((await save(alice, (p) => { p.siteSettings = { featuredEvent: "2099test" }; })).status, 403);
  assert.equal((await save(boss, (p) => { p.siteSettings = { featuredEvent: "2099test" }; })).status, 200);
  assert.equal((await s.call("GET", "/api/runtime-config")).json.featuredEvent, "2099test");
});
