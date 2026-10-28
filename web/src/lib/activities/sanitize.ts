import DOMPurify, { type DOMPurify as Purifier } from 'dompurify';

// Every user sees every activity, and pasted e-mails may carry scripts, on* handlers,
// tracking pixels and CSS. Only what the editor (Tiptap StarterKit, Image, TableKit) can
// produce is kept; no style/class/width/background attributes, so no CSS url() either.
const ALLOWED_TAGS = [
	'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre',
	'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'a', 'hr', 'img',
	'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td'
];
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'start', 'colspan', 'rowspan'];
// not URLs: without this, the custom ALLOWED_URI_REGEXP would drop them
const NON_URI_ATTR = ['start', 'colspan', 'rowspan'];
// cell spans: small numbers only (anything else is dropped, the cell stays)
const SPAN = /^[1-9][0-9]?$/;
// links: web, mail, phone; images additionally inline data:image (DOMPurify allows data:
// only on img). Everything else (javascript:, vbscript:, relative URLs, …) is dropped.
const ALLOWED_URI_REGEXP = /^(?:https?:|mailto:|tel:)/i;
// what is allowed after normalising (allowlists, never a denylist on the raw value)
const SAFE_HREF = /^(?:https?:|mailto:|tel:)/i;
const INLINE_IMAGE = /^data:image\//i;
const WEB_IMAGE = /^https?:/i;
// Browsers drop tabs/newlines anywhere in a URL and control chars/spaces around it, and
// DOMPurify checks without whitespace but writes the raw value back: `h&#10;ttps://x`
// passes as a request to x. Compare and write back the value without all of these.
const URL_JUNK = /[\x00-\x20\x7f-\x9f\xa0\u1680\u180e\u2000-\u2029\u205f\u3000\ufeff]/g;
const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, br, hr';

/** text longer than this, or more blocks than LONG_BLOCKS, is collapsed with "mehr" */
export const LONG_TEXT = 500;
export const LONG_BLOCKS = 6;

export type Sanitized = {
	html: string;
	/** images that were removed (external: tracking, or not an image); web images return with allowImages */
	blockedImages: number;
	/** long enough to show collapsed */
	long: boolean;
};

/** a URL as the browser will read it: without whitespace and control characters */
export function normalizeUrl(url: string): string {
	return url.replace(URL_JUNK, '');
}

let purifier: Purifier | null = null;
let allowImages = false;

function instance(): Purifier {
	if (purifier) return purifier;
	const p = DOMPurify(window);
	p.addHook('afterSanitizeAttributes', (node) => {
		for (const attr of ['colspan', 'rowspan']) {
			if (node.hasAttribute(attr) && !SPAN.test(node.getAttribute(attr) ?? '')) node.removeAttribute(attr);
		}
		if (node.tagName === 'A' && node.hasAttribute('href')) {
			const href = normalizeUrl(node.getAttribute('href') ?? '');
			if (SAFE_HREF.test(href)) {
				node.setAttribute('href', href);
				node.setAttribute('target', '_blank');
				node.setAttribute('rel', 'noopener noreferrer nofollow');
			} else node.removeAttribute('href');
		}
		if (node.tagName === 'IMG') {
			// allowlist: inline data:image always, web images only on request, nothing else
			const src = normalizeUrl(node.getAttribute('src') ?? '');
			const ok = INLINE_IMAGE.test(src) || (allowImages && WEB_IMAGE.test(src));
			if (!ok) node.setAttribute('data-blocked', '');
			else {
				node.setAttribute('src', src);
				node.setAttribute('loading', 'lazy');
			}
			// no referrer to the sender's server even when shown on request
			node.setAttribute('referrerpolicy', 'no-referrer');
		}
	});
	purifier = p;
	return p;
}

/**
 * Cleans activity HTML for display with {@html}. External images are removed unless
 * `opts.allowImages` (the user asked to load them); the count is returned for the hint.
 */
export function sanitizeHtml(dirty: string, opts: { allowImages?: boolean } = {}): Sanitized {
	const p = instance();
	allowImages = !!opts.allowImages;
	let frag: DocumentFragment | null;
	try {
		frag = p.sanitize(dirty ?? '', {
			ALLOWED_TAGS,
			ALLOWED_ATTR,
			ALLOWED_URI_REGEXP,
			// attributes not listed as URI-safe are checked against ALLOWED_URI_REGEXP too
			ADD_URI_SAFE_ATTR: NON_URI_ATTR,
			ALLOW_DATA_ATTR: false,
			RETURN_DOM_FRAGMENT: true
		});
	} finally {
		allowImages = false;
	}
	// no <body> after parsing (e.g. `<frameset>`): DOMPurify returns null — treat as empty,
	// otherwise one such activity breaks the whole timeline
	frag ??= document.createDocumentFragment();
	const blocked = frag.querySelectorAll('img[data-blocked]');
	blocked.forEach((img) => img.remove());
	const text = (frag.textContent ?? '').trim();
	const long = text.length > LONG_TEXT || frag.querySelectorAll(BLOCKS).length > LONG_BLOCKS;
	const box = document.createElement('div');
	box.append(frag);
	return { html: box.innerHTML, blockedImages: blocked.length, long };
}

/** true for editor output without visible content (`<p></p>`, only spaces/line breaks) */
export function isEmptyHtml(html: string): boolean {
	const doc = new DOMParser().parseFromString(html ?? '', 'text/html');
	return !(doc.body.textContent ?? '').trim() && !doc.body.querySelector('img, hr');
}
