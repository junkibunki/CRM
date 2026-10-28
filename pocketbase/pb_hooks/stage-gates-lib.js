// F12: stage gates. A requirement (`stage_requirements`) applies to its stage and every later
// stage of the same pipeline (by rank); a lead may only enter a stage when it has a fulfilled
// check (`lead_checks`) for every requirement that applies there.
// Plain CommonJS (ES2015) so it runs in the PocketBase JS VM (require(`${__hooks}/stage-gates-lib.js`)
// inside each callback) and in Vitest (web/src/lib/gates/gates-lib.test.ts). The first part is
// pure and mirrors web/src/lib/gates/evaluate.ts; the second part (`app` arguments) only runs
// in the VM.

var GATE_CODE = 'gate_open';
var MAX_VALUE = 1000;

/** code-point order like SQLite's BINARY collation (`sort=rank`), id as tiebreak */
function byRank(a, b) {
	if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The requirements of the pipeline of `columnId` up to that stage (or, with `all`, of the
 * whole pipeline), in stage order, then requirement order. Requirements of other pipelines
 * and of deleted stages are ignored.
 */
function upTo(requirements, columns, columnId, all) {
	var target = null;
	for (var i = 0; i < columns.length; i++) if (columns[i].id === columnId) target = columns[i];
	if (!target) return [];
	// a stage without gates (e.g. "Verloren") exempts only itself: nothing applies THERE,
	// but its requirements (if it had some before) still count for later stages
	if (!all && target.gates_exempt) return [];
	var stages = columns.filter(function (c) {
		return c.board === target.board;
	});
	stages.sort(byRank);
	var pos = {};
	for (var j = 0; j < stages.length; j++) pos[stages[j].id] = j;
	var limit = all ? stages.length : stages.indexOf(target);
	var out = requirements.filter(function (r) {
		return pos[r.column] !== undefined && pos[r.column] <= limit;
	});
	out.sort(function (a, b) {
		return pos[a.column] - pos[b.column] || byRank(a, b);
	});
	return out;
}

/**
 * The requirements that apply to `targetColumnId`: those of its stage and of every earlier
 * stage of the same pipeline, in stage order, then requirement order. None in an exempt
 * stage (`gates_exempt`, e.g. "Verloren"); it exempts only itself, not later stages.
 * Requirements of stages not in `columns` (other pipelines, deleted stages) are ignored.
 * @param requirements {id, column, rank, label, type}[]
 * @param columns {id, board, rank, gates_exempt}[] (any order; may contain other pipelines)
 */
function applicable(requirements, columns, targetColumnId) {
	return upTo(requirements, columns, targetColumnId, false);
}

/** every requirement of the pipeline of `columnId` that can ever apply, in order */
function pipelineRequirements(requirements, columns, columnId) {
	return upTo(requirements, columns, columnId, true);
}

/** a check fulfils its requirement: flag = "true", text = not blank */
function fulfilled(requirement, check) {
	if (!check) return false;
	var v = check.value == null ? '' : String(check.value);
	if (requirement.type === 'flag') return v === 'true';
	return v.trim() !== '';
}

/**
 * The requirements of `targetColumnId` (cumulative) without a fulfilled check.
 * @param checks {requirement, value}[] of the lead
 */
function openRequirements(requirements, columns, targetColumnId, checks) {
	var byReq = {};
	for (var i = 0; i < checks.length; i++) byReq[checks[i].requirement] = checks[i];
	return applicable(requirements, columns, targetColumnId).filter(function (r) {
		return !fulfilled(r, byReq[r.id]);
	});
}

/**
 * The value to store for a check of `requirement`, or an error text.
 * flag: true / "true" -> "true"; text: trimmed, not empty, at most 1000 characters.
 */
function normalizeValue(requirement, value) {
	if (requirement.type === 'flag') {
		if (value === true || value === 'true') return { value: 'true' };
		return { error: 'Eine Ja/Nein-Bedingung wird mit „true“ bestätigt.' };
	}
	var v = value == null ? '' : String(value).trim();
	if (!v) return { error: 'Bitte einen Wert eintragen.' };
	if (v.length > MAX_VALUE) return { error: 'Höchstens ' + MAX_VALUE + ' Zeichen.' };
	return { value: v };
}

/** the text of the ValidationError on `column` */
function gateMessage(stageName, open) {
	var labels = open.map(function (r) {
		return '„' + r.label + '“';
	});
	return (
		'Bevor der Lead nach „' +
		stageName +
		'“ kann, ' +
		(open.length === 1 ? 'muss diese Bedingung' : 'müssen diese Bedingungen') +
		' erfüllt sein: ' +
		labels.join(', ') +
		'.'
	);
}

// ---------------------------------------------------------------------------------------
// PocketBase side (JS VM only)
// ---------------------------------------------------------------------------------------

function plainColumn(rec) {
	return {
		id: rec.id,
		board: rec.getString('board'),
		rank: rec.getString('rank'),
		name: rec.getString('name'),
		gates_exempt: rec.getBool('gates_exempt')
	};
}

function plainRequirement(rec) {
	return {
		id: rec.id,
		column: rec.getString('column'),
		rank: rec.getString('rank'),
		label: rec.getString('label'),
		type: rec.getString('type')
	};
}

function plainCheck(rec) {
	return { id: rec.id, requirement: rec.getString('requirement'), value: rec.getString('value') };
}

/** the target stage, all stages of its pipeline and their requirements; null if the stage is unknown */
function context(app, columnId) {
	var column;
	try {
		column = app.findRecordById('board_columns', columnId);
	} catch (err) {
		return null; // unknown stage: the record validation reports it
	}
	var board = column.getString('board');
	var columns = app.findRecordsByFilter('board_columns', 'board = {:board}', '', 0, 0, { board: board }).map(plainColumn);
	var requirements = app
		.findRecordsByFilter('stage_requirements', 'column.board = {:board}', '', 0, 0, { board: board })
		.map(plainRequirement);
	return { column: plainColumn(column), columns: columns, requirements: requirements };
}

function checksOf(app, leadId) {
	if (!leadId) return [];
	return app.findRecordsByFilter('lead_checks', 'lead = {:lead}', '', 0, 0, { lead: leadId }).map(plainCheck);
}

/** throws a 400 with a ValidationError on `column` if requirements of the stage are open */
function enforce(app, columnId, checks) {
	var ctx = context(app, columnId);
	if (!ctx) return;
	var open = openRequirements(ctx.requirements, ctx.columns, columnId, checks);
	if (!open.length) return;
	var msg = gateMessage(ctx.column.name, open);
	throw new BadRequestError(msg, { column: new ValidationError(GATE_CODE, msg) });
}

/** the requirement of a check as a plain object, or null */
function requirementOf(app, id) {
	if (!id) return null;
	try {
		return plainRequirement(app.findRecordById('stage_requirements', id));
	} catch (err) {
		return null;
	}
}

/** stores the normalized value on the check record or throws a ValidationError on `value` */
function applyValue(record, requirement) {
	if (!requirement) return; // unknown requirement: the relation validation reports it
	var r = normalizeValue(requirement, record.get('value'));
	if (r.error) throw new BadRequestError(r.error, { value: new ValidationError('invalid_value', r.error) });
	record.set('value', r.value);
}

/** the id to store as `by`: only users (a superuser is no `users` record) */
function actorId(auth) {
	if (!auth) return '';
	try {
		return auth.collection().name === 'users' ? auth.id : '';
	} catch (err) {
		return '';
	}
}

/** writes one entry of `lead_check_events` */
function logEvent(app, action, lead, requirement, requirementId, value, by) {
	var rec = new Record(app.findCollectionByNameOrId('lead_check_events'));
	rec.set('lead', lead);
	rec.set('requirement', requirement ? requirement.id : requirementId || '');
	rec.set('requirement_label', requirement ? requirement.label : '(gelöschte Bedingung)');
	rec.set('action', action);
	rec.set('value', value || '');
	rec.set('by', by || '');
	app.save(rec);
}

/**
 * The fields a client may send when creating a lead: every field of the collection except
 * system fields (`id`) and autodates, so a field added later needs no change here.
 */
function writableFields(collection) {
	var out = [];
	var fields = collection.fields;
	for (var i = 0; i < fields.length; i++) {
		var f = fields[i];
		if (f.getSystem() || f.type() === 'autodate') continue;
		out.push(f.getName());
	}
	return out;
}

/**
 * POST /api/crm/leads: creates the lead and its checks in ONE transaction, then enforces
 * the gate of the lead's stage (open requirements roll everything back). The create rule
 * of `leads` is checked like the normal create API does (it would be bypassed by a save).
 * body: {<lead fields>, checks: [{requirement, value}]}
 * @returns {{lead: Record, checks: Record[]}}
 */
function createLead(app, auth, body, requestInfo) {
	body = body || {};
	var list = body.checks == null ? [] : body.checks;
	if (!Array.isArray(list) || list.length > 100) {
		throw new BadRequestError('Ungültige Bestätigungen.', {
			checks: new ValidationError('invalid_checks', 'Erwartet wird eine Liste von {requirement, value}.')
		});
	}
	var by = actorId(auth);
	var out = null;
	app.runInTransaction(function (tx) {
		var leads = tx.findCollectionByNameOrId('leads');
		var lead = new Record(leads);
		var names = writableFields(leads);
		for (var i = 0; i < names.length; i++) {
			if (body[names[i]] !== undefined) lead.set(names[i], body[names[i]]);
		}
		tx.save(lead);
		// the rule may refer to the stored record (relations, @collection): checked after the
		// insert, inside the transaction, as PocketBase's create API does
		if (!tx.canAccessRecord(lead, requestInfo, leads.createRule)) {
			throw new ForbiddenError('Du darfst hier keinen Lead anlegen.');
		}

		var ctx = context(tx, lead.getString('column'));
		var reqs = {};
		if (ctx) for (var r = 0; r < ctx.requirements.length; r++) reqs[ctx.requirements[r].id] = ctx.requirements[r];
		var seen = {};
		var checks = [];
		var collection = tx.findCollectionByNameOrId('lead_checks');
		for (var j = 0; j < list.length; j++) {
			var item = list[j] || {};
			var req = reqs[item.requirement];
			if (!req || seen[req.id]) {
				var m = req ? 'Eine Bedingung ist doppelt angegeben.' : 'Unbekannte Bedingung (nicht in dieser Pipeline).';
				throw new BadRequestError(m, { checks: new ValidationError('invalid_requirement', m) });
			}
			seen[req.id] = true;
			var n = normalizeValue(req, item.value);
			if (n.error) {
				var em = '„' + req.label + '“: ' + n.error;
				throw new BadRequestError(em, { checks: new ValidationError('invalid_value', em) });
			}
			var check = new Record(collection);
			check.set('lead', lead.id);
			check.set('requirement', req.id);
			check.set('value', n.value);
			check.set('by', by);
			tx.save(check);
			logEvent(tx, 'confirmed', lead.id, req, req.id, n.value, by);
			checks.push(check);
		}
		enforce(tx, lead.getString('column'), checks.map(plainCheck));
		out = { lead: lead, checks: checks };
	});
	return out;
}

module.exports = {
	GATE_CODE: GATE_CODE,
	byRank: byRank,
	applicable: applicable,
	pipelineRequirements: pipelineRequirements,
	writableFields: writableFields,
	fulfilled: fulfilled,
	openRequirements: openRequirements,
	normalizeValue: normalizeValue,
	gateMessage: gateMessage,
	context: context,
	checksOf: checksOf,
	enforce: enforce,
	requirementOf: requirementOf,
	applyValue: applyValue,
	actorId: actorId,
	logEvent: logEvent,
	createLead: createLead
};
