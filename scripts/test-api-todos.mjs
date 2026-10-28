// API integration tests for F7 (collection `todos`, `board_columns.closed`, card field
// `next_todo`) and F4 (view `lead_last_activity`). Runs against a THROWAWAY PocketBase (own
// --dir, free port), never against pocketbase/pb_data. Same setup as scripts/test-api.mjs.
// Run: cd web && node --test ../scripts/test-api-todos.mjs
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

async function createUser(su, email, name) {
	const password = 'user-password-1234';
	const r = await api('POST', '/api/collections/users/records', { email, password, passwordConfirm: password, name, verified: true }, su);
	assert.equal(r.status, 200, `create ${email}`);
	return { id: r.data.id, token: await login('users', email, password) };
}

const q = (s) => encodeURIComponent(s);

let su;
let anna;
let ben;
let board;
let stages;

async function newLead(token, title = 'Todo-Lead') {
	const co = (await api('POST', '/api/collections/companies/records', { name: 'Todo GmbH' }, token)).data;
	const ct = (await api('POST', '/api/collections/contacts/records', { last_name: 'Kontakt', company: co.id }, token)).data;
	const ld = (await api('POST', '/api/collections/leads/records', {
		column: stages[0].id, title, company: co.id, contacts: [ct.id], owner: anna.id, rank: 'a0'
	}, token)).data;
	assert.ok(ld.id, 'lead created');
	return ld.id;
}

async function newNote(token, lead, extra = {}) {
	const r = await api('POST', '/api/collections/activities/records', {
		lead, type: 'note', subject: 'Notiz', body: '<p>Inhalt</p>', occurred_at: '2026-10-01 10:00:00.000Z', author: anna.id, ...extra
	}, token);
	assert.equal(r.status, 200, 'note created');
	return r.data;
}

const todoBody = (lead, extra = {}) => ({
	lead, title: 'Anrufen', due: '2026-10-28 00:00:00.000Z', created_by: anna.id, ...extra
});

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
	board = (await api('GET', '/api/collections/boards/records', null, anna.token)).data.items[0];
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

describe('migration: closed stages and card field', () => {
	it('marks "Gewonnen" and "Verloren" as closed, the other stages not', () => {
		const closed = Object.fromEntries(stages.map((s) => [s.name, s.closed]));
		assert.deepEqual(closed, {
			Neu: false, Qualifiziert: false, Angebot: false, Verhandlung: false, Gewonnen: true, Verloren: true
		});
	});

	it('shows the next to-do on the existing pipeline', () => {
		assert.ok(board.card_fields.includes('next_todo'), JSON.stringify(board.card_fields));
		assert.equal(board.card_fields.filter((f) => f === 'next_todo').length, 1);
	});

	it('lets a logged-in user switch a stage to closed and back', async () => {
		const r = await api('PATCH', `/api/collections/board_columns/records/${stages[0].id}`, { closed: true }, ben.token);
		assert.equal(r.status, 200);
		assert.equal(r.data.closed, true);
		await api('PATCH', `/api/collections/board_columns/records/${stages[0].id}`, { closed: false }, ben.token);
	});
});

describe('todos: guests', () => {
	let lead;
	let id;
	before(async () => {
		lead = await newLead(anna.token);
		id = (await api('POST', '/api/collections/todos/records', todoBody(lead), anna.token)).data.id;
		assert.ok(id);
	});

	it('see nothing', async () => {
		const list = await api('GET', '/api/collections/todos/records');
		assert.equal(list.data.items?.length ?? 0, 0);
		assert.equal((await api('GET', `/api/collections/todos/records/${id}`)).status, 404);
	});

	it('can neither create, edit nor delete', async () => {
		assert.notEqual((await api('POST', '/api/collections/todos/records', todoBody(lead))).status, 200);
		assert.notEqual((await api('PATCH', `/api/collections/todos/records/${id}`, { title: 'x' })).status, 200);
		assert.notEqual((await api('DELETE', `/api/collections/todos/records/${id}`)).status, 204);
	});
});

describe('todos: rules for logged-in users', () => {
	let lead;
	before(async () => {
		lead = await newLead(anna.token);
	});

	it('creates with optional time, open by default', async () => {
		const r = await api('POST', '/api/collections/todos/records', todoBody(lead, { due: '2026-10-28 13:30:00.000Z', due_has_time: true }), anna.token);
		assert.equal(r.status, 200);
		assert.equal(r.data.done, false);
		assert.equal(r.data.done_at, '');
		assert.equal(r.data.due_has_time, true);
		assert.equal(r.data.due, '2026-10-28 13:30:00.000Z');
	});

	it('requires title and due date, title at most 300 characters', async () => {
		const noTitle = await api('POST', '/api/collections/todos/records', todoBody(lead, { title: '' }), anna.token);
		assert.equal(noTitle.status, 400);
		assert.ok(noTitle.data.data.title);
		const noDue = await api('POST', '/api/collections/todos/records', todoBody(lead, { due: '' }), anna.token);
		assert.equal(noDue.status, 400);
		assert.ok(noDue.data.data.due);
		const long = await api('POST', '/api/collections/todos/records', todoBody(lead, { title: 'x'.repeat(301) }), anna.token);
		assert.equal(long.status, 400);
	});

	it('created_by must be the creating user', async () => {
		const forged = await api('POST', '/api/collections/todos/records', todoBody(lead, { created_by: ben.id }), anna.token);
		assert.equal(forged.status, 400);
		const missing = await api('POST', '/api/collections/todos/records', todoBody(lead, { created_by: '' }), anna.token);
		assert.equal(missing.status, 400);
	});

	it('everybody may edit and tick off any to-do; created_by and lead stay', async () => {
		const id = (await api('POST', '/api/collections/todos/records', todoBody(lead), anna.token)).data.id;
		const done = await api('PATCH', `/api/collections/todos/records/${id}`, { done: true, done_at: '2026-10-28 09:00:00.000Z', title: 'Von Ben' }, ben.token);
		assert.equal(done.status, 200);
		assert.equal(done.data.done, true);
		assert.equal(done.data.title, 'Von Ben');

		const owner = await api('PATCH', `/api/collections/todos/records/${id}`, { created_by: ben.id }, ben.token);
		assert.notEqual(owner.status, 200);
		const other = await newLead(anna.token, 'Anderer Lead');
		const moved = await api('PATCH', `/api/collections/todos/records/${id}`, { lead: other }, ben.token);
		assert.notEqual(moved.status, 200);
		const same = await api('PATCH', `/api/collections/todos/records/${id}`, { lead, created_by: anna.id, title: 'ok' }, ben.token);
		assert.equal(same.status, 200, 'sending the unchanged values is fine');
		const now = (await api('GET', `/api/collections/todos/records/${id}`, null, anna.token)).data;
		assert.equal(now.created_by, anna.id);
		assert.equal(now.lead, lead);
	});

	it('everybody may delete', async () => {
		const id = (await api('POST', '/api/collections/todos/records', todoBody(lead), anna.token)).data.id;
		assert.equal((await api('DELETE', `/api/collections/todos/records/${id}`, null, ben.token)).status, 204);
	});
});

describe('todos: made from a note (source_activity)', () => {
	let lead;
	let note;
	before(async () => {
		lead = await newLead(anna.token);
		note = await newNote(anna.token, lead);
	});

	it('links a note of the same lead, not one of another lead', async () => {
		const ok = await api('POST', '/api/collections/todos/records', todoBody(lead, { source_activity: note.id }), anna.token);
		assert.equal(ok.status, 200);
		assert.equal(ok.data.source_activity, note.id);
		const otherLead = await newLead(anna.token, 'Fremd');
		const foreign = await newNote(anna.token, otherLead);
		const bad = await api('POST', '/api/collections/todos/records', todoBody(lead, { source_activity: foreign.id }), anna.token);
		assert.equal(bad.status, 400);
	});

	it('the link can be cleared but not pointed at another note', async () => {
		const id = (await api('POST', '/api/collections/todos/records', todoBody(lead, { source_activity: note.id }), anna.token)).data.id;
		const second = await newNote(anna.token, lead);
		const swap = await api('PATCH', `/api/collections/todos/records/${id}`, { source_activity: second.id }, anna.token);
		assert.notEqual(swap.status, 200);
		const clear = await api('PATCH', `/api/collections/todos/records/${id}`, { source_activity: '' }, anna.token);
		assert.equal(clear.status, 200);
		assert.equal(clear.data.source_activity, '');
	});

	it('expands the note with only the listed fields', async () => {
		const fields = '*,expand.source_activity.id,expand.source_activity.occurred_at';
		const r = await api('GET', `/api/collections/todos/records?filter=${q(`source_activity="${note.id}"`)}&expand=source_activity&fields=${q(fields)}`, null, anna.token);
		assert.equal(r.status, 200);
		const ex = r.data.items[0].expand.source_activity;
		assert.deepEqual(Object.keys(ex).sort(), ['id', 'occurred_at']);
	});

	it('deleting the note keeps the to-do and clears the link', async () => {
		const n = await newNote(anna.token, lead);
		const id = (await api('POST', '/api/collections/todos/records', todoBody(lead, { source_activity: n.id }), anna.token)).data.id;
		assert.equal((await api('DELETE', `/api/collections/activities/records/${n.id}`, null, ben.token)).status, 204);
		const t = await api('GET', `/api/collections/todos/records/${id}`, null, anna.token);
		assert.equal(t.status, 200);
		assert.equal(t.data.source_activity, '');
	});
});

describe('todos: board query and cascade', () => {
	it('one query finds the open to-dos of the pipeline', async () => {
		const lead = await newLead(anna.token, 'Board-Lead');
		const open = (await api('POST', '/api/collections/todos/records', todoBody(lead, { title: 'offen' }), anna.token)).data.id;
		const done = (await api('POST', '/api/collections/todos/records', todoBody(lead, { title: 'erledigt', done: true }), anna.token)).data.id;
		const filter = q(`done = false && lead.column.board = "${board.id}"`);
		const r = await api('GET', `/api/collections/todos/records?perPage=500&filter=${filter}&fields=id,lead,title,due,due_has_time,created`, null, ben.token);
		assert.equal(r.status, 200);
		const ids = r.data.items.map((t) => t.id);
		assert.ok(ids.includes(open));
		assert.ok(!ids.includes(done));
		assert.deepEqual(Object.keys(r.data.items[0]).sort(), ['created', 'due', 'due_has_time', 'id', 'lead', 'title']);
	});

	it('deleting a lead deletes its to-dos', async () => {
		const lead = await newLead(anna.token, 'Wird gelöscht');
		const id = (await api('POST', '/api/collections/todos/records', todoBody(lead), anna.token)).data.id;
		assert.equal((await api('DELETE', `/api/collections/leads/records/${lead}`, null, anna.token)).status, 204);
		assert.equal((await api('GET', `/api/collections/todos/records/${id}`, null, anna.token)).status, 404);
	});

	it('an account with to-dos cannot be deleted (created_by is required)', async () => {
		const carl = await createUser(su, 'carl@api.test', 'Carl');
		const lead = await newLead(anna.token, 'Carls Lead');
		const r = await api('POST', '/api/collections/todos/records', todoBody(lead, { created_by: carl.id }), carl.token);
		assert.equal(r.status, 200);
		assert.equal((await api('DELETE', `/api/collections/users/records/${carl.id}`, null, su)).status, 400);
	});
});

describe('view lead_last_activity (F4)', () => {
	let lead;
	let latest;
	before(async () => {
		lead = await newLead(anna.token, 'Aktivitäten-Lead');
		await newNote(anna.token, lead, { subject: 'alt', occurred_at: '2026-10-01 10:00:00.000Z' });
		latest = await newNote(anna.token, lead, {
			type: 'meeting', subject: '', body: '<h2>Agenda</h2><p>Punkt eins und zwei</p>', occurred_at: '2026-10-20 10:00:00.000Z'
		});
		// entered later, but happened earlier: not the latest
		await newNote(anna.token, lead, { subject: 'nachgetragen', occurred_at: '2026-10-05 10:00:00.000Z' });
	});

	it('is closed to guests', async () => {
		const r = await api('GET', '/api/collections/lead_last_activity/records');
		assert.equal(r.data.items?.length ?? 0, 0);
	});

	it('has one row per lead: the activity that happened last', async () => {
		const r = await api('GET', `/api/collections/lead_last_activity/records?filter=${q(`lead = "${lead}"`)}`, null, ben.token);
		assert.equal(r.status, 200);
		assert.equal(r.data.items.length, 1);
		assert.equal(r.data.items[0].id, latest.id);
		assert.equal(r.data.items[0].type, 'meeting');
	});

	it('on equal times the one entered last wins', async () => {
		const l = await newLead(anna.token, 'Gleichstand');
		await newNote(anna.token, l, { subject: 'erste', occurred_at: '2026-10-10 10:00:00.000Z' });
		const second = await newNote(anna.token, l, { subject: 'zweite', occurred_at: '2026-10-10 10:00:00.000Z' });
		const r = await api('GET', `/api/collections/lead_last_activity/records?filter=${q(`lead = "${l}"`)}`, null, ben.token);
		assert.equal(r.data.items[0].id, second.id);
	});

	it('is filtered through the lead to the pipeline (one query) and gives a text excerpt', async () => {
		const fields = 'id,lead,type,subject,occurred_at,created,body:excerpt(80,true)';
		const r = await api('GET', `/api/collections/lead_last_activity/records?perPage=500&filter=${q(`lead.column.board = "${board.id}"`)}&fields=${q(fields)}`, null, ben.token);
		assert.equal(r.status, 200);
		const row = r.data.items.find((x) => x.lead === lead);
		assert.ok(row);
		assert.equal(row.body, 'Agenda Punkt eins und zwei');
	});

	it('follows deletes: the previous activity becomes the latest', async () => {
		assert.equal((await api('DELETE', `/api/collections/activities/records/${latest.id}`, null, anna.token)).status, 204);
		const r = await api('GET', `/api/collections/lead_last_activity/records?filter=${q(`lead = "${lead}"`)}`, null, ben.token);
		assert.equal(r.data.items[0].subject, 'nachgetragen');
	});

	it('cannot be written', async () => {
		const r = await api('POST', '/api/collections/lead_last_activity/records', { lead }, anna.token);
		assert.notEqual(r.status, 200);
	});
});
