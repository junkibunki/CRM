/// <reference path="../pb_data/types.d.ts" />

// Internal CRM: no public sign-up, users are created by a superuser in the dashboard.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.createRule = null;
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.createRule = '';
		app.save(users);
	}
);
