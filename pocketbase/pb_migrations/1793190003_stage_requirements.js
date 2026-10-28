/// <reference path="../pb_data/types.d.ts" />

// F12: requirements per stage (stage gates).
// * `stage_requirements`: a requirement of a stage; it applies to that stage and every later one
//   of the pipeline (by `rank`). Kind `flag` (yes/no) or `text` (fulfilled when not empty);
//   `hint` says whom to inform. Every logged-in user may configure them, like the stages.
// * `lead_checks`: a lead fulfils a requirement (one record per lead + requirement, unique).
//   `by` is the user who confirmed or last changed it (rule: always the requesting user);
//   lead and requirement can't be changed, and the requirement must belong to the lead's
//   pipeline. Taking it back = deleting the record. Value rules (flag = "true", text not
//   blank) are checked by the hook pb_hooks/stage-gates.pb.js.
// * `lead_check_events`: log of confirmed / changed / revoked checks, written only by that
//   hook (no create/update/delete rule), readable by logged-in users. `requirement_label` is a
//   copy, so the entry stays readable after the requirement is deleted.
// * `board_columns.gates_exempt`: no requirements apply in this stage, neither its own nor
//   those of earlier stages (e.g. "Verloren": a lost lead needs no Siemens flag). Such a stage
//   can't get requirements (rule). Set for "Verloren" of the seeded pipeline "Leads".
// Moving a lead into a stage whose (cumulative) requirements are open is refused by the hook,
// as is creating a lead there; POST /api/crm/leads creates lead + checks in one transaction.
const AUTH = '@request.auth.id != ""';
const BY_ME = '@request.body.by = @request.auth.id';
const SAME_BOARD = '@request.body.requirement.column.board = @request.body.lead.column.board';

const ID = {
	name: 'id',
	type: 'text',
	system: true,
	primaryKey: true,
	required: true,
	pattern: '^[a-z0-9]+$',
	min: 15,
	max: 15,
	autogeneratePattern: '[a-z0-9]{15}'
};
const DATES = [
	{ name: 'created', type: 'autodate', onCreate: true },
	{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
];

migrate(
	(app) => {
		const columns = app.findCollectionByNameOrId('board_columns');
		const leads = app.findCollectionByNameOrId('leads');
		const users = app.findCollectionByNameOrId('users');

		if (!columns.fields.getByName('gates_exempt')) {
			columns.fields.add(new Field({ name: 'gates_exempt', type: 'bool' }));
			app.save(columns);
		}
		app
			.db()
			.newQuery(
				"UPDATE board_columns SET gates_exempt = 1 WHERE name = 'Verloren' " +
					"AND board IN (SELECT id FROM boards WHERE name = 'Leads')"
			)
			.execute();

		const requirements = new Collection({
			type: 'base',
			name: 'stage_requirements',
			listRule: AUTH,
			viewRule: AUTH,
			// a stage without gates (e.g. "Verloren") has no requirements of its own
			createRule: `${AUTH} && @request.body.column.gates_exempt = false`,
			// a requirement stays at its stage (the editor works per stage)
			updateRule: `${AUTH} && (@request.body.column:isset = false || @request.body.column = column)`,
			deleteRule: AUTH,
			fields: [
				ID,
				{
					name: 'column',
					type: 'relation',
					collectionId: columns.id,
					required: true,
					maxSelect: 1,
					cascadeDelete: true
				},
				{ name: 'label', type: 'text', required: true, max: 200, pattern: '\\S' },
				{ name: 'type', type: 'select', required: true, maxSelect: 1, values: ['flag', 'text'] },
				{ name: 'hint', type: 'text', max: 1000 },
				{ name: 'rank', type: 'text', required: true, max: 100 },
				...DATES
			],
			indexes: ['CREATE INDEX idx_stage_requirements_column ON stage_requirements (`column`, rank)']
		});
		app.save(requirements);

		const checks = new Collection({
			type: 'base',
			name: 'lead_checks',
			listRule: AUTH,
			viewRule: AUTH,
			createRule: `${AUTH} && ${BY_ME} && ${SAME_BOARD}`,
			updateRule:
				`${AUTH} && ${BY_ME}` +
				' && (@request.body.lead:isset = false || @request.body.lead = lead)' +
				' && (@request.body.requirement:isset = false || @request.body.requirement = requirement)',
			deleteRule: AUTH,
			fields: [
				ID,
				{
					name: 'lead',
					type: 'relation',
					collectionId: leads.id,
					required: true,
					maxSelect: 1,
					cascadeDelete: true
				},
				{
					name: 'requirement',
					type: 'relation',
					collectionId: requirements.id,
					required: true,
					maxSelect: 1,
					cascadeDelete: true
				},
				{ name: 'value', type: 'text', max: 1000 },
				// optional: a superuser (admin UI, import) is no `users` record
				{ name: 'by', type: 'relation', collectionId: users.id, maxSelect: 1 },
				...DATES
			],
			indexes: ['CREATE UNIQUE INDEX idx_lead_checks_lead_requirement ON lead_checks (lead, requirement)']
		});
		app.save(checks);

		const events = new Collection({
			type: 'base',
			name: 'lead_check_events',
			listRule: AUTH,
			viewRule: AUTH,
			createRule: null,
			updateRule: null,
			deleteRule: null,
			fields: [
				ID,
				{
					name: 'lead',
					type: 'relation',
					collectionId: leads.id,
					required: true,
					maxSelect: 1,
					cascadeDelete: true
				},
				// cleared when the requirement is deleted; the label below stays
				{ name: 'requirement', type: 'relation', collectionId: requirements.id, maxSelect: 1 },
				{ name: 'requirement_label', type: 'text', required: true, max: 200 },
				{
					name: 'action',
					type: 'select',
					required: true,
					maxSelect: 1,
					values: ['confirmed', 'changed', 'revoked']
				},
				{ name: 'value', type: 'text', max: 1000 },
				{ name: 'by', type: 'relation', collectionId: users.id, maxSelect: 1 },
				...DATES
			],
			indexes: ['CREATE INDEX idx_lead_check_events_lead ON lead_check_events (lead, created)']
		});
		app.save(events);
	},
	(app) => {
		for (const name of ['lead_check_events', 'lead_checks', 'stage_requirements']) {
			try {
				app.delete(app.findCollectionByNameOrId(name));
			} catch (err) {
				// not there: nothing to undo
			}
		}
		const columns = app.findCollectionByNameOrId('board_columns');
		if (columns.fields.getByName('gates_exempt')) {
			columns.fields.removeByName('gates_exempt');
			app.save(columns);
		}
	}
);
