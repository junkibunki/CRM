/// <reference path="../pb_data/types.d.ts" />

// Cards show their assignee, so every logged-in user may list and view all users.
// Emails stay hidden unless a user sets emailVisibility.
migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.listRule = '@request.auth.id != ""';
		users.viewRule = '@request.auth.id != ""';
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		users.listRule = 'id = @request.auth.id';
		users.viewRule = 'id = @request.auth.id';
		app.save(users);
	}
);
