/// <reference path="../pb_data/types.d.ts" />

// To-dos of a lead (F7). The next open to-do (earliest due) is shown on the board card.
// Every logged-in user may read, create, edit and delete every to-do; `created_by` is set to
// the creating user by rule and can't be changed, nor can the lead of a to-do. Responsible is
// always the lead's owner (no field of its own). A to-do made from a note points at it via
// `source_activity` (no cascade: deleting the note just clears the field).
// Also adds `board_columns.closed` (closed stages: no next step expected) and shows the new
// card field `next_todo` on existing pipelines.
const AUTH = '@request.auth.id != ""';
const SAME_LEAD_SOURCE =
	'(@request.body.source_activity:isset = false || @request.body.source_activity = "" || ' +
	'@request.body.source_activity.lead = @request.body.lead)';
const SOURCE_KEPT_OR_CLEARED =
	'(@request.body.source_activity:isset = false || @request.body.source_activity = "" || ' +
	'@request.body.source_activity = source_activity)';

migrate(
	(app) => {
		const leads = app.findCollectionByNameOrId('leads');
		const activities = app.findCollectionByNameOrId('activities');
		const users = app.findCollectionByNameOrId('users');

		const todos = new Collection({
			type: 'base',
			name: 'todos',
			listRule: AUTH,
			viewRule: AUTH,
			createRule: `${AUTH} && @request.body.created_by = @request.auth.id && ${SAME_LEAD_SOURCE}`,
			updateRule:
				`${AUTH} && (@request.body.created_by:isset = false || @request.body.created_by = created_by)` +
				` && (@request.body.lead:isset = false || @request.body.lead = lead) && ${SOURCE_KEPT_OR_CLEARED}`,
			deleteRule: AUTH,
			fields: [
				{
					name: 'id',
					type: 'text',
					system: true,
					primaryKey: true,
					required: true,
					pattern: '^[a-z0-9]+$',
					min: 15,
					max: 15,
					autogeneratePattern: '[a-z0-9]{15}'
				},
				{
					name: 'lead',
					type: 'relation',
					collectionId: leads.id,
					required: true,
					maxSelect: 1,
					cascadeDelete: true
				},
				{ name: 'title', type: 'text', required: true, max: 300 },
				// without time: `YYYY-MM-DD 00:00:00.000Z` (the calendar day); with time: the
				// moment, entered in local time and stored as UTC
				{ name: 'due', type: 'date', required: true },
				{ name: 'due_has_time', type: 'bool' },
				{ name: 'done', type: 'bool' },
				{ name: 'done_at', type: 'date' },
				{
					name: 'source_activity',
					type: 'relation',
					collectionId: activities.id,
					maxSelect: 1,
					cascadeDelete: false
				},
				// required without cascade, like activities.author
				{ name: 'created_by', type: 'relation', collectionId: users.id, required: true, maxSelect: 1 },
				{ name: 'created', type: 'autodate', onCreate: true },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			indexes: ['CREATE INDEX idx_todos_lead_done_due ON todos (lead, done, due)']
		});
		app.save(todos);

		// closed stages (won/lost): the card doesn't ask for a next step there
		const columns = app.findCollectionByNameOrId('board_columns');
		if (!columns.fields.getByName('closed')) {
			columns.fields.add(new Field({ name: 'closed', type: 'bool' }));
			app.save(columns);
		}
		app
			.db()
			.newQuery("UPDATE board_columns SET closed = 1 WHERE name IN ('Gewonnen', 'Verloren')")
			.execute();

		// show the new card field on existing pipelines (still switchable in the settings)
		app
			.db()
			.newQuery(
				"UPDATE boards SET card_fields = json_insert(card_fields, '$[#]', 'next_todo') " +
					"WHERE json_valid(card_fields) AND json_type(card_fields) = 'array' " +
					"AND NOT EXISTS (SELECT 1 FROM json_each(boards.card_fields) WHERE value = 'next_todo')"
			)
			.execute();
	},
	(app) => {
		app
			.db()
			.newQuery(
				"UPDATE boards SET card_fields = (SELECT json_group_array(value) FROM json_each(boards.card_fields) " +
					"WHERE value != 'next_todo') WHERE json_valid(card_fields) AND json_type(card_fields) = 'array'"
			)
			.execute();
		const columns = app.findCollectionByNameOrId('board_columns');
		if (columns.fields.getByName('closed')) {
			columns.fields.removeByName('closed');
			app.save(columns);
		}
		app.delete(app.findCollectionByNameOrId('todos'));
	}
);
