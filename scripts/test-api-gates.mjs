// API integration tests for F12 (stage gates): collections stage_requirements, lead_checks,
// lead_check_events, the hook pb_hooks/stage-gates.pb.js and the route POST /api/crm/leads.
// Runs against a THROWAWAY PocketBase (own --dir, free port), never against pocketbase/pb_data.
// Same setup as scripts/test-api-todos.mjs. Run: cd web && node --test ../scripts/test-api-gates.mjs
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
const rec = (c, id) => `/api/collections/${c}/records${id ? `/${id}` : ''}`;

let su;
let anna;
let ben;
let board;
/** stage name -> stage */
let st;
let company;
let contact;
/** requirement: flag at "Angebot", text at "Verhandlung" */
let flag;
let text;

async function list(c, filter, token = su) {
	const r = await api('GET', `${rec(c)}?perPage=500&sort=created${filter ? `&filter=${q(filter)}` : ''}`, null, token);
	assert.equal(r.status, 200, `list ${c}`);
	return r.data.items;
}

async function newLead(stage = 'Neu', title = 'Gate-Lead') {
	const r = await api('POST', rec('leads'), {
		column: st[stage].id, title, company: company.id, contacts: [contact.id], owner: anna.id, rank: 'a0'
	}, anna.token);
	assert.equal(r.status, 200, `lead in ${stage}: ${JSON.stringify(r.data)}`);
	return r.data.id;
}

const move = (lead, stage, token = anna.token) => api('PATCH', rec('leads', lead), { column: st[stage].id }, token);

async function check(lead, requirement, value, user = anna) {
	const r = await api('POST', rec('lead_checks'), { lead, requirement, value, by: user.id }, user.token);
	assert.equal(r.status, 200, `check: ${JSON.stringify(r.data)}`);
	return r.data;
}

async function addRequirement(stage, label, type, rank = 'a0', token = anna.token) {
	const r = await api('POST', rec('stage_requirements'), { column: st[stage].id, label, type, rank, hint: '' }, token);
	assert.equal(r.status, 200, `requirement ${label}: ${JSON.stringify(r.data)}`);
	return r.data;
}

before(async () => {
	assert.ok(fs.existsSync(BIN), `PocketBase binary missing: ${BIN}`);
	const port = await freePort();
	BASE = `http://127.0.0.1:${port}`;
	dataDir = fs.mkdtempSync(path.join(PB_DIR, 'pb_test_'));
	const common = ['--dir', dataDir, '--migrationsDir', path.join(PB_DIR, 'pb_migrations')];
	execFileSync(BIN, ['superuser', 'upsert', SU.email, SU.password, ...common], { stdio: 'ignore' });
	// --automigrate=false: some tests change the leads collection (rule, field); with automigrate
	// that would write a migration file into the repo's pb_migrations (docs/pitfalls/testen.md)
	server = spawn(BIN, ['serve', '--http', `127.0.0.1:${port}`, ...common, '--hooksDir', path.join(PB_DIR, 'pb_hooks'), '--automigrate=false'], {
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
	board = (await api('GET', rec('boards'), null, anna.token)).data.items[0];
	const stages = await list('board_columns', `board="${board.id}"`, anna.token);
	st = Object.fromEntries(stages.map((s) => [s.name, s]));
	assert.ok(st.Neu && st.Qualifiziert && st.Angebot && st.Verhandlung, 'standard stages');
	company = (await api('POST', rec('companies'), { name: 'Gate GmbH' }, anna.token)).data;
	contact = (await api('POST', rec('contacts'), { last_name: 'Kontakt', company: company.id }, anna.token)).data;
	flag = await addRequirement('Angebot', 'Bei Siemens als Lead geflaggt', 'flag');
	text = await addRequirement('Verhandlung', 'Siemens-Lead-Nummer', 'text');
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

describe('guests', () => {
	it('see no requirements, checks or log entries and cannot write', async () => {
		const lead = await newLead();
		await check(lead, flag.id, 'true');
		for (const c of ['stage_requirements', 'lead_checks', 'lead_check_events']) {
			assert.ok((await list(c)).length > 0, `superuser sees ${c}`);
			const r = await api('GET', rec(c));
			assert.equal(r.data.items?.length ?? 0, 0, c);
		}
		assert.ok((await api('POST', rec('stage_requirements'), { column: st.Neu.id, label: 'x', type: 'flag', rank: 'a0' })).status >= 400);
		assert.ok((await api('POST', rec('lead_checks'), { lead, requirement: text.id, value: 'x' })).status >= 400);
		const [c] = await list('lead_checks', `lead="${lead}"`);
		assert.ok((await api('DELETE', rec('lead_checks', c.id))).status >= 400);
		assert.equal((await list('lead_checks', `lead="${lead}"`)).length, 1);
	});

	it('cannot use the create route', async () => {
		const r = await api('POST', '/api/crm/leads', { title: 'x', column: st.Neu.id });
		assert.equal(r.status, 401);
	});
});

describe('moving a lead (hook on leads)', () => {
	it('into a stage with an open requirement: 400 on `column`, naming the requirement', async () => {
		const lead = await newLead();
		const r = await move(lead, 'Angebot');
		assert.equal(r.status, 400);
		assert.equal(r.data.data.column.code, 'gate_open');
		assert.match(r.data.data.column.message, /„Angebot“/);
		assert.match(r.data.data.column.message, /Bei Siemens als Lead geflaggt/);
		assert.equal((await api('GET', rec('leads', lead), null, anna.token)).data.column, st.Neu.id, 'still in Neu');
	});

	it('into a stage without requirements, before the gates: allowed', async () => {
		const lead = await newLead();
		assert.equal((await move(lead, 'Qualifiziert')).status, 200);
	});

	it('with the requirement fulfilled: allowed', async () => {
		const lead = await newLead();
		await check(lead, flag.id, 'true');
		assert.equal((await move(lead, 'Angebot')).status, 200);
	});

	it('skipping stages needs every requirement in between (cumulative by rank)', async () => {
		const lead = await newLead();
		let r = await move(lead, 'Verhandlung');
		assert.equal(r.status, 400);
		assert.match(r.data.data.column.message, /Bei Siemens als Lead geflaggt/);
		assert.match(r.data.data.column.message, /Siemens-Lead-Nummer/);
		await check(lead, text.id, 'S-4711');
		r = await move(lead, 'Verhandlung');
		assert.equal(r.status, 400, 'the flag of "Angebot" is still open');
		assert.doesNotMatch(r.data.data.column.message, /Siemens-Lead-Nummer/);
		await check(lead, flag.id, 'true');
		assert.equal((await move(lead, 'Verhandlung')).status, 200);
		// "Gewonnen" comes later: the same requirements apply, all fulfilled
		assert.equal((await move(lead, 'Gewonnen')).status, 200);
	});

	it('follows the stage order: after reordering, a requirement moves with its stage', async () => {
		const lead = await newLead();
		// "Qualifiziert" behind "Angebot": now the flag applies to "Qualifiziert"
		await api('PATCH', rec('board_columns', st.Qualifiziert.id), { rank: `${st.Angebot.rank}V` }, anna.token);
		try {
			const r = await move(lead, 'Qualifiziert');
			assert.equal(r.status, 400);
			assert.match(r.data.data.column.message, /Bei Siemens als Lead geflaggt/);
		} finally {
			await api('PATCH', rec('board_columns', st.Qualifiziert.id), { rank: st.Qualifiziert.rank }, anna.token);
		}
		assert.equal((await move(lead, 'Qualifiziert')).status, 200);
	});

	it('also applies to superusers (admin UI)', async () => {
		const lead = await newLead();
		assert.equal((await move(lead, 'Angebot', su)).status, 400);
	});

	it('creating a lead directly in a gated stage is refused', async () => {
		const r = await api('POST', rec('leads'), {
			column: st.Angebot.id, title: 'Direkt', company: company.id, contacts: [contact.id], owner: anna.id, rank: 'a0'
		}, anna.token);
		assert.equal(r.status, 400);
		assert.equal(r.data.data.column.code, 'gate_open');
	});

	it('leads already in a stage are not pushed back: other edits still work, a warning is all', async () => {
		const lead = await newLead();
		await check(lead, flag.id, 'true');
		assert.equal((await move(lead, 'Angebot')).status, 200);
		// a requirement added later to an earlier stage
		const late = await addRequirement('Qualifiziert', 'NDA unterschrieben', 'flag');
		try {
			const r = await api('PATCH', rec('leads', lead), { title: 'Umbenannt', rank: 'a5' }, anna.token);
			assert.equal(r.status, 200);
			assert.equal(r.data.column, st.Angebot.id);
			// moving back into a stage whose requirement is open is a move like any other
			assert.equal((await move(lead, 'Qualifiziert')).status, 400);
			assert.equal((await move(lead, 'Neu')).status, 200);
		} finally {
			await api('DELETE', rec('stage_requirements', late.id), null, anna.token);
		}
	});

	it('into a stage of another pipeline: its gate applies, checks of the old pipeline do not count', async () => {
		const other = (await api('POST', rec('boards'), { name: 'Zweite Pipeline' }, su)).data;
		const col = (await api('POST', rec('board_columns'), { board: other.id, name: 'Start', rank: 'a0' }, su)).data;
		const foreign = (await api('POST', rec('stage_requirements'), { column: col.id, label: 'Fremd-Freigabe', type: 'flag', rank: 'a0' }, su)).data;
		assert.ok(foreign.id);
		const lead = await newLead();
		await check(lead, flag.id, 'true');
		await check(lead, text.id, 'S-1');
		const r = await api('PATCH', rec('leads', lead), { column: col.id }, anna.token);
		assert.equal(r.status, 400);
		assert.match(r.data.data.column.message, /„Start“/);
		assert.match(r.data.data.column.message, /Fremd-Freigabe/);
		assert.doesNotMatch(r.data.data.column.message, /Siemens/);
		// confirmed (as superuser: the rule only allows requirements of the lead's own pipeline)
		assert.equal((await api('POST', rec('lead_checks'), { lead, requirement: foreign.id, value: 'true' }, su)).status, 200);
		assert.equal((await api('PATCH', rec('leads', lead), { column: col.id }, anna.token)).status, 200);
	});

	it('revoking a check leaves the lead where it is', async () => {
		const lead = await newLead();
		const c = await check(lead, flag.id, 'true');
		await move(lead, 'Angebot');
		assert.equal((await api('DELETE', rec('lead_checks', c.id), null, ben.token)).status, 204);
		assert.equal((await api('GET', rec('leads', lead), null, anna.token)).data.column, st.Angebot.id);
	});
});

describe('exempt stages (gates_exempt)', () => {
	it('the migration exempts "Verloren" of the pipeline "Leads", no other stage', () => {
		const exempt = Object.values(st).filter((s) => s.gates_exempt).map((s) => s.name);
		assert.deepEqual(exempt, ['Verloren']);
	});

	it('"Verloren" needs no requirement, "Gewonnen" needs all of them', async () => {
		const lead = await newLead();
		const r = await move(lead, 'Gewonnen');
		assert.equal(r.status, 400);
		assert.match(r.data.data.column.message, /Bei Siemens als Lead geflaggt/);
		assert.match(r.data.data.column.message, /Siemens-Lead-Nummer/);
		assert.equal((await move(lead, 'Verloren')).status, 200);
		// a new lead may be created there directly, too
		const c = await api('POST', rec('leads'), {
			column: st.Verloren.id, title: 'Verloren direkt', company: company.id, contacts: [contact.id], owner: anna.id, rank: 'a0'
		}, anna.token);
		assert.equal(c.status, 200);
	});

	it('an exempt stage cannot get requirements', async () => {
		const r = await api('POST', rec('stage_requirements'), { column: st.Verloren.id, label: 'x', type: 'flag', rank: 'a0' }, anna.token);
		assert.equal(r.status, 400);
		assert.equal((await list('stage_requirements', `column="${st.Verloren.id}"`)).length, 0);
	});

	it('exempting a stage that has requirements frees only that stage, later ones still need them', async () => {
		await api('PATCH', rec('board_columns', st.Angebot.id), { gates_exempt: true }, anna.token);
		try {
			const lead = await newLead();
			assert.equal((await move(lead, 'Angebot')).status, 200);
			await check(lead, text.id, 'S-1');
			const r = await move(lead, 'Gewonnen');
			assert.equal(r.status, 400, 'no way to "Gewonnen" without the Siemens flag');
			assert.match(r.data.data.column.message, /Bei Siemens als Lead geflaggt/);
			assert.doesNotMatch(r.data.data.column.message, /Siemens-Lead-Nummer/);
		} finally {
			await api('PATCH', rec('board_columns', st.Angebot.id), { gates_exempt: false }, anna.token);
		}
	});
});

describe('checks: values and rules', () => {
	it('a flag is confirmed only with "true"', async () => {
		const lead = await newLead();
		const r = await api('POST', rec('lead_checks'), { lead, requirement: flag.id, value: 'false', by: anna.id }, anna.token);
		assert.equal(r.status, 400);
		assert.ok(r.data.data.value, JSON.stringify(r.data));
	});

	it('a blank text is refused, a text is stored trimmed', async () => {
		const lead = await newLead();
		const r = await api('POST', rec('lead_checks'), { lead, requirement: text.id, value: '   ', by: anna.id }, anna.token);
		assert.equal(r.status, 400);
		assert.ok(r.data.data.value);
		assert.equal((await check(lead, text.id, '  S-1  ')).value, 'S-1');
	});

	it('`by` must be the requesting user, on create and on change', async () => {
		const lead = await newLead();
		let r = await api('POST', rec('lead_checks'), { lead, requirement: text.id, value: 'x', by: ben.id }, anna.token);
		assert.equal(r.status, 400);
		r = await api('POST', rec('lead_checks'), { lead, requirement: text.id, value: 'x' }, anna.token);
		assert.equal(r.status, 400);
		const c = await check(lead, text.id, 'x');
		r = await api('PATCH', rec('lead_checks', c.id), { value: 'y' }, ben.token);
		assert.equal(r.status, 404, 'update without by fails the rule');
		r = await api('PATCH', rec('lead_checks', c.id), { value: 'y', by: anna.id }, ben.token);
		assert.equal(r.status, 404);
		r = await api('PATCH', rec('lead_checks', c.id), { value: 'y', by: ben.id }, ben.token);
		assert.equal(r.status, 200);
		assert.equal(r.data.by, ben.id);
	});

	it('lead and requirement of a check cannot be changed', async () => {
		const lead = await newLead();
		const other = await newLead();
		const c = await check(lead, text.id, 'x');
		assert.ok((await api('PATCH', rec('lead_checks', c.id), { lead: other, by: anna.id }, anna.token)).status >= 400);
		assert.ok((await api('PATCH', rec('lead_checks', c.id), { requirement: flag.id, value: 'true', by: anna.id }, anna.token)).status >= 400);
		const now = (await api('GET', rec('lead_checks', c.id), null, anna.token)).data;
		assert.equal(now.lead, lead);
		assert.equal(now.requirement, text.id);
	});

	it('one check per lead and requirement (unique)', async () => {
		const lead = await newLead();
		await check(lead, flag.id, 'true');
		const r = await api('POST', rec('lead_checks'), { lead, requirement: flag.id, value: 'true', by: ben.id }, ben.token);
		assert.equal(r.status, 400);
		assert.equal((await list('lead_checks', `lead="${lead}"`)).length, 1);
	});

	it('the requirement must belong to the lead\'s pipeline', async () => {
		const other = (await api('POST', rec('boards'), { name: 'Andere' }, su)).data;
		const col = (await api('POST', rec('board_columns'), { board: other.id, name: 'X', rank: 'a0' }, su)).data;
		const req = (await api('POST', rec('stage_requirements'), { column: col.id, label: 'Fremd', type: 'flag', rank: 'a0' }, su)).data;
		assert.ok(req.id, 'foreign requirement');
		const lead = await newLead();
		const r = await api('POST', rec('lead_checks'), { lead, requirement: req.id, value: 'true', by: anna.id }, anna.token);
		assert.equal(r.status, 400);
	});

	it('a requirement stays at its stage', async () => {
		const r = await api('PATCH', rec('stage_requirements', flag.id), { column: st.Neu.id }, anna.token);
		assert.ok(r.status >= 400);
		assert.equal((await api('PATCH', rec('stage_requirements', flag.id), { hint: 'Vertrieb informieren' }, anna.token)).status, 200);
	});

	it('a superuser may confirm without `by` (admin UI, import)', async () => {
		const lead = await newLead();
		const r = await api('POST', rec('lead_checks'), { lead, requirement: flag.id, value: 'true' }, su);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		const [ev] = await list('lead_check_events', `lead="${lead}"`);
		assert.equal(ev.action, 'confirmed');
		assert.equal(ev.by, '');
	});
});

describe('log (lead_check_events)', () => {
	it('records confirm, change and revoke with value and user; an unchanged save adds nothing', async () => {
		const lead = await newLead();
		const c = await check(lead, text.id, 'S-1');
		await api('PATCH', rec('lead_checks', c.id), { value: 'S-1', by: anna.id }, anna.token);
		await api('PATCH', rec('lead_checks', c.id), { value: 'S-2', by: ben.id }, ben.token);
		assert.equal((await api('DELETE', rec('lead_checks', c.id), null, anna.token)).status, 204);
		const events = await list('lead_check_events', `lead="${lead}"`, ben.token);
		assert.deepEqual(
			events.map((e) => [e.action, e.value, e.by, e.requirement_label, e.requirement]),
			[
				['confirmed', 'S-1', anna.id, 'Siemens-Lead-Nummer', text.id],
				['changed', 'S-2', ben.id, 'Siemens-Lead-Nummer', text.id],
				['revoked', 'S-2', anna.id, 'Siemens-Lead-Nummer', text.id]
			]
		);
	});

	it('saving the same value again keeps who confirmed it and when', async () => {
		const lead = await newLead();
		const c = await check(lead, text.id, 'S-7');
		const r = await api('PATCH', rec('lead_checks', c.id), { value: ' S-7 ', by: ben.id }, ben.token);
		assert.equal(r.status, 200);
		assert.equal(r.data.by, anna.id);
		const now = (await api('GET', rec('lead_checks', c.id), null, anna.token)).data;
		assert.equal(now.by, anna.id);
		assert.equal(now.updated, c.updated);
		assert.deepEqual((await list('lead_check_events', `lead="${lead}"`)).map((e) => e.action), ['confirmed']);
	});

	it('cannot be written by users', async () => {
		const lead = await newLead();
		await check(lead, flag.id, 'true');
		const [ev] = await list('lead_check_events', `lead="${lead}"`);
		assert.equal((await api('POST', rec('lead_check_events'), { lead, requirement_label: 'x', action: 'confirmed' }, anna.token)).status, 403);
		assert.equal((await api('PATCH', rec('lead_check_events', ev.id), { value: 'x' }, anna.token)).status, 403);
		assert.equal((await api('DELETE', rec('lead_check_events', ev.id), null, anna.token)).status, 403);
		assert.equal((await list('lead_check_events', `lead="${lead}"`)).length, 1);
	});

	it('stays readable after the requirement is deleted (its checks go with it)', async () => {
		const req = await addRequirement('Gewonnen', 'Vertrag abgelegt', 'flag');
		const lead = await newLead();
		await check(lead, req.id, 'true');
		assert.equal((await api('DELETE', rec('stage_requirements', req.id), null, anna.token)).status, 204);
		assert.equal((await list('lead_checks', `lead="${lead}" && requirement="${req.id}"`)).length, 0);
		const [ev] = await list('lead_check_events', `lead="${lead}"`);
		assert.equal(ev.requirement_label, 'Vertrag abgelegt');
		assert.equal(ev.requirement, '');
	});
});

describe('POST /api/crm/leads (lead + confirmations in one transaction)', () => {
	const body = (extra = {}) => ({
		title: 'Über Route', company: company.id, contacts: [contact.id], owner: anna.id, rank: 'a0', ...extra
	});
	const counts = async () => ({
		leads: (await list('leads')).length,
		checks: (await list('lead_checks')).length,
		events: (await list('lead_check_events')).length
	});

	it('creates the lead and its checks, logged as confirmed by the user', async () => {
		const r = await api('POST', '/api/crm/leads', body({
			column: st.Verhandlung.id,
			checks: [{ requirement: flag.id, value: 'true' }, { requirement: text.id, value: ' S-9 ' }]
		}), ben.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		const lead = r.data.lead;
		assert.equal(lead.column, st.Verhandlung.id);
		assert.equal(lead.title, 'Über Route');
		assert.equal(r.data.checks.length, 2);
		const checks = await list('lead_checks', `lead="${lead.id}"`);
		assert.deepEqual(checks.map((c) => [c.requirement, c.value, c.by]).sort(), [
			[flag.id, 'true', ben.id],
			[text.id, 'S-9', ben.id]
		].sort());
		const events = await list('lead_check_events', `lead="${lead.id}"`);
		assert.deepEqual(events.map((e) => [e.action, e.by]), [['confirmed', ben.id], ['confirmed', ben.id]]);
	});

	it('works without checks in a stage without requirements', async () => {
		const r = await api('POST', '/api/crm/leads', body({ column: st.Neu.id }), anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		assert.deepEqual(r.data.checks, []);
	});

	it('refuses open requirements and creates nothing', async () => {
		const before = await counts();
		const r = await api('POST', '/api/crm/leads', body({
			column: st.Verhandlung.id,
			checks: [{ requirement: flag.id, value: 'true' }]
		}), anna.token);
		assert.equal(r.status, 400);
		assert.equal(r.data.data.column.code, 'gate_open');
		assert.match(r.data.data.column.message, /Siemens-Lead-Nummer/);
		assert.deepEqual(await counts(), before, 'rolled back: no lead, no check, no log entry');
	});

	it('rolls back when a later confirmation is invalid', async () => {
		const before = await counts();
		const r = await api('POST', '/api/crm/leads', body({
			column: st.Verhandlung.id,
			checks: [{ requirement: flag.id, value: 'true' }, { requirement: text.id, value: '  ' }]
		}), anna.token);
		assert.equal(r.status, 400);
		assert.ok(r.data.data.checks, JSON.stringify(r.data));
		assert.deepEqual(await counts(), before);
	});

	it('refuses unknown or duplicate requirements', async () => {
		let r = await api('POST', '/api/crm/leads', body({ column: st.Angebot.id, checks: [{ requirement: 'nope', value: 'true' }] }), anna.token);
		assert.equal(r.status, 400);
		r = await api('POST', '/api/crm/leads', body({
			column: st.Angebot.id,
			checks: [{ requirement: flag.id, value: 'true' }, { requirement: flag.id, value: 'true' }]
		}), anna.token);
		assert.equal(r.status, 400);
	});

	it('checks the create rule of `leads` like the normal create does', async () => {
		const col = (await api('GET', '/api/collections/leads', null, su)).data;
		const rule = col.createRule;
		const set = (createRule) => api('PATCH', '/api/collections/leads', { createRule }, su);
		assert.equal((await set(`${rule} && @request.body.title != "Verboten"`)).status, 200);
		try {
			const before = await counts();
			const r = await api('POST', '/api/crm/leads', body({ column: st.Neu.id, title: 'Verboten' }), anna.token);
			assert.equal(r.status, 403, JSON.stringify(r.data));
			assert.deepEqual(await counts(), before, 'rolled back');
			// the normal create API refuses it as well
			assert.ok((await api('POST', rec('leads'), body({ column: st.Neu.id, title: 'Verboten' }), anna.token)).status >= 400);
			assert.equal((await api('POST', '/api/crm/leads', body({ column: st.Neu.id, title: 'Erlaubt' }), anna.token)).status, 200);
		} finally {
			assert.equal((await set(rule)).status, 200);
		}
	});

	it('takes every lead field, also one added later (no fixed list)', async () => {
		const col = (await api('GET', '/api/collections/leads', null, su)).data;
		const fields = col.fields;
		assert.equal((await api('PATCH', '/api/collections/leads', { fields: [...fields, { name: 'zz_extra', type: 'text' }] }, su)).status, 200);
		try {
			const r = await api('POST', '/api/crm/leads', body({
				column: st.Neu.id, expected_close: '2026-12-31 00:00:00.000Z', zz_extra: 'mitgenommen'
			}), anna.token);
			assert.equal(r.status, 200, JSON.stringify(r.data));
			const lead = (await api('GET', rec('leads', r.data.lead.id), null, anna.token)).data;
			assert.equal(lead.zz_extra, 'mitgenommen');
			assert.equal(lead.expected_close, '2026-12-31 00:00:00.000Z');
			assert.equal(lead.rank, 'a0');
			assert.notEqual(lead.created, '', 'autodates are set by PocketBase, not taken from the body');
		} finally {
			assert.equal((await api('PATCH', '/api/collections/leads', { fields }, su)).status, 200);
		}
	});

	it('ignores autodates and the id in the body', async () => {
		const r = await api('POST', '/api/crm/leads', body({
			column: st.Neu.id, id: 'eigeneid1234567', created: '2000-01-01 00:00:00.000Z'
		}), anna.token);
		assert.equal(r.status, 200, JSON.stringify(r.data));
		assert.notEqual(r.data.lead.id, 'eigeneid1234567');
		assert.notEqual(r.data.lead.created.slice(0, 4), '2000');
	});

	it('reports invalid lead fields with the field name', async () => {
		const before = await counts();
		const r = await api('POST', '/api/crm/leads', body({ column: st.Neu.id, title: '' }), anna.token);
		assert.equal(r.status, 400);
		assert.ok(r.data.data.title, JSON.stringify(r.data));
		assert.deepEqual(await counts(), before);
	});
});
