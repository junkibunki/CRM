/// <reference path="../pb_data/types.d.ts" />

// Profile pictures use the default `avatar` file field of `users`. Narrowed here: raster
// images only (an SVG may carry script), at most 5 MB, and a 96x96 thumbnail for the round
// avatar in the header (web/src/lib/profile/avatar.ts). Guarded: a missing field must not
// take the app down (migrations run on every bootstrap).
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DEFAULT_TYPES = ['image/jpeg', 'image/png', 'image/svg+xml', 'image/gif', 'image/webp'];

migrate(
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const avatar = users.fields.getByName('avatar');
		if (!avatar || avatar.type() !== 'file') return;
		avatar.mimeTypes = TYPES;
		avatar.maxSize = 5 * 1024 * 1024;
		avatar.thumbs = ['96x96'];
		app.save(users);
	},
	(app) => {
		const users = app.findCollectionByNameOrId('users');
		const avatar = users.fields.getByName('avatar');
		if (!avatar || avatar.type() !== 'file') return;
		avatar.mimeTypes = DEFAULT_TYPES;
		avatar.maxSize = 0;
		avatar.thumbs = [];
		app.save(users);
	}
);
