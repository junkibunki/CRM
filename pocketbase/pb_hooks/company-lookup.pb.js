/// <reference path="../pb_data/types.d.ts" />
// F10: GET /api/crm/company-lookup?domain=firma.de → suggestions from the company website
// { name, address, phone, email, website, source, cached }. Only for signed-in users.
// Logic and SSRF checks live in company-lookup-lib.js (pure, unit-tested); this file only
// wires up auth, rate limit, cache and the curl call. Each callback runs in its own JS VM,
// so everything is required inside it (docs/pitfalls/pocketbase-hooks.md).

routerAdd(
	'GET',
	'/api/crm/company-lookup',
	(e) => {
		const lib = require(`${__hooks}/company-lookup-lib.js`);
		const store = $app.store();
		const now = Date.now();

		// rate limit per user (sliding window, every request counts, cached ones too)
		let allowed = false;
		store.setFunc('crm.companyLookup.rate.' + e.auth.id, (old) => {
			let list = [];
			try {
				list = old ? JSON.parse(old) : [];
			} catch (err) {
				list = [];
			}
			const r = lib.rateLimit(list, now, lib.RATE_LIMIT, lib.RATE_WINDOW_MS);
			allowed = r.allowed;
			return JSON.stringify(r.list);
		});
		if (!allowed) {
			throw new TooManyRequestsError('Zu viele Abfragen – bitte eine Minute warten.');
		}

		const n = lib.normalizeDomain(e.request.url.query().get('domain'));
		if (n.error) {
			throw new BadRequestError(n.error, { domain: new ValidationError('invalid_domain', n.error) });
		}

		const cacheKey = 'crm.companyLookup.cache.' + n.domain;
		let entry = null;
		try {
			entry = store.has(cacheKey) ? JSON.parse(store.get(cacheKey)) : null;
		} catch (err) {
			entry = null;
		}
		if (lib.cacheValid(entry, now)) {
			return e.json(200, Object.assign({}, entry.data, { cached: true }));
		}

		const fetcher = lib.makeCurlFetcher(
			(args) => $os.cmd('curl', ...args).output(),
			(bytes) => toString(bytes)
		);
		const res = lib.lookupCompany(n.domain, fetcher);
		if (!res.ok) {
			if (res.detail) {
				// the user only sees the generic text (no probing of internal hosts), the reason is here
				$app.logger().warn('company-lookup failed', 'domain', n.domain, 'reason', res.detail, 'user', e.auth.id);
			}
			if (/^blocked/.test(res.code)) {
				throw new BadRequestError(res.message, { domain: new ValidationError(res.code, res.message) });
			}
			throw new ApiError(502, res.message, { domain: new ValidationError(res.code, res.message) });
		}

		// hard cap: drop expired entries and then the oldest, so the in-memory cache stays
		// below lib.CACHE_MAX entries
		const entries = [];
		const keys = store.keys();
		for (let i = 0; i < keys.length; i++) {
			if (keys[i].indexOf('crm.companyLookup.cache.') !== 0 || keys[i] === cacheKey) continue;
			let at = null;
			try {
				at = JSON.parse(store.get(keys[i])).at;
			} catch (err) {
				at = null;
			}
			entries.push({ key: keys[i], at: at });
		}
		const drop = lib.cacheEvictions(entries, now, lib.CACHE_MAX);
		for (let i = 0; i < drop.length; i++) store.remove(drop[i]);
		store.set(cacheKey, JSON.stringify({ at: now, data: res.data }));
		return e.json(200, Object.assign({}, res.data, { cached: false }));
	},
	$apis.requireAuth()
);
