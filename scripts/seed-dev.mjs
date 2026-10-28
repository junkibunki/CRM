// Local development only: creates a superuser, a login user and demo companies,
// contacts and leads (in the pipeline the migration creates).
// Usage (repo root, PocketBase running on :8090): node scripts/seed-dev.mjs
// Never run against production; the credentials below are public.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

const existingCompanies = await api('GET', '/api/collections/companies/records', null, token);
if (existingCompanies.items.length === 0) {
	const user = (
		await api(
			'GET',
			`/api/collections/users/records?filter=${encodeURIComponent(`email="${DEV_USER.email}"`)}`,
			null,
			token
		)
	).items[0];
	// the pipeline and its stages come from the migration
	const board = (await api('GET', '/api/collections/boards/records', null, token)).items[0];
	const stages = (
		await api(
			'GET',
			`/api/collections/board_columns/records?sort=rank&filter=${encodeURIComponent(`board="${board.id}"`)}`,
			null,
			token
		)
	).items;

	const demo = [
		['Müller Maschinenbau GmbH', 'https://example.com', [['Anna', 'Müller', 'Geschäftsführerin'], ['Jonas', 'Weber', 'Einkauf']]],
		['Schneider Logistik AG', 'https://example.org', [['Petra', 'Schneider', 'Vorstand'], ['Lukas', 'Fischer', 'IT-Leitung']]],
		['Becker & Söhne KG', '', [['Thomas', 'Becker', 'Inhaber']]],
		['Hoffmann Digital', 'https://example.net', [['Sarah', 'Hoffmann', 'CTO'], ['Felix', 'Wagner', 'Produkt']]]
	];
	let n = 0;
	for (const [name, website, people] of demo) {
		const company = await api('POST', '/api/collections/companies/records', { name, website }, token);
		const contactIds = [];
		for (const [first_name, last_name, position] of people) {
			const email = `${first_name}.${last_name}@example.com`.toLowerCase().replace('ü', 'ue');
			const c = await api(
				'POST',
				'/api/collections/contacts/records',
				{ first_name, last_name, position, email, company: company.id },
				token
			);
			contactIds.push(c.id);
		}
		for (const topic of ['Wartungsvertrag', 'Pilotprojekt']) {
			const stage = stages[n % stages.length];
			await api(
				'POST',
				'/api/collections/leads/records',
				{
					column: stage.id,
					title: `${topic} ${name.split(' ')[0]}`,
					company: company.id,
					contacts: contactIds.slice(0, 1 + (n % contactIds.length)),
					expected_close: n % 3 === 0 ? '' : `2026-${String(10 + (n % 3)).padStart(2, '0')}-15 00:00:00.000Z`,
					owner: user.id,
					rank: `a${n}`
				},
				token
			);
			n++;
		}
	}
	console.log(`created ${demo.length} companies and ${n} leads`);
}
