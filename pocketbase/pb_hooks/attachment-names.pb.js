/// <reference path="../pb_data/types.d.ts" />

// F13a: keep the original file names of activity attachments (field `attachment_names`,
// see attachment-names-lib.js) and serve downloads under that name.

onRecordCreateRequest((e) => {
	require(`${__hooks}/attachment-names-lib.js`).remember(e);
	e.next();
}, 'activities');

onRecordUpdateRequest((e) => {
	require(`${__hooks}/attachment-names-lib.js`).remember(e);
	e.next();
}, 'activities');

onFileDownloadRequest((e) => {
	require(`${__hooks}/attachment-names-lib.js`).serveOriginal(e);
	e.next();
}, 'activities');
