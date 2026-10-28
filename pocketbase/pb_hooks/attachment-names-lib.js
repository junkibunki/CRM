// F13a: original file names of activity attachments. PocketBase stores uploads renamed
// (lowercase, umlauts -> `_`, random suffix); the field `attachment_names` (JSON, migration
// 1793190004_f13a.js) maps every stored name to the name it was uploaded with. Clients may
// not write the field (rule); this module computes it from the record alone.
// Loaded with require() inside each hook callback (a callback can't see its file's scope).

const FIELD = 'attachment_names';
const FILES = 'attachments';
const MAX_NAME = 200;
// control characters, bidi overrides/isolates/marks ("rechnung\u202efdp.exe" would show as
// "rechnungexe.pdf"), zero-width characters, the BOM, soft hyphen and line/paragraph
// separators: dropped
const JUNK = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;
// Unicode spaces: PocketBase escapes what Go considers non-printable in Content-Disposition,
// so the download would carry a literal escape sequence in its name: make them plain spaces
const SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
// an extension worth keeping when shortening (".pdf", ".docx", ".tar.gz" keeps ".gz")
const EXTENSION = /\.[^.\s]{1,16}$/;

/** an uploaded file name as it may be shown and offered for download, or '' */
function cleanName(name) {
	let n = String(name == null ? '' : name).replace(JUNK, '').replace(SPACES, ' ');
	// some browsers send a path ("C:\fakepath\x.pdf"): keep only the last part
	n = n.split(/[\\/]/).pop().trim();
	// PocketBase sends it as `filename="..."`: no quote may end that string early
	n = n.replace(/"/g, "'");
	if (n === '.' || n === '..') return '';
	const chars = Array.from(n);
	if (chars.length <= MAX_NAME) return n;
	// too long: shorten the base name, keep the extension
	const ext = Array.from((EXTENSION.exec(n) || [''])[0]);
	const base = chars.slice(0, chars.length - ext.length);
	return base.slice(0, MAX_NAME - ext.length).join('').trimEnd() + ext.join('');
}

/** a stored map (JSON text) as a plain object of strings; anything else counts as empty */
function parseNames(raw) {
	let v;
	try {
		v = JSON.parse(raw || '{}');
	} catch (_) {
		return {};
	}
	const out = {};
	if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
	for (const k of Object.keys(v)) if (typeof v[k] === 'string') out[k] = v[k];
	return out;
}

/**
 * The new map: names of kept files from `old`, plus the uploaded files
 * (`[{ name: stored, originalName }]`). Removed files drop out.
 */
function mergeNames(old, kept, added) {
	const out = {};
	for (const k of kept) if (Object.prototype.hasOwnProperty.call(old, k)) out[k] = old[k];
	for (const f of added) {
		const n = cleanName(f.originalName);
		if (f.name && n) out[f.name] = n;
	}
	return out;
}

/** before e.next() of a create/update request: write the map into e.record */
function remember(e) {
	const rec = e.record;
	if (!rec || !rec.collection().fields.getByName(FIELD)) return;
	// the request body is already applied: strings = kept files, objects = new uploads
	const value = rec.get(FILES) || [];
	const kept = [];
	for (const v of value) if (typeof v === 'string') kept.push(v);
	const added = [];
	for (const f of rec.getUnsavedFiles(FILES) || []) {
		if (f) added.push({ name: f.name, originalName: f.originalName });
	}
	// always from the stored record, never from the request body
	const old = rec.isNew() ? {} : parseNames(rec.original().getString(FIELD));
	rec.set(FIELD, mergeNames(old, kept, added));
}

/** in onFileDownloadRequest: serve an attachment under its original name */
function serveOriginal(e) {
	if (!e.record || !e.fileField || e.fileField.name !== FILES) return;
	// servedName is the stored name; a thumb is served as `<size>_<name>`, which is not in
	// the map and keeps its name (e.request is undefined in this event)
	const file = e.servedName;
	const names = parseNames(e.record.getString(FIELD));
	if (Object.prototype.hasOwnProperty.call(names, file)) {
		const n = cleanName(names[file]);
		if (n) e.servedName = n;
	}
}

module.exports = { FIELD, cleanName, parseNames, mergeNames, remember, serveOriginal };
