// Records -> compact text for the tools (pure, unit-tested in render.test.js). Every record
// line carries its id so the agent can ask for details. Free text from outside is data:
// multi-line text (activity bodies with subject and attachment names, notes) is fenced
// (format.untrusted), everything on a line (titles, names, labels, values) goes through
// format.inline (no fake fences, no line breaks).
import {
	ACTIVITY_TYPES,
	compareTodos,
	contactName,
	dueStatus,
	fields,
	formatDate,
	formatDay,
	formatDue,
	htmlToText,
	inline,
	pageInfo,
	truncate,
	untrusted,
	userName
} from './format.js';

const DUE_LABEL = { overdue: 'überfällig', today: 'heute', later: 'später' };

/** @param {string|undefined} appUrl */
const link = (appUrl, path) => (appUrl ? `${appUrl.replace(/\/+$/, '')}${path}` : '');

/** One line for a contact: name, position, company, e-mail, phone, id. */
export function contactLine(c, company) {
	const co = company ?? c.expand?.company;
	return [contactName(c), c.position, co?.name, c.email, c.phone].map((v) => inline(v)).filter(Boolean).join(' · ') + ` (id: ${c.id})`;
}

/** One line for a lead: title, company, stage, owner, id. */
export function leadLine(l, { company = true, stage = true } = {}) {
	const parts = [inline(l.title)];
	if (company && l.expand?.company) parts.push(inline(l.expand.company.name));
	if (stage && l.expand?.column) parts.push(`Phase ${inline(l.expand.column.name)}`);
	if (l.expand?.owner) parts.push(`zuständig ${userName(l.expand.owner)}`);
	return parts.join(' · ') + ` (id: ${l.id})`;
}

/** "- [überfällig] 27.10.2026 Anrufen (id: …)" */
export function todoLine(t, now, tz, withLead = false) {
	const lead = withLead && t.expand?.lead;
	const leadPart = lead
		? ` – Lead: ${inline(lead.title)}${lead.expand?.company ? ` · ${inline(lead.expand.company.name)}` : ''} (lead: ${lead.id})`
		: '';
	return `- [${DUE_LABEL[dueStatus(t, now, tz)]}] ${formatDue(t, tz)} ${inline(t.title)}${leadPart} (id: ${t.id})`;
}

/** Attachment names (original names where the hook recorded them). */
function attachmentNames(a) {
	const files = Array.isArray(a.attachments) ? a.attachments : [];
	const names = a.attachment_names && typeof a.attachment_names === 'object' ? a.attachment_names : {};
	return files.map((f) => inline(names[f] || f, 200));
}

/**
 * An activity: header line (date, type, author, contacts, lead) and, fenced as data, its
 * subject, attachment names and text (HTML -> text, cut to maxChars).
 * `excerpt` = the body is already plain text (PocketBase `body:excerpt`).
 */
export function activityBlock(a, tz, maxChars, { excerpt = false, nonce } = {}) {
	const head = [formatDate(a.occurred_at, tz), ACTIVITY_TYPES[a.type] ?? inline(a.type)];
	if (a.expand?.author) head.push(`von ${userName(a.expand.author)}`);
	const contacts = a.expand?.contacts ?? [];
	if (contacts.length) head.push(`Kontakte: ${contacts.map(contactName).join(', ')}`);
	if (a.expand?.lead) head.push(`Lead: ${inline(a.expand.lead.title)} (lead: ${a.expand.lead.id})`);
	const meta = [];
	if (a.subject) meta.push(`Betreff: ${inline(a.subject, 500)}`);
	const files = attachmentNames(a);
	if (files.length) meta.push(`Anhänge: ${files.join(', ')}`);
	const text = truncate(excerpt ? String(a.body ?? '').trim() : htmlToText(a.body), maxChars);
	const body = untrusted([meta.join('\n'), text].filter(Boolean).join('\n\n'), nonce);
	return `- ${head.join(' · ')} (id: ${a.id})${body ? '\n' + body : ''}`;
}

/**
 * Gate status of a lead in its stage: the requirements that apply there (cumulative) with
 * their checks. `applicable` from stage-gates-lib (same rules as the server).
 */
export function gateSection(applicable, checks, tz) {
	if (!applicable.length) return '';
	const byReq = new Map(checks.map((c) => [c.requirement, c]));
	const lines = applicable.map((r) => {
		const c = byReq.get(r.id);
		const ok = c && (r.type === 'flag' ? c.value === 'true' : String(c.value ?? '').trim() !== '');
		if (ok) {
			const value = r.type === 'text' ? `: ${inline(c.value)}` : '';
			const who = c.expand?.by ? `, ${userName(c.expand.by)}` : '';
			return `- [erfüllt] ${inline(r.label)}${value} (${formatDate(c.updated || c.created, tz, false)}${who})`;
		}
		return `- [offen] ${inline(r.label)}${r.hint ? ` – Hinweis: ${inline(r.hint, 500)}` : ''}`;
	});
	const open = lines.filter((l) => l.startsWith('- [offen]')).length;
	const summary = open ? `${open} von ${applicable.length} offen` : 'alle erfüllt';
	return `Bedingungen bis zu dieser Phase (${summary}):\n${lines.join('\n')}`;
}

/**
 * get_lead
 * @param {{lead: any, activities: any[], activityTotal: number, todos: any[], gates: string, now: Date, tz: string, appUrl?: string}} d
 */
export function renderLead(d) {
	const { lead: l, tz } = d;
	const col = l.expand?.column;
	const board = col?.expand?.board;
	const head = fields([
		['Lead', `${inline(l.title)} (id: ${l.id})`],
		['Phase', col ? `${inline(col.name)}${col.closed ? ' (abgeschlossen)' : ''}${board ? ` – Pipeline ${inline(board.name)}` : ''}` : ''],
		['Zuständig', l.expand?.owner ? userName(l.expand.owner) : ''],
		['Unternehmen', l.expand?.company ? `${inline(l.expand.company.name)} (id: ${l.expand.company.id})` : ''],
		['Erwarteter Abschluss', formatDay(l.expected_close)],
		['Angelegt', formatDate(l.created, tz, false)],
		['Geändert', formatDate(l.updated, tz, false)],
		['Link', link(d.appUrl, `/leads/${l.id}`)]
	]);
	const out = [head];
	const contacts = l.expand?.contacts ?? [];
	out.push(contacts.length ? `Kontakte (${contacts.length}):\n${contacts.map((c) => '- ' + contactLine(c, null)).join('\n')}` : 'Kontakte: keine');
	if (d.gates) out.push(d.gates);
	const todos = [...d.todos].sort((a, b) => compareTodos(a, b, tz));
	out.push(todos.length ? `Offene To-Dos (${todos.length}):\n${todos.map((t) => todoLine(t, d.now, tz)).join('\n')}` : 'Offene To-Dos: keine (kein nächster Schritt geplant)');
	if (d.activities.length) {
		const more = d.activityTotal > d.activities.length ? ` – alle mit list_activities lead=${l.id}` : '';
		out.push(`Letzte Aktivitäten (${d.activities.length} von ${d.activityTotal}${more}):\n` + d.activities.map((a) => activityBlock(a, tz, 0, { excerpt: true, nonce: d.nonce })).join('\n'));
	} else {
		out.push('Aktivitäten: keine');
	}
	return out.join('\n\n');
}

/** get_company */
export function renderCompany({ company: c, contacts, leads, tz, appUrl, nonce }) {
	const out = [
		fields([
			['Unternehmen', `${inline(c.name)} (id: ${c.id})`],
			['Website', c.website],
			['E-Mail', c.email],
			['Telefon', c.phone],
			['Adresse', c.address],
			['Angelegt', formatDate(c.created, tz, false)],
			['Link', link(appUrl, '/unternehmen')]
		])
	];
	if (c.notes) out.push(`Notizen:\n${untrusted(truncate(c.notes, 2000), nonce)}`);
	out.push(contacts.length ? `Kontakte (${contacts.length}):\n${contacts.map((x) => '- ' + contactLine(x, c)).join('\n')}` : 'Kontakte: keine');
	out.push(leads.length ? `Leads (${leads.length}):\n${leads.map((x) => '- ' + leadLine(x, { company: false })).join('\n')}` : 'Leads: keine');
	return out.join('\n\n');
}

/** get_contact */
export function renderContact({ contact: c, leads, tz, nonce }) {
	const co = c.expand?.company;
	const out = [
		fields([
			['Kontakt', `${contactName(c)} (id: ${c.id})`],
			['Position', c.position],
			['Unternehmen', co ? `${inline(co.name)} (id: ${co.id})` : ''],
			['E-Mail', c.email],
			['Telefon', c.phone],
			['Angelegt', formatDate(c.created, tz, false)]
		])
	];
	if (c.notes) out.push(`Notizen:\n${untrusted(truncate(c.notes, 2000), nonce)}`);
	out.push(leads.length ? `Leads (${leads.length}):\n${leads.map((x) => '- ' + leadLine(x)).join('\n')}` : 'Leads: keine');
	return out.join('\n\n');
}

/** search: the three result groups, each with its count. */
export function renderSearch({ query, companies, contacts, leads }) {
	const groups = [];
	if (companies) {
		groups.push(
			companies.items.length
				? `Unternehmen (${companies.total}):\n` +
						companies.items.map((c) => `- ${[c.name, c.website, c.email].map((v) => inline(v)).filter(Boolean).join(' · ')} (id: ${c.id})`).join('\n')
				: 'Unternehmen: keine Treffer'
		);
	}
	if (contacts) {
		groups.push(contacts.items.length ? `Kontakte (${contacts.total}):\n${contacts.items.map((c) => '- ' + contactLine(c)).join('\n')}` : 'Kontakte: keine Treffer');
	}
	if (leads) {
		groups.push(leads.items.length ? `Leads (${leads.total}):\n${leads.items.map((l) => '- ' + leadLine(l)).join('\n')}` : 'Leads: keine Treffer');
	}
	const shown = [companies, contacts, leads].filter(Boolean);
	const cut = shown.some((g) => g.total > g.items.length) ? '\n\n(Nicht alle Treffer gezeigt – Suche genauer fassen oder limit erhöhen.)' : '';
	return `Suche nach „${inline(query)}“:\n\n${groups.join('\n\n')}${cut}`;
}

/**
 * list_pipeline: stages in order with their leads (already sorted by rank) and each lead's
 * next to-do; leads without one in an open stage are flagged.
 * @param {{board: any, boards: any[], columns: any[], leads: any[], nextTodo: Map<string, any>, ownerLabel?: string, limit: number, now: Date, tz: string}} d
 */
export function renderPipeline(d) {
	const { tz, now } = d;
	const byColumn = new Map(d.columns.map((c) => [c.id, []]));
	for (const l of d.leads) byColumn.get(l.column)?.push(l);
	const filter = d.ownerLabel ? `, zuständig: ${d.ownerLabel}` : '';
	const others = d.boards.filter((b) => b.id !== d.board.id);
	const head =
		`Pipeline ${inline(d.board.name)} (id: ${d.board.id}) – ${d.leads.length} Leads${filter}` +
		(others.length ? `\nWeitere Pipelines: ${others.map((b) => `${inline(b.name)} (id: ${b.id})`).join(', ')}` : '');
	const sections = d.columns.map((c) => {
		const list = byColumn.get(c.id) ?? [];
		const flags = [c.closed ? 'abgeschlossen' : '', c.wip_limit ? `WIP-Limit ${c.wip_limit}` : ''].filter(Boolean);
		const title = `## ${inline(c.name)}${flags.length ? ` (${flags.join(', ')})` : ''} – ${list.length}`;
		const lines = list.slice(0, d.limit).map((l) => {
			const parts = [inline(l.title)];
			if (l.expand?.company) parts.push(inline(l.expand.company.name));
			if (l.expand?.owner && !d.ownerLabel) parts.push(userName(l.expand.owner));
			if (l.expected_close) parts.push(`Abschluss ${formatDay(l.expected_close)}`);
			const t = d.nextTodo.get(l.id);
			if (t) parts.push(`nächstes To-Do: ${formatDue(t, tz)} ${inline(t.title)} [${DUE_LABEL[dueStatus(t, now, tz)]}]`);
			else if (!c.closed) parts.push('kein nächster Schritt');
			return `- ${parts.join(' · ')} (id: ${l.id})`;
		});
		if (list.length > d.limit) lines.push(`- … ${list.length - d.limit} weitere (limit_per_stage erhöhen)`);
		return [title, ...lines].join('\n');
	});
	return [head, ...sections].join('\n\n');
}

/** list_activities */
export function renderActivities({ title, items, page, totalPages, totalItems, tz, maxChars, nonce }) {
	if (!items.length) return `${title}: keine Aktivitäten${page > 1 ? ' auf dieser Seite' : ''}.`;
	const info = pageInfo(page, totalPages, totalItems);
	return `${title} (${totalItems}${info ? `; ${info}` : ''}):\n\n` + items.map((a) => activityBlock(a, tz, maxChars, { nonce })).join('\n\n');
}

/** my_todos: grouped overdue / today / later, each sorted. */
export function renderTodos({ todos, now, tz, who, limit }) {
	const groups = { overdue: [], today: [], later: [] };
	for (const t of [...todos].sort((a, b) => compareTodos(a, b, tz))) groups[dueStatus(t, now, tz)].push(t);
	if (!todos.length) return `Keine offenen To-Dos ${who}.`;
	const titles = { overdue: 'Überfällig', today: 'Heute', later: 'Später' };
	const out = [`Offene To-Dos ${who}: ${todos.length}`];
	for (const key of ['overdue', 'today', 'later']) {
		const g = groups[key];
		if (!g.length) continue;
		const lines = g.slice(0, limit).map((t) => todoLine(t, now, tz, true));
		if (g.length > limit) lines.push(`- … ${g.length - limit} weitere (limit erhöhen)`);
		out.push(`${titles[key]} (${g.length}):\n${lines.join('\n')}`);
	}
	return out.join('\n\n');
}
