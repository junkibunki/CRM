import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { clampSpan, createEditor, editorHtml, editorImageSrc } from './editor';
import { sanitizeHtml } from './sanitize';

const DATA_IMG = 'data:image/png;base64,iVBORw0KGgo=';
const TRACKER = 'https://tracker.example/pixel.gif';

let editor: Editor | null = null;
let element: HTMLElement | null = null;

function open(content: string, onUpdate: (html: string) => void = () => {}) {
	element = document.createElement('div');
	document.body.append(element);
	editor = createEditor({ element, content, label: 'Inhalt', onUpdate, onTransaction: () => {} });
	return editor;
}

afterEach(() => {
	editor?.destroy();
	editor = null;
	element?.remove();
	element = null;
	vi.restoreAllMocks();
});

describe('editorImageSrc', () => {
	it('allows inline data images only (normalised, lowercase like the display)', () => {
		expect(editorImageSrc(DATA_IMG)).toBe(DATA_IMG);
		expect(editorImageSrc(' data:image/png;\nbase64,iVBO ')).toBe('data:image/png;base64,iVBO');
		for (const src of [TRACKER, '//tracker.example/x', '/api/files/activities/x/y.png', 'DATA:IMAGE/png;base64,AA', 'javascript:alert(1)', 'data:text/html,x', '', null, 3]) {
			expect(editorImageSrc(src), String(src)).toBeNull();
		}
	});
});

describe('createEditor (F13a: nothing is lost when editing stored content)', () => {
	it('keeps all heading levels', () => {
		const html = '<h1>Eins</h1><h2>Zwei</h2><h3>Drei</h3><h4>Vier</h4><h5>Fünf</h5><h6>Sechs</h6>';
		expect(editorHtml(open(html))).toBe(html);
	});

	it('keeps tables, including header cells and spans', () => {
		const ed = open('<table><tbody><tr><th>Name</th><th>Wert</th></tr><tr><td colspan="2">zwei <strong>Spalten</strong></td></tr></tbody></table>');
		const html = editorHtml(ed);
		expect(html).toContain('<table');
		expect(html).toContain('<tr><th><p>Name</p></th><th><p>Wert</p></th></tr>');
		expect(html).toContain('<td colspan="2"><p>zwei <strong>Spalten</strong></p></td>');
		// and the display shows them
		const shown = sanitizeHtml(html).html;
		expect(shown).toBe(
			'<table><tbody><tr><th><p>Name</p></th><th><p>Wert</p></th></tr><tr><td colspan="2"><p>zwei <strong>Spalten</strong></p></td></tr></tbody></table>'
		);
		expect(shown).not.toMatch(/style|colgroup/);
	});

	it('clamps huge or invalid spans of stored tables instead of crashing (1..99)', () => {
		const ed = open(
			'<table><tbody><tr><td colspan="100000" rowspan="1000">gross</td></tr>' +
				'<tr><th colspan="-3" rowspan="abc">kaputt</th><td colspan="7" rowspan="2">ok</td></tr></tbody></table>'
		);
		const html = editorHtml(ed);
		expect(html).toContain('<td colspan="99" rowspan="99"><p>gross</p></td>');
		expect(html).toContain('<th><p>kaputt</p></th>');
		expect(html).toContain('<td colspan="7" rowspan="2"><p>ok</p></td>');
	});

	it('clampSpan', () => {
		expect([null, '', 'x', '0', '-1', '1', '2', '99', '100', '1e9', '100000'].map(clampSpan)).toEqual([1, 1, 1, 1, 1, 1, 2, 99, 99, 1, 99]);
	});

	it('keeps inline data images and external images (the display decides about loading)', () => {
		const ed = open(`<p>Logo <img src="${DATA_IMG}" alt="Logo"> und <img src="${TRACKER}" alt="Pixel"></p>`);
		const html = editorHtml(ed);
		expect(html).toContain(`<img src="${DATA_IMG}" alt="Logo">`);
		expect(html).toContain(`<img src="${TRACKER}" alt="Pixel">`);
		const shown = sanitizeHtml(html);
		expect(shown.html).toContain(DATA_IMG);
		expect(shown.blockedImages).toBe(1);
	});

	it('shows external images only as a placeholder while editing', () => {
		open(`<p><img src="${DATA_IMG}" alt="Logo"><img src="${TRACKER}" alt="Pixel"><img src="${TRACKER}"></p>`);
		// (ProseMirror adds src-less separator images of its own)
		const imgs = [...element!.querySelectorAll('img[src]')];
		expect(imgs.map((i) => i.getAttribute('src'))).toEqual([DATA_IMG]);
		const blocked = [...element!.querySelectorAll('[data-image="blocked"]')];
		expect(blocked.map((b) => b.textContent)).toEqual(['Bild nicht geladen: Pixel', 'Bild nicht geladen']);
		expect(element!.innerHTML).not.toContain('tracker.example');
	});

	it('never creates an external <img> in the page document (it would load even detached)', () => {
		const loads: string[] = [];
		const setAttribute = Element.prototype.setAttribute;
		vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (this: Element, name: string, value: string) {
			if (this.ownerDocument === document && this.tagName === 'IMG' && name.toLowerCase() === 'src') loads.push(value);
			return setAttribute.call(this, name, value);
		});
		const srcSetter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!.set!;
		vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (this: HTMLImageElement, v: string) {
			if (this.ownerDocument === document) loads.push(v);
			srcSetter.call(this, v);
		});
		const updates: string[] = [];
		const ed = open(`<p>Hallo <img src="${TRACKER}"> <img src="${DATA_IMG}"></p>`, (h) => updates.push(h));
		ed.commands.insertContent(' Welt');
		expect(updates.at(-1)).toContain(TRACKER); // kept in the saved HTML
		editorHtml(ed);
		expect(loads.filter((s) => !s.startsWith('data:'))).toEqual([]);
	});

	it('reports edits as HTML and empty content as ""', () => {
		const updates: string[] = [];
		const ed = open('<h4>Alt</h4>', (h) => updates.push(h));
		ed.commands.insertContent(' neu');
		// (StarterKit's trailing node adds an empty paragraph after a heading at the end)
		expect(updates.at(-1)).toMatch(/^<h4>( neuAlt|Alt neu)<\/h4>(<p><\/p>)?$/);
		ed.commands.clearContent(true);
		expect(updates.at(-1)).toBe('');
	});
});
