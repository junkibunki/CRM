// Unit tests for the hook library pocketbase/pb_hooks/api-tokens-lib.js (plain CommonJS that
// also runs in the PocketBase JS VM). sha256 here is Node's; the integration tests
// (scripts/test-api-tokens.mjs) check that the VM's $security.sha256 gives the same hash.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const lib = createRequire(import.meta.url)('../../pocketbase/pb_hooks/api-tokens-lib.js');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const random = () => crypto.randomBytes(64).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, lib.RANDOM_LENGTH);

describe('api-tokens-lib: tokens', () => {
	it('builds crm_ + 43 alphanumerics (> 256 bit)', () => {
		const t = lib.newToken(random());
		assert.match(t, /^crm_[A-Za-z0-9]{43}$/);
		assert.ok(43 * Math.log2(62) > 256);
	});

	it('refuses a random string of the wrong length or alphabet', () => {
		assert.throws(() => lib.newToken('abc'));
		assert.throws(() => lib.newToken('-'.repeat(43)));
		assert.throws(() => lib.newToken(''));
	});

	it('hashes the whole token with sha256 (hex)', () => {
		const t = lib.newToken(random());
		assert.equal(lib.hashToken(t, sha256), sha256(t));
		assert.notEqual(lib.hashToken(t, sha256), lib.hashToken(t.slice(0, -1) + 'x', sha256));
	});

	it('ties a token to the user’s tokenKey', () => {
		assert.equal(lib.keyCheck('key1', 'sec', sha256), lib.keyCheck('key1', 'sec', sha256));
		assert.notEqual(lib.keyCheck('key1', 'sec', sha256), lib.keyCheck('key2', 'sec', sha256), 'password changed');
		assert.notEqual(lib.keyCheck('key1', 'sec', sha256), lib.keyCheck('key1', 'sec2', sha256), 'collection secret rotated');
		assert.notEqual(lib.keyCheck('key1', 'sec', sha256), sha256('key1'), 'domain-separated');
	});
});

describe('api-tokens-lib: parseToken', () => {
	const t = 'crm_' + 'a1B2'.repeat(10) + 'xyz';

	it('takes "Bearer <token>", the bare token or the body value', () => {
		assert.equal(lib.parseToken(`Bearer ${t}`), t);
		assert.equal(lib.parseToken(`bearer   ${t} `), t);
		assert.equal(lib.parseToken(t), t);
		assert.equal(lib.parseToken('', t), t);
		assert.equal(lib.parseToken(null, ` ${t} `), t);
	});

	it('rejects everything that does not look like a token (no DB lookup)', () => {
		assert.equal(lib.parseToken(''), null);
		assert.equal(lib.parseToken('Bearer'), null);
		assert.equal(lib.parseToken('Bearer eyJhbGciOiJIUzI1NiJ9.e30.x'), null, 'a session JWT');
		assert.equal(lib.parseToken(`Bearer ${t}x`), null);
		assert.equal(lib.parseToken(`Bearer ${t.slice(0, -1)}`), null);
		assert.equal(lib.parseToken(`Bearer ${t} extra`), null);
		assert.equal(lib.parseToken(`Bearer crm_${'-'.repeat(43)}`), null);
		assert.equal(lib.parseToken(null, 123), null);
	});
});

describe('api-tokens-lib: names', () => {
	it('trims and collapses whitespace', () => {
		assert.deepEqual(lib.validateName('  Claude   Code\tLaptop '), { name: 'Claude Code Laptop' });
	});

	it('needs 1..100 characters', () => {
		assert.ok(lib.validateName('').error);
		assert.ok(lib.validateName('   ').error);
		assert.ok(lib.validateName(null).error);
		assert.ok(lib.validateName('x'.repeat(101)).error);
		assert.deepEqual(lib.validateName('x'.repeat(100)), { name: 'x'.repeat(100) });
	});
});

describe('api-tokens-lib: rateLimit', () => {
	it('allows up to the limit inside the window', () => {
		let list = [];
		for (let i = 0; i < 3; i++) {
			const r = lib.rateLimit(list, 1000 + i, 3, 60_000);
			assert.equal(r.allowed, true);
			list = r.list;
		}
		const r = lib.rateLimit(list, 2000, 3, 60_000);
		assert.equal(r.allowed, false);
		assert.equal(r.list.length, 3, 'a refused request does not count');
	});

	it('forgets requests older than the window', () => {
		const r = lib.rateLimit([1000, 2000, 3000], 62_000, 3, 60_000);
		assert.equal(r.allowed, true);
		assert.deepEqual(r.list, [3000, 62_000]);
	});

	it('copes with garbage state', () => {
		assert.equal(lib.rateLimit(null, 1, 1, 10).allowed, true);
		assert.deepEqual(lib.rateLimit(['x', 5, 99], 10, 5, 100).list, [5, 10], 'non-numbers and future entries dropped');
	});
});

describe('api-tokens-lib: shared secret of the exchange', () => {
	const equal = (a, b) => a === b; // stands in for $security.equal (constant time)
	const secret = 's'.repeat(32);
	it('disabled without a secret of at least 32 characters', () => {
		assert.equal(lib.checkSecret('', secret, equal), 'disabled');
		assert.equal(lib.checkSecret(undefined, secret, equal), 'disabled');
		assert.equal(lib.checkSecret('s'.repeat(31), 's'.repeat(31), equal), 'disabled');
	});
	it('ok only for the same secret', () => {
		assert.equal(lib.checkSecret(secret, secret, equal), 'ok');
		assert.equal(lib.checkSecret(secret, '', equal), 'forbidden');
		assert.equal(lib.checkSecret(secret, null, equal), 'forbidden');
		assert.equal(lib.checkSecret(secret, secret + 'x', equal), 'forbidden');
		assert.equal(lib.checkSecret(secret, 'S'.repeat(32), equal), 'forbidden');
	});
});

describe('api-tokens-lib: agent tokens', () => {
	const USERS = '_pb_users_auth_';
	const jwt = (claims) => ['x', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.');
	const parse = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
	const agent = { type: 'auth', collectionId: USERS, id: 'u1', refreshable: false };

	it('recognises static auth tokens of users, not normal logins or superusers', () => {
		assert.equal(lib.isAgentToken(agent, USERS), true);
		assert.equal(lib.isAgentToken({ ...agent, refreshable: true }, USERS), false);
		assert.equal(lib.isAgentToken({ ...agent, collectionId: 'pbc_superusers' }, USERS), false);
		assert.equal(lib.isAgentToken({ ...agent, type: 'file' }, USERS), false);
		const { refreshable, ...noClaim } = agent;
		assert.equal(refreshable, false);
		assert.equal(lib.isAgentToken(noClaim, USERS), true, 'without the claim: treated as not refreshable');
		assert.equal(lib.isAgentToken(null, USERS), false);
	});

	it('reads the header with or without "Bearer"', () => {
		const users = () => USERS;
		assert.equal(lib.isAgentRequest(jwt(agent), parse, users), true);
		assert.equal(lib.isAgentRequest(`Bearer ${jwt(agent)}`, parse, users), true);
		assert.equal(lib.isAgentRequest(jwt({ ...agent, collectionId: 'pbc_superusers' }), parse, users), false);
		assert.equal(lib.isAgentRequest('', parse, users), false);
		assert.equal(lib.isAgentRequest('crm_abc', parse, users), false);
		assert.equal(lib.isAgentRequest('a.b.c', () => { throw new Error('bad'); }, users), false);
	});

	it('looks up the users collection only for a static auth token', () => {
		let lookups = 0;
		const users = () => (lookups++, USERS);
		assert.equal(lib.isAgentRequest(jwt({ ...agent, refreshable: true }), parse, users), false);
		assert.equal(lib.isAgentRequest(jwt({ ...agent, type: 'file' }), parse, users), false);
		assert.equal(lib.isAgentRequest('garbage', parse, users), false);
		assert.equal(lookups, 0);
		assert.equal(lib.isAgentRequest(jwt(agent), parse, users), true);
		assert.equal(lookups, 1);
	});

	it('may only read', () => {
		for (const m of ['GET', 'head', 'OPTIONS']) assert.equal(lib.agentMethodAllowed(m), true, m);
		for (const m of ['POST', 'PATCH', 'PUT', 'DELETE', '']) assert.equal(lib.agentMethodAllowed(m), false, m);
	});
});

describe('api-tokens-lib: shouldTouch', () => {
	const now = Date.parse('2026-10-28T12:00:00Z');
	it('writes last_used when never set or older than a minute', () => {
		assert.equal(lib.shouldTouch('', now), true);
		assert.equal(lib.shouldTouch('2026-10-28 11:58:59.000Z', now), true);
		assert.equal(lib.shouldTouch('2026-10-28 11:59:30.000Z', now), false);
		assert.equal(lib.shouldTouch('2026-10-28 13:00:00.000Z', now), true, 'clock skew: in the future');
		assert.equal(lib.shouldTouch('kaputt', now), true);
	});
});
