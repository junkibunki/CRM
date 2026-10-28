/// <reference path="../pb_data/types.d.ts" />
// F15: personal API tokens (collection `api_tokens`, migration 1793190006).
// POST /api/crm/api-tokens      {name}  (signed-in user) -> {id, name, created, token}
//   creates a token for the caller; the token is in this response only, the DB keeps its hash.
// POST /api/crm/token-exchange  Authorization: Bearer crm_…, X-CRM-MCP-Secret -> {token, expires_in, user}
//   swaps an API token for a short-lived (60 s), non-refreshable auth token of its user (what
//   the MCP server sends to the REST API, so the user's API rules apply). Only the MCP server
//   may call it: it needs the shared secret (env CRM_MCP_SECRET, >= 32 characters; not set ->
//   503, wrong -> 403). Wrong, revoked or outdated token (password changed or the `users`
//   token secret rotated since) -> 401; more than lib.RATE_LIMIT per minute -> 429.
// Middleware: such an agent token (static auth token of a `users` record) may only read:
//   every request other than GET/HEAD/OPTIONS -> 403 (records, batch, realtime subscriptions,
//   auth-refresh, file tokens, own routes). Normal logins and superusers are not affected.
//   Deliberately the same for a superuser's "impersonate" token of a user: it is also a
//   static auth token, so it can only read (to act as a user with write access, log in).
// Listing, renaming and revoking (= deleting) go through the normal records API (own only,
// never with an agent token).
// Each callback runs in its own JS VM, so everything is required inside it
// (docs/pitfalls/pocketbase-hooks.md). In record request hooks `e.request` is undefined:
// headers come from `e.requestInfo().headers` (lowercase names).

routerUse((e) => {
	const lib = require(`${__hooks}/api-tokens-lib.js`);
	if (lib.agentMethodAllowed(e.request.method)) return e.next();
	const header = e.request.header.get('Authorization');
	// claims first; the users collection is looked up only for a static auth token
	if (header && lib.isAgentRequest(header, $security.parseUnverifiedJWT, () => $app.findCollectionByNameOrId('users').id)) {
		throw new ForbiddenError('Agent-Zugänge (MCP) dürfen nur lesen.');
	}
	return e.next();
});

// explicit, independent of the middleware: agent tokens never manage API tokens
onRecordUpdateRequest((e) => {
	const lib = require(`${__hooks}/api-tokens-lib.js`);
	if (lib.isAgentRequest(e.requestInfo().headers['authorization'], $security.parseUnverifiedJWT, () => $app.findCollectionByNameOrId('users').id)) {
		throw new ForbiddenError('API-Tokens lassen sich nicht über einen Agent-Zugang verwalten.');
	}
	return e.next();
}, 'api_tokens');

onRecordDeleteRequest((e) => {
	const lib = require(`${__hooks}/api-tokens-lib.js`);
	if (lib.isAgentRequest(e.requestInfo().headers['authorization'], $security.parseUnverifiedJWT, () => $app.findCollectionByNameOrId('users').id)) {
		throw new ForbiddenError('API-Tokens lassen sich nicht über einen Agent-Zugang verwalten.');
	}
	return e.next();
}, 'api_tokens');

routerAdd(
	'POST',
	'/api/crm/api-tokens',
	(e) => {
		const lib = require(`${__hooks}/api-tokens-lib.js`);
		if (lib.isAgentRequest(e.request.header.get('Authorization'), $security.parseUnverifiedJWT, () => $app.findCollectionByNameOrId('users').id)) {
			throw new ForbiddenError('API-Tokens lassen sich nicht über einen Agent-Zugang anlegen.');
		}
		const body = e.requestInfo().body || {};
		const n = lib.validateName(body.name);
		if (n.error) {
			throw new BadRequestError(n.error, { name: new ValidationError('invalid_name', n.error) });
		}
		const count = $app.countRecords('api_tokens', $dbx.hashExp({ user: e.auth.id }));
		if (count >= lib.MAX_TOKENS_PER_USER) {
			const msg = 'Höchstens ' + lib.MAX_TOKENS_PER_USER + ' Tokens pro Person – bitte erst einen widerrufen.';
			throw new BadRequestError(msg, { name: new ValidationError('too_many_tokens', msg) });
		}

		const token = lib.newToken($security.randomString(lib.RANDOM_LENGTH));
		const users = $app.findCollectionByNameOrId('users');
		const record = new Record($app.findCollectionByNameOrId('api_tokens'));
		record.set('user', e.auth.id);
		record.set('name', n.name);
		record.set('token_hash', lib.hashToken(token, $security.sha256));
		record.set('key_check', lib.keyCheck(e.auth.tokenKey(), users.authToken.secret, $security.sha256));
		$app.save(record);
		return e.json(200, {
			id: record.id,
			name: record.get('name'),
			created: record.getString('created'),
			token: token
		});
	},
	$apis.requireAuth('users')
);

routerAdd('POST', '/api/crm/token-exchange', (e) => {
	const lib = require(`${__hooks}/api-tokens-lib.js`);
	const unauthorized = 'Ungültiges oder widerrufenes API-Token.';
	const secret = lib.checkSecret($os.getenv('CRM_MCP_SECRET'), e.request.header.get(lib.SECRET_HEADER), $security.equal);
	if (secret === 'disabled') {
		throw new ApiError(503, 'Token-Tausch ist nicht eingerichtet (CRM_MCP_SECRET fehlt oder ist kürzer als 32 Zeichen).');
	}
	if (secret !== 'ok') throw new ForbiddenError('Token-Tausch nur für den MCP-Dienst.');
	let bodyToken = null;
	try {
		bodyToken = (e.requestInfo().body || {}).token;
	} catch (err) {
		bodyToken = null;
	}
	const token = lib.parseToken(e.request.header.get('Authorization'), bodyToken);
	if (!token) throw new UnauthorizedError(unauthorized);

	let rec = null;
	try {
		rec = $app.findFirstRecordByData('api_tokens', 'token_hash', lib.hashToken(token, $security.sha256));
	} catch (err) {
		rec = null;
	}
	if (!rec) throw new UnauthorizedError(unauthorized);

	const now = Date.now();
	let allowed = false;
	$app.store().setFunc('crm.apiTokens.rate.' + rec.id, (old) => {
		let list = [];
		try {
			list = old ? JSON.parse(old) : [];
		} catch (err) {
			list = [];
		}
		const r = lib.rateLimit(list, now, lib.RATE_LIMIT, lib.RATE_WINDOW_MS);
		allowed = r.allowed;
		return JSON.stringify(r.list);
	});
	if (!allowed) throw new TooManyRequestsError('Zu viele Anfragen mit diesem Token – bitte eine Minute warten.');

	let user = null;
	try {
		user = $app.findRecordById('users', rec.getString('user'));
	} catch (err) {
		user = null;
	}
	// password changed (or the users token secret rotated) since the token was made: the
	// token is dead, like the user's sessions
	const users = $app.findCollectionByNameOrId('users');
	if (!user || rec.getString('key_check') !== lib.keyCheck(user.tokenKey(), users.authToken.secret, $security.sha256)) {
		throw new UnauthorizedError(unauthorized);
	}

	if (lib.shouldTouch(rec.getString('last_used'), now)) {
		rec.set('last_used', new DateTime());
		try {
			$app.save(rec);
		} catch (err) {
			// a concurrent revoke deleted it: no token anymore
			throw new UnauthorizedError(unauthorized);
		}
	}

	return e.json(200, {
		token: user.newStaticAuthToken(lib.AUTH_TOKEN_SECONDS * 1000000000),
		expires_in: lib.AUTH_TOKEN_SECONDS,
		user: { id: user.id, name: user.getString('name') }
	});
});
