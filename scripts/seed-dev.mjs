// Local development only: creates a superuser and a login user, then runs the feature
// seeds in scripts/seed/ (demo companies, contacts, leads, …).
// Usage (repo root, PocketBase running on :8090): node scripts/seed-dev.mjs
// Never run against production; the credentials below are public.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const DEV_SUPERUSER = { email: 'admin@crm.test', password: 'dev-admin-1234' };
export const DEV_USER = { email: 'dev@crm.test', password: 'dev-user-1234', name: 'Dev User' };

const BASE = process.env.PB_URL ?? 'http://127.0.0.1:8090';
const pbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'pocketbase');
const bin = path.join(pbDir, process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');

execFileSync(bin, ['superuser', 'upsert', DEV_SUPERUSER.email, DEV_SUPERUSER.password], {
	cwd: pbDir,
	stdio: 'inherit'
});

async function api(method, url, body, token) {
	const res = await fetch(BASE + url, {
		method,
		headers: { 'content-type': 'application/json', ...(token && { Authorization: token }) },
		body: body && JSON.stringify(body)
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(data)}`);
	return data;
}

const { token } = await api('POST', '/api/collections/_superusers/auth-with-password', {
	identity: DEV_SUPERUSER.email,
	password: DEV_SUPERUSER.password
});

const existing = await api(
	'GET',
	`/api/collections/users/records?filter=${encodeURIComponent(`email="${DEV_USER.email}"`)}`,
	null,
	token
);
if (existing.items.length === 0) {
	await api(
		'POST',
		'/api/collections/users/records',
		{ ...DEV_USER, passwordConfirm: DEV_USER.password, verified: true },
		token
	);
	console.log(`created user ${DEV_USER.email}`);
}

// Feature seeds: every file in scripts/seed/ (sorted by name) exports
// `default async ({ api, token, DEV_USER, DEV_SUPERUSER }) => {}` and must be idempotent
// (skip if its data already exists). One file per feature, so parallel work never collides.
const seedDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'seed');
for (const file of fs.readdirSync(seedDir).filter((f) => f.endsWith('.mjs')).sort()) {
	const mod = await import(pathToFileURL(path.join(seedDir, file)).href);
	await mod.default({ api, token, DEV_USER, DEV_SUPERUSER });
}
