const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer } = require("./helpers/server");

// Loopback callers are exempt from REQUIRE_HTTPS, so from a test we can only
// check the exemptions and headers; the protocol parsing itself is covered below.
test("REQUIRE_HTTPS with a trusted proxy", async () => {
  const s = await startServer({ REQUIRE_HTTPS: "true", TRUST_PROXY: "true" });
  try {
    // Loopback callers (and the host health probe) are always allowed.
    assert.equal((await s.call("GET", "/api/runtime-config")).status, 200);
    assert.equal((await s.call("GET", "/api/health", { headers: { "x-forwarded-proto": "http" } })).status, 200);
    const res = await s.call("GET", "/api/runtime-config");
    assert.match(res.headers.get("strict-transport-security") || "", /max-age/);
    assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    assert.equal(res.headers.get("cache-control"), "no-store");
  } finally {
    await s.stop();
    s.cleanup();
  }
});

test("a comma-separated X-Forwarded-Proto is read by its first value", async () => {
  const express = require("express");
  const app = express();
  app.set("trust proxy", 1);
  app.get("/", (req, res) => res.send(req.protocol));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { "x-forwarded-proto": "https, http" } });
  assert.equal(await res.text(), "https");
  server.close();
});
