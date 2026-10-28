/// <reference path="../pb_data/types.d.ts" />

// F13a (Sammelposten 2, Teil a):
// * activities: `lead` can't be changed after creation (like `author`).
// * activities: `attachment_names` maps stored attachment names to the original file names.
//   Written only by the hook pb_hooks/attachment-names.pb.js; clients may not send it.
// * users: `name` is required (and not just spaces). Existing accounts without a name get
//   "Ohne Namen (<id start>)" — what the app showed for them so far — so every account
//   still validates (password reset, profile edit) and the admin can spot and fix them.
const AUTH = '@request.auth.id != ""';
const OLD_CREATE = `${AUTH} && @request.body.author = @request.auth.id`;
const OLD_UPDATE = `${AUTH} && (@request.body.author:isset = false || @request.body.author = author)`;
const NO_NAMES = '@request.body.attachment_names:isset = false';
const NEW_CREATE = `${OLD_CREATE} && ${NO_NAMES}`;
const NEW_UPDATE = `${OLD_UPDATE} && (@request.body.lead:isset = false || @request.body.lead = lead) && ${NO_NAMES}`;
// what Go's \s matches (the pattern below), as SQLite trim() characters
const BLANK = 'char(32, 9, 10, 12, 13)';

migrate(
	(app) => {
		const activities = app.findCollectionByNameOrId('activities');
		activities.createRule = NEW_CREATE;
		activities.updateRule = NEW_UPDATE;
		if (!activities.fields.getByName('attachment_names')) {
			activities.fields.add(new JSONField({ name: 'attachment_names', maxSize: 20000 }));
		}
		app.save(activities);

		app
			.db()
			.newQuery(
				`UPDATE users SET name = 'Ohne Namen (' || substr(id, 1, 6) || ')' WHERE trim(name, ${BLANK}) = ''`
			)
			.execute();
		const users = app.findCollectionByNameOrId('users');
		const name = users.fields.getByName('name');
		if (name) {
			name.required = true;
			name.pattern = '\\S';
			app.save(users);
		}
	},
	(app) => {
		const activities = app.findCollectionByNameOrId('activities');
		activities.createRule = OLD_CREATE;
		activities.updateRule = OLD_UPDATE;
		if (activities.fields.getByName('attachment_names')) activities.fields.removeByName('attachment_names');
		app.save(activities);

		// the filled-in names stay
		const users = app.findCollectionByNameOrId('users');
		const name = users.fields.getByName('name');
		if (name) {
			name.required = false;
			name.pattern = '';
			app.save(users);
		}
	}
);
