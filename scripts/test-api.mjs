// API integration tests: rules, migrations and delete behaviour against a THROWAWAY
// PocketBase (own temp --dir, own port) — never against pocketbase/pb_data.
// Run: cd web && npm run test:api   (needs the PocketBase binary, scripts/get-pocketbase.sh)
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PB_DIR = path.join(ROOT, 'pocketbase');
const BIN = path.join(PB_DIR, process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
let PORT;
let BASE;

/** a port that is free right now (parallel agents may run test:api at the same time) */
function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer().once('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});
}
const SU = { email: 'su@api.test', password: 'su-password-1234' };

let dataDir;
let server;

async function api(method, url, body, token) {
	const res = await fetch(BASE + url, {
		method,
		headers: { 'content-type': 'application/json', ...(token && { Authorization: token }) },
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

let su; // superuser token
let user; // normal user token
let userId;
let seeded; // collection -> id of a record created as superuser

before(async () => {
	assert.ok(fs.existsSync(BIN), `PocketBase binary missing: ${BIN}`);
	PORT = await freePort();
	BASE = `http://127.0.0.1:${PORT}`;
	// inside the repo (gitignored): the system temp dir may be off-limits (sandbox)
	dataDir = fs.mkdtempSync(path.join(PB_DIR, 'pb_test_'));
	const common = ['--dir', dataDir, '--migrationsDir', path.join(PB_DIR, 'pb_migrations')];
	execFileSync(BIN, ['superuser', 'upsert', SU.email, SU.password, ...common], { stdio: 'ignore' });
	server = spawn(BIN, ['serve', '--http', `127.0.0.1:${PORT}`, ...common, '--hooksDir', path.join(PB_DIR, 'pb_hooks')], {
		stdio: 'ignore'
	});
	for (let i = 0; i < 50; i++) {
		const ok = await fetch(BASE + '/api/health').then((r) => r.ok).catch(() => false);
		if (ok) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	su = await login('_superusers', SU.email, SU.password);
	const u = await api('POST', '/api/collections/users/records', {
		email: 'user@api.test',
		password: 'user-password-1234',
		passwordConfirm: 'user-password-1234',
		name: 'API User',
		verified: true
	}, su);
	assert.equal(u.status, 200);
	userId = u.data.id;
	user = await login('users', 'user@api.test', 'user-password-1234');

	// one record in every collection, created as superuser: a guest seeing an empty list
	// only proves something if there is data to see
	const board = (await api('GET', '/api/collections/boards/records', null, su)).data.items[0];
	const stage = (await api('GET', `/api/collections/board_columns/records?filter=${encodeURIComponent(`board="${board.id}"`)}`, null, su)).data.items[0];
	const co = (await api('POST', '/api/collections/companies/records', { name: 'Seed GmbH' }, su)).data;
	const ct = (await api('POST', '/api/collections/contacts/records', { last_name: 'Seed', company: co.id }, su)).data;
	const ld = (await api('POST', '/api/collections/leads/records', {
		column: stage.id, title: 'Seed', company: co.id, contacts: [ct.id], owner: userId, rank: 'a0'
	}, su)).data;
	seeded = { companies: co.id, contacts: ct.id, boards: board.id, board_columns: stage.id, leads: ld.id, users: userId };
	for (const [c, id] of Object.entries(seeded)) assert.ok(id, `seed ${c}`);
});

after(async () => {
	// wait for the process to exit: on Windows it still holds the db files right after kill()
	if (server && server.exitCode === null) {
		const exited = new Promise((r) => server.once('exit', r));
		server.kill();
		await exited;
	}
	if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const COLLECTIONS = ['companies', 'contacts', 'boards', 'board_columns', 'leads', 'users'];

describe('guests', () => {
	for (const c of COLLECTIONS) {
		it(`cannot list ${c} (the superuser sees data there)`, async () => {
			assert.ok((await api('GET', `/api/collections/${c}/records`, null, su)).data.items.length > 0);
			const r = await api('GET', `/api/collections/${c}/records`);
			assert.equal(r.status, 200);
			assert.equal(r.data.items.length, 0);
		});

		it(`cannot view, update or delete ${c}`, async () => {
			const url = `/api/collections/${c}/records/${seeded[c]}`;
			assert.equal((await api('GET', url)).status, 404);
			assert.ok((await api('PATCH', url, { name: 'x', title: 'x' })).status >= 400);
			assert.ok((await api('DELETE', url)).status >= 400);
			// still there
			assert.equal((await api('GET', url, null, su)).status, 200);
		});
	}

	it('cannot create records', async () => {
		const r = await api('POST', '/api/collections/companies/records', { name: 'x' });
		assert.ok(r.status >= 400, `status ${r.status}`);
	});

	it('cannot sign up', async () => {
		const r = await api('POST', '/api/collections/users/records', {
			email: 'new@api.test',
			password: 'abcdefgh1234',
			passwordConfirm: 'abcdefgh1234'
		});
		assert.ok(r.status >= 400, `status ${r.status}`);
	});
});

describe('users', () => {
	it('cannot create users', async () => {
		const r = await api('POST', '/api/collections/users/records', {
			email: 'other@api.test',
			password: 'abcdefgh1234',
			passwordConfirm: 'abcdefgh1234'
		}, user);
		assert.equal(r.status, 403);
	});

	it('cannot delete their own account', async () => {
		const r = await api('DELETE', `/api/collections/users/records/${userId}`, null, user);
		assert.equal(r.status, 403);
	});

	it('can edit their own name', async () => {
		const r = await api('PATCH', `/api/collections/users/records/${userId}`, { name: 'Neu' }, user);
		assert.equal(r.status, 200);
	});

	it('cannot create or delete boards', async () => {
		assert.equal((await api('POST', '/api/collections/boards/records', { name: 'x' }, user)).status, 403);
		const board = (await api('GET', '/api/collections/boards/records', null, user)).data.items[0];
		assert.ok(board, 'migration seeds the Leads pipeline');
		assert.equal((await api('DELETE', `/api/collections/boards/records/${board.id}`, null, user)).status, 403);
	});
});

describe('delete protection', () => {
	let company, c1, c2, lead;

	before(async () => {
		const board = (await api('GET', '/api/collections/boards/records', null, user)).data.items[0];
		const stage = (await api('GET', `/api/collections/board_columns/records?filter=${encodeURIComponent(`board="${board.id}"`)}`, null, user)).data.items[0];
		company = (await api('POST', '/api/collections/companies/records', { name: 'Test GmbH' }, user)).data;
		c1 = (await api('POST', '/api/collections/contacts/records', { last_name: 'Eins', company: company.id }, user)).data;
		c2 = (await api('POST', '/api/collections/contacts/records', { last_name: 'Zwei', company: company.id }, user)).data;
		lead = (await api('POST', '/api/collections/leads/records', {
			column: stage.id, title: 'L', company: company.id, contacts: [c1.id, c2.id], owner: userId, rank: 'a0'
		}, user)).data;
		assert.ok(lead.id, 'lead created');
	});

	it('a lead needs at least one contact', async () => {
		const r = await api('PATCH', `/api/collections/leads/records/${lead.id}`, { contacts: [] }, user);
		assert.equal(r.status, 400);
	});

	it('a company used by a lead cannot be deleted', async () => {
		const r = await api('DELETE', `/api/collections/companies/records/${company.id}`, null, user);
		assert.equal(r.status, 400);
	});

	it('deleting one of several contacts removes it from the lead', async () => {
		assert.equal((await api('DELETE', `/api/collections/contacts/records/${c2.id}`, null, user)).status, 204);
		const l = await api('GET', `/api/collections/leads/records/${lead.id}`, null, user);
		assert.deepEqual(l.data.contacts, [c1.id]);
	});

	it("a lead's only contact cannot be deleted", async () => {
		const r = await api('DELETE', `/api/collections/contacts/records/${c1.id}`, null, user);
		assert.equal(r.status, 400);
	});
});
