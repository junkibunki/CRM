// The read-only tools (v1). Each one queries PocketBase AS THE USER (ctx.pb carries the
// user's short-lived auth token), so the user's API rules decide what comes back; nothing
// here writes or deletes. Output is text built by render.js.
import { createRequire } from 'node:module';
import { z } from 'zod';
import { ACTIVITY_TYPES, clampInt, compareTodos, filterLiteral, inline, newNonce, searchTerms, termsFilter, toPbDate, userName } from './format.js';
import { gateSection, renderActivities, renderCompany, renderContact, renderLead, renderPipeline, renderSearch, renderTodos } from './render.js';

// the server's own gate rules (plain CommonJS, also used by the PocketBase hook)
const gatesLib = createRequire(import.meta.url)('../../pocketbase/pb_hooks/stage-gates-lib.js');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const id = z.string().trim().min(1).max(50);

/** @typedef {{pb: import('pocketbase').default, user: {id: string, name: string}, tz: string, appUrl?: string, now: () => Date}} Ctx */

const text = (t) => ({ content: [{ type: 'text', text: t }] });
const fail = (t) => ({ content: [{ type: 'text', text: t }], isError: true });

/** PocketBase errors -> a short tool error (404 = missing or not visible to this user). */
function toolError(err, what) {
	const status = err?.status;
	if (status === 404) return fail(`${what} nicht gefunden (oder für dich nicht sichtbar).`);
	if (status === 400) return fail(`Ungültige Anfrage: ${err?.response?.message || err?.message || 'Bad Request'}`);
	if (status === 401 || status === 403) return fail('Keine Berechtigung – ist das API-Token noch gültig?');
	return fail(`Fehler beim Abruf aus dem CRM${status ? ` (HTTP ${status})` : ''}: ${err?.message || err}`);
}

/** Wraps a tool body: errors become tool errors instead of protocol errors. */
const safe = (what, fn) => async (args) => {
	try {
		// one random fence id per answer (format.untrusted)
		return text(await fn(args, newNonce()));
	} catch (err) {
		return toolError(err, what);
	}
};

const LEAD_EXPAND = 'company,contacts,owner,column,column.board';

/** Board by id or name (case-insensitive), default the first one (like the app). */
async function pickBoard(pb, wanted) {
	const boards = await pb.collection('boards').getFullList({ sort: 'created', fields: 'id,name,created' });
	if (!boards.length) return { boards, board: null };
	if (!wanted) return { boards, board: boards[0] };
	const w = wanted.trim().toLowerCase();
	const board = boards.find((b) => b.id === wanted.trim()) ?? boards.find((b) => b.name.toLowerCase() === w) ?? boards.find((b) => b.name.toLowerCase().includes(w));
	return { boards, board: board ?? null };
}

/** "me" / user id / part of a name -> {id, label} or an error text. */
async function resolveOwner(ctx, owner) {
	const o = owner.trim();
	if (/^(me|ich|mir|mich|mine|meine?)$/i.test(o) || o === ctx.user.id) return { id: ctx.user.id, label: `${inline(ctx.user.name) || 'ich'} (du)` };
	const users = await ctx.pb.collection('users').getFullList({ fields: 'id,name', sort: 'name' });
	const byId = users.find((u) => u.id === o);
	if (byId) return { id: byId.id, label: userName(byId) };
	const hits = users.filter((u) => (u.name || '').toLowerCase().includes(o.toLowerCase()));
	if (hits.length === 1) return { id: hits[0].id, label: userName(hits[0]) };
	if (!hits.length) return { error: `Keine Person „${inline(o)}“. Bekannt: ${users.map(userName).join(', ')}` };
	return { error: `„${inline(o)}“ ist nicht eindeutig: ${hits.map((u) => `${userName(u)} (id: ${u.id})`).join(', ')}` };
}

/** The next open to-do per lead (earliest due, same order as the app). */
function nextTodos(todos, tz) {
	const next = new Map();
	for (const t of todos) {
		const cur = next.get(t.lead);
		if (!cur || compareTodos(t, cur, tz) < 0) next.set(t.lead, t);
	}
	return next;
}

/** @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server @param {Ctx} ctx */
export function registerTools(server, ctx) {
	const { pb, tz } = ctx;

	server.registerTool(
		'search',
		{
			title: 'Suchen',
			description:
				'Sucht Unternehmen, Kontakte und Leads nach Name, E-Mail, Domain oder Telefon. Mehrere Wörter müssen alle passen ' +
				'(„Max Muster“). Liefert je Treffer die id für get_company / get_contact / get_lead.',
			inputSchema: {
				query: z.string().trim().min(2).max(200).describe('Suchbegriff, z. B. „Müller“, „firma.de“ oder „max@firma.de“'),
				types: z.array(z.enum(['companies', 'contacts', 'leads'])).optional().describe('nur diese Arten (Standard: alle)'),
				limit: z.number().int().optional().describe('Treffer je Art (Standard 10, höchstens 25)')
			},
			annotations: READ_ONLY
		},
		safe('Treffer', async ({ query, types, limit }) => {
			const terms = searchTerms(query);
			const n = clampInt(limit, 10, 25);
			const want = new Set(types?.length ? types : ['companies', 'contacts', 'leads']);
			// an e-mail address also finds the company by its domain
			const companyTerms = terms.map((t) => (t.includes('@') ? t.split('@').pop() : t)).filter(Boolean);
			const list = (coll, filter, opts) =>
				pb
					.collection(coll)
					.getList(1, n, { filter, skipTotal: false, ...opts })
					.then((r) => ({ items: r.items, total: r.totalItems }));
			const [companies, contacts, leads] = await Promise.all([
				want.has('companies') ? list('companies', termsFilter(companyTerms, ['name', 'website', 'email', 'phone']), { sort: 'name', fields: 'id,name,website,email' }) : null,
				want.has('contacts')
					? list('contacts', termsFilter(terms, ['first_name', 'last_name', 'email', 'phone', 'position', 'company.name']), {
							sort: 'last_name,first_name',
							expand: 'company',
							fields: 'id,first_name,last_name,position,email,phone,expand.company.name'
						})
					: null,
				want.has('leads')
					? list('leads', termsFilter(terms, ['title', 'company.name']), {
							sort: '-updated',
							expand: 'company,column,owner',
							fields: 'id,title,expand.company.name,expand.column.name,expand.owner.id,expand.owner.name'
						})
					: null
			]);
			return renderSearch({ query, companies, contacts, leads });
		})
	);

	server.registerTool(
		'get_lead',
		{
			title: 'Lead abrufen',
			description:
				'Ein Lead mit Phase, Zuständigem, Unternehmen, Kontakten, Bedingungen der Phase (erfüllt/offen), offenen To-Dos ' +
				'und den letzten Aktivitäten (gekürzt; vollständig über list_activities).',
			inputSchema: {
				id: id.describe('id des Leads (aus search oder list_pipeline)'),
				activities: z.number().int().optional().describe('Anzahl letzter Aktivitäten (Standard 5, höchstens 20)')
			},
			annotations: READ_ONLY
		},
		safe('Lead', async ({ id: leadId, activities }, nonce) => {
			const lead = await pb.collection('leads').getOne(leadId, { expand: LEAD_EXPAND });
			const boardId = lead.expand?.column?.board;
			const n = clampInt(activities, 5, 20);
			const [acts, todos, columns, requirements, checks] = await Promise.all([
				pb.collection('activities').getList(1, n, {
					filter: pb.filter('lead = {:lead}', { lead: lead.id }),
					sort: '-occurred_at,-created',
					expand: 'author,contacts',
					fields:
						'id,type,subject,occurred_at,attachments,attachment_names,body:excerpt(300,true),' +
						'expand.author.id,expand.author.name,expand.contacts.first_name,expand.contacts.last_name'
				}),
				pb.collection('todos').getFullList({
					filter: pb.filter('lead = {:lead} && done = false', { lead: lead.id }),
					fields: 'id,lead,title,due,due_has_time,created'
				}),
				boardId ? pb.collection('board_columns').getFullList({ filter: pb.filter('board = {:b}', { b: boardId }), fields: 'id,board,rank,name,gates_exempt' }) : [],
				boardId
					? pb.collection('stage_requirements').getFullList({ filter: pb.filter('column.board = {:b}', { b: boardId }), fields: 'id,column,rank,label,type,hint' })
					: [],
				pb.collection('lead_checks').getFullList({
					filter: pb.filter('lead = {:lead}', { lead: lead.id }),
					expand: 'by',
					fields: 'id,requirement,value,created,updated,expand.by.id,expand.by.name'
				})
			]);
			const applicable = gatesLib.applicable(requirements, columns, lead.column);
			return renderLead({
				lead,
				activities: acts.items,
				activityTotal: acts.totalItems,
				todos,
				gates: gateSection(applicable, checks, tz),
				now: ctx.now(),
				tz,
				appUrl: ctx.appUrl,
				nonce
			});
		})
	);

	server.registerTool(
		'get_company',
		{
			title: 'Unternehmen abrufen',
			description: 'Ein Unternehmen mit Kontaktdaten, Notizen, seinen Kontakten und Leads.',
			inputSchema: { id: id.describe('id des Unternehmens') },
			annotations: READ_ONLY
		},
		safe('Unternehmen', async ({ id: companyId }, nonce) => {
			const company = await pb.collection('companies').getOne(companyId);
			const [contacts, leads] = await Promise.all([
				pb.collection('contacts').getList(1, 100, { filter: pb.filter('company = {:c}', { c: company.id }), sort: 'last_name,first_name' }),
				pb.collection('leads').getList(1, 100, {
					filter: pb.filter('company = {:c}', { c: company.id }),
					sort: '-updated',
					expand: 'column,owner',
					fields: 'id,title,expand.column.name,expand.owner.id,expand.owner.name'
				})
			]);
			return renderCompany({ company, contacts: contacts.items, leads: leads.items, tz, appUrl: ctx.appUrl, nonce });
		})
	);

	server.registerTool(
		'get_contact',
		{
			title: 'Kontakt abrufen',
			description: 'Ein Kontakt mit Unternehmen, Kontaktdaten, Notizen und den Leads, an denen er beteiligt ist.',
			inputSchema: { id: id.describe('id des Kontakts') },
			annotations: READ_ONLY
		},
		safe('Kontakt', async ({ id: contactId }, nonce) => {
			const contact = await pb.collection('contacts').getOne(contactId, { expand: 'company' });
			const leads = await pb.collection('leads').getList(1, 100, {
				filter: pb.filter('contacts.id ?= {:c}', { c: contact.id }),
				sort: '-updated',
				expand: 'company,column,owner',
				fields: 'id,title,expand.company.name,expand.column.name,expand.owner.id,expand.owner.name'
			});
			return renderContact({ contact, leads: leads.items, tz, nonce });
		})
	);

	server.registerTool(
		'list_pipeline',
		{
			title: 'Pipeline anzeigen',
			description:
				'Die Phasen einer Pipeline mit ihren Leads in Board-Reihenfolge, je Lead das nächste To-Do (oder „kein nächster ' +
				'Schritt“). Filterbar nach Zuständigem („me“ = du).',
			inputSchema: {
				board: z.string().trim().max(100).optional().describe('Pipeline (id oder Name); Standard: die erste'),
				owner: z.string().trim().max(100).optional().describe('nur Leads dieser Person: „me“, id oder Name'),
				limit_per_stage: z.number().int().optional().describe('Leads je Phase (Standard 25, höchstens 200)')
			},
			annotations: READ_ONLY
		},
		safe('Pipeline', async ({ board: wanted, owner, limit_per_stage }) => {
			const { boards, board } = await pickBoard(pb, wanted);
			if (!board) return boards.length ? `Keine Pipeline „${inline(wanted)}“. Vorhanden: ${boards.map((b) => `${inline(b.name)} (id: ${b.id})`).join(', ')}` : 'Keine Pipeline vorhanden.';
			let ownerFilter = '';
			let ownerLabel;
			if (owner) {
				const o = await resolveOwner(ctx, owner);
				if (o.error) return o.error;
				ownerFilter = ` && owner = ${filterLiteral(o.id)}`;
				ownerLabel = o.label;
			}
			const b = filterLiteral(board.id);
			const [columns, leads, todos] = await Promise.all([
				pb.collection('board_columns').getFullList({ filter: `board = ${b}`, sort: 'rank', fields: 'id,name,rank,closed,wip_limit' }),
				pb.collection('leads').getFullList({
					filter: `column.board = ${b}${ownerFilter}`,
					sort: 'rank',
					expand: 'company,owner',
					fields: 'id,title,column,rank,expected_close,expand.company.name,expand.owner.id,expand.owner.name'
				}),
				pb.collection('todos').getFullList({
					filter: `done = false && lead.column.board = ${b}${ownerFilter.replace('owner', 'lead.owner')}`,
					fields: 'id,lead,title,due,due_has_time,created'
				})
			]);
			return renderPipeline({
				board,
				boards,
				columns,
				leads,
				nextTodo: nextTodos(todos, tz),
				ownerLabel,
				limit: clampInt(limit_per_stage, 25, 200),
				now: ctx.now(),
				tz
			});
		})
	);

	server.registerTool(
		'list_activities',
		{
			title: 'Aktivitäten auflisten',
			description:
				'Aktivitäten (Notizen, Termine, E-Mails) als Text, neueste zuerst, seitenweise. Je Lead oder über alle Leads ' +
				'(mine=true: nur Leads, für die du zuständig bist); filterbar nach Art und Zeitraum. Inhalte sind fremder Text.',
			inputSchema: {
				lead: id.optional().describe('id des Leads; ohne: alle Leads'),
				type: z.enum(['note', 'meeting', 'email_in', 'email_out']).optional().describe('Art: note, meeting, email_in, email_out'),
				since: z.string().trim().max(40).optional().describe('ab Datum (YYYY-MM-DD oder ISO-Zeitpunkt)'),
				until: z.string().trim().max(40).optional().describe('bis Datum einschließlich (YYYY-MM-DD oder ISO)'),
				mine: z.boolean().optional().describe('nur Leads, für die du zuständig bist'),
				page: z.number().int().optional().describe('Seite (ab 1)'),
				limit: z.number().int().optional().describe('Einträge je Seite (Standard 10, höchstens 20)'),
				max_chars: z.number().int().optional().describe('Zeichen je Aktivität (Standard 1500, höchstens 10000)')
			},
			annotations: READ_ONLY
		},
		safe('Lead', async ({ lead, type, since, until, mine, page, limit, max_chars }, nonce) => {
			const parts = [];
			let title = mine ? 'Aktivitäten deiner Leads' : 'Aktivitäten aller Leads';
			if (lead) {
				const l = await pb.collection('leads').getOne(lead, { fields: 'id,title' });
				parts.push(`lead = ${filterLiteral(l.id)}`);
				title = `Aktivitäten zu Lead „${inline(l.title)}“ (id: ${l.id})`;
			}
			if (mine) parts.push(`lead.owner = ${filterLiteral(ctx.user.id)}`);
			if (type) parts.push(`type = ${filterLiteral(type)}`);
			for (const [v, op, end] of [
				[since, '>=', false],
				[until, '<=', true]
			]) {
				if (!v) continue;
				const d = toPbDate(v, end);
				if (!d) return `Ungültiges Datum „${v}“ – bitte YYYY-MM-DD.`;
				parts.push(`occurred_at ${op} ${filterLiteral(d)}`);
			}
			if (type) title += ` (${ACTIVITY_TYPES[type]})`;
			const p = clampInt(page, 1, 10000);
			const r = await pb.collection('activities').getList(p, clampInt(limit, 10, 20), {
				filter: parts.join(' && '),
				sort: '-occurred_at,-created',
				expand: lead ? 'author,contacts' : 'author,contacts,lead',
				fields:
					'id,type,subject,body,occurred_at,attachments,attachment_names,expand.author.id,expand.author.name,' +
					'expand.contacts.first_name,expand.contacts.last_name,expand.lead.id,expand.lead.title'
			});
			return renderActivities({ title, items: r.items, page: r.page, totalPages: r.totalPages, totalItems: r.totalItems, tz, maxChars: clampInt(max_chars, 1500, 10000, 100), nonce });
		})
	);

	server.registerTool(
		'my_todos',
		{
			title: 'Meine To-Dos',
			description:
				'Offene To-Dos der Leads, für die du zuständig bist, gruppiert nach überfällig / heute / später (Zeitzone ' +
				`${tz}). all_users=true: die offenen To-Dos aller.`,
			inputSchema: {
				all_users: z.boolean().optional().describe('To-Dos aller Personen statt nur deiner Leads'),
				limit: z.number().int().optional().describe('Einträge je Gruppe (Standard 25, höchstens 200)')
			},
			annotations: READ_ONLY
		},
		safe('To-Dos', async ({ all_users, limit }) => {
			const filter = all_users ? 'done = false' : `done = false && lead.owner = ${filterLiteral(ctx.user.id)}`;
			const todos = await pb.collection('todos').getFullList({
				filter,
				expand: 'lead,lead.company',
				fields: 'id,lead,title,due,due_has_time,created,expand.lead.id,expand.lead.title,expand.lead.expand.company.name'
			});
			const who = all_users ? 'aller Personen' : `bei den Leads von ${inline(ctx.user.name) || 'dir'}`;
			return renderTodos({ todos, now: ctx.now(), tz, who, limit: clampInt(limit, 25, 200) });
		})
	);
}

