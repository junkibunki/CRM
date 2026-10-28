// Deterministic suggestions for a new contact from its e-mail address (F9): first and last
// name from the local part, company from the domain. Pure, no network: the dialog shows the
// result as chips the user can take over, nothing is applied automatically.

export type CompanyLike = { id: string; name: string; website: string };

export type NameSuggestion = {
	value: string;
	/** variant with umlauts (`Mueller` → `Müller`), only a hint: `Mueller` exists as well */
	umlaut: string | null;
};

export type CompanySuggestion =
	| {
			kind: 'existing';
			id: string;
			name: string;
			/** website = same domain; name = no website match, but the same name as the domain */
			match: 'website' | 'name';
		}
	| { kind: 'new'; domain: string; name: string; website: string };

export type EmailSuggestion = {
	first_name: NameSuggestion | null;
	last_name: NameSuggestion | null;
	company: CompanySuggestion | null;
};

const NONE: EmailSuggestion = { first_name: null, last_name: null, company: null };

// local parts that name a function, not a person (compared without separators and digits)
const ROLE_ADDRESSES = new Set([
	'info', 'kontakt', 'contact', 'vertrieb', 'sales', 'office', 'service', 'support',
	'buchhaltung', 'accounting', 'noreply', 'donotreply', 'mail', 'email', 'post', 'hello',
	'hallo', 'admin', 'administrator', 'webmaster', 'postmaster', 'hostmaster', 'mailerdaemon',
	'root', 'team', 'empfang', 'zentrale', 'sekretariat', 'buero', 'büro', 'rechnung',
	'rechnungen', 'invoice', 'invoices', 'billing', 'bewerbung', 'bewerbungen', 'jobs',
	'karriere', 'career', 'careers', 'presse', 'press', 'marketing', 'einkauf', 'verwaltung',
	'personal', 'hr', 'datenschutz', 'privacy', 'newsletter', 'news', 'auftrag', 'bestellung',
	'bestellungen', 'order', 'orders', 'shop', 'anfrage', 'anfragen', 'abuse', 'security',
	'helpdesk', 'hotline', 'technik', 'kundenservice', 'customerservice', 'notification',
	'notifications', 'termine', 'mitglieder', 'redaktion', 'it'
]);

// whole domains of mail providers: a contact there says nothing about its company
const FREEMAIL_DOMAINS = new Set([
	'web.de', 't-online.de', 'me.com', 'mac.com', 'live.com', 'live.de', 'msn.com',
	'posteo.de', 'posteo.net', 'mailbox.org', 'freenet.de', 'arcor.de', 'online.de',
	'1und1.de', 'email.de', 'mail.de', 'mail.com', 'vodafone.de', 'vodafonemail.de',
	'kabelmail.de', 'magenta.de', 'proton.me', 'pm.me', 'tuta.io', 'tuta.com', 'gmx.info',
	'bluewin.ch', 'hispeed.ch', 'a1.net', 'chello.at', 'aon.at', 'zoho.com', 'yandex.ru',
	'yandex.com', 'mail.ru'
]);
// provider names that are freemail under any top-level domain (gmx.de, gmx.net, yahoo.co.uk …)
const FREEMAIL_NAMES = new Set([
	'gmail', 'googlemail', 'gmx', 'outlook', 'hotmail', 'yahoo', 'ymail', 'icloud', 'aol',
	'protonmail', 'tutanota'
]);

// two-level public suffixes, so `firma.co.uk` gives `firma` and not `co`
const SECOND_LEVEL = new Set([
	'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'co.at', 'or.at',
	'ac.at', 'gv.at', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.za', 'co.jp', 'com.br',
	'com.tr', 'com.cn', 'com.pl', 'com.es', 'co.il', 'co.in'
]);

// name particles stay lowercase and belong to the last name (`anna.von.mueller`)
const PARTICLES = new Set([
	'von', 'van', 'de', 'der', 'den', 'zu', 'vom', 'zum', 'zur', 'ten', 'ter', 'da', 'di',
	'del', 'du', 'dos'
]);

// names whose ae/oe/ue is no umlaut (Michael, Manuel, Joel …)
const NO_UMLAUT = new Set([
	'michael', 'michaela', 'raphael', 'rafael', 'raphaela', 'rafaela', 'mikael', 'gael',
	'israel', 'ismael', 'manuel', 'manuela', 'emanuel', 'immanuel', 'samuel', 'miguel',
	'joel', 'noel', 'noemi', 'zoe', 'chloe', 'joe', 'goethe'
]);

// connectors that stay lowercase inside a company name (`mueller-und-soehne`)
const LOWER_WORDS = new Set(['und', 'and', 'of', 'the', 'der', 'die', 'das', 'von', 'zu', 'am', 'im']);

// tokens ignored when comparing company names (legal forms, connectors)
const NAME_NOISE = new Set([
	'gmbh', 'mbh', 'ag', 'kg', 'kgaa', 'ohg', 'ug', 'gbr', 'se', 'co', 'ek', 'ev', 'eg',
	'partg', 'haftungsbeschraenkt', 'ltd', 'limited', 'inc', 'llc', 'corp', 'sa', 'sarl',
	'bv', 'nv', 'und', 'and', 'e', 'k', 'v', 'g'
]);

// trailing marker for external staff, not part of the name
const EXTERNAL = new Set(['extern', 'external', 'ext']);

const LETTERS = /^\p{L}+(?:-\p{L}+)*$/u;
const LABEL = /^(?:[\p{L}\d](?:[\p{L}\d-]*[\p{L}\d])?)$/u;

export function suggestFromEmail(email: string, companies: readonly CompanyLike[]): EmailSuggestion {
	const at = email.trim().lastIndexOf('@');
	if (at <= 0) return NONE;
	const local = email.trim().slice(0, at);
	const domain = normalizeDomain(email.trim().slice(at + 1));
	if (!domain || /\s/.test(local)) return NONE;
	return { ...suggestName(local), company: suggestCompany(domain, companies) };
}

/** e-mail domain → lowercase host without `www.`; '' when it is no valid domain */
function normalizeDomain(raw: string): string {
	const d = raw.toLowerCase().replace(/\.$/, '').replace(/^www\d*\./, '');
	const labels = d.split('.');
	if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return '';
	// top-level domain: letters (or punycode), never an IP literal like 192.168.0.1
	if (!/^(?:\p{L}{2,}|xn--[a-z\d-]+)$/u.test(labels[labels.length - 1])) return '';
	return d;
}

/** website field → bare host (`https://www.firma.de/kontakt` → `firma.de`); '' when empty */
export function websiteHost(website: string): string {
	let s = website.trim().toLowerCase();
	s = s.replace(/^[a-z][a-z\d+.-]*:\/\//, '').replace(/^\/\//, '');
	s = s.split(/[/?#]/)[0];
	s = s.replace(/^[^@]*@/, '').replace(/:\d*$/, '').replace(/\.$/, '');
	return s.replace(/^www\d*\./, '');
}

/** `mail.firma.de` → `firma.de`, `firma.co.uk` stays */
function registrableDomain(host: string): string {
	const labels = host.split('.');
	const n = SECOND_LEVEL.has(labels.slice(-2).join('.')) ? 3 : 2;
	return labels.slice(-n).join('.');
}

function isFreemail(domain: string): boolean {
	const reg = registrableDomain(domain);
	return FREEMAIL_DOMAINS.has(domain) || FREEMAIL_DOMAINS.has(reg) || FREEMAIL_NAMES.has(reg.split('.')[0]);
}

function suggestCompany(domain: string, companies: readonly CompanyLike[]): CompanySuggestion | null {
	if (isFreemail(domain)) return null;
	const reg = registrableDomain(domain);
	const name = companyNameFromDomain(domain);
	const hosts = companies.map((c) => websiteHost(c.website));
	// exact host first, then the same registrable domain (anna@mail.firma.de ↔ www.firma.de)
	let hit = companies.find((_, i) => hosts[i] === domain);
	hit ??= companies.find((_, i) => hosts[i] !== '' && registrableDomain(hosts[i]) === reg);
	if (hit) return { kind: 'existing', id: hit.id, name: hit.name, match: 'website' };
	// no website stored, but the name fits: never offer to create the same company twice.
	// A company with another website is another company (meier.de ≠ Meier GmbH, meier-logistik.de)
	const key = nameKey(name);
	const byName = key ? companies.find((c, i) => hosts[i] === '' && nameKey(c.name) === key) : undefined;
	if (byName) return { kind: 'existing', id: byName.id, name: byName.name, match: 'name' };
	return { kind: 'new', domain: reg, name, website: `https://${reg}` };
}

/** `mueller-maschinenbau.de` → „Mueller Maschinenbau“, `ibm.com` → „IBM“ */
export function companyNameFromDomain(domain: string): string {
	const reg = registrableDomain(websiteHost(domain));
	const label = reg.split('.')[0];
	if (/^\p{L}{1,3}$/u.test(label)) return label.toUpperCase();
	return label
		.split('-')
		.filter(Boolean)
		.map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : capitalize(w)))
		.join(' ');
}

/** comparable company name: lowercase, umlauts spelled out, no legal form, no punctuation */
function nameKey(name: string): string {
	return name
		.toLowerCase()
		.replaceAll('ä', 'ae')
		.replaceAll('ö', 'oe')
		.replaceAll('ü', 'ue')
		.replaceAll('ß', 'ss')
		.split(/[^\p{L}\d]+/u)
		.filter((t) => t && !NAME_NOISE.has(t))
		.join('');
}

function suggestName(local: string): Pick<EmailSuggestion, 'first_name' | 'last_name'> {
	const none = { first_name: null, last_name: null };
	const s = local
		.toLowerCase()
		.replace(/\+.*$/, '') // sub-address: anna.mueller+crm@
		.replace(/[\d._-]+$/, '') // trailing digits: anna.mueller2@
		.replace(/^[._-]+/, '');
	if (!s || ROLE_ADDRESSES.has(s.replace(/[._-]/g, ''))) return none;

	// dots/underscores separate the parts, a hyphen then belongs to a double name; without
	// dots or underscores the hyphen is the separator (anna-mueller@)
	const byHyphen = !/[._]/.test(s);
	const parts = s.split(byHyphen ? /-+/ : /[._]+/).filter(Boolean);
	// a role word as the first part names a function, not a person (info.berlin@);
	// later parts are names again (steve.jobs@, anna.post@)
	if (ROLE_ADDRESSES.has(parts[0])) return none;
	// anna.mueller.extern@ = Anna Mueller
	if (parts.length > 2 && EXTERNAL.has(parts[parts.length - 1])) parts.pop();
	if (parts.length < 2 || parts.length > 3 || !parts.every((p) => LETTERS.test(p))) return none;
	// with hyphens only, three parts are ambiguous (Anna Mueller-Schmidt or Anna-Mueller Schmidt)
	if (byHyphen && parts.length === 3) return none;

	const initial = (p: string) => p.length === 1;
	let last = parts[parts.length - 1];
	let given = parts.slice(0, -1);
	// particle before the last name: anna.von.mueller → „von Mueller“
	if (PARTICLES.has(given[given.length - 1]) && !initial(last)) {
		last = `${given[given.length - 1]} ${capitalizeName(last)}`;
		given = given.slice(0, -1);
	} else last = initial(last) ? '' : capitalizeName(last);

	// a leading initial makes the first name unknown (a.mueller@, a.m.mueller@);
	// a middle initial is dropped (anna.m.mueller@)
	let first = '';
	if (given.length && !initial(given[0]) && !PARTICLES.has(given[0])) {
		first = given
			.filter((p) => !initial(p))
			.map(capitalizeName)
			.join(byHyphen ? '-' : ' ');
	}
	return { first_name: nameSuggestion(first), last_name: nameSuggestion(last) };
}

function nameSuggestion(value: string): NameSuggestion | null {
	if (!value) return null;
	const umlaut = umlautVariant(value);
	return { value, umlaut: umlaut === value ? null : umlaut };
}

function capitalize(w: string): string {
	return w.charAt(0).toUpperCase() + w.slice(1);
}

/** „hans-peter“ → „Hans-Peter“ */
function capitalizeName(p: string): string {
	return p.split('-').map(capitalize).join('-');
}

const UMLAUTS: Record<string, string> = { ae: 'ä', oe: 'ö', ue: 'ü' };

/** `Mueller` → `Müller`; keeps diphthongs (Bauer, Neuer, Quast) and names like Michael */
export function umlautVariant(name: string): string {
	return name.replace(/\p{L}+/gu, (word) => {
		if (NO_UMLAUT.has(word.toLowerCase())) return word;
		let out = '';
		for (let i = 0; i < word.length; i++) {
			const pair = word.slice(i, i + 2).toLowerCase();
			const prev = word.charAt(i - 1).toLowerCase();
			const u = UMLAUTS[pair];
			if (u && !(pair === 'ue' && 'aeq'.includes(prev || '-'))) {
				out += word.charAt(i) === word.charAt(i).toUpperCase() ? u.toUpperCase() : u;
				i++;
			} else out += word.charAt(i);
		}
		return out;
	});
}

/**
 * The address the contact dialog makes suggestions from: always for a new contact; when
 * editing only once the address was changed — an existing contact's empty fields were left
 * empty on purpose (or are being filled by hand), so its old address suggests nothing.
 */
export function emailToSuggest(email: string, initialEmail: string, editing: boolean): string {
	if (editing && email.trim().toLowerCase() === initialEmail.trim().toLowerCase()) return '';
	return email;
}

export type Chip = { label: string; value: string };

export type VisibleSuggestions = {
	first_name: Chip[];
	last_name: Chip[];
	company: CompanySuggestion | null;
};

/**
 * What the contact dialog offers: chips only for fields that are still empty (a filled field
 * is never overwritten), and no company suggestion once a company is chosen (e.g. the lead's
 * company in the lead dialog wins over the e-mail domain).
 */
export function visibleSuggestions(
	s: EmailSuggestion | null,
	form: { first_name: string; last_name: string; company: string }
): VisibleSuggestions {
	return {
		first_name: nameChips(s?.first_name, form.first_name),
		last_name: nameChips(s?.last_name, form.last_name),
		company: form.company ? null : (s?.company ?? null)
	};
}

/** the plain value and, as a hint, the umlaut variant („Müller?“) */
function nameChips(s: NameSuggestion | null | undefined, current: string): Chip[] {
	if (!s || current.trim()) return [];
	const chips = [{ label: s.value, value: s.value }];
	if (s.umlaut) chips.push({ label: `${s.umlaut}?`, value: s.umlaut });
	return chips;
}
