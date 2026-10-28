// Demo companies, contacts and leads (in the pipeline the migration creates).
// Called by scripts/seed-dev.mjs; skips itself if companies already exist.
export default async function seed({ api, token, DEV_USER }) {
	const existingCompanies = await api('GET', '/api/collections/companies/records', null, token);
	if (existingCompanies.items.length === 0) {
		const user = (
			await api(
				'GET',
				`/api/collections/users/records?filter=${encodeURIComponent(`email="${DEV_USER.email}"`)}`,
				null,
				token
			)
		).items[0];
		// the pipeline and its stages come from the migration
		const board = (await api('GET', '/api/collections/boards/records', null, token)).items[0];
		const stages = (
			await api(
				'GET',
				`/api/collections/board_columns/records?sort=rank&filter=${encodeURIComponent(`board="${board.id}"`)}`,
				null,
				token
			)
		).items;

		const demo = [
			['Müller Maschinenbau GmbH', 'https://example.com', [['Anna', 'Müller', 'Geschäftsführerin'], ['Jonas', 'Weber', 'Einkauf']]],
			['Schneider Logistik AG', 'https://example.org', [['Petra', 'Schneider', 'Vorstand'], ['Lukas', 'Fischer', 'IT-Leitung']]],
			['Becker & Söhne KG', '', [['Thomas', 'Becker', 'Inhaber']]],
			['Hoffmann Digital', 'https://example.net', [['Sarah', 'Hoffmann', 'CTO'], ['Felix', 'Wagner', 'Produkt']]]
		];
		let n = 0;
		for (const [name, website, people] of demo) {
			const company = await api('POST', '/api/collections/companies/records', { name, website }, token);
			const contactIds = [];
			for (const [first_name, last_name, position] of people) {
				const email = `${first_name}.${last_name}@example.com`.toLowerCase().replace('ü', 'ue');
				const c = await api(
					'POST',
					'/api/collections/contacts/records',
					{ first_name, last_name, position, email, company: company.id },
					token
				);
				contactIds.push(c.id);
			}
			for (const topic of ['Wartungsvertrag', 'Pilotprojekt']) {
				const stage = stages[n % stages.length];
				await api(
					'POST',
					'/api/collections/leads/records',
					{
						column: stage.id,
						title: `${topic} ${name.split(' ')[0]}`,
						company: company.id,
						contacts: contactIds.slice(0, 1 + (n % contactIds.length)),
						expected_close: n % 3 === 0 ? '' : `2026-${String(10 + (n % 3)).padStart(2, '0')}-15 00:00:00.000Z`,
						owner: user.id,
						rank: `a${n}`
					},
					token
				);
				n++;
			}
		}
		console.log(`created ${demo.length} companies and ${n} leads`);
	}
}
