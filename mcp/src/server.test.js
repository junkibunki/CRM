// The HTTP layer without a real PocketBase: a fake token-exchange endpoint answers 200,
// 401, 403, 429 or 500, and the tests check what the MCP endpoint makes of it.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { allowedFrom, checkHostOrigin, createHttpServer, exchangeToken, hostname } from './server.js';
import { PROMPTS } from './prompts.js';

const SECRET = 'unit-test-secret-0123456789abcdef';
const GOOD = 'crm_' + 'a'.repeat(43);
const LIMITED = 'crm_' + 'l'.repeat(43);
const BROKEN = 'crm_' + 'x'.repeat(43);
let fakePb;
let mcp;
let PB;
let MCP;
const seen = [];

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

before(async () => {
	fakePb = http.createServer((req, res) => {
		seen.push({ url: req.url, auth: req.headers.authorization, secret: req.headers['x-crm-mcp-secret'] });
		const send = (status, body) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		if (req.url !== '/api/crm/token-exchange') return send(404, {});
		if (req.headers['x-crm-mcp-secret'] !== SECRET) return send(403, { message: 'secret' });
		if (req.headers.authorization === `Bearer ${GOOD}`) return send(200, { token: 'jwt', expires_in: 300, user: { id: 'u1', name: 'Anna' } });
		if (req.headers.authorization === `Bearer ${LIMITED}`) return send(429, { message: 'Zu viele' });
		if (req.headers.authorization === `Bearer ${BROKEN}`) return send(500, {});
		return send(401, { message: 'no' });
	});
	PB = await listen(fakePb);
	mcp = createHttpServer({ pbUrl: PB, secret: SECRET, appUrl: 'https://crm.example.de', log: () => {} });
	MCP = (await listen(mcp)) + '/mcp';
});

after(async () => {
	for (const s of [mcp, fakePb]) {
		s.closeAllConnections?.();
		await new Promise((r) => s.close(r));
	}
});

const LIST = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };

const post = (token, body = LIST, url = MCP, headers = {}) =>
	fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			accept: 'application/json, text/event-stream',
			...(token && { authorization: `Bearer ${token}` }),
			...headers
		},
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});

/** raw request with a chosen Host header (fetch can't set it) */
function rawPost(host, extra = {}) {
	const u = new URL(MCP);
	return new Promise((resolve, reject) => {
		const req = http.request(
			{ host: u.hostname, port: u.port, path: '/mcp', method: 'POST', headers: { host, 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${GOOD}`, ...extra } },
			(res) => {
				res.resume();
				res.on('end', () => resolve(res.statusCode));
			}
		);
		req.on('error', reject);
		req.end(JSON.stringify(LIST));
	});
}

describe('exchangeToken', () => {
	it('sends the shared secret and maps the PocketBase answers', async () => {
		assert.deepEqual(await exchangeToken(PB, GOOD, SECRET), { ok: true, token: 'jwt', user: { id: 'u1', name: 'Anna' } });
		assert.equal(seen.at(-1).secret, SECRET);
		assert.equal((await exchangeToken(PB, 'crm_' + 'b'.repeat(43), SECRET)).status, 401);
		assert.equal((await exchangeToken(PB, LIMITED, SECRET)).status, 429);
		assert.equal((await exchangeToken(PB, BROKEN, SECRET)).status, 502);
		assert.equal((await exchangeToken('http://127.0.0.1:1', GOOD, SECRET)).status, 502, 'unreachable');
	});

	it('a wrong secret is a setup error (502 + log), not the user’s 401', async () => {
		const logged = [];
		const r = await exchangeToken(PB, GOOD, 'wrong', (m) => logged.push(m));
		assert.equal(r.status, 502);
		assert.match(logged[0], /CRM_MCP_SECRET/);
	});
});

describe('HTTP endpoint', () => {
	it('answers 401 without a token, without asking PocketBase', async () => {
		const before = seen.length;
		const r = await post(null);
		assert.equal(r.status, 401);
		assert.match(r.headers.get('www-authenticate'), /^Bearer/);
		assert.equal((await r.json()).error.code, -32001);
		assert.equal((await post('eyJhbGciOi.session.jwt')).status, 401);
		assert.equal(seen.length, before, 'malformed tokens never reach PocketBase');
	});

	it('passes 401 and 429 of the exchange through', async () => {
		const r = await post('crm_' + 'b'.repeat(43));
		assert.equal(r.status, 401);
		assert.match(r.headers.get('www-authenticate'), /invalid_token/);
		assert.equal((await post(LIMITED)).status, 429);
		assert.equal((await post(BROKEN)).status, 502);
	});

	it('serves the tool list with a valid token (no PocketBase query needed)', async () => {
		const r = await post(GOOD);
		assert.equal(r.status, 200);
		const body = await r.json();
		assert.equal(body.result.tools.length, 7);
		assert.ok(seen.at(-1).auth === `Bearer ${GOOD}`);
	});

	it('refuses JSON-RPC batches (one message per request), takes a batch of one', async () => {
		const before = seen.length;
		const r = await post(GOOD, [LIST, { ...LIST, id: 2 }]);
		assert.equal(r.status, 400);
		assert.equal((await r.json()).error.code, -32600);
		assert.equal((await post(GOOD, [])).status, 400);
		assert.equal(seen.length, before, 'no exchange for a refused batch');
		const one = await post(GOOD, [LIST]);
		assert.equal(one.status, 200);
	});

	it('only POST /mcp; health check; bad JSON', async () => {
		assert.equal((await fetch(MCP)).status, 405);
		assert.equal((await fetch(MCP, { method: 'DELETE' })).status, 405);
		assert.equal((await fetch(MCP.replace('/mcp', '/health'))).status, 200);
		assert.equal((await post(GOOD, undefined, MCP.replace('/mcp', '/other'))).status, 404);
		assert.equal((await post(GOOD, '{nope')).status, 400);
	});

	it('DNS rebinding: foreign Host or Origin -> 403', async () => {
		assert.equal(await rawPost('evil.example:80'), 403);
		assert.equal(await rawPost('crm.example.de'), 200, 'the app host (behind the proxy)');
		assert.equal(await rawPost('localhost:8200'), 200);
		assert.equal((await post(GOOD, LIST, MCP, { origin: 'https://evil.example' })).status, 403);
		assert.equal((await post(GOOD, LIST, MCP, { origin: 'https://crm.example.de' })).status, 200);
	});

	it('refuses to start with an unknown time zone or without a secret', () => {
		assert.throws(() => createHttpServer({ pbUrl: PB, secret: SECRET, tz: 'Mars/Olympus' }), /CRM_TZ/);
		assert.throws(() => createHttpServer({ pbUrl: PB }), /CRM_MCP_SECRET/);
		assert.throws(() => createHttpServer({ pbUrl: PB, secret: 'short' }), /CRM_MCP_SECRET/);
	});
});

describe('host and origin rules', () => {
	it('strips ports, keeps IPv6 brackets', () => {
		assert.equal(hostname('LocalHost:8200'), 'localhost');
		assert.equal(hostname('[::1]:8200'), '[::1]');
		assert.equal(hostname(undefined), '');
	});

	it('localhost, the app URL and the extras from env', () => {
		const a = allowedFrom({ appUrl: 'https://crm.x.de/', hosts: 'mcp.x.de, other:443', origins: 'https://tool.x.de/' });
		assert.deepEqual([...a.hosts], ['localhost', '127.0.0.1', '[::1]', 'crm.x.de', 'mcp.x.de', 'other']);
		assert.deepEqual([...a.origins], ['https://crm.x.de', 'https://tool.x.de']);
		assert.equal(checkHostOrigin({ host: 'mcp.x.de' }, a), null);
		assert.match(checkHostOrigin({}, a), /Host/);
		assert.match(checkHostOrigin({ host: 'crm.x.de', origin: 'null' }, a), /Origin/);
	});
});

describe('prompts', () => {
	it('the four templates from F15 mention the tools and the data rule', () => {
		assert.deepEqual(PROMPTS.map((p) => p.name), ['lead_briefing', 'weekly_report', 'stale_leads', 'meeting_followup']);
		const brief = PROMPTS[0].build({ lead: 'X' }).messages[0].content.text;
		assert.match(brief, /get_lead/);
		assert.match(brief, /FREMDTEXT/);
		const weekly = PROMPTS[1].build({ days: '400' }).messages[0].content.text;
		assert.match(weekly, /letzten 90 Tage/);
		assert.match(PROMPTS[2].build({}).messages[0].content.text, /owner="me"/);
		assert.doesNotMatch(PROMPTS[2].build({ owner: 'alle' }).messages[0].content.text, /owner=/);
		const follow = PROMPTS[3].build({ lead: 'X', notes: '- Preis ok' }).messages[0].content.text;
		assert.match(follow, /Speichere nichts/);
		assert.match(follow, /- Preis ok/);
	});
});
