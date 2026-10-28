/// <reference path="../pb_data/types.d.ts" />

// CRM core: companies, contacts, and the leads pipeline (boards -> board_columns -> leads).
// Lead order inside a stage is a fractional-indexing key in `rank` (string compare), so a
// move updates one record. No roles yet: every logged-in user may do everything, except
// creating/deleting boards: there is exactly one, the "Leads" pipeline, seeded below.
const AUTH = '@request.auth.id != ""';

const rules = {
	listRule: AUTH,
	viewRule: AUTH,
	createRule: AUTH,
	updateRule: AUTH,
	deleteRule: AUTH
};

const idField = {
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

const timestamps = [
	{ name: 'created', type: 'autodate', onCreate: true },
	{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
];

const STAGES = [
	['Neu', 'gray'],
	['Qualifiziert', 'blue'],
	['Angebot', 'yellow'],
	['Verhandlung', 'orange'],
	['Gewonnen', 'green'],
	['Verloren', 'red']
];

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');

		const companies = new Collection({
			type: 'base',
			name: 'companies',
			...rules,
			fields: [
				idField,
				{ name: 'name', type: 'text', required: true, max: 200 },
				{ name: 'website', type: 'url' },
				{ name: 'email', type: 'email' },
				{ name: 'phone', type: 'text', max: 50 },
				{ name: 'address', type: 'text', max: 1000 },
				{ name: 'notes', type: 'text', max: 20000 },
				...timestamps
			],
			indexes: ['CREATE INDEX idx_companies_name ON companies (name)']
		});
		app.save(companies);

		const contacts = new Collection({
			type: 'base',
			name: 'contacts',
			...rules,
			fields: [
				idField,
				{ name: 'first_name', type: 'text', max: 100 },
				{ name: 'last_name', type: 'text', required: true, max: 100 },
				// deleting a company keeps its contacts, they just lose the link
				{ name: 'company', type: 'relation', collectionId: companies.id, maxSelect: 1 },
				{ name: 'position', type: 'text', max: 100 },
				{ name: 'email', type: 'email' },
				{ name: 'phone', type: 'text', max: 50 },
				{ name: 'notes', type: 'text', max: 20000 },
				...timestamps
			],
			indexes: ['CREATE INDEX idx_contacts_company ON contacts (company)']
		});
		app.save(contacts);

		const boards = new Collection({
			type: 'base',
			name: 'boards',
			...rules,
			createRule: null,
			deleteRule: null,
			fields: [
				idField,
				{ name: 'name', type: 'text', required: true, max: 100 },
				// which optional fields a lead card shows, e.g. ["company","owner"]
				{ name: 'card_fields', type: 'json', maxSize: 2000 },
				...timestamps
			]
		});
		app.save(boards);

		const columns = new Collection({
			type: 'base',
			name: 'board_columns',
			...rules,
			fields: [
				idField,
				{
					name: 'board',
					type: 'relation',
					collectionId: boards.id,
					required: true,
					maxSelect: 1,
					cascadeDelete: true
				},
				{ name: 'name', type: 'text', required: true, max: 100 },
				{
					name: 'color',
					type: 'select',
					maxSelect: 1,
					values: ['gray', 'blue', 'green', 'yellow', 'orange', 'red', 'purple']
				},
				{ name: 'wip_limit', type: 'number', min: 0, onlyInt: true },
				{ name: 'rank', type: 'text', required: true, max: 100 },
				...timestamps
			],
			indexes: ['CREATE INDEX idx_board_columns_board_rank ON board_columns (board, rank)']
		});
		app.save(columns);

		const leads = new Collection({
			type: 'base',
			name: 'leads',
			...rules,
			fields: [
				idField,
				{
					name: 'column',
					type: 'relation',
					collectionId: columns.id,
					required: true,
					maxSelect: 1,
					cascadeDelete: true
				},
				{ name: 'title', type: 'text', required: true, max: 300 },
				// required relations without cascade: a company or contact in use by a lead
				// can't be deleted
				{
					name: 'company',
					type: 'relation',
					collectionId: companies.id,
					required: true,
					maxSelect: 1
				},
				{
					name: 'contacts',
					type: 'relation',
					collectionId: contacts.id,
					required: true,
					maxSelect: 50
				},
				{ name: 'expected_close', type: 'date' },
				{ name: 'owner', type: 'relation', collectionId: users.id, required: true, maxSelect: 1 },
				{ name: 'rank', type: 'text', required: true, max: 100 },
				...timestamps
			],
			indexes: ['CREATE INDEX idx_leads_column_rank ON leads (`column`, rank)']
		});
		app.save(leads);

		// the one pipeline with default stages (ranks a0, a1, ... are valid fractional keys)
		const board = new Record(boards);
		board.set('name', 'Leads');
		board.set('card_fields', ['company', 'contacts', 'expected_close', 'owner']);
		app.save(board);
		STAGES.forEach(([name, color], i) => {
			const col = new Record(columns);
			col.set('board', board.id);
			col.set('name', name);
			col.set('color', color);
			col.set('rank', 'a' + i);
			app.save(col);
		});
	},
	(app) => {
		for (const name of ['leads', 'board_columns', 'boards', 'contacts', 'companies']) {
			app.delete(app.findCollectionByNameOrId(name));
		}
	}
);
