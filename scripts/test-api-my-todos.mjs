// API integration tests for F8 ("Meine To-Dos"): the one query and the two realtime
// subscriptions of web/src/lib/todos/mine.svelte.ts behave as the store expects (expand +
// fields on list and realtime, no done filter, lead owner changes). Runs against a THROWAWAY
// PocketBase (own --dir, free port), never against pocketbase/pb_data.
// Run: cd web && node --test ../scripts/test-api-my-todos.mjs
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

// same as MY_TODO_FIELDS / LEAD_FIELDS in mine.svelte.ts
const LEAD_FIELDS = 'id,title,owner,company';
const TODO_FIELDS =
	'id,lead,title,due,due_has_time,done,created,' + LEAD_FIELDS.split(',').map((f) => `expand.lead.${f}`).join(',');

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

async function createUser(su, email, name) {
	const password = 'user-password-1234';
	const r = await api('POST', '/api/collections/users/records', { email, password, passwordConfirm: password, name, verified: true }, su);
	assert.equal(r.status, 200, `create ${email}`);
	return { id: r.data.id, token: await login('users', email, password) };
}

const q = (s) => encodeURIComponent(s);
/** topic with options, as the JS SDK builds it for subscribe(topic, cb, options) */
const topic = (name, query) => `${name}?options=${q(JSON.stringify({ query }))}`;

/** Minimal SSE client for /api/realtime: collects events, `next()` waits for a matching one. */
async function realtime(token, subscriptions) {
	const ctrl = new AbortController();
	const res = await fetch(BASE + '/api/realtime', { signal: ctrl.signal });
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	const events = [];
	const waiters = [];
	let buf = '';
	const deliver = (ev) => {
		events.push(ev);
		for (const w of [...waiters]) if (w.match(ev)) {
			waiters.splice(waiters.indexOf(w), 1);
			w.resolve(ev);
		}
	};
	(async () => {
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) return;
				buf += decoder.decode(value, { stream: true });
				let i;
				while ((i = buf.indexOf('\n\n')) !== -1) {
					const block = buf.slice(0, i);
					buf = buf.slice(i + 2);
					let name = 'message';
					let data = '';
					for (const line of block.split('\n')) {
						if (line.startsWith('event:')) name = line.slice(6).trim();
						else if (line.startsWith('data:')) data += line.slice(5).trim();
					}
					deliver({ name, data: data ? JSON.parse(data) : null });
				}
			}
		} catch {
			// aborted
		}
	})();
	const next = (match, ms = 3000) => {
		const found = events.find(match);
		if (found) {
			events.splice(events.indexOf(found), 1);
			return Promise.resolve(found);
		}
		return new Promise((resolve, reject) => {
			const w = { match, resolve };
			waiters.push(w);
			setTimeout(() => {
				const k = waiters.indexOf(w);
				if (k !== -1) {
					waiters.splice(k, 1);
					reject(new Error('no matching realtime event'));
				}
			}, ms);
		});
	};
	const connect = await next((e) => e.name === 'PB_CONNECT');
	const r = await fetch(BASE + '/api/realtime', {
		method: 'POST',
		headers: { 'content-type': 'application/json', Authorization: token },
		body: JSON.stringify({ clientId: connect.data.clientId, subscriptions })
	});
	assert.equal(r.status, 204, 'subscribed');
	return { next, events, close: () => ctrl.abort() };
}

let su;
let anna;
let ben;
let stages;

async function newLead(token, owner, title) {
	const co = (await api('POST', '/api/collections/companies/records', { name: `${title} GmbH` }, token)).data;
	const ct = (await api('POST', '/api/collections/contacts/records', { last_name: 'Kontakt', company: co.id }, token)).data;
	const ld = (await api('POST', '/api/collections/leads/records', {
		column: stages[0].id, title, company: co.id, contacts: [ct.id], owner, rank: 'a0'
	}, token)).data;
	assert.ok(ld.id, 'lead created');
	return ld;
}

async function newTodo(token, lead, extra = {}) {
	const r = await api('POST', '/api/collections/todos/records', {
		lead, title: 'Anrufen', due: '2026-10-28 00:00:00.000Z', created_by: anna.id, ...extra
	}, token);
	assert.equal(r.status, 200, 'todo created');
	return r.data;
}

before(async () => {
	assert.ok(fs.existsSync(BIN), `PocketBase binary missing: ${BIN}`);
	const port = await freePort();
	BASE = `http://127.0.0.1:${port}`;
	dataDir = fs.mkdtempSync(path.join(PB_DIR, 'pb_test_'));
	const common = ['--dir', dataDir, '--migrationsDir', path.join(PB_DIR, 'pb_migrations')];
	execFileSync(BIN, ['superuser', 'upsert', SU.email, SU.password, ...common], { stdio: 'ignore' });
	server = spawn(BIN, ['serve', '--http', `127.0.0.1:${port}`, ...common, '--hooksDir', path.join(PB_DIR, 'pb_hooks')], {
		stdio: 'ignore'
	});
	for (let i = 0; i < 50; i++) {
		const ok = await fetch(BASE + '/api/health').then((r) => r.ok).catch(() => false);
		if (ok) break;
		await new Promise((r) => setTimeout(r, 200));
	}
	su = await login('_superusers', SU.email, SU.password);
	anna = await createUser(su, 'anna@api.test', 'Anna');
	ben = await createUser(su, 'ben@api.test', 'Ben');
	const board = (await api('GET', '/api/collections/boards/records', null, anna.token)).data.items[0];
	stages = (await api('GET', `/api/collections/board_columns/records?sort=rank&filter=${q(`board="${board.id}"`)}`, null, anna.token)).data.items;
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

describe('my to-dos: the one query', () => {
	let lead;
	let open;
	let done;
	before(async () => {
		lead = await newLead(anna.token, anna.id, 'Abfrage');
		open = await newTodo(anna.token, lead.id);
		done = await newTodo(anna.token, lead.id, { done: true });
	});

	it('returns the open to-dos of everyone with the lead\'s title and owner, nothing more', async () => {
		const r = await api('GET', `/api/collections/todos/records?perPage=500&filter=${q('done = false')}&expand=lead&fields=${q(TODO_FIELDS)}`, null, ben.token);
		assert.equal(r.status, 200);
		const ids = r.data.items.map((t) => t.id);
		assert.ok(ids.includes(open.id));
		assert.ok(!ids.includes(done.id));
		const t = r.data.items.find((x) => x.id === open.id);
		assert.deepEqual(t.expand.lead, { id: lead.id, title: 'Abfrage', owner: anna.id, company: lead.company });
		assert.equal(t.updated, undefined);
		assert.equal(t.done_at, undefined);
	});

	it('guests get nothing', async () => {
		const r = await api('GET', `/api/collections/todos/records?filter=${q('done = false')}&expand=lead`);
		assert.equal(r.data.items?.length ?? 0, 0);
	});
});

describe('my to-dos: realtime', () => {
	let rt;
	let todoTopic;
	let leadTopic;
	before(async () => {
		todoTopic = topic('todos/*', { expand: 'lead', fields: TODO_FIELDS });
		leadTopic = topic('leads/*', { fields: LEAD_FIELDS });
		rt = await realtime(ben.token, [todoTopic, leadTopic]);
	});
	after(() => rt?.close());

	const on = (name, action, id) => (e) => e.name === name && e.data?.action === action && e.data.record.id === id;

	it('a new to-do arrives with the expanded lead (owner) and only the asked fields', async () => {
		const lead = await newLead(anna.token, anna.id, 'Realtime');
		const t = await newTodo(anna.token, lead.id);
		const e = await rt.next(on(todoTopic, 'create', t.id));
		assert.deepEqual(e.data.record.expand.lead, { id: lead.id, title: 'Realtime', owner: anna.id, company: lead.company });
		assert.equal(e.data.record.updated, undefined);
	});

	it('ticking off arrives (no done filter on the subscription)', async () => {
		const lead = await newLead(anna.token, anna.id, 'Abhaken');
		const t = await newTodo(anna.token, lead.id);
		await rt.next(on(todoTopic, 'create', t.id));
		await api('PATCH', `/api/collections/todos/records/${t.id}`, { done: true, done_at: '2026-10-28 10:00:00.000Z' }, anna.token);
		const e = await rt.next(on(todoTopic, 'update', t.id));
		assert.equal(e.data.record.done, true);
	});

	it('a new owner of the lead arrives on the lead subscription (the to-do sends nothing)', async () => {
		const lead = await newLead(anna.token, anna.id, 'Übergabe');
		const t = await newTodo(anna.token, lead.id);
		await rt.next(on(todoTopic, 'create', t.id));
		await rt.next(on(leadTopic, 'create', lead.id));
		await api('PATCH', `/api/collections/leads/records/${lead.id}`, { owner: ben.id }, anna.token);
		const e = await rt.next(on(leadTopic, 'update', lead.id));
		assert.deepEqual(e.data.record, { id: lead.id, title: 'Übergabe', owner: ben.id, company: lead.company });
		await assert.rejects(rt.next(on(todoTopic, 'update', t.id), 500));
	});

	it('deleting a lead sends its delete (the store drops the to-dos itself)', async () => {
		const lead = await newLead(anna.token, anna.id, 'Weg');
		const t = await newTodo(anna.token, lead.id);
		await rt.next(on(todoTopic, 'create', t.id));
		assert.equal((await api('DELETE', `/api/collections/leads/records/${lead.id}`, null, anna.token)).status, 204);
		await rt.next(on(leadTopic, 'delete', lead.id));
		const gone = await api('GET', `/api/collections/todos/records/${t.id}`, null, anna.token);
		assert.equal(gone.status, 404, 'cascade');
	});
});
