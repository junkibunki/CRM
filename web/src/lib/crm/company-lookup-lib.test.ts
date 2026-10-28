// @vitest-environment node
// Unit tests for the F10 hook library (pocketbase/pb_hooks/company-lookup-lib.js). The file is
// plain CommonJS for the PocketBase JS VM, so it is loaded with Node's require here.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lib: any = require('../../../../pocketbase/pb_hooks/company-lookup-lib.js');

type Res = { ok: boolean; status?: number; remoteIp?: string; contentType?: string; redirectUrl?: string; body?: string; code?: string; message?: string };

describe('normalizeDomain: only plain public hostnames', () => {
	it.each([
		['firma.de', 'firma.de'],
		['  Firma.DE. ', 'firma.de'],
		['www.firma.de', 'firma.de'],
		['shop.firma.co.uk', 'shop.firma.co.uk'],
		['xn--mller-kva.de', 'xn--mller-kva.de'],
		['mueller-maschinenbau.de', 'mueller-maschinenbau.de']
	])('%s → %s', (input, domain) => {
		expect(lib.normalizeDomain(input)).toEqual({ domain });
	});

	it.each([
		'',
		'localhost',
		'intranet',
		'server.localhost',
		'drucker.local',
		'db.internal',
		'nas.lan',
		'host.home.arpa',
		'x.test',
		'127.0.0.1',
		'10.0.0.1',
		'192.168.178.1',
		'0x7f.1',
		'2130706433',
		'[::1]',
		'::1',
		'firma.de:8080',
		'firma.de:443',
		'https://firma.de',
		'firma.de/impressum',
		'user@firma.de',
		'firma.de?x=1',
		'müller.de',
		'-firma.de',
		'firma-.de',
		'a..de',
		'fir ma.de',
		`${'a'.repeat(64)}.de`,
		`${'a.'.repeat(130)}de`
	])('refuses %j', (input) => {
		expect(lib.normalizeDomain(input).error).toBeTruthy();
	});

	it('names the reason: an IP literal vs. an invalid ending (hyphen/digit)', () => {
		const ip = 'IP-Adressen sind nicht erlaubt, nur Domains.';
		expect(lib.normalizeDomain('127.0.0.1').error).toBe(ip);
		expect(lib.normalizeDomain('0x7f.1').error).toBe(ip);
		expect(lib.normalizeDomain('0x7f.0x1').error).toBe(ip);
		// these used to say "IP-Adressen sind nicht erlaubt"
		expect(lib.normalizeDomain('firma.d3').error).toBe('Ungültige Domain-Endung „d3“.');
		expect(lib.normalizeDomain('firma.de-x').error).toBe('Ungültige Domain-Endung „de-x“.');
		expect(lib.normalizeDomain('firma.x').error).toBe('Ungültige Domain-Endung „x“.');
	});
});

describe('checkTarget: what the server may request', () => {
	it.each([
		['https://firma.de/', true],
		['https://www.firma.de/impressum', true],
		['https://FIRMA.de./x', true],
		['https://firma.de:443/x', true],
		['http://firma.de/', false],
		['ftp://firma.de/', false],
		['https://firma.de:8443/', false],
		['https://shop.firma.de/', false],
		['https://firma.de.evil.com/', false],
		['https://evil.com/firma.de', false],
		['https://firma.de@evil.com/', false],
		['https://user:pw@firma.de/', false],
		['https://127.0.0.1/', false],
		['https://[::1]/', false],
		['//firma.de/', false],
		['firma.de', false]
	])('%s → %s', (url, ok) => {
		expect(lib.checkTarget(url, 'firma.de').ok).toBe(ok);
	});
});

describe('resolveUrl', () => {
	const base = 'https://www.firma.de/de/start/index.html?x=1';
	it.each([
		['/impressum', 'https://www.firma.de/impressum'],
		['impressum.html', 'https://www.firma.de/de/start/impressum.html'],
		['../rechtliches/impressum/', 'https://www.firma.de/de/rechtliches/impressum/'],
		['./a/../b', 'https://www.firma.de/de/start/b'],
		['//firma.de/impressum', 'https://firma.de/impressum'],
		['https://firma.de/imprint#top', 'https://firma.de/imprint'],
		['?page=impressum', 'https://www.firma.de/de/start/index.html?page=impressum'],
		['  /Impressum Seite  ', 'https://www.firma.de/Impressum%20Seite'],
		['/über-uns', 'https://www.firma.de/%C3%BCber-uns'],
		['/../../etc', 'https://www.firma.de/etc']
	])('%s → %s', (href, url) => {
		expect(lib.resolveUrl(base, href, false)).toBe(url);
	});

	it('drops anchors, mailto: and javascript:', () => {
		for (const href of ['', '#impressum', 'mailto:info@firma.de', 'javascript:alert(1)', 'tel:+49', 'data:text/html,x']) {
			expect(lib.resolveUrl(base, href, true)).toBeNull();
		}
	});

	it('upgrades http links only when asked (links yes, redirects no)', () => {
		expect(lib.resolveUrl(base, 'http://firma.de/impressum', true)).toBe('https://firma.de/impressum');
		expect(lib.resolveUrl(base, 'http://firma.de/impressum', false)).toBe('http://firma.de/impressum');
	});

	it('keeps a foreign host or port, so checkTarget can refuse it', () => {
		expect(lib.resolveUrl(base, 'https://evil.com:8080/x', true)).toBe('https://evil.com:8080/x');
		expect(lib.checkTarget(lib.resolveUrl(base, 'https://evil.com:8080/x', true), 'firma.de').ok).toBe(false);
	});
});

describe('isPublicIp', () => {
	it.each([
		'0.0.0.0',
		'10.1.2.3',
		'100.64.0.1',
		'127.0.0.1',
		'127.255.255.254',
		'169.254.169.254',
		'172.16.0.1',
		'172.31.255.255',
		'192.168.0.1',
		'192.0.2.1',
		'198.18.0.1',
		'224.0.0.1',
		'255.255.255.255',
		'::',
		'::1',
		'[::1]',
		'fe80::1%eth0',
		'fc00::1',
		'fd12:3456::1',
		'ff02::1',
		'::ffff:127.0.0.1',
		'::ffff:10.0.0.1',
		'::127.0.0.1',
		'64:ff9b::a00:1',
		'2002:7f00:1::',
		'2001:db8::1',
		'',
		'nonsense',
		'999.1.1.1',
		'1.2.3'
	])('%s is not public', (ip) => {
		expect(lib.isPublicIp(ip)).toBe(false);
	});

	it.each(['8.8.8.8', '193.99.144.80', '172.32.0.1', '100.128.0.1', '2a02:2e0:3fe:1001:7777:772e:2:85', '2a00:1450:4001::1', '::ffff:8.8.8.8'])(
		'%s is public',
		(ip) => {
			expect(lib.isPublicIp(ip)).toBe(true);
		}
	);
});

describe('curl call', () => {
	it('builds a restricted GET: no config file, https only, no redirects, timeout, size limit, URL last', () => {
		const args: string[] = lib.curlArgs('https://firma.de/');
		expect(args[0]).toBe('-q');
		expect(args.join(' ')).toContain('--proto =https');
		expect(args.join(' ')).toContain('--max-time 5');
		expect(args.join(' ')).toContain('--max-filesize 1048576');
		expect(args.join(' ')).toContain('--noproxy *');
		// size limit that also holds for curl < 8.4 (chunked answers): 5 s × 200 KiB/s ≈ 1 MB
		expect(args.join(' ')).toContain('--limit-rate 200k');
		expect(args).toContain('--globoff');
		expect(args).not.toContain('-L');
		expect(args).not.toContain('--location');
		expect(args[args.length - 1]).toBe('https://firma.de/');
	});

	it('parses body and write-out', () => {
		const out = '<html>a\n@@CRM-LOOKUP@@ x</html>\n@@CRM-LOOKUP@@301\t1.2.3.4\ttext/html; charset=utf-8\thttps://www.firma.de/';
		expect(lib.parseCurlOutput(out)).toEqual({
			status: 301,
			remoteIp: '1.2.3.4',
			contentType: 'text/html; charset=utf-8',
			redirectUrl: 'https://www.firma.de/',
			body: '<html>a\n@@CRM-LOOKUP@@ x</html>'
		});
		expect(lib.parseCurlOutput('no marker')).toBeNull();
	});

	const bytes = (s: string) => Array.from(Buffer.from(s, 'latin1'));
	const utf8 = (b: number[]) => Buffer.from(b).toString('utf8');

	it('maps curl exit codes to German messages', () => {
		const fail = (msg: string) => lib.makeCurlFetcher(() => {
			throw new Error(msg);
		}, utf8)('https://firma.de/');
		expect(fail('GoError: exit status 6')).toMatchObject({ ok: false, code: 'not_found' });
		expect(fail('GoError: exit status 7')).toMatchObject({ ok: false, code: 'unreachable' });
		expect(fail('GoError: exit status 28')).toMatchObject({ ok: false, code: 'timeout' });
		expect(fail('GoError: exit status 60')).toMatchObject({ ok: false, code: 'tls' });
		expect(fail('GoError: exit status 63')).toMatchObject({ ok: false, code: 'too_large' });
		expect(fail('exec: "curl": executable file not found in $PATH')).toMatchObject({ code: 'no_curl' });
		expect(fail('GoError: exit status 6').message).toMatch(/nicht gefunden/);
	});

	it('decodes UTF-8 and windows-1252 pages', () => {
		const meta = '\n@@CRM-LOOKUP@@200\t8.8.8.8\t';
		const u = lib.makeCurlFetcher(() => Array.from(Buffer.from('Straße' + meta + 'text/html; charset=UTF-8\t', 'utf8')), utf8)('https://firma.de/');
		expect(u).toMatchObject({ ok: true, status: 200, body: 'Straße', remoteIp: '8.8.8.8' });
		const latin = lib.makeCurlFetcher(() => bytes('Stra\xdfe \x80' + meta + 'text/html; charset=iso-8859-1\t'), utf8)('https://firma.de/');
		expect(latin.body).toBe('Straße €');
		const metaTag = lib.makeCurlFetcher(() => bytes('<meta charset="windows-1252">M\xfcller' + meta + 'text/html\t'), utf8)('https://firma.de/');
		expect(metaTag.body).toContain('Müller');
	});

	it('refuses an oversized answer even if curl did not stop it', () => {
		const big = new Array(lib.MAX_BYTES + 5000).fill(32);
		expect(lib.makeCurlFetcher(() => big, utf8)('https://firma.de/')).toMatchObject({ ok: false, code: 'too_large' });
	});

	it('detects the charset', () => {
		expect(lib.detectCharset('text/html; charset="ISO-8859-1"', '')).toBe('iso-8859-1');
		expect(lib.detectCharset('text/html', '<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">')).toBe('windows-1252');
		expect(lib.detectCharset('', '<html>')).toBe('');
	});
});

describe('htmlToText / extractMeta', () => {
	it('keeps visible text line by line, drops scripts, styles and menus', () => {
		const html =
			'<head><title>x</title></head><script>var a="Fake GmbH";</script><style>.a{}</style>' +
			'<nav><a href="/">Schwesterfirma GmbH</a></nav><!-- Kommentar GmbH -->' +
			'<p>Muster&nbsp;GmbH<br>Hauptstra&szlig;e 1<br/>12345 M&uuml;nchen</p><div>Tel.&#58; 089 1234</div>';
		expect(lib.htmlToText(html)).toBe('Muster GmbH\nHauptstraße 1\n12345 München\nTel.: 089 1234');
	});

	it('decodes numeric and named entities, keeps unknown ones', () => {
		expect(lib.decodeEntities('&#228;&#xFC;&amp;&ouml;&bdquo;x&ldquo; AT&T &foo;')).toBe('äü&ö„x“ AT&T &foo;');
	});

	it('reads og:site_name and title', () => {
		expect(lib.extractMeta('<title> Muster &amp; Co </title><meta content="Muster AG" property="og:site_name">')).toEqual({
			siteName: 'Muster AG',
			title: 'Muster & Co'
		});
	});
});

describe('findImpressumLink', () => {
	const base = 'https://www.firma.de/';
	it('prefers the link text, resolves relative links', () => {
		const html = '<a href="/datenschutz">Datenschutz</a><a href="/legal/imprint-de">Impressum</a><a href="/x-impressum">mehr</a>';
		expect(lib.findImpressumLink(html, base, 'firma.de')).toBe('https://www.firma.de/legal/imprint-de');
	});

	it('falls back to the URL and upgrades http', () => {
		expect(lib.findImpressumLink('<a href="http://firma.de/impressum.html"><img alt=""></a>', base, 'firma.de')).toBe(
			'https://firma.de/impressum.html'
		);
	});

	it('ignores links to other hosts or ports', () => {
		const html = '<a href="https://agentur.de/impressum">Impressum</a><a href="https://firma.de:8080/impressum">Impressum</a>';
		expect(lib.findImpressumLink(html, base, 'firma.de')).toBeNull();
	});
});

describe('findCompanyName', () => {
	it.each([
		['Muster GmbH', 'Muster GmbH'],
		['Muster Maschinenbau GmbH & Co. KG', 'Muster Maschinenbau GmbH & Co. KG'],
		['Muster GmbH &amp; Co.KG'.replace('&amp;', '&'), 'Muster GmbH & Co. KG'],
		['Angaben gemäß § 5 DDG: Beispiel UG (haftungsbeschränkt)', 'Beispiel UG (haftungsbeschränkt)'],
		['Beispiel UG (haftungsbeschränkt) & Co. KG', 'Beispiel UG (haftungsbeschränkt) & Co. KG'],
		['© 2024 Beispiel Software GmbH. Alle Rechte vorbehalten.', 'Beispiel Software GmbH'],
		['Diese Website wird betrieben von der Muster Logistik AG', 'Muster Logistik AG'],
		['Die Muster OHG', 'Muster OHG'],
		['Gesellschaft für Informatik mbH', 'Gesellschaft für Informatik mbH'],
		['Bäckerei Schmidt e.K.', 'Bäckerei Schmidt e.K.'],
		['Kegelclub Alle Neune e. V.', 'Kegelclub Alle Neune e. V.'],
		['Faber-Castell Aktiengesellschaft', 'Faber-Castell Aktiengesellschaft'],
		['fischerwerke GmbH & Co. KG', 'fischerwerke GmbH & Co. KG'],
		['Sennheiser electronic SE & Co. KG | Deutschland', 'Sennheiser electronic SE & Co. KG'],
		['Muster GmbH, Hauptstraße 1, 12345 Musterstadt', 'Muster GmbH'],
		['SAP SE', 'SAP SE'],
		['Volksbank Musterstadt eG', 'Volksbank Musterstadt eG']
	])('%s → %s', (line, name) => {
		expect(lib.findCompanyName(line)?.name).toBe(name);
	});

	it.each([
		'Komplementärin: Muster Verwaltungs GmbH',
		'Persönlich haftende Gesellschafterin: Muster Verwaltungs GmbH',
		'phG: Muster Management SE',
		'Registergericht: Amtsgericht München, HRB 12345 (Muster GmbH)',
		'Webdesign: Agentur Pixel GmbH',
		'Realisierung & Hosting: Agentur Pixel GmbH',
		'Website erstellt von Agentur Pixel GmbH',
		'Wir sind ein Unternehmen ohne Rechtsform',
		'Datenschutzbeauftragter: Datenschutz GmbH',
		'GmbH'
	])('skips %j', (line) => {
		expect(lib.findCompanyName(line)).toBeNull();
	});

	it('starts at the impressum heading, so menu entries above lose', () => {
		const text = ['Unsere Marken', 'Schwester GmbH', 'Impressum', 'Angaben gemäß § 5 DDG', 'Muster GmbH'].join('\n');
		expect(lib.findCompanyName(text)).toEqual({ name: 'Muster GmbH', line: 4 });
	});
});

describe('findAddress', () => {
	it('street and ZIP/city on separate lines', () => {
		expect(lib.findAddress('Muster GmbH\nHauptstraße 1a\n12345 Musterstadt\nDeutschland', 0)).toBe('Hauptstraße 1a, 12345 Musterstadt');
	});

	it.each([
		['Muster GmbH, Am Markt 12-14, 12345 Musterstadt', 'Am Markt 12-14, 12345 Musterstadt'],
		['Hauptstr. 5 · D-12345 Musterstadt', 'Hauptstr. 5, 12345 Musterstadt'],
		['Am Labor 1\nDE - 30900 Wedemark', 'Am Labor 1, 30900 Wedemark'],
		['Alfred-Kärcher-Strasse 28-40\n71364 Winnenden / Germany', 'Alfred-Kärcher-Strasse 28-40, 71364 Winnenden'],
		['Sektkellereistraße 5\n06632 Freyburg (Unstrut)', 'Sektkellereistraße 5, 06632 Freyburg (Unstrut)'],
		['Anschrift: Straße des 17. Juni 135, 10623 Berlin', 'Straße des 17. Juni 135, 10623 Berlin'],
		['Ringstr. 99 | 32427 Minden', 'Ringstr. 99, 32427 Minden']
	])('%j → %s', (text, address) => {
		expect(lib.findAddress(text, 0)).toBe(address);
	});

	it('needs a street; ignores Postfach and register court lines', () => {
		expect(lib.findAddress('Muster GmbH\n12345 Musterstadt', 0)).toBe('');
		expect(lib.findAddress('Postfach 1234, 12345 Musterstadt', 0)).toBe('');
		expect(lib.findAddress('Registergericht: Amtsgericht München, Linprunstr. 22, 80335 München', 0)).toBe('');
	});

	it('prefers the address after the company name line', () => {
		const text = 'Vertrieb\nNebenweg 2\n11111 Nebenort\nMuster GmbH\nHauptweg 1\n22222 Hauptort';
		expect(lib.findAddress(text, 3)).toBe('Hauptweg 1, 22222 Hauptort');
		expect(lib.findAddress(text, 0)).toBe('Nebenweg 2, 11111 Nebenort');
	});
});

describe('findPhone', () => {
	it.each([
		['Telefon: +49 (0) 89 123456-0', '+49 (0) 89 123456-0'],
		['Tel.: 089 / 12 34 56', '089 / 12 34 56'],
		['Tel. +49 7195 / 14-0 | Fax +49 7195 / 14-2212', '+49 7195 / 14-0'],
		['Fon 0571 860', '0571 860'],
		['T: +49 30 1234567', '+49 30 1234567'],
		['Phone: +49 571 887 - 0', '+49 571 887 - 0']
	])('%s → %s', (text, phone) => {
		expect(lib.findPhone(text)).toBe(phone);
	});

	it('ignores fax, unlabelled and too short numbers', () => {
		expect(lib.findPhone('Telefax: 089 1234567\nFax: 089 7654321\n089 1234567\nTel: 12')).toBe('');
	});
});

describe('findEmail', () => {
	it('prefers an address on the company domain', () => {
		const html = '<p>Fotos: foto@agentur.de</p><a href="mailto:Info@Firma.de?subject=Hallo">Mail</a>';
		expect(lib.findEmail([html], 'firma.de')).toBe('info@firma.de');
	});

	it('accepts subdomains of the company domain and falls back to any address', () => {
		expect(lib.findEmail(['kontakt: vertrieb@de.firma.de'], 'firma.de')).toBe('vertrieb@de.firma.de');
		expect(lib.findEmail(['kontakt: info@firma-gruppe.com'], 'firma.de')).toBe('info@firma-gruppe.com');
	});

	it('decodes obfuscated and Cloudflare-protected addresses, ignores image names', () => {
		expect(lib.findEmail(['<img src="logo@2x.png">info (at) firma (punkt) de'], 'firma.de')).toBe('info@firma.de');
		expect(lib.findEmail(['info[at]firma[dot]de'], 'firma.de')).toBe('info@firma.de');
		// "a@b.de" XOR 0x42
		const hex = '42' + Array.from('a@b.de', (c) => (c.charCodeAt(0) ^ 0x42).toString(16).padStart(2, '0')).join('');
		expect(lib.findEmail([`<a class="__cf_email__" data-cfemail="${hex}">[email protected]</a>`], 'b.de')).toBe('a@b.de');
		expect(lib.findEmail(['nichts hier'], 'firma.de')).toBe('');
	});
});

// --- orchestration with a fake fetcher (no network) ---------------------------------

const PUBLIC_IP = '93.184.216.34';
const page = (body: string, extra: Partial<Res> = {}): Res => ({ ok: true, status: 200, remoteIp: PUBLIC_IP, contentType: 'text/html; charset=utf-8', redirectUrl: '', body, ...extra });
const redirect = (to: string, extra: Partial<Res> = {}): Res => ({ ok: true, status: 301, remoteIp: PUBLIC_IP, contentType: '', redirectUrl: to, body: '', ...extra });
const IMPRESSUM =
	'<h1>Impressum</h1><p>Angaben gemäß § 5 DDG</p><p>Muster Maschinenbau GmbH &amp; Co. KG<br>Industriestraße 7<br>12345 Musterstadt</p>' +
	'<p>Telefon: +49 1234 5678-0<br>Telefax: +49 1234 5678-99<br>E-Mail: <a href="mailto:info@muster.de">info@muster.de</a></p>' +
	'<p>Komplementärin: Muster Verwaltungs GmbH</p><p>Webdesign: Pixel Agentur GmbH, Nebenweg 1, 99999 Agenturstadt</p>';

function fake(routes: Record<string, Res | (() => Res)>) {
	const calls: string[] = [];
	const fn = (url: string): Res => {
		calls.push(url);
		const r = routes[url];
		if (!r) return page('<h1>Nicht gefunden</h1>', { status: 404 });
		return typeof r === 'function' ? r() : r;
	};
	return { fn, calls };
}

describe('lookupCompany', () => {
	it('home → impressum link → suggestions', () => {
		const f = fake({
			'https://muster.de/': redirect('https://www.muster.de/'),
			'https://www.muster.de/': page('<title>Start</title><footer><a href="/rechtliches/impressum">Impressum</a></footer>'),
			'https://www.muster.de/rechtliches/impressum': page(IMPRESSUM)
		});
		const res = lib.lookupCompany('muster.de', f.fn);
		expect(res).toEqual({
			ok: true,
			requests: 3,
			data: {
				name: 'Muster Maschinenbau GmbH & Co. KG',
				address: 'Industriestraße 7, 12345 Musterstadt',
				phone: '+49 1234 5678-0',
				email: 'info@muster.de',
				website: 'https://www.muster.de',
				source: 'https://www.muster.de/rechtliches/impressum'
			}
		});
	});

	it('tries /impressum, then /imprint when the home page has no link', () => {
		const f = fake({
			'https://muster.de/': page('<p>Willkommen</p>'),
			'https://muster.de/imprint': page(IMPRESSUM)
		});
		const res = lib.lookupCompany('muster.de', f.fn);
		expect(f.calls).toEqual(['https://muster.de/', 'https://muster.de/impressum', 'https://muster.de/imprint']);
		expect(res.data.name).toBe('Muster Maschinenbau GmbH & Co. KG');
	});

	it('uses the home page when there is no impressum (one-pager)', () => {
		const f = fake({ 'https://muster.de/': page('<footer>© 2025 Muster GmbH · Hauptweg 1 · 12345 Musterstadt</footer>') });
		const res = lib.lookupCompany('muster.de', f.fn);
		expect(res.data).toMatchObject({ name: 'Muster GmbH', address: 'Hauptweg 1, 12345 Musterstadt', source: 'https://muster.de/' });
	});

	it('leaves fields empty that were not recognised', () => {
		const f = fake({ 'https://muster.de/': page('<p>Nur Text</p>'), 'https://muster.de/impressum': page('<p>Impressum folgt</p>') });
		expect(lib.lookupCompany('muster.de', f.fn).data).toMatchObject({ name: '', address: '', phone: '', email: '' });
	});

	it('tries www. when the bare domain does not answer', () => {
		const f = fake({
			'https://muster.de/': { ok: false, code: 'not_found', message: 'x' },
			'https://www.muster.de/': page('<a href="/impressum">Impressum</a>'),
			'https://www.muster.de/impressum': page(IMPRESSUM)
		});
		expect(lib.lookupCompany('muster.de', f.fn).data.website).toBe('https://www.muster.de');
	});

	it('reports an unreachable site with a readable message', () => {
		const f = fake({
			'https://muster.de/': { ok: false, code: 'timeout', message: 'Die Website hat nicht rechtzeitig geantwortet.' },
			'https://www.muster.de/': { ok: false, code: 'timeout', message: 'Die Website hat nicht rechtzeitig geantwortet.' }
		});
		expect(lib.lookupCompany('muster.de', f.fn)).toMatchObject({ ok: false, code: 'unreachable', message: lib.UNREACHABLE });
		const blocked = fake({ 'https://muster.de/': page('Access denied', { status: 403 }) });
		expect(lib.lookupCompany('muster.de', blocked.fn)).toMatchObject({ ok: false, code: 'http_403', message: expect.stringMatching(/403/) });
	});

	it('answers every failure after DNS resolution with the same text (no probing of internal hosts)', () => {
		const answers = new Set<string>();
		const failures: Res[] = [
			{ ok: false, code: 'unreachable', message: 'Die Website ist nicht erreichbar.' },
			{ ok: false, code: 'timeout', message: 'Die Website hat nicht rechtzeitig geantwortet.' },
			{ ok: false, code: 'tls', message: 'Keine sichere Verbindung …' },
			{ ok: false, code: 'too_large', message: 'zu groß' },
			{ ok: false, code: 'fetch_failed', message: 'x' },
			page(IMPRESSUM, { remoteIp: '127.0.0.1' }),
			page(IMPRESSUM, { remoteIp: '10.0.0.5' })
		];
		for (const r of failures) {
			const res = lib.lookupCompany('muster.de', () => r);
			answers.add(JSON.stringify({ code: res.code, message: res.message }));
			expect(res.detail).toContain(r.code ?? 'blocked_ip'); // the reason stays for the server log
		}
		expect([...answers]).toEqual([JSON.stringify({ code: 'unreachable', message: lib.UNREACHABLE })]);
		// an unknown name (before resolution) keeps its own message
		const unknown = lib.lookupCompany('muster.de', () => ({ ok: false, code: 'not_found', message: 'Die Website wurde nicht gefunden (Domain unbekannt).' }));
		expect(unknown).toMatchObject({ code: 'not_found', message: expect.stringMatching(/nicht gefunden/) });
	});

	it.each([
		['another domain', 'https://evil.com/', 'evil.com', /Nur Seiten von muster\.de/],
		['a lookalike domain', 'https://muster.de.evil.com/', 'evil.com', /Nur Seiten von muster\.de/],
		['http', 'http://www.muster.de/', 'http:', /https/],
		['a port', 'https://muster.de:8443/', '8443', /Port/],
		['localhost', 'https://localhost/', 'localhost', /Nur Seiten von muster\.de/],
		['an IP address', 'https://127.0.0.1/', '127.0.0.1', /Nur Seiten von muster\.de/],
		['user info', 'https://muster.de@evil.com/', 'evil.com', /Zugangsdaten|Nur Seiten/],
		['a long host', `https://${'x'.repeat(5000)}.com/`, 'xxxx', /Nur Seiten von muster\.de/]
	])('does not follow a redirect to %s (and does not echo the target)', (_label, to, hidden, message) => {
		const f = fake({ 'https://muster.de/': redirect(to) });
		const res = lib.lookupCompany('muster.de', f.fn);
		expect(res).toMatchObject({ ok: false, code: 'blocked_redirect' });
		expect(res.message).toMatch(message);
		expect(res.message).not.toContain(hidden);
		expect(f.calls).toEqual(['https://muster.de/']);
	});

	it('refuses a domain that resolves to an internal address and ignores the body', () => {
		const f = fake({ 'https://muster.de/': page(IMPRESSUM, { remoteIp: '127.0.0.1' }) });
		const res = lib.lookupCompany('muster.de', f.fn);
		expect(res).toMatchObject({ ok: false, code: 'unreachable', detail: expect.stringMatching(/^blocked_ip/) });
		expect(JSON.stringify(res)).not.toContain('Muster Maschinenbau');
		for (const ip of ['10.0.0.5', '169.254.169.254', '::1', '']) {
			expect(lib.lookupCompany('muster.de', fake({ 'https://muster.de/': page(IMPRESSUM, { remoteIp: ip }) }).fn).detail).toMatch(/^blocked_ip/);
		}
	});

	it('refuses a redirect hop that lands on an internal address', () => {
		const f = fake({
			'https://muster.de/': redirect('https://www.muster.de/'),
			'https://www.muster.de/': page(IMPRESSUM, { remoteIp: '192.168.1.10' })
		});
		expect(lib.lookupCompany('muster.de', f.fn).detail).toMatch(/^blocked_ip/);
	});

	it('stops a redirect loop after MAX_REDIRECTS', () => {
		const f = fake({ 'https://muster.de/': redirect('https://www.muster.de/'), 'https://www.muster.de/': redirect('https://muster.de/') });
		const res = lib.lookupCompany('muster.de', f.fn);
		expect(res.code).toBe('too_many_redirects');
		expect(f.calls.length).toBe(1 + lib.MAX_REDIRECTS);
	});

	it('requests at most MAX_FETCHES pages plus MAX_REDIRECTS redirects', () => {
		const f = fake({
			'https://muster.de/': redirect('https://www.muster.de/'),
			'https://www.muster.de/': page('<a href="/a">Impressum</a>'),
			'https://www.muster.de/a': redirect('https://www.muster.de/b'),
			'https://www.muster.de/b': redirect('https://www.muster.de/c'),
			'https://www.muster.de/c': page('<p>leer</p>', { status: 404 })
		});
		const res = lib.lookupCompany('muster.de', f.fn);
		expect(res.ok).toBe(true);
		expect(f.calls.length).toBeLessThanOrEqual(lib.MAX_FETCHES + lib.MAX_REDIRECTS);
		expect(res.requests).toBe(f.calls.length);
	});

	it('starts no new request after the deadline', () => {
		let t = 0;
		const f = fake({
			'https://muster.de/': () => {
				t += 20_000; // the home page took 20 s
				return page('<a href="/impressum">Impressum</a>');
			}
		});
		lib.lookupCompany('muster.de', f.fn, { now: () => t });
		expect(f.calls).toEqual(['https://muster.de/']);
	});

	it('ignores non-HTML answers', () => {
		const f = fake({
			'https://muster.de/': page('Muster GmbH, Hauptweg 1, 12345 Ort', { contentType: 'application/pdf' }),
			'https://muster.de/impressum': page('%PDF Muster GmbH', { contentType: 'application/pdf' }),
			'https://muster.de/imprint': page('x', { status: 404 })
		});
		expect(lib.lookupCompany('muster.de', f.fn).data).toMatchObject({ name: '', address: '' });
	});

	it('removes < and > that entities decode into (&lt;img …&gt;)', () => {
		const f = fake({
			'https://muster.de/': page('<a href="/impressum&lt;x&gt;">Impressum</a>'),
			'https://muster.de/impressum%3Cx%3E': page(
				'<p>&lt;img src=x onerror=alert(1)&gt;Muster GmbH</p><p>&lt;b&gt;Hauptweg 1&lt;/b&gt;<br>12345 Ort</p>' +
					'<p>Telefon: 030 123456 &lt;script&gt;</p><a href="mailto:info@muster.de">Mail</a>'
			)
		});
		const data = lib.lookupCompany('muster.de', f.fn).data;
		expect(JSON.stringify(data)).not.toMatch(/[<>]/);
		expect(data.source).toBe('https://muster.de/impressum%3Cx%3E');
		expect(lib.cleanField(' <img src=x>Muster  GmbH ')).toBe('img src=x Muster GmbH');
	});

	it('returns only extracted text, never HTML', () => {
		const f = fake({
			'https://muster.de/': page('<a href="/impressum">Impressum</a>'),
			'https://muster.de/impressum': page('<p><b onclick="x()">Muster</b> <i>GmbH</i></p><p>Hauptweg 1<br>12345 <script>alert(1)</script>Ort</p>')
		});
		const data = lib.lookupCompany('muster.de', f.fn).data;
		expect(data.name).toBe('Muster GmbH');
		expect(JSON.stringify(data)).not.toMatch(/[<>]/);
	});
});

describe('rateLimit / cacheValid', () => {
	it('allows RATE_LIMIT lookups per window, then refuses until the oldest expires', () => {
		let list: number[] = [];
		for (let i = 0; i < lib.RATE_LIMIT; i++) {
			const r = lib.rateLimit(list, 1000 + i, lib.RATE_LIMIT, lib.RATE_WINDOW_MS);
			expect(r.allowed).toBe(true);
			list = r.list;
		}
		const refused = lib.rateLimit(list, 2000, lib.RATE_LIMIT, lib.RATE_WINDOW_MS);
		expect(refused.allowed).toBe(false);
		expect(refused.list.length).toBe(lib.RATE_LIMIT); // a refused request does not extend the block
		expect(lib.rateLimit(list, 1000 + lib.RATE_WINDOW_MS, lib.RATE_LIMIT, lib.RATE_WINDOW_MS).allowed).toBe(true);
		expect(lib.RATE_LIMIT).toBe(20);
	});

	it('cache entries live 24 h', () => {
		expect(lib.cacheValid({ at: 0, data: {} }, lib.CACHE_TTL_MS - 1)).toBe(true);
		expect(lib.cacheValid({ at: 0, data: {} }, lib.CACHE_TTL_MS)).toBe(false);
		expect(lib.cacheValid(null, 0)).toBe(false);
	});

	it('cacheEvictions: drops expired and unreadable entries, then the oldest to stay under the cap', () => {
		const now = lib.CACHE_TTL_MS * 2;
		const entries = [
			{ key: 'old', at: 0 }, // expired
			{ key: 'broken', at: null },
			{ key: 'a', at: now - 3 },
			{ key: 'b', at: now - 2 },
			{ key: 'c', at: now - 1 }
		];
		expect(lib.cacheEvictions(entries, now, 10)).toEqual(['old', 'broken']);
		// room for one new entry under max 3 → only two may stay
		expect(lib.cacheEvictions(entries, now, 3)).toEqual(['old', 'broken', 'a']);
		const full = Array.from({ length: lib.CACHE_MAX + 5 }, (_, i) => ({ key: `k${i}`, at: now - lib.CACHE_MAX - 5 + i }));
		const drop = lib.cacheEvictions(full, now);
		expect(full.length - drop.length).toBe(lib.CACHE_MAX - 1);
		expect(drop.slice(0, 3)).toEqual(['k0', 'k1', 'k2']);
		expect(lib.CACHE_MAX).toBe(2000);
		expect(lib.cacheValid({ at: 'x' }, 0)).toBe(false);
	});
});
