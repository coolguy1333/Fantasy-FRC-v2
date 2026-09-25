const { OAuth2Client } = require("google-auth-library");
const config = require("./config");

const client = new OAuth2Client();

async function verifyGoogleIdToken(idToken) {
  if (!config.googleClientId) throw new Error("google_client_id_not_configured");
  const ticket = await client.verifyIdToken({ idToken, audience: config.googleClientId });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) throw new Error("invalid_token");
  return {
    sub: payload.sub,
    email: payload.email || "",
    name: payload.name || "",
    picture: payload.picture || ""
  };
}

// Middleware: expects `Authorization: Bearer <google_id_token>` and attaches
// the verified user to req.authUser. Verifying on every request avoids
// needing a server-side session store, at the cost of an extra Google call -
// acceptable at this app's scale and one less thing to operate.
function requireAuth() {
  return async (req, res, next) => {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token) return res.status(401).json({ error: "authentication_required" });
    try {
      req.authUser = await verifyGoogleIdToken(token);
      next();
    } catch (err) {
      res.status(401).json({ error: "invalid_token", detail: String(err.message || "") });
    }
  };
}

module.exports = { verifyGoogleIdToken, requireAuth };
