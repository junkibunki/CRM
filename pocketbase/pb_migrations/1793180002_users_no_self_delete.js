/// <reference path="../pb_data/types.d.ts" />

// Accounts are managed by a superuser only: users may not delete their own account
// (the default rule is `id = @request.auth.id`). Editing the own profile stays allowed.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.deleteRule = null;
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.deleteRule = 'id = @request.auth.id';
		app.save(users);
	}
);
