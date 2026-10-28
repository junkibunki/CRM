// Demo stage requirements (F12): from "Angebot" the lead must be flagged at Siemens (hint:
// whom to inform), from "Verhandlung" the Siemens lead number is needed. The first demo lead
// in "Angebot" gets the flag confirmed; the others there and later show the warning on their
// card (requirements added later never push leads back). "Verloren" is exempt (no
// requirements apply there; the migration sets it, this makes sure on renamed/older data that
// a stage of that name has it). Skips the rest if requirements exist.
export default async function seed({ api, token, DEV_USER }) {
	const board = (await api('GET', '/api/collections/boards/records?sort=created&perPage=1', null, token)).items[0];
	if (!board) return;
	const stages = (
		await api(
			'GET',
			`/api/collections/board_columns/records?sort=rank&filter=${encodeURIComponent(`board="${board.id}"`)}`,
			null,
			token
		)
	).items;
	const byName = Object.fromEntries(stages.map((s) => [s.name, s]));
	if (byName.Verloren && !byName.Verloren.gates_exempt) {
		await api('PATCH', `/api/collections/board_columns/records/${byName.Verloren.id}`, { gates_exempt: true }, token);
	}

	const existing = await api('GET', '/api/collections/stage_requirements/records?perPage=1', null, token);
	if (existing.items.length > 0) return;
	if (!byName.Angebot || !byName.Verhandlung) return;

	const flag = await api(
		'POST',
		'/api/collections/stage_requirements/records',
		{
			column: byName.Angebot.id,
			label: 'Bei Siemens als Lead geflaggt',
			type: 'flag',
			hint: 'Vertriebsleitung und Siemens-Ansprechpartner informieren',
			rank: 'a0'
		},
		token
	);
	await api(
		'POST',
		'/api/collections/stage_requirements/records',
		{ column: byName.Verhandlung.id, label: 'Siemens-Lead-Nummer', type: 'text', hint: '', rank: 'a0' },
		token
	);

	const user = (
		await api(
			'GET',
			`/api/collections/users/records?filter=${encodeURIComponent(`email="${DEV_USER.email}"`)}`,
			null,
			token
		)
	).items[0];
	const lead = (
		await api(
			'GET',
			`/api/collections/leads/records?perPage=1&sort=rank&filter=${encodeURIComponent(`column="${byName.Angebot.id}"`)}`,
			null,
			token
		)
	).items[0];
	if (lead) {
		await api(
			'POST',
			'/api/collections/lead_checks/records',
			{ lead: lead.id, requirement: flag.id, value: 'true', by: user?.id ?? '' },
			token
		);
	}
	console.log('  stage requirements: 2' + (lead ? ', 1 confirmation' : ''));
}
