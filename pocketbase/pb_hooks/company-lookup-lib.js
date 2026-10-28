// F10: suggest company data (name, address, phone, e-mail) from a company's website.
// Plain JS (CommonJS, ES2015, no Unicode regex flags, no lookbehind) so it runs both in the
// PocketBase JS VM (require(`${__hooks}/company-lookup-lib.js`)) and in the Vitest tests
// (web/src/lib/crm/company-lookup-lib.test.ts). Everything here is pure; the only side
// effect (running curl) comes in from the hook as a function.

var MAX_FETCHES = 3; // pages per lookup (home, impressum, fallback) ...
var MAX_REDIRECTS = 3; // ... plus at most this many redirects in total (same domain only)
var DEADLINE_MS = 15 * 1000; // no new request after this
var MAX_BYTES = 1024 * 1024; // response size limit
var TIMEOUT_S = 5; // per request
var LIMIT_RATE = '200k'; // bytes/s: 5 s × 200 KiB ≈ 1 MB, the size limit independent of curl's version
var CACHE_MAX = 2000; // cached domains
var RATE_LIMIT = 20; // lookups per user ...
var RATE_WINDOW_MS = 60 * 1000; // ... per minute
var CACHE_TTL_MS = 24 * 60 * 60 * 1000;
var META_MARKER = '@@CRM-LOOKUP@@';
var USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// ---------------------------------------------------------------------------------------
// domain / URL / IP validation (SSRF protection)
// ---------------------------------------------------------------------------------------

// top-level labels that never belong to a public company website
var RESERVED_TLDS = {
	localhost: 1, local: 1, localdomain: 1, internal: 1, intranet: 1, lan: 1, home: 1, corp: 1,
	private: 1, arpa: 1, test: 1, example: 1, invalid: 1, onion: 1, alt: 1
};

/**
 * Validates the `domain` query parameter. Only a plain public hostname is accepted: no
 * scheme, path, port, user info, IP literal, `localhost`, single-label (internal) names or
 * reserved TLDs. A leading `www.` is dropped (both variants are allowed as fetch targets).
 * @returns {{domain: string} | {error: string}}
 */
function normalizeDomain(input) {
	var d = String(input == null ? '' : input).trim().toLowerCase();
	if (!d) return { error: 'Keine Domain angegeben.' };
	if (d.charAt(d.length - 1) === '.') d = d.slice(0, -1);
	if (d.length > 253 || !/^[a-z0-9.-]+$/.test(d)) {
		return { error: 'Ungültige Domain: nur ein Hostname wie „firma.de“ ist erlaubt (ohne https://, Pfad oder Port).' };
	}
	var labels = d.split('.');
	if (labels.length < 2) return { error: 'Interne Namen ohne Punkt sind nicht erlaubt.' };
	for (var i = 0; i < labels.length; i++) {
		if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(labels[i])) {
			return { error: 'Ungültige Domain.' };
		}
	}
	var tld = labels[labels.length - 1];
	if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) {
		// a numeric last label means an IP literal (127.0.0.1, 0x7f.1 …); anything else is just
		// no valid ending (firma.d3, firma.de-x, firma.x)
		if (/^(?:\d+|0x[0-9a-f]+)$/.test(tld)) return { error: 'IP-Adressen sind nicht erlaubt, nur Domains.' };
		return { error: 'Ungültige Domain-Endung „' + tld + '“.' };
	}
	if (RESERVED_TLDS[tld]) return { error: 'Interne oder reservierte Domains sind nicht erlaubt.' };
	if (labels[0] === 'www' && labels.length > 2) d = labels.slice(1).join('.');
	return { domain: d };
}

/** `https://user@Host:443/a?b#c` → parts; null when not an absolute URL */
function parseUrl(url) {
	var m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^\/?#]*)([^#]*)/.exec(String(url || ''));
	if (!m) return null;
	var authority = m[2];
	var userinfo = authority.indexOf('@') >= 0;
	if (userinfo) authority = authority.slice(authority.lastIndexOf('@') + 1);
	var hp = /^(\[[^\]]*\]|[^:]*)(?::(.*))?$/.exec(authority);
	var host = (hp ? hp[1] : authority).toLowerCase();
	if (host.charAt(host.length - 1) === '.') host = host.slice(0, -1);
	var rest = m[3] || '/';
	if (rest.charAt(0) !== '/') rest = '/' + rest;
	return {
		scheme: m[1].toLowerCase(),
		host: host,
		port: hp && hp[2] != null ? hp[2] : null,
		userinfo: userinfo,
		path: rest
	};
}

/**
 * May the server request this URL in a lookup for `domain`? Only https, only the domain
 * itself or its www. variant, no port, no user info.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function checkTarget(url, domain) {
	var u = parseUrl(url);
	if (!u) return { ok: false, reason: 'Ungültige Adresse.' };
	if (u.scheme !== 'https') return { ok: false, reason: 'Nur https ist erlaubt.' };
	if (u.userinfo) return { ok: false, reason: 'Adressen mit Zugangsdaten sind nicht erlaubt.' };
	if (u.port !== null && u.port !== '' && u.port !== '443') {
		return { ok: false, reason: 'Andere Ports als 443 sind nicht erlaubt.' };
	}
	if (u.host !== domain && u.host !== 'www.' + domain) {
		// the foreign host comes from the page (Location header) and is not echoed back
		return { ok: false, reason: 'Nur Seiten von ' + domain + ' werden abgerufen.' };
	}
	return { ok: true };
}

function originOf(url) {
	var u = parseUrl(url);
	return u ? u.scheme + '://' + u.host : '';
}

/** removes `.` and `..` segments from an absolute path */
function removeDotSegments(path) {
	var out = [];
	var parts = path.split('/');
	for (var i = 0; i < parts.length; i++) {
		var p = parts[i];
		if (p === '.') continue;
		if (p === '..') {
			if (out.length > 1) out.pop();
			continue;
		}
		out.push(p);
	}
	var last = parts[parts.length - 1];
	if (last === '.' || last === '..') out.push('');
	var s = out.join('/');
	return s.charAt(0) === '/' ? s : '/' + s;
}

/** keeps printable ASCII, percent-encodes the rest (spaces, umlauts, control chars, <>"`) */
function encodePath(s) {
	return s.replace(/[^\x21-\x7e]|[<>"`]/g, function (c) {
		try {
			return encodeURIComponent(c);
		} catch (err) {
			return '';
		}
	});
}

/**
 * Resolves a link from a page against the page URL. Returns null for anchors, mailto:,
 * javascript: and other non-web links. With `upgrade`, http links become https (the server
 * only fetches https; for redirects this is NOT done, an http redirect is refused).
 */
function resolveUrl(base, href, upgrade) {
	// control characters out, outer whitespace trimmed (inner spaces are encoded below)
	var h = String(href == null ? '' : href).replace(/[\x00-\x1f\x7f]/g, '').trim();
	if (!h || h.charAt(0) === '#') return null;
	var b = parseUrl(base);
	if (!b) return null;
	var abs;
	var scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(h);
	if (scheme) {
		var s = scheme[1].toLowerCase();
		if (s !== 'http' && s !== 'https') return null;
		abs = h;
	} else if (h.slice(0, 2) === '//') {
		abs = b.scheme + ':' + h;
	} else {
		var basePath = b.path.split('?')[0];
		var path;
		if (h.charAt(0) === '/') path = h;
		else if (h.charAt(0) === '?') path = basePath + h;
		else path = basePath.slice(0, basePath.lastIndexOf('/') + 1) + h;
		abs = b.scheme + '://' + b.host + (b.port ? ':' + b.port : '') + path;
	}
	abs = abs.split('#')[0];
	var u = parseUrl(abs);
	if (!u) return null;
	if (upgrade && u.scheme === 'http') u.scheme = 'https';
	var q = u.path.indexOf('?');
	var p = q >= 0 ? u.path.slice(0, q) : u.path;
	var query = q >= 0 ? u.path.slice(q) : '';
	var authority = (u.userinfo ? 'user@' : '') + u.host + (u.port ? ':' + u.port : '');
	return u.scheme + '://' + authority + encodePath(removeDotSegments(p) + query);
}

function ipv4Parts(ip) {
	var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
	if (!m) return null;
	var parts = [+m[1], +m[2], +m[3], +m[4]];
	for (var i = 0; i < 4; i++) if (parts[i] > 255) return null;
	return parts;
}

function isPublicIpv4(p) {
	var a = p[0];
	var b = p[1];
	if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this net, private, loopback, multicast/reserved
	if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
	if (a === 169 && b === 254) return false; // link-local (cloud metadata)
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && b === 168) return false;
	if (a === 192 && b === 0 && (p[2] === 0 || p[2] === 2)) return false; // IETF, TEST-NET-1
	if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
	if (a === 198 && b === 51 && p[2] === 100) return false; // TEST-NET-2
	if (a === 203 && b === 0 && p[2] === 113) return false; // TEST-NET-3
	return true;
}

/** `::ffff:1.2.3.4`, `fe80::1%eth0` → 8 numbers; null when not IPv6 */
function ipv6Groups(ip) {
	var s = ip.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
	if (s.indexOf(':') < 0 || !/^[0-9a-f:.]+$/.test(s)) return null;
	var tail = [];
	var v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
	if (v4) {
		var p = ipv4Parts(v4[1]);
		if (!p) return null;
		tail = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]];
		s = s.slice(0, s.length - v4[1].length);
		if (s.slice(-2) !== '::') s = s.slice(0, -1); // drop the ':' before the IPv4 part
	}
	var halves = s.split('::');
	if (halves.length > 2) return null;
	var head = halves[0] ? halves[0].split(':') : [];
	var back = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	var want = 8 - tail.length;
	var groups;
	if (halves.length === 2) {
		var fill = want - head.length - back.length;
		if (fill < 0) return null;
		groups = head.concat(new Array(fill + 1).join('0').split(''), back);
	} else {
		groups = head;
	}
	if (groups.length !== want) return null;
	var out = [];
	for (var i = 0; i < groups.length; i++) {
		if (!/^[0-9a-f]{1,4}$/.test(groups[i])) return null;
		out.push(parseInt(groups[i], 16));
	}
	return out.concat(tail);
}

/**
 * Is this the address of a public host? Loopback, private, link-local, CGNAT, documentation,
 * multicast and unspecified addresses are not, IPv4-mapped/NAT64/6to4 IPv6 addresses are
 * judged by their embedded IPv4 address. Unknown input → false (fail closed).
 */
function isPublicIp(ip) {
	ip = String(ip || '').trim();
	var v4 = ipv4Parts(ip);
	if (v4) return isPublicIpv4(v4);
	var g = ipv6Groups(ip);
	if (!g) return false;
	var embedded = function (hi, lo) {
		return isPublicIpv4([hi >> 8, hi & 255, lo >> 8, lo & 255]);
	};
	// ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible, also covers :: and ::1)
	if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && (g[5] === 0 || g[5] === 0xffff)) {
		return embedded(g[6], g[7]);
	}
	if (g[0] === 0x64 && g[1] === 0xff9b) return embedded(g[6], g[7]); // NAT64
	if (g[0] === 0x2002) return embedded(g[1], g[2]); // 6to4
	if ((g[0] & 0xe000) !== 0x2000) return false; // only global unicast 2000::/3
	if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
	if (g[0] === 0x2001 && g[1] < 0x0200) return false; // 2001::/23 special purpose (Teredo, ORCHID …)
	return true;
}

// ---------------------------------------------------------------------------------------
// fetching via curl (the hook passes in a function that runs the command)
// ---------------------------------------------------------------------------------------

/**
 * Arguments for one GET. curl is used instead of $http.send because $http.send follows
 * every redirect itself (also to http://127.0.0.1) and has no size limit. curl does not
 * follow redirects (no -L); the redirect target comes back in the write-out and is checked
 * by checkTarget() before the next request.
 */
function curlArgs(url) {
	return [
		'-q', // ignore ~/.curlrc (must be the first argument)
		'--silent',
		'--globoff', // no {} [] URL globbing
		'--proto', '=https',
		'--proto-redir', '=https',
		'--max-redirs', '0',
		'--noproxy', '*',
		'--max-time', String(TIMEOUT_S),
		'--connect-timeout', String(TIMEOUT_S),
		'--max-filesize', String(MAX_BYTES),
		// curl < 8.4 ignores --max-filesize for chunked answers; with --max-time this caps
		// any body at about LIMIT_RATE * TIMEOUT_S, whatever the curl version
		'--limit-rate', LIMIT_RATE,
		'--user-agent', USER_AGENT,
		'--header', 'Accept: text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
		'--header', 'Accept-Language: de-DE,de;q=0.9,en;q=0.5',
		'--write-out', '\n' + META_MARKER + '%{http_code}\t%{remote_ip}\t%{content_type}\t%{redirect_url}',
		url
	];
}

/** curl stdout (body + write-out) → parts; null when the marker is missing */
function parseCurlOutput(str) {
	var idx = str.lastIndexOf('\n' + META_MARKER);
	if (idx < 0) return null;
	var meta = str.slice(idx + 1 + META_MARKER.length).split('\t');
	return {
		status: parseInt(meta[0], 10) || 0,
		remoteIp: meta[1] || '',
		contentType: meta[2] || '',
		redirectUrl: (meta[3] || '').trim(),
		body: str.slice(0, idx)
	};
}

/** curl exit code → error code and a German message for the user */
function curlError(exitCode) {
	switch (exitCode) {
		case 6:
			return { code: 'not_found', message: 'Die Website wurde nicht gefunden (Domain unbekannt).' };
		case 7:
			return { code: 'unreachable', message: 'Die Website ist nicht erreichbar.' };
		case 28:
			return { code: 'timeout', message: 'Die Website hat nicht rechtzeitig geantwortet.' };
		case 35:
		case 51:
		case 53:
		case 54:
		case 58:
		case 59:
		case 60:
		case 77:
		case 83:
		case 90:
		case 91:
			return { code: 'tls', message: 'Keine sichere Verbindung zur Website möglich (Zertifikat/TLS).' };
		case 63:
			return { code: 'too_large', message: 'Die Seite ist zu groß (über 1 MB).' };
		case 1:
			return { code: 'protocol', message: 'Nur https-Adressen werden abgerufen.' };
		default:
			return { code: 'fetch_failed', message: 'Die Website konnte nicht abgerufen werden.' };
	}
}

/** charset from the Content-Type header or a <meta> tag at the start of the page */
function detectCharset(contentType, html) {
	var m = /charset\s*=\s*["']?([a-zA-Z0-9_.:-]+)/i.exec(contentType || '');
	if (m) return m[1].toLowerCase();
	var head = String(html || '').slice(0, 4096);
	m = /<meta[^>]+charset\s*=\s*["']?([a-zA-Z0-9_.:-]+)/i.exec(head);
	return m ? m[1].toLowerCase() : '';
}

function isSingleByteCharset(cs) {
	return /^(?:iso-?8859-(?:1|15)|latin-?1|l1|windows-1252|cp1252|cp819|ibm819)$/.test(cs || '');
}

// windows-1252 0x80–0x9f (ISO-8859-1 has control characters there)
var CP1252 = {
	128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225, 136: 710, 137: 8240,
	138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216, 146: 8217, 147: 8220, 148: 8221, 149: 8226,
	150: 8211, 151: 8212, 152: 732, 153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376
};

/** bytes (array or Uint8Array) as windows-1252 / ISO-8859-1 text */
function decodeSingleByte(bytes) {
	var parts = [];
	for (var i = 0; i < bytes.length; i += 8192) {
		parts.push(String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + 8192)));
	}
	return parts.join('').replace(/[\x80-\x9f]/g, function (c) {
		var cp = CP1252[c.charCodeAt(0)];
		return cp ? String.fromCharCode(cp) : c;
	});
}

function exitCodeOf(err) {
	var m = /exit status (\d+)/.exec(String(err && (err.message || err)));
	return m ? parseInt(m[1], 10) : -1;
}

/**
 * Builds the fetch function used by lookupCompany().
 * @param run   (args: string[]) => bytes   runs curl, returns stdout, throws on exit != 0
 * @param utf8  (bytes) => string           UTF-8 decoding (PocketBase's toString)
 * @returns (url) => {ok, status, remoteIp, contentType, redirectUrl, body} | {ok:false, code, message}
 */
function makeCurlFetcher(run, utf8) {
	return function (url) {
		var bytes;
		try {
			bytes = run(curlArgs(url));
		} catch (err) {
			var text = String(err && (err.message || err));
			if (/executable file not found|not recognized|no such file/i.test(text)) {
				return { ok: false, code: 'no_curl', message: 'Website-Abruf ist auf dem Server nicht verfügbar (curl fehlt).' };
			}
			var e = curlError(exitCodeOf(err));
			return { ok: false, code: e.code, message: e.message };
		}
		if (bytes.length > MAX_BYTES + 4096) {
			return { ok: false, code: 'too_large', message: 'Die Seite ist zu groß (über 1 MB).' };
		}
		var res = parseCurlOutput(utf8(bytes));
		if (!res) return { ok: false, code: 'fetch_failed', message: 'Die Website konnte nicht abgerufen werden.' };
		if (isSingleByteCharset(detectCharset(res.contentType, res.body))) {
			var latin = parseCurlOutput(decodeSingleByte(bytes));
			if (latin) res = latin;
		}
		res.ok = true;
		return res;
	};
}

// ---------------------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------------------

var ENTITIES = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', auml: 'ä', ouml: 'ö', uuml: 'ü',
	Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ß', eacute: 'é', egrave: 'è', aacute: 'á', agrave: 'à',
	oacute: 'ó', iacute: 'í', ccedil: 'ç', Eacute: 'É', copy: '©', reg: '®', trade: '™',
	ndash: '–', mdash: '—', bdquo: '„', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', sbquo: '‚',
	laquo: '«', raquo: '»', hellip: '…', middot: '·', bull: '•', shy: '', euro: '€', sect: '§',
	deg: '°', zwnj: '', zwj: '', ensp: ' ', emsp: ' ', thinsp: ' ', commat: '@', period: '.',
	colon: ':', sol: '/', plus: '+', lpar: '(', rpar: ')', num: '#', excl: '!', quest: '?'
};

function fromCodePoint(cp) {
	if (!(cp > 0) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
	if (cp <= 0xffff) return String.fromCharCode(cp);
	cp -= 0x10000;
	return String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
}

function decodeEntities(s) {
	return String(s).replace(/&(?:#[xX]([0-9a-fA-F]{1,6})|#([0-9]{1,7})|([a-zA-Z][a-zA-Z0-9]{1,8}));?/g, function (all, hex, dec, name) {
		if (hex) return fromCodePoint(parseInt(hex, 16));
		if (dec) return fromCodePoint(parseInt(dec, 10));
		return Object.prototype.hasOwnProperty.call(ENTITIES, name) && all.charAt(all.length - 1) === ';'
			? ENTITIES[name]
			: all;
	});
}

/** one line of text: no tags, entities decoded, whitespace collapsed */
function inlineText(html) {
	return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' '))
		.replace(/[\u00a0\u2007\u202f]/g, ' ')
		.replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '')
		.replace(/[\u2010\u2011]/g, '-')
		.replace(/\s+/g, ' ')
		.trim();
}

var BLOCK_TAGS =
	'p|div|li|ul|ol|tr|table|tbody|thead|h[1-6]|section|article|header|footer|address|dd|dt|dl|nav|main|aside|blockquote|pre|form|figure|figcaption|hr|center|button|label|option';

// invisible, or (nav) menus that list sister companies before the impressum text
var HIDDEN_TAGS = ['script', 'style', 'noscript', 'svg', 'template', 'iframe', 'head', 'select', 'textarea', 'nav'];

/** visible text of a page, one line per block / <br> */
function htmlToText(html) {
	var s = String(html || '');
	s = s.replace(/<!--[\s\S]*?-->/g, ' ');
	// one regex per tag (no backreference: keeps the regex on the linear engine in the JS VM)
	for (var t = 0; t < HIDDEN_TAGS.length; t++) {
		s = s.replace(new RegExp('<' + HIDDEN_TAGS[t] + '\\b[\\s\\S]*?<\\/' + HIDDEN_TAGS[t] + '\\s*>', 'gi'), ' ');
	}
	s = s.replace(/<br\s*\/?>/gi, '\n');
	s = s.replace(new RegExp('<\\/?(?:' + BLOCK_TAGS + ')\\b[^>]*>', 'gi'), '\n');
	s = s.replace(/<\/?t[dh]\b[^>]*>/gi, ' ');
	s = s.replace(/<[^>]*>/g, '');
	s = decodeEntities(s)
		.replace(/[\u00a0\u2007\u202f\u2009]/g, ' ')
		.replace(/[\u00ad\u200b\u200c\u200d\ufeff]/g, '')
		.replace(/[\u2010\u2011]/g, '-');
	var lines = s.split(/\r?\n|\r|\u2028|\u2029/);
	var out = [];
	for (var i = 0; i < lines.length; i++) {
		var l = lines[i].replace(/[ \t\f\v]+/g, ' ').trim();
		if (l) out.push(l);
	}
	return out.join('\n');
}

/** attributes of a start tag (`<a href="x" title='y'>`) */
function attributes(tag) {
	var attrs = {};
	var re = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
	var m;
	while ((m = re.exec(tag))) {
		attrs[m[1].toLowerCase()] = decodeEntities(m[2] != null ? m[2] : m[3] != null ? m[3] : m[4]);
	}
	return attrs;
}

/** og:site_name and <title> */
function extractMeta(html) {
	var s = String(html || '');
	var siteName = '';
	var re = /<meta\b[^>]*>/gi;
	var m;
	while ((m = re.exec(s))) {
		var a = attributes(m[0]);
		if ((a.property || a.name || '').toLowerCase() === 'og:site_name' && a.content) {
			siteName = inlineText(a.content);
			break;
		}
	}
	var t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(s);
	return { siteName: siteName, title: t ? inlineText(t[1]) : '' };
}

/** all links of a page: [{href, text}] */
function findLinks(html) {
	var links = [];
	var re = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
	var m;
	while ((m = re.exec(String(html || '')))) {
		var a = attributes(m[1]);
		if (a.href == null) continue;
		links.push({ href: a.href, text: inlineText(m[2]) || a.title || a['aria-label'] || '' });
	}
	return links;
}

/** the impressum link of a page (absolute https URL on the same domain) or null */
function findImpressumLink(html, baseUrl, domain) {
	var links = findLinks(html);
	var best = null;
	var bestScore = 0;
	for (var i = 0; i < links.length; i++) {
		var text = links[i].text.toLowerCase();
		var href = links[i].href.toLowerCase();
		var score = 0;
		if (/^\s*(?:impressum|imprint)\s*$/.test(text)) score = 4;
		else if (/impressum|imprint/.test(text)) score = 3;
		else if (/impressum|imprint/.test(href)) score = 2;
		else if (/anbieterkennzeichnung|legal notice|site notice/.test(text)) score = 1;
		if (score <= bestScore) continue;
		var url = resolveUrl(baseUrl, links[i].href, true);
		if (!url || !checkTarget(url, domain).ok) continue;
		best = url;
		bestScore = score;
	}
	return best;
}

// ---------------------------------------------------------------------------------------
// extraction: company name, address, phone, e-mail
// ---------------------------------------------------------------------------------------

var CO = '&\\s*Co\\.?\\s*';
var LEGAL_FORMS = [
	'GmbH\\s*' + CO + 'KGaA', 'GmbH\\s*' + CO + 'OHG', 'GmbH\\s*' + CO + 'KG',
	'UG\\s*\\(haftungsbeschr(?:ä|ae)nkt\\)\\s*' + CO + 'KG',
	'AG\\s*' + CO + 'KGaA', 'AG\\s*' + CO + 'KG', 'SE\\s*' + CO + 'KGaA', 'SE\\s*' + CO + 'KG',
	'UG\\s*\\(haftungsbeschr(?:ä|ae)nkt\\)', 'gGmbH', 'GmbH', 'GMBH', 'mbH', 'gAG', 'AG', 'SE',
	'KGaA', 'KG', 'OHG', 'oHG', 'GbR', 'PartGmbB', 'PartG\\s*mbB', 'PartG', 'eG',
	'e\\.\\s?K\\.', 'e\\.\\s?Kfm\\.', 'e\\.\\s?Kfr\\.', 'e\\.\\s?V\\.', 'UG',
	// spelled out
	'Gesellschaft mit beschr(?:ä|ae)nkter Haftung', 'Aktiengesellschaft', 'Kommanditgesellschaft auf Aktien',
	'Kommanditgesellschaft', 'Offene Handelsgesellschaft', 'Partnerschaftsgesellschaft',
	'eingetragener Verein', 'eingetragene Genossenschaft', 'eingetragener Kaufmann', 'eingetragene Kauffrau',
	// common foreign forms of German subsidiaries
	'Ltd\\.', 'Limited', 'Inc\\.', 'LLC', 'B\\.\\s?V\\.', 'N\\.\\s?V\\.', 'S\\.\\s?A\\.', 'S\\.p\\.A\\.', 'S\\.r\\.l\\.', 'SAS'
];
// "<prefix> <legal form>" followed by the end or a delimiter; the lazy prefix finds the first
// legal form in the line, the alternation prefers the longest form at that position
var LEGAL_RE = new RegExp('^(.*?)\\s(' + LEGAL_FORMS.join('|') + ')(?:$|[\\s,;:.)|/·•–-])');

// lines that name a company that is not the site owner (or no company at all)
var NOT_OWNER_RE =
	/registergericht|amtsgericht|handelsregister|registernummer|komplement|persönlich haftend|\bphg\b|haftende gesellschafter|gesellschafterin|umsatzsteuer|ust-?id|haftung für|haftungsausschluss|haftungshinweis|datenschutz|aufsichtsbehörde|handwerkskammer|handelskammer|ärztekammer|anwaltskammer|beraterkammer|streitschlichtung|verbraucher/i;
// credits for the agency, host or photographer ("Webdesign: Agentur X GmbH", "realisiert von …")
var CREDIT_RE =
	/(?:webdesign|web-design|design|gestaltung|konzeption|realisierung|umsetzung|programmierung|entwicklung|hosting|technik|technische betreuung|fotos?|fotografie|bilder|bildnachweis|bildquellen)\b[^:]{0,40}:|(?:erstellt|realisiert|umgesetzt|gestaltet|entwickelt|gehostet|programmiert|betreut)\s+(?:von|durch|by)\b|(?:powered|made|designed|design|hosted)\s+by\b/i;

var CONNECTORS = { für: 1, und: 1, der: 1, die: 1, das: 1, des: 1, von: 1, zu: 1, zur: 1, zum: 1, am: 1, an: 1, im: 1, in: 1, mit: 1, '&': 1, '+': 1, '-': 1, 'u.': 1 };

// words that make a prefix a sentence ("Diese Seite betreibt die Muster GmbH")
var SENTENCE_WORDS = {
	ist: 1, sind: 1, wird: 1, werden: 1, betreibt: 1, betrieben: 1, von: 1, durch: 1, die: 1, der: 1, das: 1,
	dem: 1, den: 1, eine: 1, ein: 1, website: 1, webseite: 1, seite: 1, unternehmen: 1, firma: 1, wir: 1,
	willkommen: 1, bei: 1, sie: 1, uns: 1, mit: 1, für: 1, über: 1, zur: 1, zum: 1, kontakt: 1, and: 1, by: 1
};

var ARTICLES = { die: 1, der: 1, das: 1, diese: 1, dieser: 1, dieses: 1, unsere: 1, unser: 1, eine: 1, ein: 1, the: 1 };

function isNameWord(w) {
	return /^[A-ZÄÖÜ0-9„"'(]/.test(w) || /^[a-zäöü]+[A-Z]/.test(w); // "Muster", "3D", "eXperts"
}

/** "Diese Website betreibt die Muster Maschinenbau" → "Muster Maschinenbau" */
function namePrefix(prefix) {
	var p = prefix.replace(/.*(?::|\||©|\(c\)|\s[–-]\s)/i, ' ');
	p = p.replace(/\b(?:copyright|alle rechte vorbehalten)\b/gi, ' ').replace(/\b(?:19|20)\d\d\b/g, ' ');
	var words = p.trim().split(/\s+/);
	// a short name on its own ("Sennheiser electronic", "fischerwerke") is taken as is,
	// lowercase words too
	if (words.length <= 4 && /[A-Za-zÄÖÜäöüß]/.test(words[0]) && !CONNECTORS[words[0].toLowerCase()]) {
		var sentence = false;
		for (var s = 0; s < words.length; s++) if (SENTENCE_WORDS[words[s].toLowerCase()]) sentence = true;
		if (!sentence) return words.join(' ');
	}
	var taken = [];
	for (var i = words.length - 1; i >= 0 && taken.length < 8; i--) {
		var w = words[i];
		if (!w) continue;
		if (isNameWord(w)) taken.unshift(w);
		else if (CONNECTORS[w.toLowerCase()] && taken.length && i > 0 && isNameWord(words[i - 1])) taken.unshift(w);
		else break;
	}
	while (taken.length && (CONNECTORS[taken[0].toLowerCase()] || ARTICLES[taken[0].toLowerCase()])) taken.shift();
	return taken.join(' ');
}

// where the provider details of an impressum start
var ANCHOR_RE =
	/angaben gem(?:ä|ae)(?:ß|ss)|§\s*5\s*(?:tmg|ddg)|anbieterkennzeichnung|diensteanbieter|herausgeber|betreiber (?:der|dieser)|^(?:impressum|imprint)$/i;

/** line indexes from the first anchor line to the end, then from the start */
function searchOrder(lines) {
	var anchor = 0;
	for (var a = 0; a < lines.length; a++) {
		if (lines[a].length < 120 && ANCHOR_RE.test(lines[a])) {
			anchor = a;
			break;
		}
	}
	var order = [];
	for (var i = anchor; i < lines.length; i++) order.push(i);
	for (var k = 0; k < anchor; k++) order.push(k);
	return order;
}

/**
 * First company name with legal form in the text ("Muster Maschinenbau GmbH & Co. KG"),
 * searched from the impressum heading ("Angaben gemäß § 5 DDG", "Impressum") on, skipping
 * register, liability and agency-credit lines.
 * @returns {{name: string, line: number} | null}
 */
function findCompanyName(text) {
	var lines = String(text || '').split('\n');
	var order = searchOrder(lines);
	for (var n = 0; n < order.length; n++) {
		var i = order[n];
		var line = lines[i];
		if (line.length > 300 || NOT_OWNER_RE.test(line) || CREDIT_RE.test(line)) continue;
		var m = LEGAL_RE.exec(line);
		if (!m) continue;
		var prefix = namePrefix(m[1]);
		if (!prefix || !/[A-Za-zÄÖÜäöüß]/.test(prefix)) continue;
		var form = m[2].replace(/\s+/g, ' ').replace(/&\s*Co\.?\s*/, '& Co. ').replace(/\s*&/, ' &');
		var name = prefix + ' ' + form;
		if (name.length >= 3 && name.length <= 120) return { name: name, line: i };
	}
	return null;
}

var STREET_RE =
	/^[A-ZÄÖÜ0-9][A-Za-zÄÖÜäöüß0-9.'’\-\/ ]{1,60}?\s\d{1,4}\s?[a-zA-Z]?(?:\s?[-–\/]\s?\d{1,4}\s?[a-zA-Z]?)?$/;
var ZIP_CITY_RE = /^(?:D\s?-\s?)?(\d{5})\s+([A-ZÄÖÜ][A-Za-zÄÖÜäöüß.()\/\- ]{1,40})$/;

function segments(line) {
	return line.split(/\s*[,;|·•]\s*|\s+[–-]\s+/);
}

function cleanCity(city) {
	return city
		.replace(/\s*[\/(-]?\s*(?:Deutschland|Germany|DE)\)?$/i, '')
		.replace(/[\s\/(-]+$/, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Street, ZIP code and city ("Musterstraße 1, 12345 Musterstadt"), searched from line
 * `from` on (the company name's line), then from the start.
 */
function findAddress(text, from) {
	var lines = String(text || '').split('\n');
	var start = from > 0 && from < lines.length ? from : 0;
	var order = [];
	for (var i = start; i < lines.length; i++) order.push(i);
	for (var k = 0; k < start; k++) order.push(k);
	for (var n = 0; n < order.length; n++) {
		var idx = order[n];
		var line = lines[idx];
		if (line.length > 300 || /registergericht|amtsgericht|postfach/i.test(line)) continue;
		var segs = segments(line.replace(/(^|[,;|]\s*)DE?\s*[-–]\s*(\d{5}\s)/, '$1$2')); // "DE - 30900 Wedemark"
		for (var j = 0; j < segs.length; j++) {
			var m = ZIP_CITY_RE.exec(segs[j]);
			if (!m) continue;
			var city = cleanCity(m[2]);
			if (city.split(' ').length > 4) continue;
			var street = '';
			if (j > 0) street = segs[j - 1];
			else if (idx > 0) {
				var prev = segments(lines[idx - 1]);
				street = prev[prev.length - 1];
			}
			street = street.replace(/^(?:anschrift|adresse|sitz|address)\s*:?\s*/i, '').trim();
			if (!STREET_RE.test(street) || !/[A-Za-zÄÖÜäöüß]{3}/.test(street)) continue;
			return street.replace(/\s+/g, ' ') + ', ' + m[1] + ' ' + city;
		}
	}
	return '';
}

var PHONE_RE =
	/(?:^|[^A-Za-zÄÖÜäöü])(?:Telefonnummer|Telefon|Phone|Tel|Fon|T\s*:)\s*[.:]{0,2}\s*(?:\([^)\d]*\)\s*)?(\+?[\d(][\d\s()\/.\-–]{4,24}\d)/i;

/** first labelled phone number ("Telefon: +49 (0) 123 / 45 67-0") */
function findPhone(text) {
	var lines = String(text || '').split('\n');
	for (var i = 0; i < lines.length; i++) {
		var m = PHONE_RE.exec(lines[i]);
		if (!m) continue;
		var digits = m[1].replace(/\D/g, '');
		if (digits.length < 6 || digits.length > 16) continue;
		return m[1].replace(/\s+/g, ' ').replace(/–/g, '-').trim();
	}
	return '';
}

var EMAIL_SRC =
	'[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\\.[A-Za-z]{2,24}';
var EMAIL_ONE_RE = new RegExp('^' + EMAIL_SRC + '$');

/** Cloudflare e-mail protection: hex string, first byte is the XOR key */
function decodeCfEmail(hex) {
	if (!/^[0-9a-fA-F]{4,}$/.test(hex) || hex.length % 2) return '';
	var key = parseInt(hex.slice(0, 2), 16);
	var out = '';
	for (var i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
	return out;
}

/** e-mail addresses of a page: Cloudflare-protected, mailto: links, then the text */
function emailsOf(html) {
	var s = String(html || '');
	var found = [];
	var m;
	var cf = /data-cfemail\s*=\s*["']([0-9a-fA-F]+)["']|\/cdn-cgi\/l\/email-protection#([0-9a-fA-F]+)/g;
	while ((m = cf.exec(s))) found.push(decodeCfEmail(m[1] || m[2]));
	var links = findLinks(s);
	for (var i = 0; i < links.length; i++) {
		var h = links[i].href.trim();
		if (/^mailto:/i.test(h)) {
			var addr = h.slice(7).split('?')[0];
			try {
				addr = decodeURIComponent(addr);
			} catch (err) {
				/* keep as is */
			}
			found.push(addr);
		}
	}
	var text = htmlToText(s)
		.replace(/\s*[(\[{]\s*(?:at|ät|@)\s*[)\]}]\s*/gi, '@')
		.replace(/\s*[(\[{]\s*(?:dot|punkt)\s*[)\]}]\s*/gi, '.');
	var re = new RegExp(EMAIL_SRC, 'g');
	var t;
	while ((t = re.exec(text))) found.push(t[0]);
	var out = [];
	for (var j = 0; j < found.length; j++) {
		var e = String(found[j] || '').trim().toLowerCase();
		if (!EMAIL_ONE_RE.test(e) || /\.(?:png|jpe?g|gif|svg|webp|avif)$/.test(e)) continue;
		if (out.indexOf(e) < 0) out.push(e);
	}
	return out;
}

/** first address on the company's own domain, else the first address at all */
function findEmail(htmls, domain) {
	var all = [];
	for (var i = 0; i < htmls.length; i++) all = all.concat(emailsOf(htmls[i]));
	for (var j = 0; j < all.length; j++) {
		var host = all[j].split('@')[1];
		if (host === domain || host.slice(-(domain.length + 1)) === '.' + domain) return all[j];
	}
	return all.length ? all[0] : '';
}

/** og:site_name as a fallback name, only when it looks like a name (short, no slogan) */
function siteNameFallback(siteName) {
	var s = String(siteName || '').trim();
	return s.length >= 2 && s.length <= 60 && !/[|:!?]/.test(s) ? s : '';
}

/**
 * Suggestions from the fetched pages. Fields stay '' when nothing was recognised reliably.
 * @param pages {home: {url, html}, impressum: {url, html} | null}
 */
function extractCompany(pages, domain) {
	var homeHtml = pages.home.html || '';
	var impHtml = pages.impressum ? pages.impressum.html || '' : '';
	var impText = htmlToText(impHtml);
	var homeText = htmlToText(homeHtml);
	var meta = extractMeta(homeHtml);
	var name = '';
	var address = '';
	var hit = findCompanyName(impText);
	if (hit) {
		name = hit.name;
		address = findAddress(impText, hit.line);
	} else {
		hit = findCompanyName(meta.siteName) || findCompanyName(meta.title) || findCompanyName(homeText);
		name = hit ? hit.name : siteNameFallback(meta.siteName);
		address = findAddress(impText, 0);
	}
	if (!address) {
		var homeHit = findCompanyName(homeText);
		address = findAddress(homeText, homeHit ? homeHit.line : 0);
	}
	return {
		name: cleanField(name),
		address: cleanField(address),
		phone: cleanField(findPhone(impText) || findPhone(homeText)),
		email: cleanField(findEmail([impHtml, homeHtml], domain)),
		website: cleanField(originOf(pages.home.url)),
		source: cleanField(pages.impressum ? pages.impressum.url : pages.home.url)
	};
}

/** entities are decoded after the tags are gone, so `&lt;img&gt;` would come back as a tag */
function cleanField(s) {
	return String(s || '')
		.replace(/[<>]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

// ---------------------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------------------

function isHtml(contentType) {
	var ct = String(contentType || '').toLowerCase();
	return !ct || ct.indexOf('text/html') === 0 || ct.indexOf('application/xhtml+xml') === 0;
}

var RETRY_WWW = { not_found: 1, unreachable: 1, timeout: 1, tls: 1 };

function budgetLeft(budget) {
	return budget.pages > 0 && budget.now() < budget.deadline;
}

/**
 * GET with manual, checked redirects. Uses one of budget.pages, every redirect one of
 * budget.redirects; no new request after budget.deadline.
 */
function fetchPage(url, domain, fetchFn, budget) {
	if (!budgetLeft(budget)) {
		return { ok: false, code: 'too_many_fetches', message: 'Abruf-Limit erreicht – Abruf abgebrochen.' };
	}
	budget.pages--;
	for (var hops = 0; ; hops++) {
		var t = checkTarget(url, domain);
		if (!t.ok) {
			return hops
				? { ok: false, code: 'blocked_redirect', message: 'Weiterleitung nicht gefolgt: ' + t.reason }
				: { ok: false, code: 'blocked', message: t.reason };
		}
		if (hops) {
			if (budget.redirects <= 0 || budget.now() >= budget.deadline) {
				return { ok: false, code: 'too_many_redirects', message: 'Zu viele Weiterleitungen – Abruf abgebrochen.' };
			}
			budget.redirects--;
		}
		budget.requests++;
		var r = fetchFn(url);
		if (!r || !r.ok) {
			r = r || { code: 'fetch_failed', message: 'Die Website konnte nicht abgerufen werden.' };
			return { ok: false, code: r.code, message: r.message, retry: !hops && !!RETRY_WWW[r.code] };
		}
		if (!isPublicIp(r.remoteIp)) {
			return { ok: false, code: 'blocked_ip', message: 'Die Domain zeigt auf eine interne Adresse – Abruf verweigert.' };
		}
		if (r.status >= 300 && r.status < 400) {
			var next = r.redirectUrl ? resolveUrl(url, r.redirectUrl, false) : null;
			if (!next) return { ok: false, code: 'bad_redirect', message: 'Die Website leitet ins Leere weiter.' };
			url = next;
			continue;
		}
		return { ok: true, url: url, status: r.status, contentType: r.contentType, body: r.body || '' };
	}
}

/**
 * Fetches https://<domain>/ (or https://www.<domain>/ when the bare domain does not answer)
 * and its impressum (link on the page, else /impressum, /imprint): at most MAX_FETCHES
 * pages plus MAX_REDIRECTS redirects in total, no new request after DEADLINE_MS. Then
 * extracts the suggestions.
 * @param fetchFn (url) => {ok, status, remoteIp, contentType, redirectUrl, body} | {ok:false, code, message}
 * @param opts    {maxPages, maxRedirects, deadlineMs, now} (tests)
 * @returns {{ok: true, data: object, requests: number} | {ok: false, code: string, message: string, requests: number}}
 */
function lookupCompany(domain, fetchFn, opts) {
	opts = opts || {};
	var now = opts.now || Date.now;
	var budget = {
		pages: opts.maxPages != null ? opts.maxPages : MAX_FETCHES,
		redirects: opts.maxRedirects != null ? opts.maxRedirects : MAX_REDIRECTS,
		deadline: now() + (opts.deadlineMs != null ? opts.deadlineMs : DEADLINE_MS),
		now: now,
		requests: 0
	};
	var res = runLookup(domain, fetchFn, budget);
	if (!res.ok && OPAQUE_ERRORS[res.code]) {
		// after DNS resolution every failure looks the same to the user, otherwise the answers
		// tell which internal hosts have port 443 open; the reason goes to the server log only
		res = { ok: false, code: 'unreachable', message: UNREACHABLE, detail: res.code + ': ' + res.message };
	}
	res.requests = budget.requests;
	return res;
}

var UNREACHABLE = 'Die Website ist nicht erreichbar oder der Abruf ist nicht erlaubt.';
// failures that happen after the name was resolved (connection, TLS, timeout, address check)
var OPAQUE_ERRORS = {
	unreachable: 1, tls: 1, timeout: 1, blocked_ip: 1, too_large: 1, protocol: 1, fetch_failed: 1
};

function runLookup(domain, fetchFn, budget) {
	var home = fetchPage('https://' + domain + '/', domain, fetchFn, budget);
	if (!home.ok && home.retry) {
		var www = fetchPage('https://www.' + domain + '/', domain, fetchFn, budget);
		if (www.ok || /^blocked/.test(www.code)) home = www;
	}
	if (!home.ok) return { ok: false, code: home.code, message: home.message };
	if (home.status >= 400) {
		return { ok: false, code: 'http_' + home.status, message: 'Die Website antwortet mit Fehler ' + home.status + '.' };
	}
	var homeHtml = isHtml(home.contentType) ? home.body : '';
	var origin = originOf(home.url);
	var candidates = [];
	var link = findImpressumLink(homeHtml, home.url, domain);
	if (link) candidates.push(link);
	var fallbacks = [origin + '/impressum', origin + '/imprint'];
	for (var f = 0; f < fallbacks.length; f++) if (candidates.indexOf(fallbacks[f]) < 0) candidates.push(fallbacks[f]);
	var impressum = null;
	for (var i = 0; i < candidates.length && budgetLeft(budget) && !impressum; i++) {
		if (candidates[i] === home.url) {
			impressum = { url: home.url, html: homeHtml };
			break;
		}
		var r = fetchPage(candidates[i], domain, fetchFn, budget);
		if (r.ok && r.status === 200 && isHtml(r.contentType)) impressum = { url: r.url, html: r.body };
	}
	return { ok: true, data: extractCompany({ home: { url: home.url, html: homeHtml }, impressum: impressum }, domain) };
}

// ---------------------------------------------------------------------------------------
// rate limit and cache (state lives in $app.store(), these only compute)
// ---------------------------------------------------------------------------------------

/** sliding window: timestamps of the last lookups → allowed? and the new list */
function rateLimit(timestamps, now, limit, windowMs) {
	var list = [];
	var src = timestamps || [];
	for (var i = 0; i < src.length; i++) if (now - src[i] < (windowMs || RATE_WINDOW_MS)) list.push(src[i]);
	if (list.length >= (limit || RATE_LIMIT)) return { allowed: false, list: list };
	list.push(now);
	return { allowed: true, list: list };
}

function cacheValid(entry, now) {
	return !!entry && typeof entry.at === 'number' && now - entry.at >= 0 && now - entry.at < CACHE_TTL_MS;
}

/**
 * Cache keys to drop before adding one entry: all expired ones, then the oldest until there
 * is room for the new entry under `max`.
 * @param entries [{key, at}] (at: null/NaN for unreadable entries)
 */
function cacheEvictions(entries, now, max) {
	var limit = max || CACHE_MAX;
	var drop = [];
	var keep = [];
	for (var i = 0; i < entries.length; i++) {
		if (cacheValid({ at: entries[i].at }, now)) keep.push(entries[i]);
		else drop.push(entries[i].key);
	}
	keep.sort(function (a, b) {
		return a.at - b.at;
	});
	for (var j = 0; keep.length - j >= limit; j++) drop.push(keep[j].key);
	return drop;
}

module.exports = {
	MAX_FETCHES: MAX_FETCHES,
	MAX_REDIRECTS: MAX_REDIRECTS,
	DEADLINE_MS: DEADLINE_MS,
	MAX_BYTES: MAX_BYTES,
	RATE_LIMIT: RATE_LIMIT,
	RATE_WINDOW_MS: RATE_WINDOW_MS,
	CACHE_TTL_MS: CACHE_TTL_MS,
	normalizeDomain: normalizeDomain,
	parseUrl: parseUrl,
	checkTarget: checkTarget,
	resolveUrl: resolveUrl,
	isPublicIp: isPublicIp,
	curlArgs: curlArgs,
	parseCurlOutput: parseCurlOutput,
	curlError: curlError,
	detectCharset: detectCharset,
	decodeSingleByte: decodeSingleByte,
	makeCurlFetcher: makeCurlFetcher,
	decodeEntities: decodeEntities,
	htmlToText: htmlToText,
	extractMeta: extractMeta,
	findImpressumLink: findImpressumLink,
	findCompanyName: findCompanyName,
	findAddress: findAddress,
	findPhone: findPhone,
	findEmail: findEmail,
	extractCompany: extractCompany,
	lookupCompany: lookupCompany,
	rateLimit: rateLimit,
	cacheValid: cacheValid,
	cacheEvictions: cacheEvictions,
	CACHE_MAX: CACHE_MAX,
	UNREACHABLE: UNREACHABLE,
	cleanField: cleanField
};
