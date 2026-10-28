// Tiptap setup. Imported only dynamically from RichTextEditor.svelte, so the editor stays
// out of every bundle except the one of the opened activity form.
import { Editor } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { DOMSerializer, type Node as PmNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { normalizeUrl } from './sanitize';

// Content saved via the API or pasted from e-mails may contain images, tables and every
// heading level; the editor must keep them, or saving an edit silently drops them (F13a).

/**
 * The image source the editor may load: only inline `data:image/…` (no request, no
 * tracking), like the display without "Bilder anzeigen". Everything else is kept in the
 * content but never loaded while editing.
 */
export function editorImageSrc(src: unknown): string | null {
	if (typeof src !== 'string') return null;
	const s = normalizeUrl(src);
	// lowercase only, like DOMPurify in the display
	return /^data:image\//.test(s) ? s : null;
}

const BLOCKED_IMAGE =
	'inline-flex max-w-full items-center rounded border border-dashed px-1.5 text-xs text-muted-foreground';

/** Image node that shows external images only as a placeholder (src stays in the HTML). */
const SafeImage = Image.extend({
	addNodeView() {
		return ({ node }) => {
			const src = editorImageSrc(node.attrs.src);
			const alt = typeof node.attrs.alt === 'string' ? node.attrs.alt : '';
			let dom: HTMLElement;
			if (src) {
				const img = document.createElement('img');
				img.src = src;
				if (alt) img.alt = alt;
				dom = img;
			} else {
				dom = document.createElement('span');
				dom.className = BLOCKED_IMAGE;
				dom.textContent = alt ? `Bild nicht geladen: ${alt}` : 'Bild nicht geladen';
				dom.title = 'Externe Bilder lädt der Editor nicht. Das Bild bleibt beim Speichern erhalten.';
			}
			dom.dataset.image = src ? 'inline' : 'blocked';
			const same = (n: PmNode) =>
				n.type === node.type && n.attrs.src === node.attrs.src && n.attrs.alt === node.attrs.alt;
			return { dom, update: same };
		};
	}
});

/** max. colspan/rowspan, as in the display (sanitize.ts) */
export const MAX_SPAN = 99;

/**
 * A stored colspan/rowspan as the editor reads it: 1..MAX_SPAN. A huge value
 * (`colspan="100000"`) would make the table model build that many cells and overflow the
 * stack, so opening such an activity would crash the form.
 */
export function clampSpan(value: string | null): number {
	const n = Number.parseInt(value ?? '', 10);
	if (!Number.isFinite(n) || n < 1) return 1;
	return Math.min(n, MAX_SPAN);
}

const spanAttributes = {
	colspan: { default: 1, parseHTML: (el: HTMLElement) => clampSpan(el.getAttribute('colspan')) },
	rowspan: { default: 1, parseHTML: (el: HTMLElement) => clampSpan(el.getAttribute('rowspan')) }
};
const SafeTableCell = TableCell.extend({
	addAttributes() {
		return { ...this.parent?.(), ...spanAttributes };
	}
});
const SafeTableHeader = TableHeader.extend({
	addAttributes() {
		return { ...this.parent?.(), ...spanAttributes };
	}
});

/**
 * HTML of the editor content, built in a document without a browsing context. Tiptap's
 * getHTML() creates the elements in the page's document, and an <img> there fetches its
 * src even when it is never attached: every keystroke would load external images.
 */
export function editorHtml(editor: Editor): string {
	const doc = document.implementation.createHTMLDocument('');
	const box = doc.createElement('div');
	box.append(DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.state.doc.content, { document: doc }));
	return box.innerHTML;
}

// table look in the editor: cell borders, so cells can be found and typed into
const TABLE_CLASSES = [
	'[&_table]:w-full [&_table]:border-collapse [&_table]:table-fixed',
	'[&_td]:border [&_th]:border [&_td]:px-2 [&_th]:px-2 [&_td]:py-1 [&_th]:py-1',
	'[&_td]:align-top [&_th]:align-top [&_th]:bg-muted [&_th]:text-left [&_th]:font-semibold',
	'[&_.selectedCell]:bg-primary/10'
].join(' ');

export function createEditor(opts: {
	element: HTMLElement;
	content: string;
	label: string;
	onUpdate: (html: string) => void;
	/** after every change of content or selection (toolbar state) */
	onTransaction: () => void;
}): Editor {
	return new Editor({
		element: opts.element,
		content: opts.content,
		extensions: [
			StarterKit.configure({
				// the toolbar offers h2 only; the others must survive an edit
				heading: { levels: [1, 2, 3, 4, 5, 6] },
				link: {
					openOnClick: false,
					autolink: true,
					defaultProtocol: 'https',
					protocols: ['mailto', 'tel'],
					HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' }
				}
			}),
			// inline: images in e-mails sit inside paragraphs
			SafeImage.configure({ inline: true, allowBase64: true }),
			// TableKit's parts, with spans clamped when parsing
			Table.configure({ resizable: false }),
			TableRow,
			SafeTableHeader,
			SafeTableCell
		],
		editorProps: {
			attributes: {
				class: `activity-html min-h-40 px-3 py-2 outline-none ${TABLE_CLASSES}`,
				role: 'textbox',
				'aria-multiline': 'true',
				'aria-label': opts.label
			}
		},
		onUpdate: ({ editor }) => opts.onUpdate(editor.isEmpty ? '' : editorHtml(editor)),
		onTransaction: () => opts.onTransaction()
	});
}
