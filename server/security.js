const rateLimit = require("express-rate-limit");
const config = require("./config");
const { readSessionId } = require("./sessions");

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
  if (config.requireHttps) res.setHeader("Strict-Transport-Security", "max-age=15552000");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; " +
      "img-src 'self' data: https:; " +
      // accounts.google.com/gsi/style is the stylesheet Google One Tap injects.
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com/gsi/style; " +
      "font-src 'self' https://fonts.gstatic.com; script-src 'self' https://accounts.google.com; " +
      "connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com"
  );
  next();
}

function enforceTransport(req, res, next) {
  if (!config.requireHttps) return next();
  // The host's health probe talks to the container directly over plain HTTP
  // (no proxy, not loopback), so it must not be rejected. The endpoint returns
  // nothing sensitive.
  if (req.path === "/api/health") return next();
  // req.protocol only honours X-Forwarded-Proto when "trust proxy" is set (and
  // then reads just the first value of a comma-separated list), so a client
  // can't claim to be HTTPS when there's no trusted proxy in front.
  if (req.protocol === "https" || isLoopback(req.socket.remoteAddress)) return next();
  res.status(400).json({ error: "https_required" });
}

function enforceLocalApiOnly(req, res, next) {
  if (!config.localApiOnly) return next();
  if (isLoopback(req.socket.remoteAddress)) return next();
  res.status(403).json({ error: "remote_api_disabled" });
}

// PUT /api/state must come from a same-origin browser request, not a
// cross-site script acting on a signed-in user's behalf.
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function requireSameOrigin(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) {
    // Browsers always send Origin on writes. Without it, only allow callers
    // that aren't using the session cookie (API clients with a bearer token) -
    // a cookie is sent automatically by any site, so it must come with proof.
    const usesCookie = req.authVia === "cookie" || (req.authVia === undefined && Boolean(readSessionId(req)));
    const site = req.headers["sec-fetch-site"];
    if (usesCookie && site !== "same-origin" && site !== "none") {
      return res.status(403).json({ error: "cross_origin_request_denied" });
    }
    return next();
  }
  const originHost = hostOf(origin);
  const allowed = [req.headers.host, hostOf(config.publicUrl)];
  // A trusted proxy may rewrite Host but tells us the original in X-Forwarded-Host.
  if (config.trustProxy) allowed.push(String(req.headers["x-forwarded-host"] || "").split(",")[0].trim());
  if (originHost && allowed.includes(originHost)) return next();
  res.status(403).json({ error: "cross_origin_request_denied" });
}

module.exports = { limiters, securityHeaders, enforceTransport, enforceLocalApiOnly, requireSameOrigin };
