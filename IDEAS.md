# IDEAS – Feature-Backlog

Jedes Feature ist so geschnitten, dass ein Sub-Agent es allein umsetzen kann. Vor der
Umsetzung gelten für **jeden** Agenten:

* [CLAUDE.md](CLAUDE.md) lesen, dazu die dort verlinkten `docs/pitfalls/*.md`, die das
  Feature berührt (mindestens `datenmodell.md`; bei Board-Bezug `kanban.md`; bei UI
  `designsystem.md`; bei Migrationen `migrationen.md`).
* **Nur die Dateien anfassen, die unter „Besitzt" stehen.** Alles andere ist tabu oder
  unter „Darf ändern" ausdrücklich genannt. So arbeiten mehrere Agents parallel ohne
  Konflikte.
* **Keine Änderungen an `CLAUDE.md`, `README.md` oder `web/src/lib/types.ts`.** Was dort
  hinein muss, schreibt der Agent unter „Notizen für die Doku" in seinen Abschlussbericht;
  zusammengeführt wird zentral.
* Migrationen nur mit der reservierten Nummer des Features.
* **Neue npm-Pakete nicht selbst installieren** (`package.json`/Lockfile würden sich
  zwischen parallelen Agents überschreiben): benötigte Pakete stehen beim Feature unter
  „Zentral vorab" und werden vor dem Start installiert; fehlt eins, im Bericht melden.
* Live-Daten immer über `liveSync()` / `LiveCollection`, Dialoge speichern nur geänderte
  Felder (`changedFields()`).
* Fertig heißt: `npm run check` und `npm run build` grün, im Browser selbst geprüft
  (Playwright-MCP, Dev-Login aus `scripts/seed-dev.mjs`), Akzeptanzkriterien erfüllt.
  Committet wird erst nach dem unabhängigen Review aus CLAUDE.md.

Status: `offen` → `in Arbeit` → `Review` → `fertig`.

---

## F1 – Lead-Schnellansicht (Pop-up beim Klick auf eine Karte)

**Status:** fertig (Welle 1) · **Abhängig von:** – (die Anzeige der letzten Aktivität kommt mit F4)

**Ziel:** Ein Klick auf eine Lead-Karte öffnet eine kompakte Übersicht statt direkt des
Bearbeiten-Dialogs. Von dort geht es zum Bearbeiten oder zur vollständigen Ansicht.

**Akzeptanzkriterien**
* Klick (oder Enter/Leertaste) auf eine Karte öffnet ein Pop-up mit: Titel, Phase (mit
  Farbpunkt), Unternehmen, Kontakte (Name, Position), voraussichtlicher Abschluss
  (überfällig rot), Zuständiger, Erstellt am.
* Buttons: **„Öffnen"** → `/leads/<id>` (F2), **„Bearbeiten"** → bestehender
  `LeadDialog`. Schließen per Esc, Klick daneben oder X.
* Drag & Drop bleibt unverändert: ein Drag öffnet das Pop-up nicht.
* Das Pop-up aktualisiert sich live, wenn jemand den Lead währenddessen ändert; wird er
  gelöscht, schließt es mit kurzer Meldung.

**Besitzt:** `web/src/lib/kanban/LeadPreview.svelte` (neu)
**Darf ändern:** `web/src/lib/kanban/KanbanBoard.svelte` (Klick-Handler und Dialog-Zustand)
**Migration:** keine

---

## F2 – Lead-Detailseite

**Status:** fertig (Welle 1, Aktivitäten bei der Integration eingesetzt) · **Abhängig von:** F3 nur für die Aktivitäten-Kachel

**Ziel:** Eine eigene Seite pro Lead mit allen Informationen; Herzstück sind die
Aktivitäten (F3).

**Akzeptanzkriterien**
* Route `/leads/<id>`; „Zurück zur Pipeline" führt nach `/leads`. Direkter Aufruf per
  URL funktioniert (Lesezeichen, Link teilen).
* **Kopf:** Titel, Phase (änderbar per Auswahl → verschiebt den Lead ans Ende der
  Phase), Zuständiger, voraussichtlicher Abschluss, Erstellt am, Button „Bearbeiten"
  (bestehender `LeadDialog`), Löschen mit Bestätigung → zurück zur Pipeline.
* **Kachel Kontakte:** alle Kontakte des Leads mit Name, Position, E-Mail (mailto),
  Telefon (tel:); Klick öffnet den `ContactDialog`.
* **Kachel Unternehmen:** Name, Website, E-Mail, Telefon, Adresse, Anzahl Kontakte;
  Klick öffnet den `CompanyDialog`.
* **Hauptbereich Aktivitäten:** bindet `<ActivityTimeline leadId={id} />` aus F3 ein.
  Solange F3 nicht fertig ist: Platzhalter-Kachel „Aktivitäten folgen".
* Alles live: Änderungen am Lead, an Kontakten und am Unternehmen erscheinen ohne Reload;
  wird der Lead gelöscht, Hinweis + Link zur Pipeline.
* Layout Desktop: Aktivitäten links breit, Kontakte und Unternehmen rechts als Kacheln.

**Besitzt:** `web/src/routes/leads/[id]/+page.svelte` (neu), `web/src/lib/lead/` (neu:
z. B. `lead.svelte.ts` – Store für *einen* Lead über `liveSync()`, `ContactsTile.svelte`,
`CompanyTile.svelte`, `LeadHeader.svelte`)
**Darf ändern:** – (`BoardStore` nicht anfassen; für den Phasenwechsel eine eigene kleine
Funktion mit `rank` am Ende der Zielphase, siehe `kanban.md`)
**Migration:** keine

---

## F3 – Aktivitäten zu einem Lead

**Status:** fertig (Welle 1) · **Abhängig von:** – · **Migration:** `1793190000_activities.js`

**Ziel:** Zu jedem Lead lassen sich Aktivitäten anlegen, damit alle Nutzer sehen, was im
Lead passiert ist. Das ist das wichtigste Feature.

**Aktivitätsarten:** Notiz · Meeting-Notiz · E-Mail eingegangen (vom Lead) · E-Mail
gesendet (an den Lead)

**Datenmodell (Vorschlag)** – Collection `activities`
| Feld | Typ | Bemerkung |
|---|---|---|
| `lead` | Relation → leads, Pflicht, cascade | Lead gelöscht → Aktivitäten weg |
| `type` | select: `note`, `meeting`, `email_in`, `email_out`, Pflicht | |
| `subject` | text, optional | Betreff / Meeting-Titel |
| `body` | editor (HTML), Pflicht, `maxSize` ≈ 1 MB | Rich-Text; eingefügte E-Mails behalten Formatierung |
| `occurred_at` | date, Pflicht | wann es passiert ist (Default: jetzt), nicht = `created` |
| `contacts` | Relation → contacts, mehrfach, optional | Teilnehmer / Absender / Empfänger |
| `attachments` | file, mehrfach (max. 10), je max. 20 MB, **`protected: true`** | Protokolle, Mail-Anhänge |
| `author` | Relation → users, Pflicht | per Rule erzwungen: `author = @request.auth.id` |
| `created`, `updated` | autodate | |

Rules: alle Angemeldeten dürfen lesen, anlegen, bearbeiten und löschen (Entscheidung:
keine Autor-Beschränkung). `author` bleibt beim Bearbeiten unverändert (Rule:
`@request.body.author:isset = false || @request.body.author = author`). Index auf
`(lead, occurred_at)`.

**Entscheidungen (geklärt)**
* E-Mails werden **manuell** erfasst (Betreff + Inhalt einfügen, Richtung wählen).
  Postfach-Anbindung → eigenes späteres Feature F6.
* **Alle Nutzer** dürfen jede Aktivität bearbeiten und löschen.
* **Rich-Text-Editor** (Vorschlag: Tiptap, `@tiptap/core` + `starter-kit` + `link`,
  framework-unabhängig per Svelte-Action eingebunden; Toolbar: fett, kursiv, Listen,
  Überschrift, Link, Zitat). Editor nur im Formular laden (dynamischer Import), damit das
  Board-Bundle nicht wächst.
* **Anhänge gleich mit.**

**Sicherheit (Pflicht)**
* **HTML vor der Anzeige bereinigen** (DOMPurify o. ä., Allowlist passend zur Toolbar).
  Alle Nutzer sehen alle Aktivitäten; eingefügte E-Mails können Skripte, Tracking-Pixel
  und `on*`-Attribute enthalten. Externe Bilder in eingefügten Mails nicht automatisch
  laden (Tracking).
* Anhänge sind `protected`: Download-Links brauchen einen File-Token
  (`pb.files.getToken()`), der kurz gültig ist — Links nicht in den Store cachen, sondern
  beim Klick erzeugen.

**Akzeptanzkriterien**
* Komponente `<ActivityTimeline leadId={string} />` (Schnittstelle für F2): Liste neueste
  zuerst, gruppiert nach Tag; je Eintrag Symbol der Art, Betreff, Text (lange Texte
  eingeklappt mit „mehr"), beteiligte Kontakte, Autor, Zeitpunkt.
* Filter nach Art (alle / Notizen / Meetings / E-Mails).
* Neue Aktivität: Art wählen, Betreff, Inhalt (Rich-Text), Zeitpunkt (Default jetzt),
  Kontakte (Auswahl aus den Kontakten des Leads), Anhänge (mehrere, per Auswahl oder
  Drag & Drop in das Formular). Strg+Enter speichert.
* Anhänge in der Timeline: Dateiname, Größe, Download; Bilder als kleine Vorschau.
* Bearbeiten (Inhalt, Anhänge hinzufügen/entfernen) und Löschen (mit Bestätigung) für alle
  Nutzer; beim Bearbeiten nur geänderte Felder senden (`changedFields()`).
* Live für alle Nutzer, auch nach Reconnect.
* Performance: ein Lead mit 500 Aktivitäten lädt und scrollt flüssig (nur die Aktivitäten
  *dieses* Leads laden, Filter `lead = {:id}`).

**Besitzt:** `pocketbase/pb_migrations/1793190000_activities.js` (neu),
`web/src/lib/activities/` (neu: Store, `ActivityTimeline.svelte`, `ActivityForm.svelte`,
`ActivityItem.svelte`, eigene `types.ts`)
**Darf ändern:** – (Demo-Aktivitäten in eigener Datei `scripts/seed/activities.mjs`, siehe
Welle 0)
**Zentral vorab (nicht vom Agenten):** `@tiptap/core`, `@tiptap/starter-kit`,
`@tiptap/extension-link`, `dompurify` in `web/package.json`.

---

## F4 – Letzte Aktivität auf Karte und Schnellansicht (Folge-Feature)

**Status:** fertig (Welle 2, zusammen mit F7) · **Abhängig von:** F1, F3 · **Migration:** `1793190002_last_activity.js` (View `lead_last_activity`)

* Schnellansicht (F1) zeigt die letzte Aktivität (Art, Datum, erste Zeile).
* Optional auf der Karte: Datum der letzten Aktivität („vor 3 Tagen"), konfigurierbar
  über die Kartenfelder der Pipeline.
* Muss performant bleiben: nicht pro Karte eine Anfrage (z. B. View-Collection oder ein
  Feld `last_activity_at` am Lead, das ein Hook pflegt).

---

---

## F5 – Kleinere Punkte aus den Reviews (Sammelposten)

**Status:** fertig (Welle 1, bis auf das atomare Neu-Nummerieren → F13) · Hier standen „minor"-Findings, die nicht vor einem Commit behoben
wurden. Jeder Punkt mit Datei, Szenario und Vorschlag.

* **Rollback überschreibt fremde Änderung kurz** – `web/src/lib/board.svelte.ts`
  (`updateLead`/`updateColumn`): schlägt ein optimistisches Update fehl, stellt
  `Object.assign(lead, prev)` den Stand vom Beginn wieder her, auch wenn inzwischen ein
  Realtime-Event eines anderen dieselben Felder geändert hat — bis zum nächsten Event falsch
  angezeigt. Vorschlag: nur Felder zurücksetzen, deren Wert noch dem eigenen entspricht.
* **Neu-Ranking nicht atomar** – `board.svelte.ts` (`rankAt`): bei Rank-Kollision oder zu
  langen Keys laufen N Updates parallel, lokale Ranks werden vorab gesetzt. Schlagen
  einzelne fehl, weichen lokale und Server-Reihenfolge bis zum Reload ab; andere sehen die
  Reihenfolge währenddessen kurz durcheinander. Vorschlag: PocketBase-Batch-API (in den
  Einstellungen aktivieren) oder ein Hook-Endpoint, der die Spalte in einer Transaktion
  neu nummeriert.
* **Gleichzeitig Kontakte hinzufügen** – `LeadDialog.svelte` + `diff.ts`: `contacts` wird als
  ganzes Array gespeichert. Fügen A und B gleichzeitig je einen Kontakt hinzu, verliert der
  zweite Speichervorgang den Kontakt des anderen. Vorschlag: PocketBase-Modifier
  `contacts+` / `contacts-` mit der Differenz senden.
* **Neuer Lead/Phase mit ungültiger Session** – `board.svelte.ts` (`addLead`, `addColumn`):
  ein 400 prüft die Session nicht, der Nutzer sieht eine allgemeine Fehlermeldung und wird
  erst bei der minütlichen Prüfung abgemeldet. Vorschlag: wie `LiveCollection.guard` auch
  bei 400/403 `auth.refresh()`.
* **Doppelter Session-Check auf der Leads-Seite** – `routes/leads/+page.svelte` + `live.ts`:
  Board-Suche und `BoardStore.sync()` prüfen die Session nacheinander, ≈ zwei zusätzliche
  Round-Trips vor dem ersten Rendern. Vorschlag: Session-Ergebnis für einige Sekunden
  wiederverwenden.
* **Phase gelöscht während der Bearbeitung** – `board.svelte.ts` (`updateColumn`): die
  Änderung verfällt ohne Meldung (die Spalte verschwindet sichtbar). Vorschlag: Hinweis wie
  bei `updateLead`.
* **Nutzer ohne Namen** – `collection.svelte.ts` (`userLabel`): Kollegen sehen
  „Unbenannt", weil E-Mails verborgen sind. Vorschlag: `name` bei Konten Pflicht machen
  oder eine Profilseite, auf der man ihn setzt.

---

## F13 – Sammelposten 2 (kleinere Punkte aus Welle 1)

**Status:** F13a fertig (Welle 2), F13b offen · Je Punkt: Datei, Szenario, Vorschlag. Keine neuen Features.

**F13a (Welle 2, parallel zu F7/F10) – fertig** – nur Punkte, deren Dateien weder F7 noch F10 gehören:
Kopfzeile auf dem Handy, `lead` einer Aktivität per API sperren, Original-Dateinamen, Editor
verliert Bilder/Tabellen/Überschriften, Tageslabels um Mitternacht, `favicon.ico`, `name` bei
Konten Pflicht.
* **Migration reserviert:** `1793190004_f13a.js` (Rules/Felder dieser Punkte in einer Datei).
* **Besitzt:** `pocketbase/pb_hooks/attachment-names.pb.js` (+ `-lib.js`), `web/static/favicon.ico`
  (bzw. ein passendes Icon).
* **Darf ändern:** `web/src/routes/+layout.svelte`, `web/src/lib/activities/editor.ts`,
  `sanitize.ts` (nur Allowlist für Tabellen/Bilder), `format.ts`, `Attachment.svelte`,
  `files.ts`, `ActivityTimeline.svelte`, `activities.svelte.ts` und deren Tests,
  `scripts/test-api-activities.mjs`. **Nicht** `ActivityItem.svelte` (gehört in Welle 2 F7).
* **Zentral vorab (erledigt):** `@tiptap/extension-image`, `@tiptap/extension-table`.

**F13b (nach Welle 2)** – die übrigen Punkte; sie berühren Dateien von F7/F10/F12
(`board.svelte.ts`, `KanbanCard`, `LeadPreview`/`preview.ts`, `ActivityItem`, Kontakt-Dialoge):
atomares Neu-Nummerieren, Rollback bei gleichem Wert, „Bilder anzeigen" merken, Heuristik für
lange Texte, doppelte Datums-Helfer, doppeltes `isGone`/`MAX_RANK_LENGTH`, Tests/Fokus der
Schnellansicht, Screenreader-Text „Close", Punkte zu den E-Mail-Vorschlägen.

**Neu für F13b aus Welle 2** (Reviews und Berichte von F7/F4, F10, F13a, Integration):
* **Quelle eines To-Dos veraltet** – `todos/lead.svelte.ts`: das per `expand` geladene Datum/die
  Art der Quell-Notiz wird nicht aktualisiert, wenn jemand die Notiz bearbeitet („aus Notiz vom
  …" bleibt bis zum Neuladen alt). Vorschlag: auf `activities` hören und das expand nachladen.
* **Uhrzeit in der Sommerzeit-Lücke** – `todos/due.ts` (`fromDueInput`): 02:30 am Tag der
  Zeitumstellung im Frühjahr wird still um eine Stunde verschoben. Vorschlag: erkennen und
  einen Hinweis zeigen.
* **Link „aus Notiz vom …" ins Leere** – wenn der Timeline-Filter die Notiz ausblendet, passiert
  beim Klick nichts. Vorschlag: Filter zurücksetzen, dann scrollen.
* **Erledigte To-Dos ohne Datum** – zeigen nur „erledigt", nicht wann.
* **Doppelter Tabellenstil** – `activities/editor.ts` (`TABLE_CLASSES`, `table-fixed`) und
  `activity-html.css` (Timeline, Auto-Layout) können auseinanderlaufen. Vorschlag: eine Quelle.
* **Unternehmens-Abruf im Lead-Dialog** – der in `LeadDialog` eingebettete `CompanyDialog` ruft
  die Website-Daten nicht automatisch ab (nur per Knopf), anders als aus dem Kontakt-Dialog.
* **Website-Abruf: Cache nur im Speicher** – geht beim Neustart verloren; Seiten, die per
  JavaScript rendern oder Bot-Schutz haben, liefern nichts (das wäre F11).
* **Website-Abruf: UX** – während ein Abruf läuft (bis ≈ 20 s), bleibt der Knopf gesperrt, auch
  wenn die Website im Feld geändert wurde; eine ungültige Endung mit Bindestrich/Ziffer meldet
  „IP-Adressen sind nicht erlaubt".

* **Atomares Neu-Nummerieren** – `board.svelte.ts` (`rankAt`): parallel laufende Updates sind
  nicht atomar; andere Nutzer sehen kurz eine durcheinandergeratene Reihenfolge. Vorschlag:
  Migration `batch.enabled = true`, dann `pb.createBatch()`; oder ein Hook-Endpoint.
* **Rollback bei gleichem Wert** – `board.svelte.ts` und `lead/lead.svelte.ts` (`rollback`):
  speichert ein anderer gleichzeitig *denselben* Wert und unser Request scheitert, wird lokal
  der alte Wert angezeigt. Vorschlag: merken, ob seit dem Absenden ein Realtime-Event für das
  Feld kam.
* **Kopfzeile auf dem Handy** – `routes/+layout.svelte`: bei 390 px ragt „Abmelden" über den
  Rand (alle Seiten). Vorschlag: Navigation umbrechen bzw. Menü.
* **`lead` einer Aktivität per API änderbar** – Migration `activities`: Rule wie bei `author`
  (`@request.body.lead:isset = false || @request.body.lead = lead`).
* **Original-Dateinamen gehen verloren** – Anhänge: PocketBase baut Namen um. Vorschlag:
  Hook, der den Originalnamen in einem JSON-Feld `attachment_names` mitschreibt.
* **Editor verliert Bilder, Tabellen, h1/h4–h6** beim Bearbeiten per API gespeicherter
  Inhalte – `activities/editor.ts`. Vorschlag: Image- und Table-Extension (Bilder nur
  `data:`/geschützt), Überschriften-Level erweitern.
* **Tageslabels „Heute/Gestern"** in der Timeline springen um Mitternacht erst beim nächsten
  Neuzeichnen um – wie `KanbanCard` einen minütlichen `today`-Zustand nutzen.
* **„Bilder anzeigen" wird nicht gemerkt** (pro Aktivität, nur bis zum Neuladen).
* **Lange Texte per Heuristik** (> 500 Zeichen / > 6 Blöcke) statt gemessen.
* **Doppelte Datumshelfer** – `localDate()` in `KanbanCard.svelte` und `kanban/preview.ts`:
  zusammenlegen.
* **`isGone()` und `MAX_RANK_LENGTH` doppelt** in `board.svelte.ts` und `lead/lead.svelte.ts`:
  in ein gemeinsames Modul.
* **Schnellansicht:** Effekt „schließen, wenn gelöscht" und die Übergabe „Bearbeiten" haben keinen
  direkten Test; nach „Bearbeiten" kann der Fokus auf die Karte statt in den Dialog gehen
  (manuell prüfen); `shown` könnte `$state.raw` sein.
* **Dialog-Schließen-Button** hat den Screenreader-Text „Close" (englisch, shadcn-CLI-Output,
  alle Dialoge) – über einen Prop/Wrapper auf „Schließen".
* **E-Mail-Vorschläge (F9):** Drei-Teil-Namen sind geraten („Anna Maria / Mueller"); die
  Dubletten-Prüfung per Website läuft nur im Client; Vorschläge erscheinen auch beim
  Bearbeiten (nur leere Felder).
* **`favicon.ico` fehlt** – 404 in der Konsole jeder Seite.
* **`name` bei Konten Pflicht** – braucht eine Migration; bis dahin „Ohne Namen (abc123)".

---

## F6 – E-Mail-Anbindung (später)

**Status:** Idee · E-Mails automatisch aus dem Postfach (Outlook/IMAP) als Aktivitäten
übernehmen; Zuordnung Mail → Lead über die Kontakt-Adressen. Bis dahin: manuell (F3).

---

## F7 – To-Dos pro Lead, nächstes To-Do auf der Karte

**Status:** fertig (Welle 2) · **Abhängig von:** – (Kern); F2 und F3 für die Einbindung (siehe unten)
· **Migration reserviert:** `1793190001_todos.js`

**Ziel:** Zu jedem Lead lassen sich To-Dos mit Datum anlegen. Entscheidend ist das
**nächste offene To-Do**: sein Datum steht auf der Kanban-Karte, damit man sofort sieht, ob
etwas ansteht, heute fällig ist oder schon in der Vergangenheit liegt. To-Dos können
direkt aus Notizen entstehen.

**Datenmodell (Vorschlag)** – Collection `todos`
| Feld | Typ | Bemerkung |
|---|---|---|
| `lead` | Relation → leads, Pflicht, cascade | |
| `title` | text, Pflicht, max. 300 | |
| `due` | date, Pflicht | Fälligkeit; ohne Uhrzeit als `YYYY-MM-DD 00:00:00Z` gespeichert |
| `due_has_time` | bool | `true` = mit Uhrzeit (lokal eingegeben, als UTC gespeichert) |
| `done` | bool | |
| `done_at` | date | beim Abhaken gesetzt, beim Zurücknehmen geleert |
| `source_activity` | Relation → activities, optional, **ohne** cascade | Notiz, aus der das To-Do entstand; Notiz gelöscht → Feld wird leer, To-Do bleibt |
| `created_by` | Relation → users, Pflicht | per Rule `= @request.auth.id` |
| `created`, `updated` | autodate | |

Kein eigenes Zuständig-Feld: **zuständig ist immer der Zuständige des Leads** (`lead.owner`).
Rules wie überall: alle Angemeldeten dürfen alles. Index auf `(lead, done, due)`.

**Phase „abgeschlossen"** – neues Feld `board_columns.closed` (bool) in derselben
Migration; die Migration setzt es für „Gewonnen" und „Verloren". Im Phasen-Dialog als
Schalter „Abgeschlossene Phase" (dort wird kein nächster Schritt erwartet).
`source_activity` direkt in `1793190001_todos.js` anlegen (F3 ist da).

**„Nächstes To-Do"** = offenes To-Do (`done = false`) mit der frühesten Fälligkeit. Ein To-Do
ohne Uhrzeit zählt innerhalb seines Tages vor denen mit Uhrzeit; bei Gleichstand das zuerst
angelegte.

**Fälligkeit:** ohne Uhrzeit überfällig ab dem nächsten Tag (lokales Datum), mit Uhrzeit ab
diesem Zeitpunkt; „heute" = lokaler heutiger Tag.

**Performance:** nicht pro Karte abfragen. Das Board lädt mit **einer** Abfrage alle offenen
To-Dos der Pipeline (`done = false && lead.column.board = {:id}`, nur die Felder
`id,lead,title,due`) über `liveSync()` und bildet daraus im Client eine Map
Lead → nächstes To-Do. Erledigte To-Dos lädt nur die Detailseite.

**Akzeptanzkriterien**
* **Karte:** neues Kartenfeld „Nächstes To-Do" (in den Pipeline-Einstellungen
  abschaltbar) mit Datum (ggf. Uhrzeit) und gekürztem Titel; Farbe nach Lage: **überfällig** rot,
  **heute** hervorgehoben, **künftig** neutral. Lokales Datum, springt um Mitternacht um
  (wie das Abschlussdatum). Ohne offenes To-Do: dezenter grauer Hinweis „Kein nächster
  Schritt" — außer in abgeschlossenen Phasen.
* **Komponente `<TodoList leadId={string} />`** (Schnittstelle für F2): offene To-Dos nach
  Datum sortiert, erledigte eingeklappt darunter; abhaken / zurücknehmen mit einem Klick,
  Titel und Fälligkeit inline ändern, löschen mit Bestätigung; neues To-Do mit Titel +
  Datum (Schnellwahl: heute, morgen, nächste Woche) + optionaler Uhrzeit.
* **Schnellansicht (F1):** zeigt das nächste To-Do mit Häkchen zum Abhaken und
  „+ To-Do".
* **Aus Notizen entstehen (mit F3):** an jeder Notiz / Meeting-Notiz ein Button „To-Do
  daraus anlegen"; markierter Text (sonst der Betreff) wird als Titel vorbelegt, das
  To-Do verweist per `source_activity` auf die Notiz. In der To-Do-Liste ein Link „aus
  Notiz vom …", in der Notiz ein Hinweis auf die daraus entstandenen To-Dos.
* Alles live für alle Nutzer, auch nach Reconnect; Speichern nur geänderter Felder.

**Besitzt:** `pocketbase/pb_migrations/1793190001_todos.js` (+ ggf. `…0002`),
`web/src/lib/todos/` (neu: Store für eine Pipeline und für einen Lead, `TodoList.svelte`,
`TodoForm.svelte`, `NextTodoBadge.svelte`, eigene `types.ts`)
**Darf ändern:** `web/src/lib/kanban/KanbanCard.svelte` (Badge einbinden),
`web/src/routes/leads/+page.svelte` (Store der offenen To-Dos starten und an das Board
reichen), `web/src/lib/kanban/ColumnDialog.svelte` (Schalter „Abgeschlossene Phase"),
`web/src/lib/board.svelte.ts` (nur `closed` in `addColumn`/`updateColumn` durchlassen),
`web/src/lib/kanban/KanbanBoard.svelte` und `KanbanColumn.svelte` nur zum
Durchreichen der Map — **Achtung:** `KanbanBoard.svelte` gehört auch F1; F1 und F7 deshalb
nicht gleichzeitig, oder F7 erst nach F1.
**Zentral vorab (erledigt in Welle 0):** in `web/src/lib/types.ts` ist `next_todo` im Typ
`CardField` und `closed?: boolean` in `BoardColumn` vorbereitet. **Ausnahme:** F7 ergänzt
selbst den Eintrag `{ key: 'next_todo', label: 'Nächstes To-Do' }` in `CARD_FIELDS` (erst
dann ist das Feld in den Pipeline-Einstellungen sichtbar).

**Integration danach:** F2 bindet `<TodoList>` als Kachel ein; F1 zeigt das nächste To-Do;
mit F3 der Button „To-Do daraus anlegen".

**Entscheidungen (geklärt)**
* Datum **mit optionaler Uhrzeit**.
* Zuständig ist **immer der Zuständige des Leads** (kein eigenes Feld, keine Delegation).
* Lead ohne offenes To-Do: **dezenter Hinweis**, nicht in abgeschlossenen Phasen.
* Übersicht „Meine To-Dos" → eigenes Feature **F8**.

---

## F8 – Übersicht „Meine To-Dos"

**Status:** in Arbeit (Welle 3) · **Abhängig von:** F7

* Eigene Seite in der Navigation: alle offenen To-Dos der Leads, für die ich zuständig bin,
  gruppiert nach **überfällig**, **heute**, **diese Woche**, **später**; umschaltbar auf
  „alle Nutzer".
* Abhaken direkt in der Liste; Klick auf den Lead öffnet die Schnellansicht (F1) bzw. die
  Detailseite (F2).
* Zähler in der Navigation (überfällig + heute).
* Später optional: tägliche E-Mail-Erinnerung (PocketBase-Cron-Hook, siehe
  `docs/pitfalls/pocketbase-hooks.md`) — **nicht Teil von Welle 3**.
* Performance: **eine** Live-Abfrage für alle offenen To-Dos (`liveSync()`, nach Board/Lead
  abonnieren statt `done = false`, siehe CLAUDE.md „Realtime-Filter"), Gruppierung im Client;
  der Zähler in der Navigation teilt sich diese Quelle, kein zweites Abo.

**Besitzt:** `web/src/routes/todos/` (neu), neue Dateien in `web/src/lib/todos/` (z. B.
`mine.svelte.ts`, `groups.ts`, `MyTodos*.svelte`, `NavCounter.svelte`, mit Tests),
`scripts/test-api-my-todos.mjs` (falls Rules geprüft werden)
**Darf ändern:** `web/src/routes/+layout.svelte` (Menüpunkt + Zähler),
`web/src/lib/kanban/LeadPreview.svelte` nur, falls sie außerhalb des Boards nutzbar gemacht
werden muss (Props, kein Umbau; sonst Link auf die Detailseite). Bestehende Dateien in
`lib/todos/` nur lesen bzw. unverändert wiederverwenden.

---

## F9 – Kontakt aus E-Mail-Adresse: Name und Unternehmen vorschlagen (Stufe 1)

**Status:** fertig (Welle 1) · **Abhängig von:** – · **Migration:** keine

**Ziel:** Beim Anlegen eines Kontakts genügt die E-Mail-Adresse. Vorname, Nachname und
Unternehmen werden sofort und rein deterministisch im Client **vorgeschlagen** — nichts
wird ohne Bestätigung angelegt.

**Regeln für die Vorschläge**
* **Name aus dem lokalen Teil:** `anna.mueller@`, `anna_mueller@`, `anna-mueller@` →
  Vorname „Anna", Nachname „Mueller"; Großschreibung je Namensteil; Doppelnamen
  (`hans-peter.schmidt@` → „Hans-Peter" / „Schmidt"); Ziffern am Ende ignorieren
  (`anna.mueller2@`).
* **Umlaute** nur als zusätzlicher Vorschlag (`mueller` → „Müller?" per Klick übernehmbar),
  weil nicht eindeutig (`Mueller` gibt es auch so).
* **Nicht eindeutig → kein Vorschlag:** `a.mueller@` → nur Nachname „Mueller";
  `annamueller@` → nichts (nicht trennbar); mehr als drei Teile → nichts.
* **Rollen-Adressen** (`info@`, `kontakt@`, `vertrieb@`, `sales@`, `office@`, `service@`,
  `support@`, `buchhaltung@`, `noreply@`, `no-reply@` …) → kein Name.
* **Unternehmen aus der Domain:** Domain (ohne `www.`) mit `companies.website` abgleichen →
  vorhandenes Unternehmen vorauswählen. Freemail-Domains (gmail, googlemail, gmx, web.de,
  outlook, hotmail, live, yahoo, t-online, icloud, me, aol, posteo, mailbox.org, freenet …)
  → kein Unternehmen.
* **Unbekannte Firmen-Domain** → Vorschlag „Neues Unternehmen anlegen: <Domain>" mit
  Website `https://<domain>` und einem aus der Domain abgeleiteten Namen
  (`mueller-maschinenbau.de` → „Mueller Maschinenbau"); Anlegen erst per Klick, über den
  bestehenden `CompanyDialog` (vorausgefüllt).

**Akzeptanzkriterien**
* Im `ContactDialog` steht die E-Mail als **erstes** Feld; Vorschläge erscheinen beim
  Verlassen des Feldes (oder nach kurzer Tipp-Pause) als übernehmbare Chips neben den
  Feldern. Bereits ausgefüllte Felder werden nie überschrieben.
* Funktioniert auch über „+ Neu" bei Kontakten im Lead-Dialog; ist dort schon ein
  Unternehmen gewählt, hat dieses Vorrang vor dem Domain-Vorschlag.
* Vorhandene Unternehmen werden erkannt, ein Unternehmen wird nie doppelt angelegt.
* Die Erkennung ist eine reine Funktion `suggestFromEmail(email, companies)` mit
  **Unit-Tests** für alle Muster oben (Vitest).

**Besitzt:** `web/src/lib/crm/email-suggest.ts` (neu), `web/src/lib/crm/email-suggest.test.ts` (neu)
**Darf ändern:** `web/src/lib/crm/ContactDialog.svelte`, `web/src/lib/crm/CompanyDialog.svelte`
(nur: Vorbelegung per Prop)
**Zentral vorab (nicht vom Agenten):** Vitest als devDependency und `test`-Skript in
`web/package.json`.

---

## F10 – Unternehmensdaten von der Website vorschlagen (Stufe 2)

**Status:** fertig (Welle 2; braucht `curl` auf dem Server, siehe README) · **Abhängig von:** F9 (nutzt dessen Domain-Erkennung und ändert
dieselben Dialoge — **nach F9** umsetzen) · **Migration:** keine

**Ziel:** Für eine unbekannte Firmen-Domain liest der Server die Website und das Impressum
und schlägt Firmenname, Adresse, Telefon und E-Mail vor.

**Umsetzung**
* PocketBase-Route `GET /api/crm/company-lookup?domain=<domain>` (Hook), nur für
  angemeldete Nutzer. Der Browser kann fremde Seiten wegen CORS nicht selbst laden.
* Ruft `https://<domain>/` ab und sucht das Impressum (Link mit Text „Impressum"/„Imprint",
  sonst `/impressum`, `/imprint`). Liest `og:site_name`, `<title>` und aus dem Impressum per
  Muster: Firmenname mit Rechtsform (GmbH, AG, KG, OHG, UG (haftungsbeschränkt), GmbH & Co.
  KG, e. K., e. V. …), Straße + PLZ + Ort, Telefon, E-Mail.
* Antwort: `{ name, address, phone, email, website, source }` mit leeren Feldern, wo nichts
  sicher erkannt wurde; Ergebnis pro Domain 24 h zwischenspeichern.
* Im Dialog: „Daten von <domain> laden" (bzw. automatisch nach F9-Erkennung einer
  unbekannten Domain) mit Ladeanzeige; Vorschläge feldweise übernehmbar.
* **Kein Google-Scraping** (Nutzungsbedingungen, wird geblockt); die Domain aus der E-Mail
  führt direkt zur Website. Falls später eine Suche nötig wird: offizielle Such-API oder
  Handelsregister-Daten (z. B. North Data) als eigenes Feature.

**Sicherheit (Pflicht)**
* Nur die übergebene Domain (gültiger Hostname, kein IP-Literal, kein `localhost`, keine
  internen Namen ohne Punkt, keine Ports), nur `https`, Weiterleitungen nur auf dieselbe
  Domain (bzw. `www.`), Timeout ≈ 5 s pro Abruf, Größenlimit ≈ 1 MB, höchstens 3 Abrufe pro
  Lookup. Sonst kann jeder Nutzer den Server interne Adressen abfragen lassen (SSRF).
* Rate-Limit pro Nutzer (z. B. 20 Lookups/Minute).
* Abgerufenes HTML nie ungefiltert anzeigen, nur extrahierte Textfelder.

**Akzeptanzkriterien**
* Für typische deutsche Firmenseiten mit Impressum werden Name mit Rechtsform und Adresse
  erkannt (mit 5 echten Beispiel-Domains im Abschlussbericht belegen).
* Nicht erreichbare oder blockierte Seiten → verständliche Meldung, Dialog bleibt nutzbar.
* Nichts wird automatisch angelegt.
* Vor dem Schreiben `docs/pitfalls/pocketbase-hooks.md` lesen (JS-VM: kein Modulscope im
  Callback, `res.body` ist ein Byte-Array, Neustart nach Hook-Änderung).

**Besitzt:** `pocketbase/pb_hooks/company-lookup.pb.js`, `pocketbase/pb_hooks/company-lookup-lib.js` (neu)
**Darf ändern:** `web/src/lib/crm/ContactDialog.svelte`, `web/src/lib/crm/CompanyDialog.svelte`

---

## F11 – KI-Extraktion von Unternehmensdaten (Stufe 3, Idee)

**Status:** Idee, nicht beauftragt · **Abhängig von:** F10

* Text von Startseite + Impressum an die Claude-API, strukturierte Antwort (Name,
  Rechtsform, Adresse, Branche, Kurzbeschreibung). Robuster als Muster bei ungewöhnlichen
  Seiten; Bruchteile eines Cents pro Abruf, API-Key nur auf dem Server.

---

## F12 – Bedingungen pro Phase (Stage Gates)

**Status:** in Arbeit (Welle 3) · **Abhängig von:** F7 (gleiche Dateien: `ColumnDialog`, `KanbanBoard`,
`KanbanCard`, `board.svelte.ts`) — **nach F7** umsetzen · **Migration reserviert:**
`1793190003_stage_requirements.js`

**Ziel:** Eine Phase kann Bedingungen haben, die erfüllt sein müssen, bevor ein Lead in
diese oder eine spätere Phase kommt. Beispiel: ab „Angebot" muss der Lead bei Siemens als
Lead geflaggt sein, mit dem Hinweis, wen man informieren muss. Allgemein und pro Phase
konfigurierbar.

**Entscheidungen (geklärt)**
* Eine Bedingung gilt **ab ihrer Phase**: für diese und alle späteren Phasen (nach `rank`).
  Wer Phasen überspringt (Neu → Verhandlung), muss alle Bedingungen dazwischen erfüllen.
* Arten: **Ja/Nein-Flag** und **Text** (z. B. Siemens-Lead-Nummer). Text gilt als erfüllt,
  wenn er nicht leer ist.
* „Personen informieren" ist ein **Hinweistext** an der Bedingung; das Abhaken bestätigt
  es. Keine automatischen E-Mails.
* **Zurücknehmen erlaubt**, mit Bestätigung; steht der Lead danach in einer Phase, deren
  Bedingung offen ist, zeigt die Karte ein Warnsymbol. Alles wird protokolliert.

**Datenmodell (Vorschlag)**
* `stage_requirements`: `column` (Relation → board_columns, Pflicht, cascade), `label`
  (Pflicht, z. B. „Bei Siemens als Lead geflaggt"), `type` (select: `flag`, `text`),
  `hint` (optional, z. B. „Vertriebsleitung und Siemens-Ansprechpartner informieren"),
  `rank` (Reihenfolge innerhalb der Phase), autodates.
* `lead_checks`: `lead` (Relation → leads, Pflicht, cascade), `requirement` (Relation →
  stage_requirements, Pflicht, cascade), `value` (text; bei `flag` `"true"`), `by`
  (Relation → users, per Rule `= @request.auth.id`), autodates. **Unique-Index**
  `(lead, requirement)`. Zurücknehmen = Datensatz löschen.
* `lead_check_events` (Protokoll, nur per Hook geschrieben, für Nutzer nur lesbar):
  `lead`, `requirement_label` (Kopie, damit es auch nach Löschen der Bedingung lesbar
  bleibt), `action` (`confirmed`, `changed`, `revoked`), `value`, `by`, `created`.

**Durchsetzung (Server, Pflicht)**
* Hook auf `leads` (Update mit geändertem `column`, und Create): Bedingungen aller Phasen
  desselben Boards mit `rank` ≤ Ziel-Phase sammeln; fehlt ein erfüllter `lead_check`,
  Abbruch mit `ValidationError` auf `column` und den offenen Bezeichnungen im Text. Vorher
  `docs/pitfalls/pocketbase-hooks.md` lesen (Rule läuft vor dem Hook, Feldfehler als
  `ValidationError`, kein Modulscope im Callback).
* **Neuer Lead direkt in einer Phase mit Bedingungen:** `lead_checks` brauchen eine
  vorhandene Lead-ID, der Create-Hook würde den Lead aber ablehnen. Deshalb eine Route
  `POST /api/crm/leads` (nur angemeldet), die Lead + Bestätigungen **in einer
  Transaktion** anlegt; der `LeadDialog` nutzt sie, wenn die Ziel-Phase Bedingungen hat.
* Hooks auf `lead_checks` schreiben die `lead_check_events`.
* Werden Bedingungen nachträglich hinzugefügt oder Phasen umsortiert, werden Leads, die
  schon dort stehen, **nicht** zurückgeschoben; ihre Karten zeigen das Warnsymbol.

**Bedienung**
* **Konfiguration im Phasen-Dialog:** Abschnitt „Bedingungen ab dieser Phase". Beim
  **Anlegen** einer Phase fragt der Dialog ausdrücklich: „Soll diese Phase Bedingungen
  haben?" (Ja → Liste aufklappen). Pro Bedingung: Bezeichnung, Art (Flag/Text), Hinweis;
  hinzufügen, bearbeiten, löschen, sortieren. Phasen mit Bedingungen tragen ein kleines
  Schloss-Symbol im Kopf.
* **Verschieben:** Lässt man einen Lead in eine Phase fallen, deren (kumulierte)
  Bedingungen offen sind, öffnet sich der Dialog „Bevor ‚<Lead>' nach ‚<Phase>' kann" mit
  den offenen Bedingungen (Checkbox bzw. Textfeld, Hinweis darunter). „Bestätigen und
  verschieben" speichert erst die Bestätigungen, dann den Move; „Abbrechen" lässt die Karte
  an ihrem Platz (kein optimistischer Move vor der Bestätigung). Erfüllte Bedingungen →
  Move wie bisher, ohne Dialog.
* Derselbe Dialog greift beim Phasenwechsel auf der Detailseite (F2) und beim Anlegen
  eines Leads in einer Phase mit Bedingungen.
* **Karte:** Warnsymbol mit Tooltip („Bedingung offen: …"), wenn der Lead in einer Phase
  steht, deren Bedingungen nicht alle erfüllt sind.
* **Detailseite (F2):** Kachel „Bedingungen" mit Status je Bedingung (wer, wann, Wert),
  Bearbeiten/Zurücknehmen (mit Warnung) und Protokoll.

**Performance:** keine Abfrage pro Karte. Das Board lädt `stage_requirements` der Pipeline
und alle `lead_checks` ihrer Leads mit je **einer** Abfrage (`liveSync()`), Auswertung im
Client als Map Lead → offene Bedingungen.

**Akzeptanzkriterien**
* Ohne erfüllte Bedingungen kommt ein Lead weder per Drag & Drop noch per API in die
  Phase oder eine spätere (API-Test mit HTTP: 400 mit verständlicher Meldung).
* Bestätigen, Ändern und Zurücknehmen sind protokolliert und für alle live sichtbar.
* Ein Lead mit erfüllten Bedingungen verschiebt sich ohne zusätzlichen Klick.

**Besitzt:** `pocketbase/pb_migrations/1793190003_stage_requirements.js`,
`pocketbase/pb_hooks/stage-gates.pb.js` + `stage-gates-lib.js`,
`web/src/lib/gates/` (neu: Store, `GateDialog.svelte`, `RequirementsEditor.svelte`,
`GateBadge.svelte`, eigene `types.ts`)
**Darf ändern:** `web/src/lib/kanban/ColumnDialog.svelte` (Abschnitt Bedingungen),
`web/src/lib/kanban/KanbanBoard.svelte` (vor `moveLead` den Gate-Dialog), `KanbanCard.svelte`
und `KanbanColumn.svelte` (Badge, Schloss), `web/src/lib/kanban/LeadDialog.svelte` (Anlegen
über die Route), `web/src/routes/leads/+page.svelte` (Stores starten),
`web/src/lib/board.svelte.ts` (Anlegen über die Route, Move erst nach dem Gate),
`web/src/routes/leads/[id]/+page.svelte` und `web/src/lib/lead/` (Kachel „Bedingungen",
Gate-Dialog beim Phasenwechsel), jeweils mit Tests; Seed `scripts/seed/40-gates.mjs`,
API-Tests `scripts/test-api-gates.mjs` (neu)

---

## F14 – Import aus HubSpot (CSV-Export)

**Status:** Idee · **Abhängig von:** F3 (Aktivitäten) · **Migration reserviert:**
`1793190005_hubspot_import.js` (falls Felder nötig)

**Ziel:** Bestehende Daten aus HubSpot einmalig übernehmen: Unternehmen, Kontakte, Deals
(→ Leads) und die Notizen der Deals, mit ihren Verknüpfungen.

**Entscheidungen (geklärt)**
* **Notizen ohne Datum** aus dem Deal-Export, mit Vermerk „aus HubSpot"; Meetings,
  E-Mails und Anrufe werden nicht übernommen.
* **HubSpot-Phasen werden eigene Pipeline-Phasen**; nur „Abgeschlossen und verloren" →
  „Verloren".
* **Einmalige Migration**, kein laufender Abgleich. Ein zweiter Lauf soll trotzdem keine
  Dubletten erzeugen (Abgleich über E-Mail bzw. Domain, siehe unten).
* **Nur Admins** dürfen importieren.

**Export-Format (geprüft an echten Exporten vom 2026-10-28)**
* Drei Dateien „alle Deals/Kontakte/Unternehmen": UTF-8 **ohne BOM**, CRLF, jedes Feld in
  `"…"`, Komma als Trenner. Spaltennamen **deutsch** (Kontosprache) und teils mit
  Leerzeichen am Ende (`"Für Kontakt zuständiger Mitarbeiter "`) → Kopfzeilen trimmen.
* IDs sind 11–12-stellige Zahlen (`Datensatz-ID`) — als String behandeln, nicht als Zahl.
* Zeitstempel `YYYY-MM-DD HH:MM` ohne Zeitzone (Kontozeit); leer = `""`.
* Werte nicht sauber: Leerzeichen am Ende (`"Dirk "`), Telefon mit führendem Leerzeichen
  (`" +4902451481539"`) → alle Werte trimmen; Telefonnummern sonst unverändert übernehmen.
* **Unternehmen:** `Datensatz-ID, Unternehmensname, Associated Contact, Erstellungsdatum,
  Für Unternehmen zuständiger Mitarbeiter, Telefonnummer, Datum der letzten Aktivität,
  Stadt, Associated Contact IDs`. Die **Kontakt-Zuordnung steht hier**: `Associated Contact
  IDs`, mehrere durch `;` getrennt. **Keine Domain/Website-Spalte**; Name kann **leer** sein.
* **Kontakte:** `Datensatz-ID, Vorname, Nachname, Jobbezeichnung, E-Mail, Telefonnummer,
  Für Kontakt zuständiger Mitarbeiter, Datum der letzten Aktivität, Erstellungsdatum`.
  **Keine Unternehmens-Spalte** (Zuordnung nur über die Unternehmens-Datei). Namen sind
  nicht eindeutig (zwei verschiedene „Christian Huber").
* **Deals:** den Export **mit allen Eigenschaften und Zuordnungen** verwenden (153 Spalten,
  `…-alle-deals-…-1.csv`); der schlanke Export (6 Spalten) hat keine Zuordnungen. Genutzt:
  `Datensatz-ID`, `Deal-Name`, `Deal-Phase`, `Abschlussdatum`, `Für Deal zuständiger
  Mitarbeiter` (Name, nicht E-Mail), `Associated Company IDs`, `Associated Contact IDs`
  (`;`-Listen), `Siemens Flag` (`Ja`/`Nein`/leer, Bezug zu F12). Kopfzeilen enthalten
  typografische Anführungszeichen (`„Erstellt von Benutzer“-ID`), Werte `""`-escapte
  Anführungszeichen. Nicht jeder Deal hat ein Unternehmen (2 von 24 ohne).
* Deal-Phasen im Export: Ersten Termin vereinbart · Ersten Termin abgeschlossen ·
  Folgeschritte definiert · Lead bei Mendix flaggen · Workshop durchgeführt · Abgeschlossen
  und verloren. Nur eine Pipeline („Deals-Pipeline").
* **Aktivitäten nur bruchstückhaft** im Deal-Export: `Associated Note` = Notiztexte als
  **reiner Text ohne Zeilenumbrüche, ohne Datum und Autor**, mehrere durch `;` getrennt —
  `;` steht aber auch *im* Text (1 Notiz → 8 Teile bei 1 ID). `Associated Meeting`/`Task`/
  `Call` nur Titel (fehlt der Titel, steht die ID da), `Associated Email` nur IDs.

**Zuordnung**
* Unternehmen → `companies`: Name, Telefon, `Stadt` → `address`. `website` aus den
  E-Mail-Domains der zugeordneten Kontakte ableiten (Freemail ausgenommen, Logik aus
  `email-suggest.ts` wiederverwenden). Leerer Name → Name aus der Domain wie bei F9
  (`spie-escad.de` → „Spie Escad"), im Probelauf markiert. Dublette = gleiche Domain,
  sonst gleicher Name.
* Kontakte → `contacts`: Vorname, Nachname, Jobbezeichnung → `position`, E-Mail, Telefon;
  `company` über `Associated Contact IDs` der Unternehmens-Datei. Dublette = gleiche E-Mail.
* Deals → `leads`: Deal-Name → `title`, Abschlussdatum (nur Datum) → `expected_close`,
  Zuständiger → `owner` über `users.name`, Deal-Phase → Pipeline-Phase (siehe
  Phasen unten), `company` aus `Associated Company IDs` (bei mehreren die
  `(Primary)`-Spalte), `contacts` aus `Associated Contact IDs`.
* Nicht übernommen: Zuständige bei Unternehmen/Kontakten (gibt es hier nicht), `Betrag`,
  Wahrscheinlichkeit, Deal-Typ, Priorität, `Erstellungsdatum`/`Datum der letzten
  Aktivität` (`created` ist ein autodate).
* Notizen → `activities` (`note`): Text am `;` nur trennen, wenn die Teile zur Zahl der
  `Associated Note IDs` passen, sonst als **eine** Notiz mit Hinweis im Probelauf.
  Betreff **„aus HubSpot"**; `occurred_at` (Pflicht) = Zeitpunkt des Imports, weil HubSpot
  kein Datum liefert; `author` = der importierende Admin bzw. ein fester Import-Nutzer.
  Dublette = gleicher Lead + gleicher Text.
* **Phasen:** jede HubSpot-Phase wird eine **eigene Pipeline-Phase** (gleicher Name,
  angelegt, falls noch nicht vorhanden); nur „Abgeschlossen und verloren" → vorhandene
  Phase „Verloren" (ebenso „Abgeschlossen und gewonnen" → „Gewonnen", falls es vorkommt).
  Neue Phasen kommen vor die abgeschlossenen Phasen, sortiert nach HubSpots
  `Dealwahrscheinlichkeit` (Ersten Termin vereinbart 0,1 → Ersten Termin abgeschlossen
  0,2 → Folgeschritte definiert / Lead bei Mendix flaggen 0,3 → Workshop durchgeführt
  0,5); Gleichstand in der Reihenfolge des Exports. Die vorhandenen Phasen bleiben;
  aufräumen und umsortieren danach von Hand im Board.
* **Entfallen:** Meetings, E-Mails und Anrufe (im Export nur Titel/IDs).
* Offene Aufgaben (`Associated Task`, nur Titel) → To-Dos (F7), sobald es sie gibt.

**Offene Punkte (vor Umsetzung klären)**
* `Siemens Flag` übernehmen, sobald F12 die Bedingungen hat (passt zur Phase „Lead bei
  Mendix flaggen")?
* Umsetzung als Admin-Skript (`scripts/import-hubspot.mjs`, Superuser, mit Probelauf
  `--dry-run`) oder als Seite in der App? Für eine einmalige Migration genügt das Skript.
* Anhänge von Notizen mit übernehmen?

**Akzeptanzkriterien (Entwurf)**
* Probelauf zeigt: wie viele Datensätze je Art angelegt/übersprungen werden, nicht
  zuordenbare Zeilen mit Grund (fehlende Phase, unbekannter Zuständiger, Kontakt-ID ohne
  Treffer, Unternehmen ohne Namen).
* Verknüpfungen bleiben erhalten; ein zweiter Lauf legt nichts doppelt an.
* Parser und Zuordnung als reine Funktionen mit Unit-Tests. **Echte Exporte enthalten
  personenbezogene Daten und kommen nicht ins Repo**; Test-CSVs mit erfundenen Werten im
  exakten Format oben (Kopfzeilen, Leerzeichen, `;`-Listen, leere Namen).

---

## F15 – MCP-Server für Agents

**Status:** Idee · **Abhängig von:** – (Kern); F7 für `my_todos` · **Migration reserviert:**
`1793190006_api_tokens.js`

**Ziel:** Mitarbeiter greifen mit ihren eigenen Agents (Claude Code, Claude Desktop u. a.)
auf das CRM zu: Leads nachschlagen, Verlauf zusammenfassen, Pipeline auswerten.

**Entscheidungen (geklärt)**
* **Anmeldung per persönlichem API-Token**, kein OAuth. Der Agent handelt immer **als
  dieser Nutzer**; es gelten dessen PocketBase-Rules.
* **Version 1 nur lesen.** Schreiben (Aktivität, To-Do, Kontakt, Lead anlegen) und **Leads
  verschieben** kommen in Version 2.
* **Löschen nie** über den MCP-Server.
* **Vorlagen (MCP-Prompts)** gehören dazu.

**Umsetzung (Vorschlag)**
* Eigener kleiner Node-Dienst `mcp/` mit dem offiziellen MCP-TypeScript-SDK, Streamable
  HTTP unter `/mcp`, hinter demselben Reverse-Proxy wie PocketBase; spricht über die
  REST-API mit PocketBase. (Ein PocketBase-Hook kann das SDK nicht laden.)
* **Token:** Collection `api_tokens` (`user`, `name`, `token_hash`, `last_used`, `created`;
  für Nutzer nur die eigenen sichtbar). Der Token wird einmal angezeigt, gespeichert wird
  nur der Hash. Eine Hook-Route tauscht den Token gegen ein kurzlebiges Auth-Token des
  Nutzers; der MCP-Dienst braucht so **keine Superuser-Zugangsdaten**. Verwaltung
  (anlegen, benennen, widerrufen) auf einer Profilseite.
* Antworten knapp halten: Aktivitäten als Text statt HTML, lange Inhalte gekürzt,
  Listen mit Limit und Seitenweise.

**Tools (Version 1, nur lesen)**
* `search` – Unternehmen, Kontakte, Leads nach Name/E-Mail/Domain.
* `get_lead` – Lead mit Phase, Zuständigem, Unternehmen, Kontakten, letzten Aktivitäten
  und offenen To-Dos.
* `get_company`, `get_contact` – inkl. zugehöriger Leads bzw. Kontakte.
* `list_pipeline` – Phasen mit ihren Leads (filterbar nach Zuständigem).
* `list_activities` – je Lead, filterbar nach Art und Zeitraum.
* `my_todos` – offene To-Dos, überfällig/heute/später (nach F7).

**Vorlagen (Prompts)**
* „Lead-Briefing vor einem Termin" – Stand, Verlauf, Ansprechpartner, offene Punkte.
* „Wochenbericht meiner Pipeline" – Bewegungen, neue Aktivitäten, Überfälliges.
* „Leads ohne nächsten Schritt / überfällig".
* „Meeting nachbereiten" – entwirft Notiz und To-Dos (Version 1 als Text zum Einfügen,
  ab Version 2 direkt speichern).

**Sicherheit**
* Aktivitäten enthalten fremden Text (eingefügte E-Mails) → möglicher Prompt-Injection-
  Kanal. Für Version 1 unkritisch (nur lesen); vor Version 2 Schreib-Tools klein und
  eindeutig halten, keine Massenänderungen pro Aufruf.
* Rate-Limit pro Token, Protokoll der Aufrufe (`last_used`, ab Version 2 wer was schrieb),
  Token widerrufbar.

**Akzeptanzkriterien (Entwurf)**
* Claude Code verbindet sich mit URL + Token und findet einen Lead per Name.
* Ein Nutzer sieht über den MCP-Server nichts, was er in der App nicht sieht;
  widerrufener oder falscher Token → 401.
* Integrationstests gegen Wegwerf-PocketBase (Token-Tausch, Rules), Unit-Tests für die
  Aufbereitung der Antworten.

---

## Umsetzungsplan: Wellen mit parallelen Sub-Agents

Grundidee: Innerhalb einer Welle fasst **keine Datei mehr als ein Agent** an. Was mehrere
Features berühren (Board-Dateien, `types.ts`, `package.json`, Doku), kommt entweder in eine
spätere Welle oder wird zentral vom Orchestrator (Haupt-Session) erledigt.

### Überschneidungen (Grund für die Wellen)

| Datei | F1 | F5 | F7+F4 | F12 | F9 | F10 | F2 | F8 |
|---|---|---|---|---|---|---|---|---|
| `kanban/KanbanBoard.svelte` | ✎ | | ✎ | ✎ | | | | |
| `kanban/KanbanCard.svelte`, `KanbanColumn.svelte` | | | ✎ | ✎ | | | | |
| `kanban/ColumnDialog.svelte` | | | ✎ | ✎ | | | | |
| `kanban/LeadDialog.svelte` | | ✎ | | ✎ | | | | |
| `board.svelte.ts`, `routes/leads/+page.svelte` | | ✎ | ✎ | ✎ | | | | |
| `crm/ContactDialog.svelte`, `CompanyDialog.svelte` | | | | | ✎ | ✎ | | |
| `kanban/LeadPreview.svelte` (F1) | ★ | | ✎ | | | | | |
| `routes/leads/[id]/` (F2) | | | ✎ | ✎ | | | ★ | |
| `routes/+layout.svelte` (Navigation) | | | | | | | | ✎ |

★ = legt die Datei an, ✎ = ändert sie. F3 (Aktivitäten) arbeitet nur in eigenen, neuen
Dateien; in Welle 2 ändert F7 dort nur `ActivityItem.svelte` (Button „To-Do daraus").

### Welle 0 – Vorbereitung (Orchestrator, nacheinander, klein)

1. **Pakete** installieren: `vitest` (+ `test`-Skript), `@tiptap/core`,
   `@tiptap/starter-kit`, `@tiptap/extension-link`, `dompurify`.
1b. **Test-Infrastruktur** (Regel aus CLAUDE.md: Tests immer mitentwickeln):
   * Vitest-Konfiguration für Runes-Dateien (`*.svelte.ts`) und ein gemeinsamer
     PocketBase-Mock (`web/src/lib/test/pb-mock.ts`: Collections, Realtime-Events,
     Fehlerantworten 400/404, ungültige Session).
   * `predev`: führt `vitest run` aus und zeigt das Ergebnis deutlich an, startet den
     Dev-Server aber auch bei Fehlern (man will sie ja beheben); `prebuild`: bricht bei
     roten Tests ab.
   * Integrationstest-Gerüst: startet eine Wegwerf-PocketBase (eigenes `--dir`, freier
     Port), wendet die Migrationen an, prüft API-Rules per HTTP; Skript `npm run test:api`.
   * **Tests für den bestehenden Code nachziehen:** `rank.ts`, `diff.ts`, Datums-Helfer in
     `types.ts`, `liveSync` (Puffer, Generationen, Reconnect, Session-Check),
     `LiveCollection` (Dedup, veraltete Antworten, `guard`), `BoardStore` (Move-Index,
     Self-Drop, Rollback, 404, Reconcile), Drop-Berechnung aus `KanbanBoard`
     (als reine Funktion herausziehen), `auth.refresh` (geteilter Request, 401/404);
     API: Gäste ohne Zugriff, keine Selbstregistrierung/Selbstlöschung, Löschsperren.
2. **`types.ts`** vorab: `CARD_FIELDS` + `next_todo`, `BoardColumn.closed`.
3. **Seed modular machen:** `scripts/seed-dev.mjs` lädt alle `scripts/seed/*.mjs`; jedes
   Feature legt seine Demo-Daten in eine **eigene** Datei (z. B. `seed/activities.mjs`).
4. **Parallele Umgebungen:** Skript `scripts/agent-env.sh <n>`, das in einem Worktree das
   PocketBase-Binary aus dem Haupt-Checkout kopiert, eigene `pb_data` anlegt (Migrationen
   + Seed) und Ports vergibt: PocketBase `810<n>`, Vite `518<n>` (Proxy-Ziel per
   Umgebungsvariable `PB_URL` statt fest `:8090`).
5. Alles committen; erst dann starten die Agents.

### Welle 1 – fünf Agents parallel (erledigt)

| Agent | Feature | Ports | Hinweis |
|---|---|---|---|
| A1 | **F1** Schnellansicht | 8101 / 5181 | zeigt noch kein To-Do, keine Aktivität |
| A2 | **F2** Detailseite | 8102 / 5182 | Platzhalter für Aktivitäten, To-Dos, Bedingungen |
| A3 | **F3** Aktivitäten | 8103 / 5183 | größtes Feature; Seed in `seed/activities.mjs` |
| A4 | **F5** Sammelposten | 8104 / 5184 | nur die 8 Punkte, keine neuen Features |
| A5 | **F9** Kontakt aus E-Mail | 8105 / 5185 | mit Vitest-Tests |

**Integration 1 (Orchestrator):** Branches nacheinander nach `main` mergen (F9 → F5 →
F3 → F2 → F1), nach jedem Merge `check` + `build`; danach `ActivityTimeline` in die
Detailseite einsetzen (kleine Änderung, eigener Review); Doku zusammenführen.

### Welle 2 – drei Agents parallel (erledigt)

Jeder Agent führt als **erstes** `git merge --ff-only main` in seinem Worktree aus (Worktrees
können von einem älteren Commit abzweigen, siehe `testen.md`).

| Agent | Feature | Hinweis |
|---|---|---|
| B1 | **F7 + F4** To-Dos, danach letzte Aktivität | ein Agent, weil beide `KanbanCard`, `LeadPreview` und die Board-Stores ändern; `source_activity` direkt in `1793190001_todos.js` (F3 ist da). Darf zusätzlich `LeadPreview.svelte` + `preview.ts`, `routes/leads/[id]/` (To-Do-Kachel statt Platzhalter) und `activities/ActivityItem.svelte` (Button „To-Do daraus") ändern |
| B2 | **F10** Website-Daten | nur Hook-Dateien + die beiden Dialoge |
| B3 | **F13a** Sammelposten 2, Teil a | siehe F13a; Ports 8103/5183 |

**Integration 2:** mergen, prüfen, Doku.

### Welle 3 – zwei Agents parallel (läuft)

| Agent | Feature | Hinweis |
|---|---|---|
| Agent | Feature | Ports | Hinweis |
|---|---|---|---|
| C1 | **F12** Bedingungen pro Phase | 8101 / 5181 | Board-Dateien, `board.svelte.ts`, `lead/` und Detailseite gehören allein C1 |
| C2 | **F8** Meine To-Dos | 8102 / 5182 | neue Route + Navigation in `+layout.svelte`; bestehende To-Do-Dateien nur lesen |

Keine gemeinsame Datei: C2 fasst weder Board- noch Lead-Dateien an, C1 weder `+layout.svelte`
noch `lib/todos/`.

**Integration 3:** mergen (F8 → F12), Gesamttest, Doku.

### Welle 4 – drei Agents parallel (nach Welle 3)

| Agent | Feature | Ports | Besitzt / darf ändern |
|---|---|---|---|
| D1 | **F13b** Sammelposten | 8101 / 5181 | die in F13b genannten Dateien (`board.svelte.ts`, `lead/`, `KanbanCard`, `LeadPreview`/`preview.ts`, `ActivityItem`, `editor.ts` + `activity-html.css`, `todos/lead.svelte.ts` + `due.ts`, Kontakt-/Unternehmens-Dialoge, Dialog-Wrapper für „Schließen"); Migration `1793190007_f13b.js` (z. B. `batch.enabled`) |
| D2 | **F14** HubSpot-Import | 8102 / 5182 | `scripts/import-hubspot.mjs`, `scripts/hubspot/` (Parser, Zuordnung, Tests mit erfundenen CSVs), Migration `1793190005_hubspot_import.js` (z. B. `hubspot_id` für zweiten Lauf ohne Dubletten), `scripts/test-api-hubspot.mjs`; **keine** Datei unter `web/` |
| D3 | **F15** MCP-Server v1 | 8103 / 5183 | `mcp/` (eigenes `package.json`, eigene Tests), Migration `1793190006_api_tokens.js`, Hook `api-tokens.pb.js` + `-lib.js` (Token-Tausch), `web/src/routes/profil/` + `web/src/lib/tokens/` (Token-Verwaltung), Menüpunkt in `+layout.svelte`, `scripts/test-api-tokens.mjs` |

* Warum erst nach Welle 3: F13b ändert Board-/Lead-Dateien von F12; F14 soll das `Siemens
  Flag` als F12-Bedingung übernehmen; F15 braucht `+layout.svelte`, das in Welle 3 F8 gehört.
* D1 fasst `+layout.svelte` nicht an, D2 nichts unter `web/`, D3 keine Board-/Lead-Dateien.
* **Vor dem Start von D2 klären** (offene Punkte in F14): `Siemens Flag` als Bedingung, Skript
  statt Seite, Anhänge der Notizen. Außerdem einen echten Export lokal bereitlegen (nicht im
  Repo) für den Probelauf.
* **Zentral (Orchestrator) bei Integration 4:** `mcp/`-Tests in `npm test`/`predev`
  einbinden, `README` (Import-Anleitung, MCP-Dienst hinter dem Reverse-Proxy), `CLAUDE.md`
  Struktur.

Nicht eingeplant: **F6** (Postfach-Anbindung, später), **F11** (KI, nicht beauftragt),
**F15 Version 2** (Schreib-Tools) und die E-Mail-Erinnerung aus F8.

### Ablauf pro Agent

1. Start mit `isolation: worktree` (eigener Branch `feature/F<n>-<name>`), Brief = der
   Feature-Abschnitt hier + die allgemeinen Regeln oben + die zugewiesenen Ports.
2. Umgebung: `scripts/agent-env.sh <n>`, `npm ci` im Worktree.
3. **Browser-Tests nicht über den Playwright-MCP** (ein gemeinsamer Browser, parallel
   belegt → „Browser is already in use"). Stattdessen `playwright-core` aus dem npx-Cache
   headless per Skript gegen die eigenen Ports (siehe `docs/pitfalls/testen.md`, „Ausweg").
4. Fertig = `check` + `build` grün, **neue Unit-Tests für die eigene Logik** (und bei
   Schema/Hooks Integrationstests) geschrieben und zusammen mit allen bestehenden Tests
   grün (`npm test`, ggf. `npm run test:api`), Akzeptanzkriterien geprüft;
   **noch nicht committen**, sondern Bericht: geänderte Dateien, Migrationen, Testnachweis,
   „Notizen für die Doku", offene Punkte.
5. **Review** (Orchestrator startet einen unabhängigen Reviewer nur mit der Anforderung,
   wie in CLAUDE.md). Findings gehen per Nachricht an denselben Agenten zurück.
   **Höchstens zwei Review-Runden**; danach verbleibende „minor"-Punkte in einen neuen
   Sammelposten (F13) statt weiterer Schleifen. Blockierendes wird immer behoben.
6. Bei grünem Review committet der Agent auf seinem Branch; der Orchestrator merged.

### Regeln gegen Reibung

* Datei nicht im „Besitzt/Darf ändern" des eigenen Features → **nicht anfassen**, sondern
  im Bericht als Bedarf melden.
* Keine Änderungen an `CLAUDE.md`, `README.md`, `types.ts`, `package.json`, Lockfile.
* Migrationen nur mit der reservierten Nummer; nie eine fremde Migration ändern.
* Nach einem Merge, der ein spätere Welle betrifft, starten deren Agents vom neuen `main`.
* Größe: Welle 1 = 5 Umsetzer + bis zu 5 Reviewer gleichzeitig; Wellen 2 und 3 je 2 + 2.
