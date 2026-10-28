// F15: personal API tokens for agents (MCP server). Plain JS (CommonJS, ES2015) so it runs in
// the PocketBase JS VM (require(`${__hooks}/api-tokens-lib.js`)) and in node --test
// (mcp/src/api-tokens-lib.test.js). Pure; randomness and hashing come in from the hook
// ($security.randomString = crypto/rand, $security.sha256 = hex digest).

var PREFIX = 'crm_';
var RANDOM_LENGTH = 43; // [A-Za-z0-9]{43}: 62^43 > 2^256
var TOKEN_PATTERN = /^crm_[A-Za-z0-9]{43}$/;
var NAME_MAX = 100;
var MAX_TOKENS_PER_USER = 20;
var AUTH_TOKEN_SECONDS = 60; // lifetime of the auth token the exchange hands out (one MCP request)
var RATE_LIMIT = 120; // exchanges per token ...
var RATE_WINDOW_MS = 60 * 1000; // ... per minute (the MCP server exchanges once per request)
var TOUCH_INTERVAL_MS = 60 * 1000; // `last_used` is written at most this often

/** A new token from a random string of RANDOM_LENGTH characters ([A-Za-z0-9]). */
function newToken(random) {
	var r = String(random || '');
	if (!/^[A-Za-z0-9]+$/.test(r) || r.length !== RANDOM_LENGTH) {
		throw new Error('api-tokens: bad random string');
	}
	return PREFIX + r;
}

/**
 * The token from an `Authorization` header (`Bearer crm_…` or the bare token) or a body
 * value; null when there is none or it doesn't look like a token (no DB lookup then).
 */
function parseToken(header, bodyValue) {
	var v = String(header || '').trim();
	var m = /^Bearer\s+(\S+)$/i.exec(v);
	if (m) v = m[1];
	if (!v && bodyValue != null) v = String(bodyValue).trim();
	return TOKEN_PATTERN.test(v) ? v : null;
}

/** Stored hash of a token: sha256 hex of the full token (`sha256` = $security.sha256). */
function hashToken(token, sha256) {
	return String(sha256(token));
}

/**
 * Fingerprint of the user's tokenKey and the `users` auth token secret at creation time.
 * PocketBase renews the tokenKey when the password (or e-mail) changes, so "change the
 * password to lock an employee out" also revokes all of their API tokens; rotating the
 * collection's token secret (which ends every session) revokes all API tokens.
 */
function keyCheck(tokenKey, collectionSecret, sha256) {
	return String(sha256('crm-api-token:' + String(tokenKey || '') + ':' + String(collectionSecret || '')));
}

/** Trimmed name or an error text. */
function validateName(name) {
	var n = String(name == null ? '' : name).replace(/\s+/g, ' ').trim();
	if (!n) return { error: 'Bitte einen Namen angeben (z. B. „Claude Code Laptop“).' };
	if (n.length > NAME_MAX) return { error: 'Der Name darf höchstens ' + NAME_MAX + ' Zeichen lang sein.' };
	return { name: n };
}

/**
 * Sliding-window rate limit. `list` = timestamps (ms) of earlier requests; returns the new
 * list (only entries inside the window, plus `now` if allowed) and whether it is allowed.
 */
function rateLimit(list, now, limit, windowMs) {
	var kept = [];
	var src = Array.isArray(list) ? list : [];
	for (var i = 0; i < src.length; i++) {
		if (typeof src[i] === 'number' && src[i] > now - windowMs && src[i] <= now) kept.push(src[i]);
	}
	if (kept.length >= limit) return { allowed: false, list: kept };
	kept.push(now);
	return { allowed: true, list: kept };
}

/** Parses a PocketBase date string (`YYYY-MM-DD HH:MM:SS.sssZ`) to ms; NaN for ''. */
function parseDate(s) {
	var v = String(s || '').trim();
	if (!v) return NaN;
	return Date.parse(v.replace(' ', 'T'));
}

/** Whether `last_used` should be written now (never set, or older than TOUCH_INTERVAL_MS). */
function shouldTouch(lastUsed, now) {
	var t = parseDate(lastUsed);
	return isNaN(t) || now - t >= TOUCH_INTERVAL_MS || t > now;
}

var SECRET_MIN_LENGTH = 32;
var SECRET_HEADER = 'X-CRM-MCP-Secret';

/**
 * The shared secret between PocketBase and the MCP server (env CRM_MCP_SECRET, header
 * X-CRM-MCP-Secret): only the MCP server may swap API tokens. `equal` = $security.equal
 * (constant time). 'disabled' when the env is missing or shorter than SECRET_MIN_LENGTH.
 * @returns {'ok' | 'forbidden' | 'disabled'}
 */
function checkSecret(expected, given, equal) {
	var e = expected == null ? '' : String(expected);
	if (e.length < SECRET_MIN_LENGTH) return 'disabled';
	var g = given == null ? '' : String(given);
	if (!g) return 'forbidden';
	return equal(e, g) ? 'ok' : 'forbidden';
}

/** The raw token of an Authorization header ("Bearer x" or "x", as the JS SDK sends it). */
function bearer(header) {
	var v = String(header || '').trim();
	var m = /^Bearer\s+(\S+)$/i.exec(v);
	return m ? m[1] : v;
}

/**
 * An auth token as the exchange hands it out: a static (non-refreshable) auth token of a
 * `users` record. Normal logins are refreshable, superusers are another collection.
 * `claims` = $security.parseUnverifiedJWT(token): only the request's own, PocketBase-
 * verified token decides whether the request is authenticated at all, so a forged token
 * with these claims gains nothing (it is just refused earlier).
 */
function isAgentToken(claims, usersCollectionId) {
	if (!claims || typeof claims !== 'object') return false;
	return claims.type === 'auth' && claims.collectionId === usersCollectionId && claims.refreshable !== true;
}

/** Agent tokens may only read: GET, HEAD (and CORS preflights). */
function agentMethodAllowed(method) {
	var m = String(method || '').toUpperCase();
	return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
}

/**
 * Whether a request carries an agent token. `parseJWT` = $security.parseUnverifiedJWT
 * (throws on garbage, that is no agent token). `usersCollectionId` is a function, called
 * only for a static auth token (no DB lookup for normal requests).
 */
function isAgentRequest(authHeader, parseJWT, usersCollectionId) {
	var raw = bearer(authHeader);
	if (!raw || raw.split('.').length !== 3) return false;
	var claims = null;
	try {
		claims = parseJWT(raw);
	} catch (err) {
		return false;
	}
	if (!claims || typeof claims !== 'object' || claims.type !== 'auth' || claims.refreshable === true) return false;
	return isAgentToken(claims, usersCollectionId());
}

module.exports = {
	SECRET_MIN_LENGTH: SECRET_MIN_LENGTH,
	SECRET_HEADER: SECRET_HEADER,
	checkSecret: checkSecret,
	bearer: bearer,
	isAgentToken: isAgentToken,
	agentMethodAllowed: agentMethodAllowed,
	isAgentRequest: isAgentRequest,
	PREFIX: PREFIX,
	RANDOM_LENGTH: RANDOM_LENGTH,
	NAME_MAX: NAME_MAX,
	MAX_TOKENS_PER_USER: MAX_TOKENS_PER_USER,
	AUTH_TOKEN_SECONDS: AUTH_TOKEN_SECONDS,
	RATE_LIMIT: RATE_LIMIT,
	RATE_WINDOW_MS: RATE_WINDOW_MS,
	TOUCH_INTERVAL_MS: TOUCH_INTERVAL_MS,
	newToken: newToken,
	parseToken: parseToken,
	hashToken: hashToken,
	keyCheck: keyCheck,
	validateName: validateName,
	rateLimit: rateLimit,
	shouldTouch: shouldTouch
};
