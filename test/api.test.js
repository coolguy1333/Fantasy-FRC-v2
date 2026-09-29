const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, token } = require("./helpers/server");

let s;
const boss = token("boss");
const alice = token("alice");
const bob = token("bob");

test.before(async () => {
  s = await startServer({ GLOBAL_ADMIN_EMAILS: "boss@example.com" });
});
test.after(async () => {
  await s.stop();
  s.cleanup();
});

const getState = async (tok) => (await s.call("GET", "/api/state", { tok })).json;
const putState = (tok, payload, updatedAt) => s.call("PUT", "/api/state", { tok, body: { payload, updatedAt } });
async function save(tok, mutate) {
  const { payload, updatedAt } = await getState(tok);
  mutate(payload);
  return putState(tok, payload, updatedAt);
}

test("health is public and cheap", async () => {
  const res = await s.call("GET", "/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
});

test("unknown API routes, bad JSON and missing assets are proper errors", async () => {
  assert.equal((await s.call("GET", "/api/nope")).status, 404);
  const bad = await fetch(`${s.base}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(bad.status, 400);
  assert.equal((await fetch(`${s.base}/js/missing.js`)).status, 404);
  const page = await fetch(`${s.base}/some/page`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /html/);
});

test("state endpoints require a valid token", async () => {
  assert.equal((await s.call("GET", "/api/state")).status, 401);
  assert.equal((await s.call("GET", "/api/state", { tok: token("x", { bad: true }) })).status, 401);
});

test("an unverified email never grants admin", async () => {
  const spoof = token("mallory", { email: "boss@example.com", email_verified: false });
  const res = await s.call("POST", "/api/auth/verify", { body: { idToken: spoof } });
  assert.equal(res.json.isGlobalAdmin, false);
  const real = await s.call("POST", "/api/auth/verify", { body: { idToken: boss } });
  assert.equal(real.json.isGlobalAdmin, true);
});

test("stale writes get 409 instead of a permanent 403 or silent overwrite", async () => {
  const bobView = await getState(bob);
  await save(alice, (p) => { p.profiles.alice = { name: "Alice" }; });
  bobView.payload.profiles.bob = { name: "Bob" };
  const stale = await putState(bob, bobView.payload, bobView.updatedAt);
  assert.equal(stale.status, 409);
  const fresh = await save(bob, (p) => { p.profiles.bob = { name: "Bob" }; });
  assert.equal(fresh.status, 200);
  const missing = await s.call("PUT", "/api/state", { tok: bob, body: { payload: (await getState(bob)).payload } });
  assert.equal(missing.status, 400);
});

test("admin-only data is hidden from non-admins and can't be clobbered by them", async () => {
  const fb = await save(boss, (p) => {
    p.feedback.push({ profileId: "boss", name: "Carol", contact: "carol@private.example", message: "hi", at: 1 });
    p.globalAdminEmails.push("second@example.com");
  });
  assert.equal(fb.status, 200);
  const seen = (await getState(alice)).payload;
  assert.deepEqual(seen.feedback, []);
  assert.deepEqual(seen.globalAdminEmails, []);
  // A normal non-admin save (whose copy of those domains is empty) must not erase them.
  assert.equal((await save(alice, (p) => { p.profiles.alice = { name: "Alice 2" }; })).status, 200);
  const adminView = (await getState(boss)).payload;
  assert.equal(adminView.feedback.length, 1);
  assert.deepEqual(adminView.globalAdminEmails, ["second@example.com"]);
  // ...and can't smuggle in an admin grant.
  const grab = await save(alice, (p) => { p.globalAdminEmails = ["alice@example.com"]; });
  assert.equal(grab.status, 200);
  assert.deepEqual((await getState(boss)).payload.globalAdminEmails, ["second@example.com"]);
});

test("feedback goes through its own endpoint, needs sign-in and is capped", async () => {
  assert.equal((await s.call("POST", "/api/feedback", { body: { message: "x" } })).status, 401);
  assert.equal((await s.call("POST", "/api/feedback", { tok: alice, body: { message: "  " } })).status, 400);
  const ok = await s.call("POST", "/api/feedback", { tok: alice, body: { name: "Al", contact: "al@x", message: "m".repeat(5000) } });
  assert.equal(ok.status, 200);
  const stored = (await getState(boss)).payload.feedback.at(-1);
  assert.equal(stored.profileId, "alice");
  assert.equal(stored.message.length, 2000);
  assert.deepEqual((await getState(alice)).payload.feedback, []);
});

test("predictions lock server-side", async () => {
  const predict = (tok, key, value = { winner: "red", predictedAt: 1 }) =>
    save(tok, (p) => {
      const sub = tok === alice ? "alice" : tok === bob ? "bob" : "boss";
      p.predictionsByProfile[sub] = { ...(p.predictionsByProfile[sub] || {}), [key]: value };
    });
  // qm4 starts in 2.5h: open. qm3 in 2h: open. qm2 in 5 min: inside the 10 min window. qm1 already played.
  assert.equal((await predict(alice, "2099test_qm4")).status, 200);
  const played = await predict(alice, "2099test_qm1");
  assert.equal(played.status, 403);
  assert.equal(played.json.error, "prediction_locked");
  assert.equal((await predict(alice, "2099test_qm2")).status, 403);
  assert.equal((await predict(alice, "2099test_qm99")).status, 400);
  assert.equal((await predict(alice, "garbage")).status, 400);
  assert.equal((await predict(alice, "2099nope_qm1")).status, 400);
  // Editing an existing pick on an open match is fine; admins may fix locked ones.
  assert.equal((await predict(alice, "2099test_qm4", { winner: "blue", score: 80, predictedAt: 2 })).status, 200);
  assert.equal((await predict(boss, "2099test_qm1")).status, 200);
});

test("bracket picks are per event and lock with their match", async () => {
  const pick = (key) => save(alice, (p) => { p.bracketPicksByProfile.alice = { ...(p.bracketPicksByProfile.alice || {}), [key]: "red" }; });
  assert.equal((await pick("2099test:u1")).status, 200); // bracket not in TBA yet: allowed
  assert.equal((await pick("u1")).status, 400); // legacy un-scoped key
});

test("playoff bracket picks lock per game using TBA's set numbers", async () => {
  const pick = (game) => save(alice, (p) => { p.bracketPicksByProfile.alice = { ...(p.bracketPicksByProfile.alice || {}), [`2099playoffs:${game}`]: "red" }; });
  // sf2 (u2) has been played, sf7 (u5) starts in 20 minutes, sf13 (l6) isn't scheduled yet.
  const played = await pick("u2");
  assert.equal(played.status, 403);
  assert.equal(played.json.error, "prediction_locked");
  assert.equal((await pick("l2")).status, 403);
  assert.equal((await pick("u5")).status, 200);
  assert.equal((await pick("l6")).status, 200);
});

test("a team admin can remove a member; a stranger can't", async () => {
  await save(alice, (p) => {
    p.groups.t1 = { name: "T1", createdAt: 1 };
    p.teamAdmins.t1 = ["alice"];
    p.teamInviteCodes.t1 = "ABCDE";
    p.profileTeams.alice = "t1";
  });
  await save(bob, (p) => { p.profileTeams.bob = "t1"; });
  const stranger = await save(bob, (p) => { delete p.profileTeams.alice; });
  assert.equal(stranger.status, 403);
  const admin = await save(alice, (p) => { delete p.profileTeams.bob; });
  assert.equal(admin.status, 200);
  assert.equal((await getState(alice)).payload.profileTeams.bob, undefined);
});

test("oversized fields are rejected", async () => {
  const res = await save(alice, (p) => { p.profiles.alice = { name: "x".repeat(500) }; });
  assert.equal(res.status, 400);
});

test("TBA proxy validates keys and passes data through", async () => {
  assert.equal((await s.call("GET", `/api/tba/event/${"a".repeat(80)}/matches`)).status, 400);
  assert.equal((await s.call("GET", "/api/tba/event/not_a_key/matches")).status, 400);
  const ok = await s.call("GET", "/api/tba/event/2099test/matches");
  assert.equal(ok.status, 200);
  assert.equal(ok.json.length, 4);
  assert.equal((await s.call("GET", "/api/tba/event/2099zzzz/matches")).status, 404);
  assert.equal((await s.call("GET", "/api/tba/events/2099/simple")).status, 200);
});
