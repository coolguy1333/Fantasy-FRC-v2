const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const server = require("../server/state/patch");
const { emptyState } = require("../server/state/schema");
const { startServer, token } = require("./helpers/server");

async function loadClient() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ffrc-client-"));
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}');
  fs.copyFileSync(path.join(__dirname, "..", "public", "js", "patch.js"), path.join(dir, "patch.js"));
  return import(pathToFileURL(path.join(dir, "patch.js")).href);
}

function sample() {
  const a = emptyState();
  a.profiles = { ann: { name: "Ann" }, bo: { name: "Bo" } };
  a.predictionsByProfile = { ann: { "2099x_qm1": { winner: "red" } } };
  a.globalAdminIds = ["ann"];
  const b = structuredClone(a);
  b.profiles.bo.name = "Bob";
  delete b.profiles.ann;
  b.profiles.cy = { name: "Cy" };
  b.predictionsByProfile.ann["2099x_qm2"] = { winner: "blue", score: 80 };
  b.globalAdminIds = ["ann", "bo"];
  b.showAllEventsInCatalog = true;
  b.announcement = { text: "hi", updatedAt: 5 };
  return { a, b };
}

test("a diff applied to the old document gives the new one, on both sides", async () => {
  const client = await loadClient();
  const { a, b } = sample();
  const patch = server.diffState(a, b);
  assert.deepEqual(server.applyPatch(a, patch), b);
  assert.deepEqual(client.diffState(a, b), patch, "browser and server must describe a change the same way");
  assert.deepEqual(client.applyPatch(a, patch), b);
  assert.deepEqual(patch.profiles, { set: { bo: { name: "Bob" }, cy: { name: "Cy" } }, unset: ["ann"] });
  assert.deepEqual(patch.globalAdminIds, { value: ["ann", "bo"] });
  assert.equal(patch.groups, undefined, "unchanged domains aren't sent");
  assert.deepEqual(server.diffState(a, structuredClone(a)), {});
});

test("merged patches have the same effect as applying them in order", async () => {
  const client = await loadClient();
  const { a, b } = sample();
  const c = structuredClone(b);
  c.profiles.ann = { name: "Ann again" };
  delete c.profiles.cy;
  c.globalAdminIds = [];
  const p1 = server.diffState(a, b);
  const p2 = server.diffState(b, c);
  assert.deepEqual(server.applyPatch(a, server.mergePatches([p1, p2])), c);
  assert.deepEqual(client.applyPatch(a, client.mergePatches([p1, p2])), c);
});

test("malformed patches and prototype keys are refused", () => {
  const s = emptyState();
  for (const bad of [null, [], { nope: { set: {} } }, { profiles: { set: [] } }, { profiles: { unset: [1] } }, { profiles: { value: 1, set: {} } }]) {
    assert.throws(() => server.applyPatch(s, bad), /invalid_patch/);
  }
  assert.throws(() => server.applyPatch(s, JSON.parse('{"profiles":{"set":{"__proto__":{"x":1}}}}')), /invalid_patch/);
  assert.equal({}.x, undefined);
});

test.describe("over the API", () => {
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
  const version = async (tok) => (await s.call("GET", "/api/state", { tok })).json.updatedAt;
  const patch = (tok, body) => s.call("PATCH", "/api/state", { tok, body });

  test("a pick is saved by sending just that pick", async () => {
    const v = await version(alice);
    const res = await patch(alice, { updatedAt: v, patch: { predictionsByProfile: { set: { alice: { "2099test_qm3": { winner: "red" } } } }, profiles: { set: { alice: { name: "Alice" } } } } });
    assert.equal(res.status, 200);
    const { payload } = (await s.call("GET", "/api/state", { tok: alice })).json;
    assert.equal(payload.predictionsByProfile.alice["2099test_qm3"].winner, "red");
    assert.equal(payload.profiles.alice.name, "Alice");
  });

  test("the same rules apply as for whole-document writes", async () => {
    const v = await version(alice);
    assert.equal((await patch(alice, { updatedAt: v - 1, patch: { profiles: { set: { alice: { name: "A" } } } } })).status, 409, "stale base");
    assert.equal((await patch(alice, { updatedAt: v, patch: { profiles: { set: { bob: { name: "Hacked" } } } } })).status, 403, "someone else's profile");
    assert.equal((await patch(alice, { updatedAt: v, patch: { predictionsByProfile: { set: { alice: { "2099test_qm1": { winner: "blue" } } } } } })).status, 403, "a played match");
    assert.equal((await patch(alice, { updatedAt: v, patch: { pointAdjustments: { set: { alice: 99 } } } })).status, 403, "admin-only");
    // Admin lists are hidden from non-admins, so their copy is ignored rather than trusted.
    assert.equal((await patch(alice, { updatedAt: v, patch: { globalAdminIds: { value: ["alice"] } } })).status, 200);
    assert.equal((await s.call("GET", "/api/admin/accounts", { tok: alice })).status, 403, "still not an admin");
    const v2 = await version(alice);
    assert.equal((await patch(alice, { updatedAt: v2, patch: { nope: { value: 1 } } })).status, 400);
    assert.equal((await patch(alice, { updatedAt: v2, patch: { profiles: { set: { alice: { name: "x".repeat(500) } } } } })).status, 400);
    const empty = await patch(alice, { updatedAt: v2, patch: {} });
    assert.equal(empty.status, 200);
    assert.equal(empty.json.updatedAt, v2, "an empty patch doesn't make a new version");
    assert.equal(v2, v, "nor does a write that changes nothing");
  });

  test("a non-admin's patch can't touch what they can't see", async () => {
    await s.call("POST", "/api/feedback", { tok: bob, body: { message: "secret contact" } });
    const v = await version(alice);
    // feedback is admin-only: ignored for non-admins, never wiped
    const res = await patch(alice, { updatedAt: v, patch: { feedback: { value: [] }, profiles: { set: { alice: { name: "Alice 2" } } } } });
    assert.equal(res.status, 200);
    const admin = (await s.call("GET", "/api/state", { tok: boss })).json.payload;
    assert.equal(admin.feedback.length, 1);
  });

  test("polls get just what changed, redacted for the caller", async () => {
    const since = await version(alice);
    const v = await version(bob);
    assert.equal((await patch(bob, { updatedAt: v, patch: { profiles: { set: { bob: { name: "Bob" } } } } })).status, 200);
    await s.call("POST", "/api/feedback", { tok: bob, body: { message: "more" } });
    const delta = (await s.call("GET", `/api/state?since=${since}&delta=1&admin=0`, { tok: alice })).json;
    assert.ok(delta.patch, "a patch, not the whole document");
    assert.deepEqual(delta.patch.profiles, { set: { bob: { name: "Bob" } } });
    assert.equal(delta.patch.feedback, undefined, "admin-only data isn't sent to non-admins");
    const adminDelta = (await s.call("GET", `/api/state?since=${since}&delta=1&admin=1`, { tok: boss })).json;
    assert.equal(adminDelta.patch.feedback.value.length, 2);
    // Without delta=1 (a tab from before this existed) the answer is the whole document.
    assert.ok((await s.call("GET", `/api/state?since=${since}`, { tok: alice })).json.payload);
    // A version the server doesn't know, or a role that changed: the whole document.
    assert.ok((await s.call("GET", `/api/state?since=1&delta=1&admin=0`, { tok: alice })).json.payload);
    const promoted = (await s.call("GET", `/api/state?since=${since}&delta=1&admin=0`, { tok: boss })).json;
    assert.ok(promoted.payload);
    assert.equal(promoted.isGlobalAdmin, true);
  });

  test("team code visibility follows team changes in polls", async () => {
    const v = await version(alice);
    const created = await patch(alice, {
      updatedAt: v,
      patch: { groups: { set: { tA: { name: "A team", createdAt: 1 } } }, teamAdmins: { set: { tA: ["alice"] } }, teamInviteCodes: { set: { tA: "AAAAA" } }, profileTeams: { set: { alice: "tA" } } }
    });
    assert.equal(created.status, 200);
    const since = await version(bob);
    assert.equal((await s.call("POST", "/api/teams/join", { tok: bob, body: { code: "AAAAA" } })).status, 200);
    const delta = (await s.call("GET", `/api/state?since=${since}&delta=1&admin=0`, { tok: bob })).json;
    assert.deepEqual(delta.patch.teamInviteCodes, { value: { tA: "AAAAA" } }, "joining makes the code visible");
  });
});
