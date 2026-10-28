/// <reference path="../pb_data/types.d.ts" />

// Activities of a lead (F3): notes, meeting notes, e-mails received/sent (entered by hand).
// Every logged-in user may read, create, edit and delete every activity. `author` is set to
// the creating user by rule and can't be changed afterwards. Attachments are protected
// files: downloads need a short-lived file token (pb.files.getToken()).
const AUTH = '@request.auth.id != ""';

migrate(
	(app) => {
		const leads = app.findCollectionByNameOrId('leads');
		const contacts = app.findCollectionByNameOrId('contacts');
		const users = app.findCollectionByNameOrId('users');

		const activities = new Collection({
			type: 'base',
			name: 'activities',
			listRule: AUTH,
			viewRule: AUTH,
			createRule: `${AUTH} && @request.body.author = @request.auth.id`,
			updateRule: `${AUTH} && (@request.body.author:isset = false || @request.body.author = author)`,
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
				{
					name: 'type',
					type: 'select',
					required: true,
					maxSelect: 1,
					values: ['note', 'meeting', 'email_in', 'email_out']
				},
				{ name: 'subject', type: 'text', max: 500 },
				// HTML from the rich-text editor; sanitised before display (lib/activities/sanitize.ts)
				{ name: 'body', type: 'editor', required: true, maxSize: 1048576, convertURLs: false },
				{ name: 'occurred_at', type: 'date', required: true },
				// participants / sender / recipients; deleting a contact just removes it here
				{ name: 'contacts', type: 'relation', collectionId: contacts.id, maxSelect: 50 },
				{
					name: 'attachments',
					type: 'file',
					maxSelect: 10,
					maxSize: 20 * 1024 * 1024,
					protected: true,
					thumbs: ['200x200f']
				},
				// required without cascade, like leads.owner: an account with activities can't
				// be deleted (lock it by changing its password instead)
				{ name: 'author', type: 'relation', collectionId: users.id, required: true, maxSelect: 1 },
				{ name: 'created', type: 'autodate', onCreate: true },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			indexes: ['CREATE INDEX idx_activities_lead_occurred ON activities (lead, occurred_at)']
		});
		app.save(activities);
	},
	(app) => {
		app.delete(app.findCollectionByNameOrId('activities'));
	}
);
