/// <reference path="../pb_data/types.d.ts" />
// F12: stage gates (logic in stage-gates-lib.js; each callback runs in its own JS VM, so the
// lib is required inside it, see docs/pitfalls/pocketbase-hooks.md).
// * leads: creating a lead in, or moving it into, a stage whose (cumulative) requirements are
//   not all fulfilled -> 400 with a ValidationError on `column`. Leads already in a stage are
//   never pushed back (requirements added later only show a warning on the card).
// * POST /api/crm/leads: lead + checks in one transaction (a new lead has no id for checks yet).
// * lead_checks: value normalized (flag = "true", text trimmed, not blank) and every confirm,
//   change and revoke logged to lead_check_events, in the same transaction as the write. An
//   update with the same value saves nothing (`by` and `updated` stay).
// * Stages with `gates_exempt` (e.g. "Verloren") need no requirements (see the lib).

// gate check and save in one transaction: a check revoked in between can't slip through
onRecordCreateRequest((e) => {
	const lib = require(`${__hooks}/stage-gates-lib.js`);
	e.app.runInTransaction((tx) => {
		e.app = tx;
		lib.enforce(tx, e.record.getString('column'), []);
		e.next();
	});
}, 'leads');

onRecordUpdateRequest((e) => {
	const lib = require(`${__hooks}/stage-gates-lib.js`);
	const column = e.record.getString('column');
	if (column === e.record.original().getString('column')) return e.next();
	e.app.runInTransaction((tx) => {
		e.app = tx;
		lib.enforce(tx, column, lib.checksOf(tx, e.record.id));
		e.next();
	});
}, 'leads');

routerAdd(
	'POST',
	'/api/crm/leads',
	(e) => {
		const lib = require(`${__hooks}/stage-gates-lib.js`);
		const info = e.requestInfo();
		const res = lib.createLead(e.app, e.auth, info.body, info);
		return e.json(200, res);
	},
	$apis.requireAuth()
);

onRecordCreateRequest((e) => {
	const lib = require(`${__hooks}/stage-gates-lib.js`);
	const req = lib.requirementOf(e.app, e.record.getString('requirement'));
	lib.applyValue(e.record, req);
	e.app.runInTransaction((tx) => {
		e.app = tx;
		e.next();
		const r = e.record;
		lib.logEvent(tx, 'confirmed', r.getString('lead'), req, r.getString('requirement'), r.getString('value'), r.getString('by'));
	});
}, 'lead_checks');

onRecordUpdateRequest((e) => {
	const lib = require(`${__hooks}/stage-gates-lib.js`);
	const req = lib.requirementOf(e.app, e.record.getString('requirement'));
	lib.applyValue(e.record, req);
	const original = e.record.original();
	// same value again (e.g. two people confirm the same text): nothing changes, so who
	// confirmed it and when stay as they are; answered with the stored record
	if (e.record.getString('value') === original.getString('value')) return e.json(200, original);
	e.app.runInTransaction((tx) => {
		e.app = tx;
		e.next();
		const r = e.record;
		lib.logEvent(tx, 'changed', r.getString('lead'), req, r.getString('requirement'), r.getString('value'), r.getString('by'));
	});
}, 'lead_checks');

onRecordDeleteRequest((e) => {
	const lib = require(`${__hooks}/stage-gates-lib.js`);
	const r = e.record;
	const req = lib.requirementOf(e.app, r.getString('requirement'));
	e.app.runInTransaction((tx) => {
		e.app = tx;
		e.next();
		lib.logEvent(tx, 'revoked', r.getString('lead'), req, r.getString('requirement'), r.getString('value'), lib.actorId(e.auth));
	});
}, 'lead_checks');
