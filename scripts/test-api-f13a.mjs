// API integration tests for F13a (migration 1793190004_f13a.js, hook attachment-names.pb.js):
// original attachment names, `name` required for accounts (incl. the upgrade of existing
// accounts without a name). Runs against a THROWAWAY PocketBase (own --dir, free port), never
// against pocketbase/pb_data. The `lead` lock is tested in test-api-activities.mjs.
// Run: cd web && node --test ../scripts/test-api-f13a.mjs
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PB_DIR = path.join(ROOT, 'pocketbase');
const BIN = path.join(PB_DIR, process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
const MIGRATIONS = path.join(PB_DIR, 'pb_migrations');
const HOOKS = path.join(PB_DIR, 'pb_hooks');
const F13A = '1793190004_f13a.js';
const SU = { email: 'su@api.test', password: 'su-password-1234' };
const PASSWORD = 'user-password-1234';
const lib = createRequire(import.meta.url)(path.join(HOOKS, 'attachment-names-lib.js'));

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
	assert.equal(r.status, 200, `login ${identity}: ${JSON.stringify(r.data)}`);
	return r.data.token;
}

async function start(migrationsDir, hooksDir) {
	const port = await freePort();
	BASE = `http://127.0.0.1:${port}`;
	server = spawn(BIN, ['serve', '--http', `127.0.0.1:${port}`, '--dir', dataDir, '--migrationsDir', migrationsDir, '--hooksDir', hooksDir], {
		stdio: 'ignore'
	});
	for (let i = 0; i < 50; i++) {
		const ok = await fetch(BASE + '/api/health').then((r) => r.ok).catch(() => false);
		if (ok) return;
		await new Promise((r) => setTimeout(r, 200));
	}
	assert.fail('PocketBase did not start');
}

async function stop() {
	// wait for the process to exit: on Windows it still holds the db files right after kill()
	if (server && server.exitCode === null) {
		const exited = new Promise((r) => server.once('exit', r));
		server.kill();
		await exited;
	}
}

/** a valid 2x2 PNG (PocketBase only makes thumbs of real images) */
function png() {
	const crc = (buf) => {
		let c = ~0;
		for (const b of buf) {
			c ^= b;
			for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
		}
		return ~c >>> 0;
	};
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type), data]);
		const c = Buffer.alloc(4);
		c.writeUInt32BE(crc(td));
		return Buffer.concat([len, td, c]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(2, 0);
	ihdr.writeUInt32BE(2, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // RGB
	const raw = Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 255]);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0))
	]);
}

/** Content-Disposition file name; PocketBase sends UTF-8 bytes, fetch reads them as latin1 */
function dispositionName(res) {
	const h = res.headers.get('content-disposition') ?? '';
	const m = /filename="((?:[^"\\]|\\.)*)"/.exec(h);
	return m ? Buffer.from(m[1], 'latin1').toString('utf8') : null;
}

let su;
let anna; // { id, token }
let leadId;
let oldActivity; // created before the migration: no attachment_names
let nameless; // account without a name before the migration

const now = () => new Date().toISOString().replace('T', ' ');

async function createUser(email, name) {
	const r = await api('POST', '/api/collections/users/records', { email, password: PASSWORD, passwordConfirm: PASSWORD, name, verified: true }, su);
	assert.equal(r.status, 200, `create ${email}: ${JSON.stringify(r.data)}`);
	return r.data;
}

function activityForm(files, extra = {}) {
	const fd = new FormData();
	const fields = { lead: leadId, type: 'note', subject: 'Anhänge', body: '<p>x</p>', occurred_at: now(), author: anna.id, ...extra };
	for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === 'string' ? v : JSON.stringify(v));
	for (const [name, content] of files) fd.append('attachments', new Blob([content]), name);
	return fd;
}

before(async () => {
	assert.ok(fs.existsSync(BIN), `PocketBase binary missing: ${BIN}`);
	dataDir = fs.mkdtempSync(path.join(PB_DIR, 'pb_test_'));
	// 1) the state before F13a: all other migrations, no hooks
	const oldMigrations = path.join(dataDir, 'old_migrations');
	fs.mkdirSync(oldMigrations);
	for (const f of fs.readdirSync(MIGRATIONS)) if (f !== F13A) fs.copyFileSync(path.join(MIGRATIONS, f), path.join(oldMigrations, f));
	const noHooks = path.join(dataDir, 'no_hooks');
	fs.mkdirSync(noHooks);
	execFileSync(BIN, ['superuser', 'upsert', SU.email, SU.password, '--dir', dataDir, '--migrationsDir', oldMigrations], { stdio: 'ignore' });
	await start(oldMigrations, noHooks);
	su = await login('_superusers', SU.email, SU.password);
	const a = await createUser('anna@api.test', 'Anna');
	anna = { id: a.id };
	nameless = { empty: await createUser('leer@api.test', ''), blank: await createUser('blank@api.test', ' \t ') };
	anna.token = await login('users', 'anna@api.test', PASSWORD);
	const board = (await api('GET', '/api/collections/boards/records', null, anna.token)).data.items[0];
	const stage = (await api('GET', `/api/collections/board_columns/records?filter=${encodeURIComponent(`board="${board.id}"`)}`, null, anna.token)).data.items[0];
	const co = (await api('POST', '/api/collections/companies/records', { name: 'F13a GmbH' }, anna.token)).data;
	const ct = (await api('POST', '/api/collections/contacts/records', { last_name: 'Kontakt', company: co.id }, anna.token)).data;
	leadId = (await api('POST', '/api/collections/leads/records', {
		column: stage.id, title: 'F13a', company: co.id, contacts: [ct.id], owner: anna.id, rank: 'a0'
	}, anna.token)).data.id;
	assert.ok(leadId, 'lead created');
	const r = await api('POST', '/api/collections/activities/records', activityForm([['Alt Übersicht.txt', 'alt']]), anna.token);
	assert.equal(r.status, 200, JSON.stringify(r.data));
	oldActivity = r.data;
	await stop();

	// 2) the upgrade: all migrations, with hooks
	await start(MIGRATIONS, HOOKS);
	su = await login('_superusers', SU.email, SU.password);
	anna.token = await login('users', 'anna@api.test', PASSWORD);
});

after(async () => {
	await stop();
	if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('users: name is required', () => {
	it('existing accounts without a name got a placeholder and can still log in', async () => {
		for (const [email, u] of [['leer@api.test', nameless.empty], ['blank@api.test', nameless.blank]]) {
			const token = await login('users', email, PASSWORD);
			const me = (await api('GET', `/api/collections/users/records/${u.id}`, null, token)).data;
			assert.equal(me.name, `Ohne Namen (${u.id.slice(0, 6)})`);
		}
		const annaRec = (await api('GET', `/api/collections/users/records/${anna.id}`, null, anna.token)).data;
		assert.equal(annaRec.name, 'Anna', 'existing names stay');
	});

	it('a former nameless account can still save its record (e.g. password change)', async () => {
		const token = await login('users', 'leer@api.test', PASSWORD);
		const r = await api('PATCH', `/api/collections/users/records/${nameless.empty.id}`, {
			oldPassword: PASSWORD, password: PASSWORD, passwordConfirm: PASSWORD
		}, token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
	});

	it('a new account needs a name, also for the superuser', async () => {
		for (const name of [undefined, '', '   ', '\t']) {
			const r = await api('POST', '/api/collections/users/records', {
				email: `neu${Math.random().toString(36).slice(2, 8)}@api.test`, password: PASSWORD, passwordConfirm: PASSWORD, verified: true,
				...(name !== undefined && { name })
			}, su);
			assert.equal(r.status, 400, JSON.stringify(name));
			assert.ok(r.data.data?.name, `error on name for ${JSON.stringify(name)}`);
		}
		const ok = await createUser('neu@api.test', 'Neu Person');
		assert.equal(ok.name, 'Neu Person');
	});

	it('the name cannot be removed', async () => {
		for (const name of ['', '  ']) {
			const r = await api('PATCH', `/api/collections/users/records/${anna.id}`, { name }, anna.token);
			assert.equal(r.status, 400, JSON.stringify(name));
		}
		assert.equal((await api('PATCH', `/api/collections/users/records/${anna.id}`, { name: 'Anna B.' }, anna.token)).status, 200);
	});
});

describe('attachments: original names', () => {
	let rec;
	const names = ['Präsentation Q3 (final).pdf', 'Angebot – Müller & Söhne.docx', 'Bild.png'];

	before(async () => {
		const r = await api('POST', '/api/collections/activities/records', activityForm([
			[names[0], 'pdf'], [names[1], 'docx'], [names[2], png()]
		]), anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		rec = r.data;
	});

	it('are stored per stored file name', () => {
		assert.equal(rec.attachments.length, 3);
		assert.deepEqual(Object.keys(rec.attachment_names).sort(), [...rec.attachments].sort());
		assert.deepEqual(rec.attachments.map((n) => rec.attachment_names[n]), names);
	});

	it('come back in lists and realtime-visible record data', async () => {
		const r = await api('GET', `/api/collections/activities/records/${rec.id}`, null, anna.token);
		assert.deepEqual(r.data.attachment_names, rec.attachment_names);
	});

	it('are the download name (Content-Disposition); thumbs keep their own name', async () => {
		const { token } = (await api('POST', '/api/files/token', null, anna.token)).data;
		for (const [i, stored] of rec.attachments.entries()) {
			const res = await fetch(`${BASE}/api/files/activities/${rec.id}/${stored}?token=${token}&download=1`);
			assert.equal(res.status, 200);
			assert.equal(dispositionName(res), names[i]);
		}
		const png = rec.attachments[2];
		const thumb = await fetch(`${BASE}/api/files/activities/${rec.id}/${png}?token=${token}&thumb=200x200f`);
		assert.equal(thumb.status, 200);
		assert.notEqual(dispositionName(thumb), names[2]);
	});

	it('a Unicode space in the name reaches the download as a plain space', async () => {
		const r = await api('POST', '/api/collections/activities/records', activityForm([['Angebot\u00a0Q3.pdf', 'x']]), anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		const stored = r.data.attachments[0];
		assert.equal(r.data.attachment_names[stored], 'Angebot Q3.pdf');
		const { token } = (await api('POST', '/api/files/token', null, anna.token)).data;
		const res = await fetch(`${BASE}/api/files/activities/${r.data.id}/${stored}?token=${token}&download=1`);
		assert.equal(dispositionName(res), 'Angebot Q3.pdf');
	});

	it('cannot be set by a client, neither on create nor on update', async () => {
		const forged = { 'x.pdf': 'Rechnung.pdf' };
		const c = await api('POST', '/api/collections/activities/records', activityForm([['a.txt', 'a']], { attachment_names: forged }), anna.token);
		assert.equal(c.status, 400);
		const u = await api('PATCH', `/api/collections/activities/records/${rec.id}`, { attachment_names: forged }, anna.token);
		assert.ok(u.status >= 400, `status ${u.status}`);
		const fd = new FormData();
		fd.append('attachment_names', JSON.stringify(forged));
		const uf = await api('PATCH', `/api/collections/activities/records/${rec.id}`, fd, anna.token);
		assert.ok(uf.status >= 400, `status ${uf.status}`);
		const now = (await api('GET', `/api/collections/activities/records/${rec.id}`, null, su)).data;
		assert.deepEqual(now.attachment_names, rec.attachment_names);
	});

	it('the hook ignores what a superuser sends and keeps the map consistent', async () => {
		const r = await api('PATCH', `/api/collections/activities/records/${rec.id}`, {
			subject: 'vom Admin', attachment_names: { [rec.attachments[0]]: 'Falsch.pdf' }
		}, su);
		assert.equal(r.status, 200);
		assert.deepEqual(r.data.attachment_names, rec.attachment_names);
	});

	it('follow attachments+ / attachments-; editing other fields keeps them', async () => {
		const fd = new FormData();
		fd.append('attachments+', new Blob(['neu']), 'Neu – März.txt');
		fd.append('attachments-', rec.attachments[1]);
		const r = await api('PATCH', `/api/collections/activities/records/${rec.id}`, fd, anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		assert.equal(r.data.attachments.length, 3);
		assert.deepEqual(Object.keys(r.data.attachment_names).sort(), [...r.data.attachments].sort());
		assert.equal(r.data.attachment_names[rec.attachments[0]], names[0]);
		assert.equal(r.data.attachment_names[r.data.attachments[2]], 'Neu – März.txt');
		assert.ok(!(rec.attachments[1] in r.data.attachment_names));

		const plain = await api('PATCH', `/api/collections/activities/records/${rec.id}`, { subject: 'nur Text' }, anna.token);
		assert.deepEqual(plain.data.attachment_names, r.data.attachment_names);
	});

	it('removing all attachments leaves an empty map', async () => {
		const r = await api('PATCH', `/api/collections/activities/records/${rec.id}`, { attachments: [] }, anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		assert.deepEqual(r.data.attachment_names, {});
	});

	it('activities from before the migration keep working (stored name as fallback)', async () => {
		const old = (await api('GET', `/api/collections/activities/records/${oldActivity.id}`, null, anna.token)).data;
		assert.equal(old.attachments.length, 1);
		assert.ok(!old.attachment_names || Object.keys(old.attachment_names).length === 0);
		const { token } = (await api('POST', '/api/files/token', null, anna.token)).data;
		const res = await fetch(`${BASE}/api/files/activities/${old.id}/${old.attachments[0]}?token=${token}&download=1`);
		assert.equal(res.status, 200);
		assert.equal(dispositionName(res), old.attachments[0]);

		const fd = new FormData();
		fd.append('attachments+', new Blob(['neu']), 'Später.txt');
		const r = await api('PATCH', `/api/collections/activities/records/${old.id}`, fd, anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		assert.deepEqual(Object.values(r.data.attachment_names), ['Später.txt']);
	});
});

describe('attachment-names-lib', () => {
	it('cleanName drops paths, control and bidi characters, quotes and overlong tails', () => {
		assert.equal(lib.cleanName('C:\\fakepath\\Angebot.pdf'), 'Angebot.pdf');
		assert.equal(lib.cleanName('../../etc/passwd'), 'passwd');
		assert.equal(lib.cleanName('rechnung\u202efdp.exe'), 'rechnungfdp.exe');
		assert.equal(lib.cleanName('a\u0000b\nc\u200b.txt'), 'abc.txt');
		assert.equal(lib.cleanName('say "hi".txt'), "say 'hi'.txt");
		assert.equal(lib.cleanName('  Präsentation.pdf  '), 'Präsentation.pdf');
		assert.equal(lib.cleanName(''), '');
		assert.equal(lib.cleanName(null), '');
		assert.equal(lib.cleanName('..'), '');
		assert.equal(Array.from(lib.cleanName('ä'.repeat(300))).length, 200);
	});

	it('cleanName turns Unicode spaces into plain spaces and drops soft hyphen, ALM and line separators', () => {
		for (const sp of ['\u00a0', '\u1680', '\u2000', '\u2005', '\u200a', '\u202f', '\u205f', '\u3000']) {
			assert.equal(lib.cleanName(`a${sp}b.pdf`), 'a b.pdf', escape(sp));
		}
		assert.equal(lib.cleanName('Ab\u00adrech\u061cnung\u2028\u2029.pdf'), 'Abrechnung.pdf');
		assert.equal(lib.cleanName('\u00a0x.pdf\u3000'), 'x.pdf');
	});

	it('cleanName shortens overlong names but keeps the extension', () => {
		const long = lib.cleanName('ä'.repeat(300) + '.docx');
		assert.equal(Array.from(long).length, 200);
		assert.ok(long.endsWith('ä.docx'), long.slice(-10));
		const spaced = lib.cleanName('a'.repeat(194) + '     b.pdf');
		assert.ok(spaced.endsWith('a.pdf') && !spaced.includes(' .pdf'), spaced.slice(-10));
		// no real extension: plain cut
		assert.equal(lib.cleanName('x'.repeat(250)), 'x'.repeat(200));
		assert.equal(Array.from(lib.cleanName('y'.repeat(250) + '.' + 'z'.repeat(30))).length, 200);
	});

	it('parseNames accepts only an object of strings', () => {
		assert.deepEqual(lib.parseNames('{"a":"A","b":3}'), { a: 'A' });
		for (const raw of ['', 'null', '[1]', '"x"', '{', undefined]) assert.deepEqual(lib.parseNames(raw), {});
	});

	it('mergeNames keeps kept files, adds uploads and drops removed ones', () => {
		const old = { a: 'A.pdf', b: 'B.pdf' };
		assert.deepEqual(
			lib.mergeNames(old, ['a', 'x'], [{ name: 'c', originalName: 'C.pdf' }, { name: 'd', originalName: '\u0000' }]),
			{ a: 'A.pdf', c: 'C.pdf' }
		);
		assert.deepEqual(lib.mergeNames({ ['__proto__']: 'x' }, ['__proto__', 'toString'], []), {});
	});
});
