// Demo to-dos (F7) for the demo leads: overdue, today (with and without time), later, done,
// one made from a note. Some leads keep none, so the card shows "Kein nächster Schritt"
// (except in the closed stages "Gewonnen" / "Verloren"). Skips itself if to-dos exist.
const pad = (n) => String(n).padStart(2, '0');

/** local day + `days` as stored without time: `YYYY-MM-DD 00:00:00.000Z` */
function day(days) {
	const d = new Date();
	d.setDate(d.getDate() + days);
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00.000Z`;
}

/** local day + `days` at hh:mm local time, stored as UTC */
function at(days, hh, mm = 0) {
	const d = new Date();
	d.setDate(d.getDate() + days);
	d.setHours(hh, mm, 0, 0);
	return d.toISOString().replace('T', ' ');
}

export default async function seed({ api, token, DEV_USER }) {
	const existing = await api('GET', '/api/collections/todos/records?perPage=1', null, token);
	if (existing.items.length > 0) return;

	const user = (
		await api(
			'GET',
			`/api/collections/users/records?filter=${encodeURIComponent(`email="${DEV_USER.email}"`)}`,
			null,
			token
		)
	).items[0];
	const leads = (await api('GET', '/api/collections/leads/records?perPage=200&sort=created', null, token)).items;
	const notes = (
		await api('GET', `/api/collections/activities/records?perPage=200&filter=${encodeURIComponent('type="note"')}`, null, token)
	).items;

	// [lead index, title, due, has time, done]
	const plan = [
		[0, 'Angebot nachfassen', day(-2), false, false],
		[0, 'Unterlagen schicken', day(3), false, false],
		[0, 'Erstgespräch vorbereiten', day(-5), false, true],
		[1, 'Rückruf Einkauf', at(0, 16, 30), true, false],
		[1, 'Termin bestätigen', day(7), false, false],
		[2, 'Vertragsentwurf prüfen', day(0), false, false],
		[3, 'Präsentation abstimmen', day(10), false, false],
		[4, 'Referenzen zusammenstellen', at(1, 9), true, false]
	];

	let n = 0;
	for (const [i, title, due, hasTime, done] of plan) {
		const lead = leads[i];
		if (!lead) continue;
		await api(
			'POST',
			'/api/collections/todos/records',
			{
				lead: lead.id,
				title,
				due,
				due_has_time: hasTime,
				done,
				done_at: done ? new Date().toISOString().replace('T', ' ') : '',
				created_by: user.id
			},
			token
		);
		n++;
	}

	// one made from a note ("aus Notiz vom …")
	const note = notes.find((a) => a.lead === leads[0]?.id);
	if (note) {
		await api(
			'POST',
			'/api/collections/todos/records',
			{ lead: note.lead, title: 'Unterlagen aus dem Erstkontakt zusammenstellen', due: day(1), source_activity: note.id, created_by: user.id },
			token
		);
		n++;
	}
	console.log(`created ${n} to-dos`);
}
