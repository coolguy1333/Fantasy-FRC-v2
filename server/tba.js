const config = require("./config");

// Tiny in-memory cache so a room full of players polling the same event
// doesn't multiply into that many TBA requests.
const cache = new Map();
const CACHE_MS = 15 * 1000;

async function fetchTba(pathSuffix) {
  const cached = cache.get(pathSuffix);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.body;
  if (!config.tbaApiKey) {
    const err = new Error("tba_not_configured");
    err.status = 500;
    throw err;
  }
  const response = await fetch(`${config.tbaApiBase}${pathSuffix}`, {
    headers: { "X-TBA-Auth-Key": config.tbaApiKey, Accept: "application/json" }
  });
  if (!response.ok) {
    const err = new Error("tba_upstream_error");
    err.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw err;
  }
  const body = await response.json();
  cache.set(pathSuffix, { body, at: Date.now() });
  return body;
}

function tbaProxyHandler(pathBuilder) {
  return async (req, res) => {
    try {
      res.json(await fetchTba(pathBuilder(req.params)));
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message || "tba_proxy_failed" });
    }
  };
}

const EVENT_KEY_RE = /^[a-z0-9_]+$/i;
const YEAR_RE = /^\d{4}$/;

module.exports = { fetchTba, tbaProxyHandler, EVENT_KEY_RE, YEAR_RE };
