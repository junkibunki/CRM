// API integration tests for F3 (collection `activities`): rules, author enforcement,
// protected attachments, cascade. Runs against a THROWAWAY PocketBase (own --dir, free
// port), never against pocketbase/pb_data. Same setup as scripts/test-api.mjs.
// Run: cd web && node --test ../scripts/test-api-activities.mjs
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
	const isForm = body instanceof FormData;
	const res = await fetch(BASE + url, {
		method,
		headers: { ...(!isForm && body && { 'content-type': 'application/json' }), ...(token && { Authorization: token }) },
		body: isForm ? body : body && JSON.stringify(body)
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

let su;
let anna; // author
let ben; // another logged-in user
let leadId;
let contactId;

const now = () => new Date().toISOString().replace('T', ' ');
const activity = (extra = {}) => ({
	lead: leadId,
	type: 'note',
	subject: 'Test',
	body: '<p>Inhalt</p>',
	occurred_at: now(),
	author: anna.id,
	...extra
});

async function newLead(token) {
	const board = (await api('GET', '/api/collections/boards/records', null, token)).data.items[0];
	const stage = (await api('GET', `/api/collections/board_columns/records?filter=${encodeURIComponent(`board="${board.id}"`)}`, null, token)).data.items[0];
	const co = (await api('POST', '/api/collections/companies/records', { name: 'Akt GmbH' }, token)).data;
	const ct = (await api('POST', '/api/collections/contacts/records', { last_name: 'Kontakt', company: co.id }, token)).data;
	const ld = (await api('POST', '/api/collections/leads/records', {
		column: stage.id, title: 'Akt-Lead', company: co.id, contacts: [ct.id], owner: anna.id, rank: 'a0'
	}, token)).data;
	assert.ok(ld.id, 'lead created');
	return { lead: ld.id, contact: ct.id };
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
	({ lead: leadId, contact: contactId } = await newLead(anna.token));
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

describe('activities: guests', () => {
	let id;
	before(async () => {
		id = (await api('POST', '/api/collections/activities/records', activity(), anna.token)).data.id;
		assert.ok(id);
	});

	it('cannot list or view (the superuser sees data)', async () => {
		assert.ok((await api('GET', '/api/collections/activities/records', null, su)).data.items.length > 0);
		const list = await api('GET', '/api/collections/activities/records');
		assert.equal(list.status, 200);
		assert.equal(list.data.items.length, 0);
		assert.equal((await api('GET', `/api/collections/activities/records/${id}`)).status, 404);
	});

	it('cannot create, update or delete', async () => {
		assert.ok((await api('POST', '/api/collections/activities/records', activity())).status >= 400);
		assert.ok((await api('PATCH', `/api/collections/activities/records/${id}`, { subject: 'x' })).status >= 400);
		assert.ok((await api('DELETE', `/api/collections/activities/records/${id}`)).status >= 400);
		const still = await api('GET', `/api/collections/activities/records/${id}`, null, su);
		assert.equal(still.data.subject, 'Test');
	});
});

describe('activities: author', () => {
	it('is the creating user', async () => {
		const r = await api('POST', '/api/collections/activities/records', activity({ contacts: [contactId] }), anna.token);
		assert.equal(r.status, 200);
		assert.equal(r.data.author, anna.id);
	});

	it('cannot be someone else', async () => {
		const before = (await api('GET', '/api/collections/activities/records', null, su)).data.totalItems;
		const r = await api('POST', '/api/collections/activities/records', activity({ author: ben.id }), anna.token);
		assert.ok(r.status >= 400, `status ${r.status}`);
		assert.equal((await api('GET', '/api/collections/activities/records', null, su)).data.totalItems, before);
	});

	it('cannot be left out', async () => {
		const { author, ...rest } = activity();
		assert.ok(author);
		const r = await api('POST', '/api/collections/activities/records', rest, anna.token);
		assert.ok(r.status >= 400, `status ${r.status}`);
	});

	it('stays unchanged when another user edits; any user may edit', async () => {
		const id = (await api('POST', '/api/collections/activities/records', activity(), anna.token)).data.id;
		const r = await api('PATCH', `/api/collections/activities/records/${id}`, { body: '<p>von Ben</p>' }, ben.token);
		assert.equal(r.status, 200);
		assert.equal(r.data.body, '<p>von Ben</p>');
		assert.equal(r.data.author, anna.id);
	});

	it('cannot be changed (not even to oneself), resending the same value is fine', async () => {
		const id = (await api('POST', '/api/collections/activities/records', activity(), anna.token)).data.id;
		assert.ok((await api('PATCH', `/api/collections/activities/records/${id}`, { author: ben.id }, ben.token)).status >= 400);
		assert.ok((await api('PATCH', `/api/collections/activities/records/${id}`, { author: ben.id }, anna.token)).status >= 400);
		const same = await api('PATCH', `/api/collections/activities/records/${id}`, { author: anna.id, subject: 'gleich' }, ben.token);
		assert.equal(same.status, 200);
		const rec = await api('GET', `/api/collections/activities/records/${id}`, null, su);
		assert.equal(rec.data.author, anna.id);
	});

	it('any user may delete', async () => {
		const id = (await api('POST', '/api/collections/activities/records', activity(), anna.token)).data.id;
		assert.equal((await api('DELETE', `/api/collections/activities/records/${id}`, null, ben.token)).status, 204);
	});
});

describe('activities: lead', () => {
	it('cannot be changed to another lead; resending the same value is fine', async () => {
		const id = (await api('POST', '/api/collections/activities/records', activity(), anna.token)).data.id;
		const other = await newLead(anna.token);
		for (const body of [{ lead: other.lead }, { lead: other.lead, subject: 'verschoben' }, { 'lead+': other.lead }]) {
			const r = await api('PATCH', `/api/collections/activities/records/${id}`, body, ben.token);
			assert.ok(r.status >= 400, `${JSON.stringify(body)}: status ${r.status}`);
		}
		// `+lead` (prepend) passes the rule on a single relation, but keeps the last value
		await api('PATCH', `/api/collections/activities/records/${id}`, { '+lead': other.lead }, ben.token);
		assert.equal((await api('GET', `/api/collections/activities/records/${id}`, null, su)).data.lead, leadId);
		const fd = new FormData();
		fd.append('lead', other.lead);
		assert.ok((await api('PATCH', `/api/collections/activities/records/${id}`, fd, anna.token)).status >= 400);
		const same = await api('PATCH', `/api/collections/activities/records/${id}`, { lead: leadId, subject: 'gleich' }, ben.token);
		assert.equal(same.status, 200);
		const rec = await api('GET', `/api/collections/activities/records/${id}`, null, su);
		assert.equal(rec.data.lead, leadId);
		assert.equal(rec.data.subject, 'gleich');
	});
});

describe('activities: validation', () => {
	it('requires lead, a known type, body and occurred_at', async () => {
		for (const bad of [{ lead: '' }, { type: 'call' }, { body: '' }, { occurred_at: '' }]) {
			const r = await api('POST', '/api/collections/activities/records', activity(bad), anna.token);
			assert.equal(r.status, 400, JSON.stringify(bad));
		}
	});

	it('accepts all four types', async () => {
		for (const type of ['note', 'meeting', 'email_in', 'email_out']) {
			assert.equal((await api('POST', '/api/collections/activities/records', activity({ type }), anna.token)).status, 200, type);
		}
	});

	it('filters by lead (what the client loads)', async () => {
		const other = await newLead(anna.token);
		await api('POST', '/api/collections/activities/records', activity({ lead: other.lead, subject: 'anderer Lead' }), anna.token);
		const r = await api('GET', `/api/collections/activities/records?perPage=500&filter=${encodeURIComponent(`lead="${leadId}"`)}`, null, ben.token);
		assert.ok(r.data.items.length > 0);
		assert.ok(r.data.items.every((a) => a.lead === leadId));
	});
});

describe('activities: protected attachments', () => {
	let rec;
	before(async () => {
		const fd = new FormData();
		for (const [k, v] of Object.entries(activity())) fd.append(k, v);
		fd.append('attachments', new Blob(['Protokoll-Inhalt'], { type: 'text/plain' }), 'Protokoll.txt');
		fd.append('attachments', new Blob(['zweite'], { type: 'text/plain' }), 'Zweite.txt');
		const r = await api('POST', '/api/collections/activities/records', fd, anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		rec = r.data;
		assert.equal(rec.attachments.length, 2);
	});

	const fileUrl = (name) => `${BASE}/api/files/activities/${rec.id}/${name}`;

	it('cannot be downloaded without a file token', async () => {
		assert.equal((await fetch(fileUrl(rec.attachments[0]))).status, 404);
		// the auth token alone is not enough either
		assert.equal((await fetch(fileUrl(rec.attachments[0]), { headers: { Authorization: anna.token } })).status, 404);
	});

	it('can be downloaded by any logged-in user with a file token; HEAD gives the size', async () => {
		const { token } = (await api('POST', '/api/files/token', null, ben.token)).data;
		const get = await fetch(`${fileUrl(rec.attachments[0])}?token=${token}`);
		assert.equal(get.status, 200);
		assert.equal(await get.text(), 'Protokoll-Inhalt');
		const head = await fetch(`${fileUrl(rec.attachments[0])}?token=${token}`, { method: 'HEAD' });
		assert.equal(head.headers.get('content-length'), String('Protokoll-Inhalt'.length));
	});

	it('a guest gets no file token', async () => {
		const r = await api('POST', '/api/files/token');
		assert.ok(r.status >= 400 || !r.data.token, `status ${r.status}`);
	});

	it('can be added and removed with attachments+ / attachments-', async () => {
		const fd = new FormData();
		fd.append('attachments+', new Blob(['neu'], { type: 'text/plain' }), 'Neu.txt');
		fd.append('attachments-', rec.attachments[1]);
		const r = await api('PATCH', `/api/collections/activities/records/${rec.id}`, fd, ben.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		assert.equal(r.data.attachments.length, 2);
		assert.equal(r.data.attachments[0], rec.attachments[0]);
		assert.ok(!r.data.attachments.includes(rec.attachments[1]));
		assert.equal(r.data.author, anna.id);
	});
});

describe('activities: deleting', () => {
	it('a lead deletes its activities (cascade)', async () => {
		const l = await newLead(anna.token);
		const id = (await api('POST', '/api/collections/activities/records', activity({ lead: l.lead }), anna.token)).data.id;
		assert.equal((await api('DELETE', `/api/collections/leads/records/${l.lead}`, null, anna.token)).status, 204);
		assert.equal((await api('GET', `/api/collections/activities/records/${id}`, null, su)).status, 404);
	});

	it('a contact can be deleted; it just disappears from the activity', async () => {
		// the lead needs another contact, its only one can't be deleted
		const l = await newLead(anna.token);
		const lead = (await api('GET', `/api/collections/leads/records/${l.lead}`, null, anna.token)).data;
		const extra = (await api('POST', '/api/collections/contacts/records', { last_name: 'Extra', company: lead.company }, anna.token)).data;
		const id = (await api('POST', '/api/collections/activities/records', activity({ lead: l.lead, contacts: [extra.id, l.contact] }), anna.token)).data.id;
		assert.equal((await api('DELETE', `/api/collections/contacts/records/${extra.id}`, null, anna.token)).status, 204);
		const rec = await api('GET', `/api/collections/activities/records/${id}`, null, anna.token);
		assert.deepEqual(rec.data.contacts, [l.contact]);
	});
});
