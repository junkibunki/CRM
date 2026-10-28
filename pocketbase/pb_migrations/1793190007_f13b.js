/// <reference path="../pb_data/types.d.ts" />

// F13b (Sammelposten 2, Teil b):
// * Batch API on: the client re-ranks a whole stage (or the stage list) in ONE transaction
//   (web/src/lib/optimistic.ts, saveRanks), so nobody sees a half re-ranked list. Each request
//   of a batch still passes the collection's API rules. maxRequests matches BATCH_MAX there.
// * stage_requirements: `type` (flag/text) can't be changed after creation — a switch would
//   reinterpret the values already confirmed for it (lead_checks.value).
const AUTH = '@request.auth.id != ""';
const OLD_UPDATE = `${AUTH} && (@request.body.column:isset = false || @request.body.column = column)`;
const NEW_UPDATE = `${OLD_UPDATE} && (@request.body.type:isset = false || @request.body.type = type)`;

migrate(
	(app) => {
		const settings = app.settings();
		settings.batch.enabled = true;
		settings.batch.maxRequests = 1000;
		// seconds; a re-rank of a large stage runs up to a thousand updates with their rules
		settings.batch.timeout = 10;
		app.save(settings);

		const reqs = app.findCollectionByNameOrId('stage_requirements');
		reqs.updateRule = NEW_UPDATE;
		app.save(reqs);
	},
	(app) => {
		const settings = app.settings();
		settings.batch.enabled = false;
		settings.batch.maxRequests = 50;
		settings.batch.timeout = 3;
		app.save(settings);

		const reqs = app.findCollectionByNameOrId('stage_requirements');
		reqs.updateRule = OLD_UPDATE;
		app.save(reqs);
	}
);
