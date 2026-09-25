const rateLimit = require("express-rate-limit");
const config = require("./config");

function makeLimiter(max) {
  return rateLimit({ windowMs: 60 * 1000, max, standardHeaders: true, legacyHeaders: false });
}

const limiters = {
  read: makeLimiter(240),
  write: makeLimiter(80),
  auth: makeLimiter(120),
  tba: makeLimiter(180)
};

function isLoopback(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; script-src 'self' https://accounts.google.com; " +
      "connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com"
  );
  next();
}

function enforceTransport(req, res, next) {
  if (!config.requireHttps) return next();
  // Only consult X-Forwarded-Proto when we're actually behind a trusted
  // reverse proxy (config.trustProxy) - a client can set this header to
  // whatever it wants, so trusting it without a real proxy in front would
  // let plain HTTP traffic claim to be HTTPS and bypass this check entirely.
  const proto = config.trustProxy ? req.headers["x-forwarded-proto"] || req.protocol : req.protocol;
  if (proto === "https" || isLoopback(req.socket.remoteAddress)) return next();
  res.status(400).json({ error: "https_required" });
}

function enforceLocalApiOnly(req, res, next) {
  if (!config.localApiOnly) return next();
  if (isLoopback(req.socket.remoteAddress)) return next();
  res.status(403).json({ error: "remote_api_disabled" });
}

// PUT /api/state must come from a same-origin browser request, not a
// cross-site script acting on a signed-in user's behalf.
function requireSameOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) return next(); // same-origin requests may omit Origin
  const host = req.headers.host;
  try {
    if (new URL(origin).host === host) return next();
  } catch {
    // fall through to reject
  }
  res.status(403).json({ error: "cross_origin_request_denied" });
}

module.exports = { limiters, securityHeaders, enforceTransport, enforceLocalApiOnly, requireSameOrigin };
