// Demo activities (F3) for the demo leads: notes, meeting notes, e-mails in both
// directions, some with contacts and attachments. Skips itself if activities exist.
const BASE = process.env.PB_URL ?? 'http://127.0.0.1:8090';

// 1x1 PNG, enough to show the image preview
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);

const hoursAgo = (h) => new Date(Date.now() - h * 3_600_000).toISOString().replace('T', ' ');

export default async function seed({ api, token, DEV_USER }) {
	const existing = await api('GET', '/api/collections/activities/records?perPage=1', null, token);
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

	const templates = [
		(l) => ({
			type: 'note',
			subject: 'Erstkontakt',
			body: `<p>Kurz telefoniert, Interesse an <strong>${l.title}</strong> ist da. Unterlagen schicken wir nächste Woche.</p>`,
			occurred_at: hoursAgo(24 * 9 + 3)
		}),
		(l) => ({
			type: 'meeting',
			subject: 'Kick-off vor Ort',
			body:
				'<h2>Agenda</h2><ol><li>Vorstellung</li><li>Anforderungen</li><li>Zeitplan</li></ol>' +
				'<h2>Ergebnisse</h2><ul><li>Budget für Q1 freigegeben</li><li>Ansprechpartner im Einkauf benannt</li>' +
				'<li>Technische Abstimmung bis Ende des Monats</li></ul><blockquote><p>„Wir wollen bis zum Sommer live sein.“</p></blockquote>' +
				'<p>Nächster Termin wird per Mail abgestimmt. Protokoll anbei.</p>',
			occurred_at: hoursAgo(24 * 5 + 1),
			contacts: l.contacts,
			files: [['Protokoll Kick-off.txt', 'text/plain', Buffer.from('Protokoll Kick-off\n\n1. Vorstellung\n2. Anforderungen\n')]]
		}),
		(l) => ({
			type: 'email_in',
			subject: `AW: Angebot ${l.title}`,
			body:
				'<p>Guten Tag,</p><p>vielen Dank für das Angebot. Wir haben noch Fragen zu Position 3 und zur ' +
				'<a href="https://example.com/agb">Laufzeit</a>.</p><p>Mit freundlichen Grüßen</p>' +
				'<img src="https://tracking.example.com/pixel.gif" width="1" height="1">',
			occurred_at: hoursAgo(26),
			contacts: l.contacts.slice(0, 1)
		}),
		(l) => ({
			type: 'email_out',
			subject: `Angebot ${l.title}`,
			body: '<p>Hallo,</p><p>anbei wie besprochen unser Angebot. Gültig bis Monatsende.</p><p>Viele Grüße</p>',
			occurred_at: hoursAgo(2),
			contacts: l.contacts.slice(0, 1),
			files: [['Skizze.png', 'image/png', PNG]]
		})
	];

	let n = 0;
	for (const [i, lead] of leads.entries()) {
		// different amounts per lead, the first lead gets all kinds
		for (const make of templates.slice(0, i === 0 ? templates.length : 1 + (i % templates.length))) {
			const { files = [], ...data } = make(lead);
			const fd = new FormData();
			for (const [k, v] of Object.entries({ contacts: [], ...data, lead: lead.id, author: user.id })) {
				if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
				else fd.append(k, v);
			}
			for (const [name, type, bytes] of files) fd.append('attachments', new Blob([bytes], { type }), name);
			const res = await fetch(`${BASE}/api/collections/activities/records`, {
				method: 'POST',
				headers: { Authorization: token },
				body: fd
			});
			if (!res.ok) throw new Error(`POST activities: ${res.status} ${await res.text()}`);
			n++;
		}
	}
	console.log(`created ${n} activities`);
}
