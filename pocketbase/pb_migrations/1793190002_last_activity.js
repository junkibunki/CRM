/// <reference path="../pb_data/types.d.ts" />

// Latest activity per lead (F4), as a view collection: the board loads it for all its leads
// with ONE query (`lead.column.board = {:id}`) instead of one request per card. "Latest" is
// the same order as the timeline: occurred_at, then entry time, then id. Views send no
// realtime events; the board follows `activities` itself and re-reads single leads.
// Columns are plain references to `activities`, so PocketBase keeps their field types
// (`lead` stays a relation and can be filtered through).
const AUTH = '@request.auth.id != ""';

migrate(
	(app) => {
		const view = new Collection({
			type: 'view',
			name: 'lead_last_activity',
			listRule: AUTH,
			viewRule: AUTH,
			viewQuery:
				'SELECT a.id, a.lead, a.type, a.subject, a.body, a.occurred_at, a.created FROM activities a ' +
				'WHERE a.id = (SELECT b.id FROM activities b WHERE b.lead = a.lead ' +
				'ORDER BY b.occurred_at DESC, b.created DESC, b.id DESC LIMIT 1)'
		});
		app.save(view);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('lead_last_activity'));
	}
);
