import { describe, expect, it } from 'vitest';
import { isEmptyHtml, LONG_BLOCKS, LONG_TEXT, sanitizeHtml } from './sanitize';

const clean = (html: string, allowImages = false) => sanitizeHtml(html, { allowImages }).html;

describe('sanitizeHtml', () => {
	it('keeps the formatting the editor toolbar produces', () => {
		const html =
			'<h2>Titel</h2><p><strong>fett</strong> <em>kursiv</em> <u>u</u> <s>s</s> <code>c</code></p>' +
			'<ul><li>a</li></ul><ol start="3"><li>b</li></ol><blockquote><p>Zitat</p></blockquote><hr><pre><code>x</code></pre>';
		expect(clean(html)).toBe(html);
	});

	it('removes scripts including their content', () => {
		const out = clean('<p>Hallo</p><script>alert(1)</script><SCRIPT src="//evil/x.js"></SCRIPT>');
		expect(out).toBe('<p>Hallo</p>');
	});

	it('removes on* attributes', () => {
		const out = clean('<p onclick="alert(1)" onmouseover="x()">Text</p><img src="data:image/png;base64,AA" onerror="alert(1)">');
		expect(out).not.toMatch(/on(click|mouseover|error)/i);
		expect(out).toContain('<p>Text</p>');
	});

	it('removes javascript: and other non-web links but keeps the text', () => {
		for (const href of [
			'javascript:alert(1)',
			'JaVaScRiPt:alert(1)',
			' javascript:alert(1)',
			'&#106;avascript:alert(1)',
			'java\nscript:alert(1)',
			'vbscript:x',
			'data:text/html;base64,PHNjcmlwdD4='
		]) {
			const out = clean(`<a href="${href}">Klick</a>`);
			expect(out, href).not.toMatch(/href/);
			expect(out).toContain('Klick');
		}
	});

	it('keeps web, mail and phone links and opens them safely in a new tab', () => {
		const out = clean('<a href="https://example.com/a?b=1">Web</a><a href="mailto:a@b.de">Mail</a><a href="tel:+49301234">Tel</a>');
		expect(out).toContain('href="https://example.com/a?b=1"');
		expect(out).toContain('href="mailto:a@b.de"');
		expect(out).toContain('href="tel:+49301234"');
		expect(out.match(/target="_blank"/g)).toHaveLength(3);
		expect(out.match(/rel="noopener noreferrer nofollow"/g)).toHaveLength(3);
	});

	it('removes external images (tracking pixels) and counts them', () => {
		const r = sanitizeHtml(
			'<p>Hi</p><img src="https://tracker.example/p.gif" width="1"><img src="//cdn.example/x.png"><img src="http://x/y.jpg">'
		);
		expect(r.html).toBe('<p>Hi</p>');
		expect(r.blockedImages).toBe(3);
	});

	it('shows external images only on request, without referrer and lazy', () => {
		const r = sanitizeHtml('<img src="https://example.com/logo.png" alt="Logo">', { allowImages: true });
		expect(r.blockedImages).toBe(0);
		expect(r.html).toContain('src="https://example.com/logo.png"');
		expect(r.html).toContain('referrerpolicy="no-referrer"');
		expect(r.html).toContain('loading="lazy"');
		// the next call blocks again (the option doesn't stick)
		expect(sanitizeHtml('<img src="https://example.com/logo.png">').blockedImages).toBe(1);
	});

	describe('external images hidden in obfuscated URLs (browsers strip tabs/newlines/controls)', () => {
		const cases: [string, string][] = [
			['newline in scheme', 'h&#10;ttps://tracker.example/p.gif'],
			['tab in scheme', 'ht&#9;tps://tracker.example/p.gif'],
			['CR in scheme', 'http&#13;s://tracker.example/p.gif'],
			['control char in scheme', 'h&#1;ttps://tracker.example/p.gif'],
			['NUL in scheme', 'ht&#0;tps://tracker.example/p.gif'],
			['leading control chars and spaces', '&#1;&#31; https://tracker.example/p.gif'],
			['https:host without slashes', 'https:tracker.example/p.gif'],
			['protocol-relative', '//tracker.example/p.gif'],
			['protocol-relative with newline', '/&#10;/tracker.example/p.gif'],
			['uppercase scheme', 'HTTPS://tracker.example/p.gif'],
			['relative path', 'p.gif'],
			['data: but not an image', 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=='],
			['data:image hidden behind newline in a web URL', 'h&#10;ttps://tracker.example/data:image/x']
		];
		for (const [label, src] of cases) {
			it(`blocks ${label}`, () => {
				const r = sanitizeHtml(`<p>x</p><img src="${src}">`);
				expect(r.html, label).toBe('<p>x</p>');
				expect(r.blockedImages, label).toBe(1);
			});
		}

		it('writes back the normalised URL when images are allowed', () => {
			const r = sanitizeHtml('<img src="h&#10;ttps://example.com/&#9;a.png">', { allowImages: true });
			expect(r.blockedImages).toBe(0);
			expect(r.html).toContain('src="https://example.com/a.png"');
			expect(r.html).not.toMatch(/&#10;|\n|\t/);
		});

		it('still blocks non-web sources when images are allowed', () => {
			for (const src of ['data:text/html,x', 'p.gif', 'ftp://example.com/a.png']) {
				expect(sanitizeHtml(`<img src="${src}">`, { allowImages: true }).blockedImages, src).toBe(1);
			}
		});

		it('keeps data:image with whitespace inside, normalised', () => {
			const r = sanitizeHtml('<img src="data:image/png;base64,&#10;iVBOR&#9;w0KGgo=">');
			expect(r.blockedImages).toBe(0);
			expect(r.html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
		});

		it('blocks an uppercase DATA: image (DOMPurify only allows lowercase data:) — never loads anything', () => {
			expect(sanitizeHtml('<img src="DATA:IMAGE/png;base64,iVBORw0KGgo=">').blockedImages).toBe(1);
		});
	});

	it('normalises link hrefs before the scheme check', () => {
		const ok = clean('<a href="h&#10;ttps://example.com/a&#9;b">x</a>');
		expect(ok).toContain('href="https://example.com/ab"');
		for (const href of ['java&#10;script:alert(1)', '&#1;javascript:alert(1)', 'jav&#13;ascript:alert(1)', 'java&#0;script:alert(1)']) {
			const out = clean(`<a href="${href}">x</a>`);
			expect(out, href).not.toMatch(/href/);
		}
	});

	it('keeps inline data: images (no request, no tracking)', () => {
		const r = sanitizeHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">');
		expect(r.blockedImages).toBe(0);
		expect(r.html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
	});

	it('removes style attributes, style sheets and srcset (CSS url() can track too)', () => {
		const out = clean(
			'<style>p{background:url(https://t.example/a)}</style><p style="background:url(https://t.example/b)">x</p><img src="data:image/png;base64,AA" srcset="https://t.example/c 2x">'
		);
		expect(out).not.toMatch(/t\.example|style|srcset/);
		expect(out).toContain('<p>x</p>');
	});

	it('removes embedding and form elements', () => {
		const out = clean(
			'<iframe src="https://evil"></iframe><object data="x"></object><embed src="x"><form action="https://evil"><input name="pw"><button>Los</button></form><svg onload="alert(1)"><circle/></svg><meta http-equiv="refresh" content="0;url=https://evil"><base href="https://evil/">'
		);
		expect(out).not.toMatch(/<(iframe|object|embed|form|input|button|svg|meta|base)/i);
		expect(out).not.toContain('evil');
	});

	it('drops class, id and data attributes', () => {
		expect(clean('<p class="x" id="y" data-foo="z">a</p>')).toBe('<p>a</p>');
	});

	it('marks long texts and many paragraphs as long', () => {
		expect(sanitizeHtml('<p>kurz</p>').long).toBe(false);
		expect(sanitizeHtml(`<p>${'a'.repeat(LONG_TEXT + 1)}</p>`).long).toBe(true);
		expect(sanitizeHtml('<p>x</p>'.repeat(LONG_BLOCKS + 1)).long).toBe(true);
		expect(sanitizeHtml('<p>x</p>'.repeat(LONG_BLOCKS)).long).toBe(false);
	});

	it('treats documents without a body (frameset) as empty instead of throwing', () => {
		for (const html of ['<frameset></frameset>', '<!--x--><frameset>', '<html><frameset>']) {
			expect(() => sanitizeHtml(html), html).not.toThrow();
			expect(sanitizeHtml(html), html).toEqual({ html: '', blockedImages: 0, long: false });
			expect(sanitizeHtml(html, { allowImages: true }).html, html).toBe('');
		}
	});

	it('copes with empty input', () => {
		expect(sanitizeHtml('')).toEqual({ html: '', blockedImages: 0, long: false });
	});
});

describe('sanitizeHtml: tables (F13a)', () => {
	it('keeps the table structure the editor produces, without its inline styles and colgroup', () => {
		const tiptap =
			'<table style="min-width: 50px"><colgroup><col style="min-width: 25px"><col style="min-width: 25px"></colgroup>' +
			'<tbody><tr><th colspan="1" rowspan="1"><p>Name</p></th><th colspan="1" rowspan="1"><p>Wert</p></th></tr>' +
			'<tr><td colspan="2" rowspan="1"><p>zwei <strong>Spalten</strong></p></td></tr></tbody></table>';
		expect(clean(tiptap)).toBe(
			'<table><tbody><tr><th colspan="1" rowspan="1"><p>Name</p></th><th colspan="1" rowspan="1"><p>Wert</p></th></tr>' +
				'<tr><td colspan="2" rowspan="1"><p>zwei <strong>Spalten</strong></p></td></tr></tbody></table>'
		);
	});

	it('keeps thead/tfoot from e-mails', () => {
		const html = '<table><thead><tr><th>K</th></tr></thead><tbody><tr><td>1</td></tr></tbody><tfoot><tr><td>S</td></tr></tfoot></table>';
		expect(clean(html)).toBe(html);
	});

	it('drops table attributes that load or style anything (background, style, bgcolor, width, class)', () => {
		const out = clean(
			'<table background="https://t.example/a.gif" style="background:url(https://t.example/b)" bgcolor="red" width="900" class="x" border="1" cellpadding="9">' +
				'<tr background="https://t.example/c.gif"><td background="https://t.example/d.gif" style="background-image:url(https://t.example/e)" width="50" height="9" nowrap>x</td></tr></table>'
		);
		expect(out).toBe('<table><tbody><tr><td>x</td></tr></tbody></table>');
		expect(out).not.toMatch(/t\.example|style|background|width|class|border/);
	});

	it('removes event handlers on table elements', () => {
		const out = clean(
			'<table onmouseover="alert(1)"><tbody onclick="x()"><tr onfocus="y()"><th onmouseenter="z()">a</th><td onpointerdown="w()">b</td></tr></tbody></table>'
		);
		expect(out).not.toMatch(/on[a-z]+=/i);
		expect(out).toContain('<th>a</th><td>b</td>');
	});

	it('keeps only small numeric spans (no URLs, no script, no huge layouts)', () => {
		for (const v of ['javascript:alert(1)', '0', '-1', '1000', '2x', '2 3', 'https://t.example', '']) {
			const out = clean(`<table><tr><td colspan="${v}" rowspan="${v}">x</td></tr></table>`);
			expect(out, v).toBe('<table><tbody><tr><td>x</td></tr></tbody></table>');
		}
		expect(clean('<table><tr><td colspan="12" rowspan="3">x</td></tr></table>')).toContain('<td colspan="12" rowspan="3">');
	});

	it('removes scripts, styles and embeds inside cells, and blocks images there like anywhere', () => {
		const r = sanitizeHtml(
			'<table><tr><td><script>alert(1)</script><style>td{background:url(https://t.example/s)}</style>' +
				'<iframe src="https://t.example/f"></iframe><img src="https://t.example/p.gif">ok</td></tr></table>'
		);
		expect(r.html).toBe('<table><tbody><tr><td>ok</td></tr></tbody></table>');
		expect(r.blockedImages).toBe(1);
	});

	it('survives known mXSS shapes with tables (no handler, no svg/math, no style)', () => {
		for (const html of [
			'<table><td><svg><style><img src=x onerror=alert(1)>',
			'<table><tr><td><math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
			'<form><math><mtext></form><form><mglyph><style></math><img src onerror=alert(1)>',
			'<table><caption><svg><desc><table><td><img src=x onerror=alert(1)></td></table></desc></svg></caption></table>',
			'<noscript><table><td title="</noscript><img src=x onerror=alert(1)>">'
		]) {
			const out = clean(html);
			expect(out, html).not.toMatch(/onerror|<svg|<math|<style|<script|<noscript/i);
		}
	});

	it('drops caption, colgroup and col but keeps the caption text', () => {
		const out = clean('<table><caption>Preise</caption><colgroup><col span="2"></colgroup><tr><td>1</td></tr></table>');
		expect(out).not.toMatch(/caption|colgroup|<col/);
		expect(out).toContain('Preise');
	});
});

describe('isEmptyHtml', () => {
	it('treats empty editor output as empty', () => {
		expect(isEmptyHtml('')).toBe(true);
		expect(isEmptyHtml('<p></p>')).toBe(true);
		expect(isEmptyHtml('<p> &nbsp; </p><p><br></p>')).toBe(true);
	});

	it('treats text as content', () => {
		expect(isEmptyHtml('<p>a</p>')).toBe(false);
		expect(isEmptyHtml('<ul><li>x</li></ul>')).toBe(false);
	});
});
