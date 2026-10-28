/// <reference path="../pb_data/types.d.ts" />

// F15: personal API tokens for agents (MCP server). A user sees, renames and revokes (=
// deletes) only their own tokens. Tokens are created only by the hook route
// POST /api/crm/api-tokens (createRule null): it draws the token with crypto/rand, shows it
// once and stores only its sha256 (`token_hash`, hidden: never in API responses or realtime
// events, not filterable by users). `key_check` (hidden) ties the token to the user's
// tokenKey, so a password change revokes it. `last_used` is written by the token exchange.
const OWN = '@request.auth.id != "" && user = @request.auth.id';
const ONLY_NAME =
	'@request.body.user:isset = false && @request.body.token_hash:isset = false && ' +
	'@request.body.key_check:isset = false && @request.body.last_used:isset = false';

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const tokens = new Collection({
			type: 'base',
			name: 'api_tokens',
			listRule: OWN,
			viewRule: OWN,
			createRule: null,
			updateRule: `${OWN} && ${ONLY_NAME}`,
			deleteRule: OWN,
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
				{ name: 'user', type: 'relation', collectionId: users.id, required: true, maxSelect: 1, cascadeDelete: true },
				{ name: 'name', type: 'text', required: true, max: 100 },
				{ name: 'token_hash', type: 'text', required: true, hidden: true, max: 64 },
				{ name: 'key_check', type: 'text', required: true, hidden: true, max: 64 },
				{ name: 'last_used', type: 'date' },
				{ name: 'created', type: 'autodate', onCreate: true },
				{ name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
			],
			indexes: [
				'CREATE UNIQUE INDEX idx_api_tokens_hash ON api_tokens (token_hash)',
				'CREATE INDEX idx_api_tokens_user ON api_tokens (user)'
			]
		});
		app.save(tokens);
	},
	(app) => {
		try {
			app.delete(app.findCollectionByNameOrId('api_tokens'));
		} catch (err) {
			// already gone
		}
	}
);
