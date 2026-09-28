const config = require("./config");

// Small in-memory cache so a room full of players polling the same event
// doesn't multiply into that many TBA requests. It is bounded, and failures are
// cached briefly too: these routes are reachable without signing in, so without
// that anyone could make us spend our TBA key on endless distinct/bad keys.
const cache = new Map();
const inflight = new Map();
const OK_TTL_MS = 15 * 1000;
const ERROR_TTL_MS = 10 * 1000;
const NOT_FOUND_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const UPSTREAM_TIMEOUT_MS = 10 * 1000;

function tbaError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function remember(pathSuffix, entry) {
  cache.delete(pathSuffix);
  cache.set(pathSuffix, { ...entry, at: Date.now() });
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

async function requestTba(pathSuffix) {
  let response;
  try {
    response = await fetch(`${config.tbaApiBase}${pathSuffix}`, {
      headers: { "X-TBA-Auth-Key": config.tbaApiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch {
    remember(pathSuffix, { error: { message: "tba_unreachable", status: 502 }, ttl: ERROR_TTL_MS });
    throw tbaError("tba_unreachable", 502);
  }
  if (!response.ok) {
    // Our own key being rejected is a server problem, not the caller's.
    const notFound = response.status === 404;
    const error = { message: notFound ? "tba_not_found" : "tba_upstream_error", status: notFound ? 404 : 502 };
    remember(pathSuffix, { error, ttl: notFound ? NOT_FOUND_TTL_MS : ERROR_TTL_MS });
    throw tbaError(error.message, error.status);
  }
  const body = await response.json();
  remember(pathSuffix, { body, ttl: OK_TTL_MS });
  return body;
}

async function fetchTba(pathSuffix) {
  const cached = cache.get(pathSuffix);
  if (cached && Date.now() - cached.at < cached.ttl) {
    if (cached.error) throw tbaError(cached.error.message, cached.error.status);
    return cached.body;
  }
  if (!config.tbaApiKey) throw tbaError("tba_not_configured", 503);
  if (!inflight.has(pathSuffix)) {
    const request = requestTba(pathSuffix).finally(() => inflight.delete(pathSuffix));
    inflight.set(pathSuffix, request);
  }
  return inflight.get(pathSuffix);
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

// TBA event keys are the year followed by a short event code, e.g. 2024casj.
const EVENT_KEY_RE = /^\d{4}[a-z0-9]{1,24}$/i;
const YEAR_RE = /^\d{4}$/;

module.exports = { fetchTba, tbaProxyHandler, EVENT_KEY_RE, YEAR_RE };
