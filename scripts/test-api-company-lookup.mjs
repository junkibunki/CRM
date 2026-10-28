// API integration tests for F10 (GET /api/crm/company-lookup): auth, SSRF refusals, rate
// limit. Runs against a THROWAWAY PocketBase (own --dir, free port), never against
// pocketbase/pb_data. No test depends on a real external website: refused requests are
// answered before any fetch, the redirect/IP logic is unit-tested with a fake fetcher
// (web/src/lib/crm/company-lookup-lib.test.ts), and the real curl call is checked against
// local servers below.
// Run: cd web && node --test ../scripts/test-api-company-lookup.mjs
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PB_DIR = path.join(ROOT, 'pocketbase');
const BIN = path.join(PB_DIR, process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
const lib = createRequire(import.meta.url)(path.join(PB_DIR, 'pb_hooks', 'company-lookup-lib.js'));
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

async function lookup(domain, token) {
	const res = await fetch(`${BASE}/api/crm/company-lookup?domain=${encodeURIComponent(domain)}`, {
		headers: token ? { Authorization: token } : {}
	});
	return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function login(collection, identity, password) {
	const res = await fetch(`${BASE}/api/collections/${collection}/auth-with-password`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ identity, password })
	});
	assert.equal(res.status, 200, `login ${identity}`);
	return (await res.json()).token;
}

async function createUser(su, email) {
	const password = 'user-password-1234';
	const res = await fetch(`${BASE}/api/collections/users/records`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', Authorization: su },
		body: JSON.stringify({ email, password, passwordConfirm: password, name: email, verified: true })
	});
	assert.equal(res.status, 200, `create ${email}`);
	return login('users', email, password);
}

let anna; // general tests
let ben; // rate limit
let cora; // rate limit is per user

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
	const su = await login('_superusers', SU.email, SU.password);
	anna = await createUser(su, 'anna@api.test');
	ben = await createUser(su, 'ben@api.test');
	cora = await createUser(su, 'cora@api.test');
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

describe('company-lookup: access', () => {
	it('refuses guests', async () => {
		const r = await lookup('firma.de');
		assert.equal(r.status, 401);
	});

	it('refuses an invalid token', async () => {
		const r = await lookup('firma.de', 'not-a-token');
		assert.equal(r.status, 401);
	});
});

describe('company-lookup: SSRF attempts are refused before any fetch', () => {
	const refused = [
		'',
		'localhost',
		'LOCALHOST.',
		'intranet',
		'server.localhost',
		'drucker.local',
		'db.internal',
		'nas.lan',
		'127.0.0.1',
		'10.0.0.1',
		'192.168.178.1',
		'169.254.169.254',
		'0x7f.1',
		'2130706433',
		'[::1]',
		'::1',
		'firma.de:8443',
		'firma.de:443',
		'https://firma.de',
		'http://firma.de',
		'firma.de/impressum',
		'user@firma.de',
		'firma.de#x',
		'firma.de%2f..'
	];
	// every request counts against the rate limit, so the cases are spread over several users
	const tokens = [];
	before(async () => {
		const su = await login('_superusers', SU.email, SU.password);
		for (let i = 0; i * 10 < refused.length; i++) tokens.push(await createUser(su, `ssrf${i}@api.test`));
	});
	refused.forEach((domain, i) => {
		it(`${JSON.stringify(domain)} → 400`, async () => {
			const t = Date.now();
			const r = await lookup(domain, tokens[Math.floor(i / 10)]);
			assert.equal(r.status, 400, JSON.stringify(r.data));
			assert.equal(r.data.data?.domain?.code, 'invalid_domain');
			assert.ok(r.data.message && !/something went wrong/i.test(r.data.message), r.data.message);
			assert.ok(Date.now() - t < 2000, 'answered without fetching');
		});
	});

	// Depends on public DNS only (no website): localtest.me resolves to 127.0.0.1. Whether the
	// lookup fails at DNS (offline), at the connection (nothing on :443) or at the internal
	// address check, it must be refused and must not return data.
	it('a public name that resolves to 127.0.0.1 is refused without data', async () => {
		const r = await lookup('localtest.me', anna);
		assert.ok(r.status === 400 || r.status === 502, `status ${r.status}`);
		assert.equal(r.data.name, undefined);
		assert.ok(r.data.message);
	});
});

describe('company-lookup: rate limit per user', () => {
	it(`answers 429 after ${lib.RATE_LIMIT} lookups per minute, other users unaffected`, async () => {
		for (let i = 0; i < lib.RATE_LIMIT; i++) {
			const r = await lookup('localhost', ben); // refused input counts too, and needs no network
			assert.equal(r.status, 400, `request ${i + 1}`);
		}
		const blocked = await lookup('firma.de', ben);
		assert.equal(blocked.status, 429);
		assert.match(blocked.data.message, /Zu viele Abfragen/);
		const other = await lookup('localhost', cora);
		assert.equal(other.status, 400);
	});
});

// The real curl call with the flags from curlArgs(): it must never talk plain HTTP and must
// not send a request over an unverified TLS connection (an internal service without a valid
// certificate for the looked-up name never sees an HTTP request).
describe('curl fetcher against local servers', () => {
	let hasCurl = true;
	try {
		execFileSync('curl', ['--version'], { stdio: 'ignore' });
	} catch {
		hasCurl = false;
	}
	// async (the local server lives in this process and must be able to answer)
	const curl = (url) =>
		new Promise((resolve) => {
			execFile('curl', lib.curlArgs(url), (err, stdout) => resolve({ exit: err ? err.code : 0, stdout }));
		});

	async function withServer(fn) {
		let requests = 0;
		const srv = http.createServer((req, res) => {
			requests++;
			res.writeHead(302, { location: 'http://127.0.0.1:1/secret' });
			res.end('SECRET');
		});
		await new Promise((r) => srv.listen(0, '127.0.0.1', r));
		try {
			return await fn(srv.address().port, () => requests);
		} finally {
			await new Promise((r) => srv.close(r));
		}
	}

	it('refuses http:// without connecting', { skip: !hasCurl && 'curl not installed' }, async () => {
		await withServer(async (port, requests) => {
			const r = await curl(`http://127.0.0.1:${port}/`);
			assert.equal(r.exit, 1); // CURLE_UNSUPPORTED_PROTOCOL
			assert.equal(lib.curlError(r.exit).code, 'protocol');
			assert.equal(requests(), 0);
		});
	});

	it('sends no HTTP request without a valid TLS certificate', { skip: !hasCurl && 'curl not installed' }, async () => {
		await withServer(async (port, requests) => {
			const r = await curl(`https://127.0.0.1:${port}/`);
			assert.notEqual(r.exit, 0);
			assert.ok(!String(r.stdout).includes('SECRET'));
			assert.equal(requests(), 0);
		});
	});
});
