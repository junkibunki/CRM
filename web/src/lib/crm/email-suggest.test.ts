// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
	companyNameFromDomain,
	suggestFromEmail,
	umlautVariant,
	visibleSuggestions,
	websiteHost,
	type CompanyLike
} from './email-suggest';

const names = (email: string) => {
	const s = suggestFromEmail(email, []);
	return [s.first_name?.value ?? null, s.last_name?.value ?? null];
};

describe('suggestFromEmail: name from the local part', () => {
	it.each([
		['anna.mueller@firma.de', 'Anna', 'Mueller'],
		['anna_mueller@firma.de', 'Anna', 'Mueller'],
		['anna-mueller@firma.de', 'Anna', 'Mueller'],
		['Anna.Mueller@Firma.de', 'Anna', 'Mueller'],
		['ANNA.MUELLER@firma.de', 'Anna', 'Mueller'],
		['  anna.mueller@firma.de  ', 'Anna', 'Mueller']
	])('%s → %s %s', (email, first, last) => {
		expect(names(email)).toEqual([first, last]);
	});

	it('keeps double names together and capitalizes each part', () => {
		expect(names('hans-peter.schmidt@firma.de')).toEqual(['Hans-Peter', 'Schmidt']);
		expect(names('hans-peter_schmidt@firma.de')).toEqual(['Hans-Peter', 'Schmidt']);
		expect(names('anna.mueller-schmidt@firma.de')).toEqual(['Anna', 'Mueller-Schmidt']);
		expect(names('hans-peter.mueller-schmidt@firma.de')).toEqual(['Hans-Peter', 'Mueller-Schmidt']);
	});

	it('ignores trailing digits', () => {
		expect(names('anna.mueller2@firma.de')).toEqual(['Anna', 'Mueller']);
		expect(names('anna.mueller1987@firma.de')).toEqual(['Anna', 'Mueller']);
		expect(names('anna.mueller.2@firma.de')).toEqual(['Anna', 'Mueller']);
		expect(names('anna-mueller_01@firma.de')).toEqual(['Anna', 'Mueller']);
	});

	it('ignores a sub-address (+tag)', () => {
		expect(names('anna.mueller+crm@firma.de')).toEqual(['Anna', 'Mueller']);
	});

	it('gives no name for digits inside a part', () => {
		expect(names('anna2.mueller@firma.de')).toEqual([null, null]);
		expect(names('a1b.mueller@firma.de')).toEqual([null, null]);
	});

	it('leading initial → only the last name', () => {
		expect(names('a.mueller@firma.de')).toEqual([null, 'Mueller']);
		expect(names('a_mueller@firma.de')).toEqual([null, 'Mueller']);
		expect(names('a-mueller@firma.de')).toEqual([null, 'Mueller']);
		expect(names('a.m.mueller@firma.de')).toEqual([null, 'Mueller']);
		expect(names('a.maria.mueller@firma.de')).toEqual([null, 'Mueller']);
	});

	it('trailing initial → only the first name; two initials → nothing', () => {
		expect(names('anna.m@firma.de')).toEqual(['Anna', null]);
		expect(names('a.m@firma.de')).toEqual([null, null]);
	});

	it('drops a middle initial', () => {
		expect(names('anna.m.mueller@firma.de')).toEqual(['Anna', 'Mueller']);
	});

	it('three parts: two given names, or a name particle', () => {
		expect(names('anna.maria.mueller@firma.de')).toEqual(['Anna Maria', 'Mueller']);
		expect(names('anna.von.mueller@firma.de')).toEqual(['Anna', 'von Mueller']);
		expect(names('ben.van.dijk@firma.nl')).toEqual(['Ben', 'van Dijk']);
		expect(names('von.mueller@firma.de')).toEqual([null, 'von Mueller']);
		expect(names('anna.von.mueller-schmidt@firma.de')).toEqual(['Anna', 'von Mueller-Schmidt']);
	});

	it('three parts with hyphens only are ambiguous → nothing', () => {
		expect(names('anna-mueller-schmidt@firma.de')).toEqual([null, null]);
		expect(names('hans-peter-schmidt@firma.de')).toEqual([null, null]);
	});

	it('ignores a trailing extern/external/ext part', () => {
		expect(names('anna.mueller.extern@firma.de')).toEqual(['Anna', 'Mueller']);
		expect(names('anna.mueller.external@firma.de')).toEqual(['Anna', 'Mueller']);
		expect(names('anna_mueller_ext@firma.de')).toEqual(['Anna', 'Mueller']);
		expect(names('anna-mueller-extern@firma.de')).toEqual(['Anna', 'Mueller']);
		expect(names('anna.maria.mueller.extern@firma.de')).toEqual(['Anna Maria', 'Mueller']);
		expect(names('anna.extern@firma.de')).toEqual(['Anna', 'Extern']);
	});

	it('a role word later in the address is a name (steve.jobs@, anna.post@)', () => {
		expect(names('steve.jobs@firma.de')).toEqual(['Steve', 'Jobs']);
		expect(names('anna.post@firma.de')).toEqual(['Anna', 'Post']);
		expect(names('x.root@firma.de')).toEqual([null, 'Root']);
		expect(names('anna-service@firma.de')).toEqual(['Anna', 'Service']);
	});

	it('not splittable or too many parts → nothing', () => {
		expect(names('annamueller@firma.de')).toEqual([null, null]);
		expect(names('anna@firma.de')).toEqual([null, null]);
		expect(names('amueller@firma.de')).toEqual([null, null]);
		expect(names('anna.maria.luise.mueller@firma.de')).toEqual([null, null]);
		expect(names('a.b.c.d@firma.de')).toEqual([null, null]);
		expect(names('12345@firma.de')).toEqual([null, null]);
		expect(names('o\'neil.mary@firma.de')).toEqual([null, null]);
	});

	it.each([
		'info', 'kontakt', 'vertrieb', 'sales', 'office', 'service', 'support', 'buchhaltung',
		'noreply', 'no-reply', 'no_reply', 'no.reply', 'do-not-reply', 'Info', 'INFO', 'info2',
		'info.berlin', 'vertrieb-sued', 'sales_team', 'mailer-daemon', 'post', 'kontakt.mueller'
	])('role address %s@ → no name', (local) => {
		const s = suggestFromEmail(`${local}@firma.de`, []);
		expect(s.first_name).toBeNull();
		expect(s.last_name).toBeNull();
		expect(s.company).not.toBeNull(); // the company still counts
	});

	it('invalid addresses → nothing at all', () => {
		for (const email of ['', 'anna.mueller', '@firma.de', 'anna.mueller@', 'anna.mueller@firma',
			'anna.mueller@192.168.0.1', 'anna.mueller@localhost', 'anna mueller@firma.de',
			'anna.mueller@fir ma.de', 'anna.mueller@-firma.de']) {
			expect(suggestFromEmail(email, [])).toEqual({ first_name: null, last_name: null, company: null });
		}
	});
});

describe('umlaut suggestions', () => {
	it('offers an umlaut variant only as extra suggestion', () => {
		const s = suggestFromEmail('juergen.mueller@firma.de', []);
		expect(s.first_name).toEqual({ value: 'Juergen', umlaut: 'Jürgen' });
		expect(s.last_name).toEqual({ value: 'Mueller', umlaut: 'Müller' });
	});

	it('no variant when there is nothing to replace', () => {
		expect(suggestFromEmail('anna.schmidt@firma.de', []).last_name).toEqual({ value: 'Schmidt', umlaut: null });
	});

	it.each([
		['Mueller', 'Müller'],
		['Schaefer', 'Schäfer'],
		['Koenig', 'König'],
		['Oezdemir', 'Özdemir'],
		['Ueberall', 'Überall'],
		['Kuehne-Boehm', 'Kühne-Böhm'],
		['von Mueller', 'von Müller'],
		['Anna Baerbel', 'Anna Bärbel'],
		// diphthongs and qu: no umlaut
		['Bauer', 'Bauer'],
		['Neuer', 'Neuer'],
		['Quelle', 'Quelle'],
		// names whose ae/oe/ue is no umlaut
		['Michael', 'Michael'],
		['Manuel', 'Manuel'],
		['Samuel', 'Samuel'],
		['Joel', 'Joel'],
		['Raphael', 'Raphael']
	])('%s → %s', (name, expected) => {
		expect(umlautVariant(name)).toBe(expected);
	});

	it('works on suggestions from particles and double names', () => {
		expect(suggestFromEmail('anna.von.mueller@firma.de', []).last_name?.umlaut).toBe('von Müller');
		expect(suggestFromEmail('michael.mueller@firma.de', []).first_name?.umlaut).toBeNull();
	});
});

describe('suggestFromEmail: company from the domain', () => {
	const companies: CompanyLike[] = [
		{ id: 'c1', name: 'Acme GmbH', website: 'https://www.acme.de/' },
		{ id: 'c2', name: 'Beta AG', website: 'http://beta.com' },
		{ id: 'c3', name: 'Gamma KG', website: 'gamma.de' },
		{ id: 'c4', name: 'Delta', website: 'HTTPS://WWW.DELTA.DE/kontakt?x=1' },
		{ id: 'c5', name: 'Epsilon', website: 'www.epsilon.co.uk' },
		{ id: 'c6', name: 'Mueller Maschinenbau GmbH & Co. KG', website: '' },
		{ id: 'c7', name: 'Ohne Website', website: '' }
	];
	const company = (email: string, list = companies) => suggestFromEmail(email, list).company;

	it.each([
		['anna@acme.de', 'c1'],
		['anna@beta.com', 'c2'],
		['anna@gamma.de', 'c3'],
		['anna@delta.de', 'c4'],
		['anna@DELTA.de', 'c4'],
		['anna@www.acme.de', 'c1'],
		['anna@epsilon.co.uk', 'c5']
	])('%s matches an existing company website (www./http(s)/slash/path variants)', (email, id) => {
		expect(company(email)).toMatchObject({ kind: 'existing', id, match: 'website' });
	});

	it('matches a subdomain of the e-mail against the website and vice versa', () => {
		expect(company('anna@mail.acme.de')).toMatchObject({ kind: 'existing', id: 'c1' });
		const shop = [{ id: 's', name: 'Shop', website: 'https://shop.zeta.de' }];
		expect(company('anna@zeta.de', shop)).toMatchObject({ kind: 'existing', id: 's' });
	});

	it('prefers the exact host over the same registrable domain', () => {
		const list = [
			{ id: 'main', name: 'Zeta', website: 'zeta.de' },
			{ id: 'sub', name: 'Zeta Shop', website: 'https://shop.zeta.de' }
		];
		expect(company('anna@shop.zeta.de', list)).toMatchObject({ id: 'sub' });
		expect(company('anna@zeta.de', list)).toMatchObject({ id: 'main' });
	});

	it('finds an existing company by name when it has no website (never create twice)', () => {
		expect(company('anna@mueller-maschinenbau.de')).toEqual({
			kind: 'existing',
			id: 'c6',
			name: 'Mueller Maschinenbau GmbH & Co. KG',
			match: 'name'
		});
		const umlaut = [{ id: 'u', name: 'Müller Maschinenbau GmbH', website: '' }];
		expect(company('anna@mueller-maschinenbau.de', umlaut)).toMatchObject({ kind: 'existing', id: 'u' });
	});

	it('unknown company domain → suggestion to create it, with website and derived name', () => {
		expect(company('anna.mueller@neu-firma.de')).toEqual({
			kind: 'new',
			domain: 'neu-firma.de',
			name: 'Neu Firma',
			website: 'https://neu-firma.de'
		});
		expect(company('anna@mail.neu-firma.de')).toMatchObject({
			kind: 'new',
			domain: 'neu-firma.de',
			website: 'https://neu-firma.de'
		});
	});

	it('name match only for companies without a website', () => {
		// Acme GmbH has the website acme.de: acme.com is another company
		expect(company('anna@acme.com')).toMatchObject({ kind: 'new', domain: 'acme.com', name: 'Acme' });
		const meier = [{ id: 'm', name: 'Meier GmbH', website: 'https://meier-logistik.de' }];
		expect(company('anna@meier.de', meier)).toEqual({
			kind: 'new',
			domain: 'meier.de',
			name: 'Meier',
			website: 'https://meier.de'
		});
		const noWebsite = [{ id: 'm', name: 'Meier GmbH', website: '  ' }];
		expect(company('anna@meier.de', noWebsite)).toMatchObject({ kind: 'existing', id: 'm', match: 'name' });
	});

	it('a company created from a "new" suggestion is found as existing afterwards', () => {
		for (const email of ['anna@neu-firma.de', 'anna@mail.neu-firma.de', 'anna@ibm.com']) {
			const s = company(email, []);
			if (s?.kind !== 'new') throw new Error(`expected a new suggestion for ${email}`);
			const created = [...companies, { id: 'created', name: s.name, website: s.website }];
			expect(company(email, created)).toEqual({ kind: 'existing', id: 'created', name: s.name, match: 'website' });
			expect(company(`ben@${s.domain}`, created)).toMatchObject({ kind: 'existing', id: 'created' });
		}
	});

	it('does not match unrelated companies or empty websites', () => {
		expect(company('anna@cme.de')).toMatchObject({ kind: 'new', domain: 'cme.de' });
		expect(company('anna@acme-bau.de')).toMatchObject({ kind: 'new', name: 'Acme Bau' });
		expect(company('anna@website.de')).toMatchObject({ kind: 'new' }); // c7 'Ohne Website'
		// a company without a name key (only a legal form) never matches
		const legal = [{ id: 'x', name: 'GmbH', website: '' }];
		expect(company('anna@gmbh.de', legal)).toMatchObject({ kind: 'new' });
	});

	it.each([
		'gmail.com', 'googlemail.com', 'gmx.de', 'gmx.net', 'gmx.at', 'web.de', 'outlook.com',
		'outlook.de', 'hotmail.com', 'hotmail.de', 'live.com', 'live.de', 'yahoo.com', 'yahoo.de',
		'yahoo.co.uk', 't-online.de', 'icloud.com', 'me.com', 'aol.com', 'posteo.de',
		'mailbox.org', 'freenet.de', 'GMAIL.COM', 'proton.me', 'protonmail.com'
	])('freemail %s → no company', (domain) => {
		const s = suggestFromEmail(`anna.mueller@${domain}`, [
			{ id: 'g', name: 'Google', website: 'https://gmail.com' }
		]);
		expect(s.company).toBeNull();
		expect(s.last_name?.value).toBe('Mueller'); // the name still counts
	});
});

describe('companyNameFromDomain', () => {
	it.each([
		['mueller-maschinenbau.de', 'Mueller Maschinenbau'],
		['siemens.com', 'Siemens'],
		['mueller-und-soehne.de', 'Mueller und Soehne'],
		['www.beispiel-firma.de', 'Beispiel Firma'],
		['mail.beispiel.de', 'Beispiel'],
		['firma.co.uk', 'Firma'],
		['ibm.com', 'IBM'],
		['dm.de', 'DM'],
		['1und1-it.de', '1und1 It'],
		['https://www.acme.de/', 'Acme']
	])('%s → %s', (domain, name) => {
		expect(companyNameFromDomain(domain)).toBe(name);
	});
});

describe('websiteHost', () => {
	it.each([
		['https://www.firma.de/', 'firma.de'],
		['http://firma.de', 'firma.de'],
		['firma.de', 'firma.de'],
		['www.firma.de/kontakt', 'firma.de'],
		['HTTPS://WWW.FIRMA.DE', 'firma.de'],
		['  https://firma.de:443/impressum#x  ', 'firma.de'],
		['//firma.de', 'firma.de'],
		['https://www2.firma.de', 'firma.de'],
		['', '']
	])('%s → %s', (website, host) => {
		expect(websiteHost(website)).toBe(host);
	});
});

describe('visibleSuggestions (what the contact dialog offers)', () => {
	const empty = { first_name: '', last_name: '', company: '' };
	const s = suggestFromEmail('juergen.mueller@acme.de', [{ id: 'c1', name: 'Acme GmbH', website: 'acme.de' }]);

	it('offers chips for empty fields, the umlaut variant as extra chip', () => {
		expect(visibleSuggestions(s, empty)).toEqual({
			first_name: [
				{ label: 'Juergen', value: 'Juergen' },
				{ label: 'Jürgen?', value: 'Jürgen' }
			],
			last_name: [
				{ label: 'Mueller', value: 'Mueller' },
				{ label: 'Müller?', value: 'Müller' }
			],
			company: { kind: 'existing', id: 'c1', name: 'Acme GmbH', match: 'website' }
		});
	});

	it('never offers anything for a filled field', () => {
		const v = visibleSuggestions(s, { first_name: 'Jürgen', last_name: 'Schmidt', company: '' });
		expect(v.first_name).toEqual([]);
		expect(v.last_name).toEqual([]);
		expect(v.company).not.toBeNull();
	});

	it('whitespace counts as empty', () => {
		expect(visibleSuggestions(s, { ...empty, first_name: '  ' }).first_name).toHaveLength(2);
	});

	it('a chosen company (e.g. the one of the lead) wins over the domain suggestion', () => {
		expect(visibleSuggestions(s, { ...empty, company: 'other' }).company).toBeNull();
		const fresh = suggestFromEmail('anna.berg@neu-firma.de', []);
		expect(visibleSuggestions(fresh, empty).company).toMatchObject({ kind: 'new' });
		expect(visibleSuggestions(fresh, { ...empty, company: 'lead-company' }).company).toBeNull();
	});

	it('no suggestion (nothing checked yet, invalid address) → nothing offered', () => {
		const none = { first_name: [], last_name: [], company: null };
		expect(visibleSuggestions(null, empty)).toEqual(none);
		expect(visibleSuggestions(suggestFromEmail('kaputt', []), empty)).toEqual(none);
	});
});
