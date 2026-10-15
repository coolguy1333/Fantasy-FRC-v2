const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer, token } = require("./helpers/server");

// No GLOBAL_ADMIN_EMAILS at all: the owner uses the code printed in the server log.
test("the setup code from the log makes the owner an admin, once", async () => {
  const s = await startServer({ GLOBAL_ADMIN_EMAILS: "" });
  try {
    const code = /Admin setup code: ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(s.log())?.[1];
    assert.ok(code, "setup code is printed at startup");
    const owner = token("owner");
    assert.equal((await s.call("GET", "/api/runtime-config")).json.adminClaimAvailable, true);
    assert.equal((await s.call("POST", "/api/admin/claim", { body: { code } })).status, 401);
    assert.equal((await s.call("POST", "/api/admin/claim", { tok: owner, body: { code: "AAAA-AAAA" } })).status, 403);
    // Spaces, lower case and a missing dash are fine.
    const ok = await s.call("POST", "/api/admin/claim", { tok: owner, body: { code: ` ${code.replace("-", "").toLowerCase()} ` } });
    assert.equal(ok.status, 200);
    assert.equal((await s.call("POST", "/api/auth/verify", { body: { idToken: owner } })).json.isGlobalAdmin, true);
    assert.equal((await s.call("GET", "/api/runtime-config")).json.adminClaimAvailable, false);
    // Now that there is an admin, the code is spent.
    assert.equal((await s.call("POST", "/api/admin/claim", { tok: token("intruder"), body: { code } })).status, 409);
  } finally {
    await s.stop();
    s.cleanup();
  }
});
