// API integration tests for F13b (migration 1793190007_f13b.js): the batch API for atomic
// re-ranking, and the requirement type (stage_requirements.type) locked after creation.
// Runs against a THROWAWAY PocketBase (own --dir, free port), never against pocketbase/pb_data.
// Same setup as scripts/test-api-gates.mjs. Run: cd web && node --test ../scripts/test-api-f13b.mjs
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
const SU = { email: 'su@api.test', password: 'su-password-1234' };
let BASE;
let dataDir;
let server;

function freePort() {
	return new Promise((resolve, reject) => {
		const srv = net.createServer().once('error', reject);
		srv.listen(0, '127.0.0.1', () => {
			const { port } = srv.address();
			srv.close(() => resolve(port));
		});
	});
}

async function api(method, url, body, token) {
	const res = await fetch(BASE + url, {
		method,
		headers: { ...(body && { 'content-type': 'application/json' }), ...(token && { Authorization: token }) },
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

const q = (s) => encodeURIComponent(s);
const rec = (c, id) => `/api/collections/${c}/records${id ? `/${id}` : ''}`;

let su;
let anna;
let stage;
let company;
let contact;

async function newLead(title) {
	const r = await api('POST', rec('leads'), {
		column: stage.id, title, company: company.id, contacts: [contact.id], owner: anna.id, rank: 'a0'
	}, anna.token);
	assert.equal(r.status, 200, `lead ${title}: ${JSON.stringify(r.data)}`);
	return r.data.id;
}

const rankBatch = (entries) => ({
	requests: entries.map(([id, rank]) => ({ method: 'PATCH', url: `/api/collections/leads/records/${id}`, body: { rank } }))
});

async function ranks(ids) {
	const filter = ids.map((id) => `id="${id}"`).join(' || ');
	const r = await api('GET', `${rec('leads')}?perPage=500&fields=id,rank&filter=${q(filter)}`, null, su);
	assert.equal(r.status, 200);
	return Object.fromEntries(r.data.items.map((l) => [l.id, l.rank]));
}

before(async () => {
	assert.ok(fs.existsSync(BIN), `PocketBase binary missing: ${BIN}`);
	const port = await freePort();
	BASE = `http://127.0.0.1:${port}`;
	dataDir = fs.mkdtempSync(path.join(PB_DIR, 'pb_test_'));
	const common = ['--dir', dataDir, '--migrationsDir', path.join(PB_DIR, 'pb_migrations')];
	execFileSync(BIN, ['superuser', 'upsert', SU.email, SU.password, ...common], { stdio: 'ignore' });
	// --automigrate=false: nothing here may write a migration into the repo (docs/pitfalls/testen.md)
	server = spawn(BIN, ['serve', '--http', `127.0.0.1:${port}`, ...common, '--hooksDir', path.join(PB_DIR, 'pb_hooks'), '--automigrate=false'], {
		stdio: 'ignore'
	});
	for (let i = 0; i < 50; i++) {
		const ok = await fetch(BASE + '/api/health').then((r) => r.ok).catch(() => false);
		if (ok) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	su = await login('_superusers', SU.email, SU.password);
	const password = 'user-password-1234';
	const u = await api('POST', rec('users'), { email: 'anna@api.test', password, passwordConfirm: password, name: 'Anna', verified: true }, su);
	assert.equal(u.status, 200);
	anna = { id: u.data.id, token: await login('users', 'anna@api.test', password) };
	const board = (await api('GET', rec('boards'), null, anna.token)).data.items[0];
	const stages = (await api('GET', `${rec('board_columns')}?filter=${q(`board="${board.id}"`)}`, null, anna.token)).data.items;
	stage = stages.find((s) => s.name === 'Neu');
	assert.ok(stage, 'stage Neu');
	company = (await api('POST', rec('companies'), { name: 'Batch GmbH' }, anna.token)).data;
	contact = (await api('POST', rec('contacts'), { last_name: 'Kontakt', company: company.id }, anna.token)).data;
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

describe('batch API (atomic re-rank)', () => {
	it('settings: on, up to 1000 requests (BATCH_MAX in web/src/lib/optimistic.ts), 10 s timeout', async () => {
		const r = await api('GET', '/api/settings', null, su);
		assert.equal(r.status, 200);
		assert.equal(r.data.batch.enabled, true);
		assert.equal(r.data.batch.maxRequests, 1000);
		assert.equal(r.data.batch.timeout, 10);
	});

	it('is enabled: a signed-in user re-ranks several leads in one request', async () => {
		const a = await newLead('A');
		const b = await newLead('B');
		const r = await api('POST', '/api/batch', rankBatch([[a, 'a1'], [b, 'a2']]), anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		assert.deepEqual(await ranks([a, b]), { [a]: 'a1', [b]: 'a2' });
	});

	it('is all or nothing: one failing request leaves every rank unchanged', async () => {
		const a = await newLead('C');
		const b = await newLead('D');
		const r = await api('POST', '/api/batch', rankBatch([[a, 'a5'], [b, 'a6'], ['doesnotexist123', 'a7']]), anna.token);
		assert.equal(r.status, 400);
		assert.deepEqual(await ranks([a, b]), { [a]: 'a0', [b]: 'a0' });
	});

	it('still applies the API rules: a guest changes nothing', async () => {
		const a = await newLead('E');
		const r = await api('POST', '/api/batch', rankBatch([[a, 'a9']]));
		assert.notEqual(r.status, 200);
		assert.deepEqual(await ranks([a]), { [a]: 'a0' });
	});

	it('takes a whole large stage in one batch (more than the default 50 requests)', async () => {
		const ids = [];
		for (let i = 0; i < 120; i++) ids.push(await newLead(`L${i}`));
		const keys = ids.map((_, i) => `b${String(i).padStart(3, '0')}`);
		const r = await api('POST', '/api/batch', rankBatch(ids.map((id, i) => [id, keys[i]])), anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data).slice(0, 300));
		const got = await ranks(ids);
		assert.deepEqual(ids.map((id) => got[id]), keys);
	});
});

describe('stage_requirements: type is fixed after creation', () => {
	let req;
	before(async () => {
		const r = await api('POST', rec('stage_requirements'), { column: stage.id, label: 'Flagge', type: 'flag', rank: 'a0', hint: '' }, anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		req = r.data;
	});

	it('refuses to switch flag -> text', async () => {
		const r = await api('PATCH', rec('stage_requirements', req.id), { type: 'text' }, anna.token);
		assert.notEqual(r.status, 200);
		const now = await api('GET', rec('stage_requirements', req.id), null, anna.token);
		assert.equal(now.data.type, 'flag');
	});

	it('still saves other fields, also when the unchanged type is sent along', async () => {
		let r = await api('PATCH', rec('stage_requirements', req.id), { label: 'Neu benannt' }, anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		r = await api('PATCH', rec('stage_requirements', req.id), { label: 'Nochmal', type: 'flag' }, anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		assert.equal(r.data.label, 'Nochmal');
	});

	it('keeps the column locked as before', async () => {
		const other = (await api('POST', rec('board_columns'), { board: stage.board, name: 'X', rank: 'z0', color: 'gray' }, anna.token)).data;
		const r = await api('PATCH', rec('stage_requirements', req.id), { column: other.id }, anna.token);
		assert.notEqual(r.status, 200);
	});
});
