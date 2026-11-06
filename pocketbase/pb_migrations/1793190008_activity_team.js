/// <reference path="../pb_data/types.d.ts" />

// Internal participants of a meeting (F16): `activities.team` -> users. The external ones
// stay in `contacts`. Optional, no rule change: every logged-in user may set it, like
// `contacts`. Deleting an account just removes it here (not required, no cascade).
migrate(
	(app) => {
		const activities = app.findCollectionByNameOrId('activities');
		if (activities.fields.getByName('team')) return;
		const users = app.findCollectionByNameOrId('users');
		activities.fields.add(
			new RelationField({ name: 'team', collectionId: users.id, maxSelect: 50, cascadeDelete: false })
		);
		app.save(activities);
	},
	(app) => {
		const activities = app.findCollectionByNameOrId('activities');
		if (!activities.fields.getByName('team')) return;
		activities.fields.removeByName('team');
		app.save(activities);
	}
);
