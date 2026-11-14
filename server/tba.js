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
// If TBA is down, keep serving the last good answer for a while. Match times
// barely change, so locks still close on schedule; scores just stop updating.
const STALE_MAX_MS = 30 * 60 * 1000;
const lastGood = new Map();

function tbaError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function remember(pathSuffix, entry) {
  cache.delete(pathSuffix);
  cache.set(pathSuffix, { fetchedAt: Date.now(), ...entry, at: Date.now() });
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

function rememberGood(pathSuffix, body) {
  lastGood.delete(pathSuffix);
  lastGood.set(pathSuffix, { body, fetchedAt: Date.now() });
  while (lastGood.size > MAX_CACHE_ENTRIES) lastGood.delete(lastGood.keys().next().value);
}

// Upstream failed: fall back to the last good copy if it's recent enough.
function staleOr(pathSuffix, error) {
  const good = lastGood.get(pathSuffix);
  if (good && Date.now() - good.fetchedAt < STALE_MAX_MS) {
    remember(pathSuffix, { body: good.body, fetchedAt: good.fetchedAt, ttl: ERROR_TTL_MS, stale: true });
    return good.body;
  }
  remember(pathSuffix, { error, ttl: ERROR_TTL_MS });
  throw tbaError(error.message, error.status);
}

async function requestTba(pathSuffix) {
  let response;
  try {
    response = await fetch(`${config.tbaApiBase}${pathSuffix}`, {
      headers: { "X-TBA-Auth-Key": config.tbaApiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
  } catch {
    return staleOr(pathSuffix, { message: "tba_unreachable", status: 502 });
  }
  if (response.status === 404) {
    const error = { message: "tba_not_found", status: 404 };
    remember(pathSuffix, { error, ttl: NOT_FOUND_TTL_MS });
    throw tbaError(error.message, error.status);
  }
  // Our own key being rejected, or TBA erroring, is a server problem, not the caller's.
  if (!response.ok) return staleOr(pathSuffix, { message: "tba_upstream_error", status: 502 });
  let body;
  try {
    body = await response.json();
  } catch {
    return staleOr(pathSuffix, { message: "tba_upstream_error", status: 502 });
  }
  remember(pathSuffix, { body, ttl: OK_TTL_MS });
  rememberGood(pathSuffix, body);
  return body;
}

// When the data for this path was actually fetched from TBA (older than "now" when stale).
function fetchedAt(pathSuffix) {
  return cache.get(pathSuffix)?.fetchedAt || Date.now();
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
      const pathSuffix = pathBuilder(req.params);
      const body = await fetchTba(pathSuffix);
      res.setHeader("X-Data-As-Of", String(fetchedAt(pathSuffix)));
      res.json(body);
    } catch (err) {
      res.status(err.status || 502).json({ error: err.message || "tba_proxy_failed" });
    }
  };
}

// TBA event keys are the year followed by a short event code, e.g. 2024casj.
const EVENT_KEY_RE = /^\d{4}[a-z0-9]{1,24}$/i;
const YEAR_RE = /^\d{4}$/;

module.exports = { fetchTba, tbaProxyHandler, EVENT_KEY_RE, YEAR_RE };
