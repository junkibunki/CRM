// API integration tests for profile pictures (migration 1793190009_users_avatar.js): a user
// sets and removes their own `avatar`, raster images only (no SVG), a 96x96 thumbnail is
// served, other users cannot change it. Runs against a THROWAWAY PocketBase (own --dir,
// free port), never against pocketbase/pb_data.
// Run: cd web && node --test ../scripts/test-api-avatar.mjs
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
const PASSWORD = 'user-password-1234';
// 1x1 PNG
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

let BASE;
let dataDir;
let proc;

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
	const r = await api('POST', '/api/collections/users/records', { email, password: PASSWORD, passwordConfirm: PASSWORD, name, verified: true }, su);
	assert.equal(r.status, 200, `create ${email}`);
	return { id: r.data.id, email, token: await login('users', email, PASSWORD) };
}

/** multipart update of `avatar` (a file, or '' to remove it) */
async function setAvatar(user, token, file) {
	const form = new FormData();
	if (file) form.append('avatar', new Blob([file.data], { type: file.type }), file.name);
	else form.append('avatar', '');
	const res = await fetch(`${BASE}/api/collections/users/records/${user.id}`, {
		method: 'PATCH',
		headers: { Authorization: token },
		body: form
	});
	return { status: res.status, data: await res.json().catch(() => ({})) };
}

let su;
let anna;
let ben;

before(async () => {
	assert.ok(fs.existsSync(BIN), `PocketBase binary missing: ${BIN}`);
	const port = await freePort();
	BASE = `http://127.0.0.1:${port}`;
	dataDir = fs.mkdtempSync(path.join(PB_DIR, 'pb_test_'));
	const common = ['--dir', path.join(dataDir, 'data'), '--migrationsDir', path.join(PB_DIR, 'pb_migrations')];
	execFileSync(BIN, ['superuser', 'upsert', SU.email, SU.password, ...common], { stdio: 'ignore' });
	proc = spawn(BIN, ['serve', '--http', `127.0.0.1:${port}`, '--automigrate=false', ...common, '--hooksDir', path.join(PB_DIR, 'pb_hooks')], {
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
});

after(async () => {
	// wait for the process to exit: on Windows it still holds the db files right after kill()
	if (proc && proc.exitCode === null) {
		const exited = new Promise((r) => proc.once('exit', r));
		proc.kill();
		await exited;
	}
	if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

describe('users.avatar', () => {
	it('is narrowed by the migration', async () => {
		const r = await api('GET', '/api/collections/users', null, su);
		assert.equal(r.status, 200);
		const f = r.data.fields.find((x) => x.name === 'avatar');
		assert.equal(f.type, 'file');
		assert.deepEqual(f.mimeTypes, ['image/jpeg', 'image/png', 'image/webp']);
		assert.deepEqual(f.thumbs, ['96x96']);
		assert.equal(f.maxSize, 5 * 1024 * 1024);
		assert.equal(f.maxSelect, 1);
	});

	it('a user sets their own picture and its thumbnail is served', async () => {
		const r = await setAvatar(anna, anna.token, { data: PNG, type: 'image/png', name: 'me.png' });
		assert.equal(r.status, 200, JSON.stringify(r.data));
		assert.ok(r.data.avatar, 'file name stored');
		const thumb = await fetch(`${BASE}/api/files/users/${anna.id}/${r.data.avatar}?thumb=96x96`);
		assert.equal(thumb.status, 200);
		assert.match(thumb.headers.get('content-type') ?? '', /^image\/png/);
		// other logged-in users see the file name (header avatars of colleagues later)
		const seen = await api('GET', `/api/collections/users/records/${anna.id}`, null, ben.token);
		assert.equal(seen.data.avatar, r.data.avatar);
	});

	it('rejects an SVG', async () => {
		const r = await setAvatar(anna, anna.token, { data: SVG, type: 'image/svg+xml', name: 'x.svg' });
		assert.equal(r.status, 400);
		assert.ok(r.data.data?.avatar, 'error on the avatar field');
	});

	it('another user cannot change it', async () => {
		const r = await setAvatar(anna, ben.token, { data: PNG, type: 'image/png', name: 'evil.png' });
		assert.equal(r.status, 404);
	});

	it('a user removes their own picture', async () => {
		const r = await setAvatar(anna, anna.token, null);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		assert.equal(r.data.avatar, '');
	});
});
