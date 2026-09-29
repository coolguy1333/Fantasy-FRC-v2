const { OAuth2Client } = require("google-auth-library");
const config = require("./config");
const { lookupSession, readSessionId, setSessionCookie } = require("./sessions");

const client = new OAuth2Client();

async function verifyGoogleIdToken(idToken) {
  if (!config.googleClientId) throw new Error("google_client_id_not_configured");
  const ticket = await client.verifyIdToken({ idToken, audience: config.googleClientId });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) throw new Error("invalid_token");
  // An unverified email claim can be set by whoever created the Google account,
  // so it must never count towards admin bootstrapping.
  return {
    sub: payload.sub,
    email: payload.email && payload.email_verified === true ? payload.email : "",
    name: payload.name || "",
    picture: payload.picture || ""
  };
}

// Middleware. Accepts either `Authorization: Bearer <google_id_token>` (scripts
// and tests, verified against Google on every call) or the session cookie set
// by POST /api/auth/verify (the browser). Attaches the user to req.authUser and
// records how in req.authVia, which the same-origin check needs.
function requireAuth() {
  return async (req, res, next) => {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (token) {
      try {
        req.authUser = await verifyGoogleIdToken(token);
        req.authVia = "bearer";
        return next();
      } catch (err) {
        return res.status(401).json({ error: "invalid_token", detail: String(err.message || "") });
      }
    }
    const session = lookupSession(readSessionId(req));
    if (!session) return res.status(401).json({ error: "authentication_required" });
    if (session.renewed) setSessionCookie(req, res, readSessionId(req));
    req.authUser = session.user;
    req.authVia = "cookie";
    next();
  };
}

module.exports = { verifyGoogleIdToken, requireAuth };
