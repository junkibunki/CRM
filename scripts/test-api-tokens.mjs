// API integration tests for F15 (collection `api_tokens`, hook routes
// POST /api/crm/api-tokens and POST /api/crm/token-exchange). Runs against a THROWAWAY
// PocketBase (own --dir, free port), never against pocketbase/pb_data. Same setup as
// scripts/test-api.mjs. Run: cd web && node --test ../scripts/test-api-tokens.mjs
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PB_DIR = path.join(ROOT, 'pocketbase');
const BIN = path.join(PB_DIR, process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
const SU = { email: 'su@api.test', password: 'su-password-1234' };
const PASSWORD = 'user-password-1234';
let BASE;

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer().once('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});
}

async function api(method, url, body, token, headers = {}) {
	const res = await fetch(BASE + url, {
		method,
		headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { Authorization: token }), ...headers },
		body: body && JSON.stringify(body)
	});
	const data = await res.json().catch(() => ({}));
	return { status: res.status, data };
}

async function login(collection, identity, password) {
	const r = await api('POST', `/api/collections/${collection}/auth-with-password`, { identity, password });
	assert.equal(r.status, 200, `login ${identity}`);
	return r.data.token;
}

async function createUser(su, email, name) {
	const r = await api('POST', '/api/collections/users/records', { email, password: PASSWORD, passwordConfirm: PASSWORD, name, verified: true }, su);
	assert.equal(r.status, 200, `create ${email}`);
	return { id: r.data.id, email, token: await login('users', email, PASSWORD) };
}

const q = (s) => encodeURIComponent(s);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const jwtPayload = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());

async function newToken(user, name = 'Claude Code') {
	const r = await api('POST', '/api/crm/api-tokens', { name }, user.token);
	assert.equal(r.status, 200, JSON.stringify(r.data));
	return r.data;
}

// the shared secret between PocketBase and the MCP server (env CRM_MCP_SECRET)
const SECRET = 'test-mcp-secret-0123456789abcdef-0123';
const exchange = (token, secret = SECRET) =>
	api('POST', '/api/crm/token-exchange', null, null, { Authorization: `Bearer ${token}`, ...(secret && { 'X-CRM-MCP-Secret': secret }) });

let su;
let anna;
let ben;

/** A throwaway PocketBase with the repo's migrations and hooks; `env` on top of ours. */
async function startPb(env, hooksDir = path.join(PB_DIR, 'pb_hooks')) {
	const port = await freePort();
	const base = `http://127.0.0.1:${port}`;
	const dir = fs.mkdtempSync(path.join(PB_DIR, 'pb_test_'));
	const common = ['--dir', path.join(dir, 'data'), '--migrationsDir', path.join(PB_DIR, 'pb_migrations')];
	execFileSync(BIN, ['superuser', 'upsert', SU.email, SU.password, ...common], { stdio: 'ignore' });
	const proc = spawn(BIN, ['serve', '--http', `127.0.0.1:${port}`, '--automigrate=false', ...common, '--hooksDir', hooksDir], {
		stdio: 'ignore',
		env
	});
	for (let i = 0; i < 50; i++) {
		const ok = await fetch(base + '/api/health').then((r) => r.ok).catch(() => false);
		if (ok) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	return { base, dir, proc };
}

async function stopPb(pb) {
	// wait for the process to exit: on Windows it still holds the db files right after kill()
	if (pb?.proc && pb.proc.exitCode === null) {
		const exited = new Promise((r) => pb.proc.once('exit', r));
		pb.proc.kill();
		await exited;
	}
	if (pb?.dir) fs.rmSync(pb.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

let main;

before(async () => {
	assert.ok(fs.existsSync(BIN), `PocketBase binary missing: ${BIN}`);
	const env = { ...process.env, CRM_MCP_SECRET: SECRET };
	main = await startPb(env);
	BASE = main.base;
	su = await login('_superusers', SU.email, SU.password);
	anna = await createUser(su, 'anna@api.test', 'Anna');
	ben = await createUser(su, 'ben@api.test', 'Ben');
});

after(async () => {
	await stopPb(main);
});

describe('api_tokens: creating', () => {
	it('is not possible as a guest or a superuser', async () => {
		assert.equal((await api('POST', '/api/crm/api-tokens', { name: 'x' })).status, 401);
		assert.ok([401, 403].includes((await api('POST', '/api/crm/api-tokens', { name: 'x' }, su)).status));
	});

	it('returns the token once and stores only its hash', async () => {
		const t = await newToken(anna, '  Claude   Code Laptop ');
		assert.match(t.token, /^crm_[A-Za-z0-9]{43}$/);
		assert.equal(t.name, 'Claude Code Laptop');
		const list = await api('GET', '/api/collections/api_tokens/records', null, anna.token);
		const mine = list.data.items.find((x) => x.id === t.id);
		assert.ok(mine, 'listed');
		assert.equal(mine.user, anna.id);
		assert.equal(mine.token, undefined);
		assert.equal(mine.token_hash, undefined, 'hash not readable');
		assert.equal(mine.key_check, undefined);
		assert.equal(mine.last_used, '');
		const one = await api('GET', `/api/collections/api_tokens/records/${t.id}`, null, anna.token);
		assert.equal(one.data.token_hash, undefined);
		// stored is sha256(token): the superuser finds the record by that hash
		const bySu = await api('GET', `/api/collections/api_tokens/records?filter=${q(`token_hash="${sha256(t.token)}"`)}`, null, su);
		assert.equal(bySu.status, 200);
		assert.deepEqual(bySu.data.items.map((x) => x.id), [t.id]);
		assert.ok(!JSON.stringify(bySu.data).includes(t.token), 'the token itself is nowhere');
	});

	it('draws a different token every time', async () => {
		const a = await newToken(anna, 'A');
		const b = await newToken(anna, 'B');
		assert.notEqual(a.token, b.token);
	});

	it('needs a name of at most 100 characters', async () => {
		const empty = await api('POST', '/api/crm/api-tokens', { name: '  ' }, anna.token);
		assert.equal(empty.status, 400);
		assert.equal(empty.data.data.name.code, 'invalid_name');
		assert.equal((await api('POST', '/api/crm/api-tokens', { name: 'x'.repeat(101) }, anna.token)).status, 400);
	});

	it('is not possible through the records API (hash chosen by the client)', async () => {
		const r = await api('POST', '/api/collections/api_tokens/records', { user: anna.id, name: 'x', token_hash: sha256('crm_x'), key_check: 'x' }, anna.token);
		assert.ok([400, 403].includes(r.status), String(r.status));
	});

	it('allows at most 20 tokens per user', async () => {
		const carl = await createUser(su, 'carl@api.test', 'Carl');
		for (let i = 0; i < 20; i++) await newToken(carl, `T${i}`);
		const r = await api('POST', '/api/crm/api-tokens', { name: 'one more' }, carl.token);
		assert.equal(r.status, 400);
		assert.equal(r.data.data.name.code, 'too_many_tokens');
	});
});

describe('api_tokens: only your own', () => {
	let t;
	before(async () => {
		t = await newToken(anna, 'Annas Token');
	});

	it('guests see nothing', async () => {
		const list = await api('GET', '/api/collections/api_tokens/records');
		assert.equal(list.data.items?.length ?? 0, 0);
		assert.equal((await api('GET', `/api/collections/api_tokens/records/${t.id}`)).status, 404);
	});

	it('others neither see, rename nor revoke them', async () => {
		const list = await api('GET', '/api/collections/api_tokens/records', null, ben.token);
		assert.equal(list.data.items.length, 0);
		assert.equal((await api('GET', `/api/collections/api_tokens/records/${t.id}`, null, ben.token)).status, 404);
		assert.equal((await api('PATCH', `/api/collections/api_tokens/records/${t.id}`, { name: 'x' }, ben.token)).status, 404);
		assert.equal((await api('DELETE', `/api/collections/api_tokens/records/${t.id}`, null, ben.token)).status, 404);
		assert.equal((await exchange(t.token)).status, 200, 'still valid');
	});

	it('the owner may rename, but change nothing else', async () => {
		const r = await api('PATCH', `/api/collections/api_tokens/records/${t.id}`, { name: 'Neu' }, anna.token);
		assert.equal(r.status, 200);
		assert.equal(r.data.name, 'Neu');
		const before = (await api('GET', `/api/collections/api_tokens/records/${t.id}`, null, su)).data;
		for (const body of [{ user: ben.id }, { last_used: '2020-01-01 00:00:00.000Z' }]) {
			const bad = await api('PATCH', `/api/collections/api_tokens/records/${t.id}`, body, anna.token);
			assert.equal(bad.status, 404, JSON.stringify(body));
		}
		// hidden fields: PocketBase drops them from a user's request body (200, unchanged)
		for (const body of [{ token_hash: sha256('crm_x') }, { key_check: 'x' }]) {
			const bad = await api('PATCH', `/api/collections/api_tokens/records/${t.id}`, body, anna.token);
			assert.ok([200, 404].includes(bad.status), JSON.stringify(body));
		}
		const now = (await api('GET', `/api/collections/api_tokens/records/${t.id}`, null, su)).data;
		assert.equal(now.token_hash, before.token_hash);
		assert.equal(now.token_hash, sha256(t.token));
		assert.equal(now.key_check, before.key_check);
		assert.equal(now.user, anna.id);
		assert.equal((await exchange(t.token)).status, 200, 'still valid');
	});

	it('users cannot probe the hash with a filter', async () => {
		const r = await api('GET', `/api/collections/api_tokens/records?filter=${q(`token_hash="${sha256(t.token)}"`)}`, null, anna.token);
		assert.ok(r.status === 400 || r.data.items.length === 0, JSON.stringify(r.data));
		const sorted = await api('GET', '/api/collections/api_tokens/records?sort=token_hash', null, anna.token);
		assert.ok(sorted.status === 400 || !JSON.stringify(sorted.data).includes(sha256(t.token)));
	});
});

describe('token exchange', () => {
	let t;
	before(async () => {
		t = await newToken(anna, 'Exchange');
	});

	it('gives a short-lived, non-refreshable auth token of the user', async () => {
		const r = await exchange(t.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		assert.equal(r.data.user.id, anna.id);
		assert.equal(r.data.user.name, 'Anna');
		assert.equal(r.data.expires_in, 60);
		const p = jwtPayload(r.data.token);
		assert.equal(p.id, anna.id);
		assert.equal(p.refreshable, false);
		const left = p.exp - Date.now() / 1000;
		assert.ok(left <= 60 && left > 30, String(left));
		// it acts as Anna: her rules apply (own tokens only)
		const list = await api('GET', '/api/collections/api_tokens/records', null, r.data.token);
		assert.equal(list.status, 200);
		assert.ok(list.data.items.some((x) => x.id === t.id));
		assert.ok(list.data.items.every((x) => x.user === anna.id));
		// and it can't be extended
		assert.equal((await api('POST', '/api/collections/users/auth-refresh', null, r.data.token)).status, 403);
	});

	it('also takes the token in the body', async () => {
		const r = await api('POST', '/api/crm/token-exchange', { token: t.token }, null, { 'X-CRM-MCP-Secret': SECRET });
		assert.equal(r.status, 200);
		assert.equal(r.data.user.id, anna.id);
	});

	it('records when the token was last used', async () => {
		const r = await api('GET', `/api/collections/api_tokens/records/${t.id}`, null, anna.token);
		assert.ok(r.data.last_used, 'set');
		assert.ok(Math.abs(Date.parse(r.data.last_used.replace(' ', 'T')) - Date.now()) < 60_000);
	});

	it('answers 401 for a missing, malformed or unknown token', async () => {
		assert.equal((await api('POST', '/api/crm/token-exchange', null, null, { 'X-CRM-MCP-Secret': SECRET })).status, 401);
		assert.equal((await exchange('crm_short')).status, 401);
		assert.equal((await exchange('x' + t.token.slice(1))).status, 401);
		const unknown = 'crm_' + 'A'.repeat(43);
		assert.equal((await exchange(unknown)).status, 401);
		// a user's normal auth token is not an API token
		assert.equal((await api('POST', '/api/crm/token-exchange', null, anna.token, { 'X-CRM-MCP-Secret': SECRET })).status, 401);
	});

	it('answers 401 once the token is revoked', async () => {
		const r = await newToken(anna, 'Revoke me');
		assert.equal((await exchange(r.token)).status, 200);
		assert.equal((await api('DELETE', `/api/collections/api_tokens/records/${r.id}`, null, anna.token)).status, 204);
		assert.equal((await exchange(r.token)).status, 401);
	});

	it('answers 401 after the user’s password was changed (locking an employee out)', async () => {
		const dora = await createUser(su, 'dora@api.test', 'Dora');
		const r = await newToken(dora, 'Dora');
		assert.equal((await exchange(r.token)).status, 200);
		const pw = 'other-password-5678';
		assert.equal((await api('PATCH', `/api/collections/users/records/${dora.id}`, { password: pw, passwordConfirm: pw }, su)).status, 200);
		assert.equal((await exchange(r.token)).status, 401);
	});

	it('answers 401 after the users token secret was rotated (own server: ends every session)', async () => {
		const other = await startPb({ ...process.env, CRM_MCP_SECRET: SECRET });
		const call = async (method, url, body, token, headers = {}) => {
			const r = await fetch(other.base + url, {
				method,
				headers: { 'content-type': 'application/json', ...(token && { Authorization: token }), ...headers },
				body: body && JSON.stringify(body)
			});
			return { status: r.status, data: await r.json().catch(() => ({})) };
		};
		try {
			const s = (await call('POST', '/api/collections/_superusers/auth-with-password', { identity: SU.email, password: SU.password })).data.token;
			await call('POST', '/api/collections/users/records', { email: 'rot@api.test', password: PASSWORD, passwordConfirm: PASSWORD, name: 'Rot' }, s);
			const user = (await call('POST', '/api/collections/users/auth-with-password', { identity: 'rot@api.test', password: PASSWORD })).data.token;
			const t = (await call('POST', '/api/crm/api-tokens', { name: 'x' }, user)).data;
			const ex = () => call('POST', '/api/crm/token-exchange', null, `Bearer ${t.token}`, { 'X-CRM-MCP-Secret': SECRET });
			assert.equal((await ex()).status, 200);
			const coll = (await call('GET', '/api/collections/users', null, s)).data;
			const patch = await call('PATCH', '/api/collections/users', { authToken: { duration: coll.authToken?.duration || 604800, secret: crypto.randomBytes(32).toString('hex') } }, s);
			assert.equal(patch.status, 200, JSON.stringify(patch.data));
			assert.equal((await ex()).status, 401);
		} finally {
			await stopPb(other);
		}
	});

	it('is rate-limited per token (120 per minute), other tokens unaffected', async () => {
		const limited = await newToken(ben, 'Limited');
		const other = await newToken(ben, 'Other');
		const statuses = [];
		for (let i = 0; i < 121; i++) statuses.push((await exchange(limited.token)).status);
		assert.equal(statuses.filter((s) => s === 200).length, 120);
		assert.equal(statuses[120], 429);
		assert.equal((await exchange(other.token)).status, 200);
	});
});

describe('token exchange: only for the MCP server (shared secret)', () => {
	let t;
	before(async () => {
		t = await newToken(anna, 'Secret');
	});

	it('refuses a missing or wrong secret with 403', async () => {
		assert.equal((await exchange(t.token, null)).status, 403);
		assert.equal((await exchange(t.token, SECRET.slice(0, -1) + 'x')).status, 403);
		assert.equal((await exchange(t.token, SECRET + 'x')).status, 403);
		assert.equal((await exchange(t.token)).status, 200);
	});

	it('is switched off (503) while CRM_MCP_SECRET is not set or too short', async () => {
		for (const value of [undefined, 'short-secret']) {
			const env = { ...process.env };
			delete env.CRM_MCP_SECRET;
			if (value) env.CRM_MCP_SECRET = value;
			const other = await startPb(env);
			try {
				const r = await fetch(other.base + '/api/crm/token-exchange', {
					method: 'POST',
					headers: { Authorization: `Bearer ${t.token}`, 'X-CRM-MCP-Secret': value ?? SECRET }
				});
				assert.equal(r.status, 503, String(value));
			} finally {
				await stopPb(other);
			}
		}
	});
});

describe('agent tokens (from the exchange) may only read', () => {
	let agent;
	let mine;
	let lead;
	let company;
	before(async () => {
		mine = await newToken(anna, 'Agent');
		agent = (await exchange(mine.token)).data.token;
		assert.ok(agent);
		const board = (await api('GET', '/api/collections/boards/records', null, anna.token)).data.items[0];
		const stage = (await api('GET', `/api/collections/board_columns/records?sort=rank&filter=${q(`board="${board.id}"`)}`, null, anna.token)).data.items[0];
		company = (await api('POST', '/api/collections/companies/records', { name: 'Lese GmbH' }, anna.token)).data;
		const contact = (await api('POST', '/api/collections/contacts/records', { last_name: 'Leser', company: company.id }, anna.token)).data;
		lead = (await api('POST', '/api/collections/leads/records', { column: stage.id, title: 'Nur lesen', company: company.id, contacts: [contact.id], owner: anna.id, rank: 'a0' }, anna.token)).data;
		assert.ok(lead.id);
	});

	const refused = (r) => {
		assert.equal(r.status, 403, JSON.stringify(r.data));
		assert.match(r.data.message, /Agent-Zug/);
	};

	it('GET works (lists and single records)', async () => {
		const list = await api('GET', '/api/collections/leads/records', null, agent);
		assert.equal(list.status, 200);
		assert.ok(list.data.items.some((x) => x.id === lead.id));
		assert.equal((await api('GET', `/api/collections/companies/records/${company.id}`, null, agent)).status, 200);
	});

	it('PATCH, DELETE and POST on collections are refused, nothing changes', async () => {
		refused(await api('PATCH', `/api/collections/leads/records/${lead.id}`, { title: 'gehackt' }, agent));
		refused(await api('DELETE', `/api/collections/companies/records/${company.id}`, null, agent));
		refused(await api('POST', '/api/collections/companies/records', { name: 'Neu' }, agent));
		assert.equal((await api('GET', `/api/collections/leads/records/${lead.id}`, null, anna.token)).data.title, 'Nur lesen');
		assert.equal((await api('GET', `/api/collections/companies/records/${company.id}`, null, anna.token)).status, 200);
	});

	it('batch, realtime subscriptions, auth-refresh and file tokens are refused', async () => {
		refused(await api('POST', '/api/batch', { requests: [{ method: 'DELETE', url: `/api/collections/companies/records/${company.id}` }] }, agent));
		refused(await api('POST', '/api/realtime', { clientId: 'x', subscriptions: ['leads'] }, agent));
		refused(await api('POST', '/api/collections/users/auth-refresh', null, agent));
		refused(await api('POST', '/api/files/token', null, agent));
		// own routes too (e.g. creating a lead with checks)
		refused(await api('POST', '/api/crm/leads', { title: 'x' }, agent));
	});

	it('cannot create, rename or revoke API tokens', async () => {
		const before = (await api('GET', '/api/collections/api_tokens/records', null, anna.token)).data.items.length;
		assert.equal((await api('POST', '/api/crm/api-tokens', { name: 'Hintertür' }, agent)).status, 403);
		assert.equal((await api('PATCH', `/api/collections/api_tokens/records/${mine.id}`, { name: 'x' }, agent)).status, 403);
		assert.equal((await api('DELETE', `/api/collections/api_tokens/records/${mine.id}`, null, agent)).status, 403);
		const after = (await api('GET', '/api/collections/api_tokens/records', null, anna.token)).data.items;
		assert.equal(after.length, before);
		assert.equal(after.find((x) => x.id === mine.id).name, 'Agent');
	});

	it('also as "Bearer <token>" (the header form PocketBase accepts too)', async () => {
		refused(await api('PATCH', `/api/collections/leads/records/${lead.id}`, { title: 'x' }, `Bearer ${agent}`));
	});

	it('the api_tokens guards hold on their own (hooks without the middleware)', async () => {
		const dir = fs.mkdtempSync(path.join(PB_DIR, 'pb_test_'));
		for (const f of fs.readdirSync(path.join(PB_DIR, 'pb_hooks'))) {
			let s = fs.readFileSync(path.join(PB_DIR, 'pb_hooks', f), 'utf8');
			if (f === 'api-tokens.pb.js') s = s.slice(0, s.indexOf('routerUse(')) + s.slice(s.indexOf('// explicit'));
			fs.writeFileSync(path.join(dir, f), s);
		}
		const other = await startPb({ ...process.env, CRM_MCP_SECRET: SECRET }, dir);
		try {
			const call = async (method, url, body, token, headers = {}) => {
				const r = await fetch(other.base + url, {
					method,
					headers: { 'content-type': 'application/json', ...(token && { Authorization: token }), ...headers },
					body: body && JSON.stringify(body)
				});
				return { status: r.status, data: await r.json().catch(() => ({})) };
			};
			const s = (await call('POST', '/api/collections/_superusers/auth-with-password', { identity: SU.email, password: SU.password })).data.token;
			await call('POST', '/api/collections/users/records', { email: 'eve@api.test', password: PASSWORD, passwordConfirm: PASSWORD, name: 'Eve' }, s);
			const user = (await call('POST', '/api/collections/users/auth-with-password', { identity: 'eve@api.test', password: PASSWORD })).data.token;
			const t = (await call('POST', '/api/crm/api-tokens', { name: 'x' }, user)).data;
			const ag = (await call('POST', '/api/crm/token-exchange', null, `Bearer ${t.token}`, { 'X-CRM-MCP-Secret': SECRET })).data.token;
			assert.ok(ag);
			assert.equal((await call('POST', '/api/crm/api-tokens', { name: 'y' }, ag)).status, 403);
			assert.equal((await call('PATCH', `/api/collections/api_tokens/records/${t.id}`, { name: 'y' }, ag)).status, 403);
			assert.equal((await call('DELETE', `/api/collections/api_tokens/records/${t.id}`, null, ag)).status, 403);
			assert.equal((await call('PATCH', `/api/collections/api_tokens/records/${t.id}`, { name: 'z' }, user)).status, 200, 'normal session still may');
		} finally {
			await stopPb(other);
			fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		}
	});

	it('deliberately also a superuser’s impersonate token of a user: read only', async () => {
		const r = await api('POST', `/api/collections/users/impersonate/${anna.id}`, { duration: 600 }, su);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		const imp = r.data.token;
		assert.equal(jwtPayload(imp).refreshable, false);
		assert.equal((await api('GET', `/api/collections/leads/records/${lead.id}`, null, imp)).status, 200);
		refused(await api('PATCH', `/api/collections/leads/records/${lead.id}`, { title: 'x' }, imp));
		refused(await api('POST', '/api/crm/api-tokens', { name: 'x' }, imp));
	});

	it('normal logins and superusers are not affected', async () => {
		assert.equal((await api('PATCH', `/api/collections/leads/records/${lead.id}`, { title: 'Nur lesen 2' }, anna.token)).status, 200);
		assert.equal((await api('POST', '/api/files/token', null, anna.token)).status, 200);
		assert.equal((await api('POST', '/api/collections/users/auth-refresh', null, anna.token)).status, 200);
		assert.equal((await api('PATCH', `/api/collections/leads/records/${lead.id}`, { title: 'Nur lesen' }, su)).status, 200);
		assert.equal((await api('POST', '/api/files/token', null, su)).status, 200);
	});
});
