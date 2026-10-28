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
* Live-Daten immer über `liveSync()` / `LiveCollection`, Dialoge speichern nur geänderte
  Felder (`changedFields()`).
* Fertig heißt: `npm run check` und `npm run build` grün, im Browser selbst geprüft
  (Playwright-MCP, Dev-Login aus `scripts/seed-dev.mjs`), Akzeptanzkriterien erfüllt.
  Committet wird erst nach dem unabhängigen Review aus CLAUDE.md.

Status: `offen` → `in Arbeit` → `Review` → `fertig`.

---

## F1 – Lead-Schnellansicht (Pop-up beim Klick auf eine Karte)

**Status:** offen · **Abhängig von:** – (die Anzeige der letzten Aktivität kommt mit F4)

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

**Status:** offen · **Abhängig von:** F3 nur für die Aktivitäten-Kachel (siehe Schnittstelle)

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

**Status:** offen · **Abhängig von:** – · **Migration reserviert:** `1793190000_activities.js`

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
**Darf ändern:** `scripts/seed-dev.mjs` (Demo-Aktivitäten anhängen, am Ende der Datei)

---

## F4 – Letzte Aktivität auf Karte und Schnellansicht (Folge-Feature)

**Status:** offen · **Abhängig von:** F1, F3

* Schnellansicht (F1) zeigt die letzte Aktivität (Art, Datum, erste Zeile).
* Optional auf der Karte: Datum der letzten Aktivität („vor 3 Tagen"), konfigurierbar
  über die Kartenfelder der Pipeline.
* Muss performant bleiben: nicht pro Karte eine Anfrage (z. B. View-Collection oder ein
  Feld `last_activity_at` am Lead, das ein Hook pflegt).

---

---

## F5 – Kleinere Punkte aus den Reviews (Sammelposten)

**Status:** offen · Hier landen „minor"-Findings, die nicht vor einem Commit behoben
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

## F6 – E-Mail-Anbindung (später)

**Status:** Idee · E-Mails automatisch aus dem Postfach (Outlook/IMAP) als Aktivitäten
übernehmen; Zuordnung Mail → Lead über die Kontakt-Adressen. Bis dahin: manuell (F3).

---

## F7 – To-Dos pro Lead, nächstes To-Do auf der Karte

**Status:** offen · **Abhängig von:** – (Kern); F2 und F3 für die Einbindung (siehe unten)
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
`source_activity` gibt es erst mit F3; liegt F3 bei Umsetzung noch nicht vor, das Feld in
einer eigenen Migration nachziehen (Nummer `1793190002_todos_source.js` reserviert).

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
**Zentral vorab (nicht vom Agenten):** in `web/src/lib/types.ts` `CARD_FIELDS` um
`next_todo` und `BoardColumn` um `closed: boolean` ergänzen.

**Integration danach:** F2 bindet `<TodoList>` als Kachel ein; F1 zeigt das nächste To-Do;
mit F3 der Button „To-Do daraus anlegen".

**Entscheidungen (geklärt)**
* Datum **mit optionaler Uhrzeit**.
* Zuständig ist **immer der Zuständige des Leads** (kein eigenes Feld, keine Delegation).
* Lead ohne offenes To-Do: **dezenter Hinweis**, nicht in abgeschlossenen Phasen.
* Übersicht „Meine To-Dos" → eigenes Feature **F8**.

---

## F8 – Übersicht „Meine To-Dos"

**Status:** Idee · **Abhängig von:** F7

* Eigene Seite in der Navigation: alle offenen To-Dos der Leads, für die ich zuständig bin,
  gruppiert nach **überfällig**, **heute**, **diese Woche**, **später**; umschaltbar auf
  „alle Nutzer".
* Abhaken direkt in der Liste; Klick auf den Lead öffnet die Schnellansicht (F1) bzw. die
  Detailseite (F2).
* Zähler in der Navigation (überfällig + heute).
* Später optional: tägliche E-Mail-Erinnerung (PocketBase-Cron-Hook, siehe
  `docs/pitfalls/pocketbase-hooks.md`).

---

## F9 – Kontakt aus E-Mail-Adresse anlegen (Vorschläge für Name und Unternehmen)

**Status:** Idee · **Abhängig von:** – · Stufen einzeln umsetzbar

**Ziel:** Beim Anlegen eines Kontakts genügt die E-Mail-Adresse; Vorname, Nachname und
Unternehmen werden **vorgeschlagen** (nicht stumm angelegt), der Nutzer bestätigt oder
korrigiert.

**Stufe 1 – deterministisch, im Client (klein)**
* Name aus dem lokalen Teil: `anna.mueller@`, `anna_mueller@`, `anna-mueller@` →
  „Anna" / „Mueller"; Großschreibung, Doppelnamen (`hans-peter.schmidt`). Umlaute nur als
  Vorschlag (`mueller` → „Müller?"), weil nicht eindeutig. `a.mueller@` → nur Nachname;
  `annamueller@` → kein Vorschlag (nicht trennbar).
* Rollen-Adressen (`info@`, `vertrieb@`, `kontakt@`, `office@`, `noreply@` …) → kein Name.
* Domain → **vorhandenes Unternehmen** vorauswählen (Abgleich mit `companies.website`,
  ohne `www.`). Freemail-Domains (gmail, gmx, web.de, outlook, t-online, icloud …) → kein
  Unternehmen.
* Unbekannte Firmen-Domain → Vorschlag „Neues Unternehmen: <domain>" mit Website.

**Stufe 2 – Website lesen, serverseitig (mittel)**
* Neue Route als PocketBase-Hook (Browser kann fremde Seiten wegen CORS nicht laden):
  ruft `https://<domain>` und `/impressum` ab, liest `og:site_name`, `<title>`, und aus dem
  Impressum per Muster Firmenname mit Rechtsform (GmbH, AG, KG, UG …), Adresse, Telefon.
  Vorschlag im Dialog, Übernahme per Klick.
* **Kein Google-Scraping:** verstößt gegen die Nutzungsbedingungen und wird geblockt; die
  Domain aus der E-Mail führt ohnehin direkt zur Website. Falls eine Suche nötig wird: eine
  offizielle Such-API (kostenpflichtig) oder Handelsregister-Daten (z. B. North Data, API).
* **Sicherheit (Pflicht):** die Route darf nur die Domain aus der E-Mail abrufen, nur
  `https`, keine IP-Literale, kein `localhost`/interne Namen, kurze Timeouts, Größenlimit
  (z. B. 1 MB), keine Weiterleitung auf andere Hosts — sonst kann jeder Nutzer den Server
  interne Adressen abfragen lassen (SSRF). Hook-Fallstricke: `docs/pitfalls/pocketbase-hooks.md`.

**Stufe 3 – KI-Extraktion (optional, klein)**
* Text von Startseite + Impressum an die Claude-API, strukturierte Antwort (Name,
  Rechtsform, Adresse, Branche, Kurzbeschreibung). Robuster als Regex bei ungewöhnlichen
  Seiten; kostet Bruchteile eines Cents pro Abruf, braucht einen API-Key auf dem Server.

**Akzeptanzkriterien**
* E-Mail eingeben → Vorschläge erscheinen sofort (Stufe 1) bzw. nach kurzer Zeit mit
  Ladeanzeige (Stufe 2/3); nichts wird ohne Bestätigung angelegt.
* Vorhandene Unternehmen werden erkannt, nie doppelt angelegt (Domain-Abgleich).
* Auch im Lead-Dialog („+ Neu" bei Kontakten) nutzbar.

**Besitzt:** `web/src/lib/crm/email-suggest.ts` (neu, Stufe 1, mit Unit-Tests der
Muster), `pocketbase/pb_hooks/company-lookup.pb.js` + `company-lookup-lib.js` (Stufe 2/3)
**Darf ändern:** `web/src/lib/crm/ContactDialog.svelte`, `web/src/lib/crm/CompanyDialog.svelte`

---

## Reihenfolge / Parallelisierung

* **Parallel startbar:** F1, F2, F3 (disjunkte Dateien; F2 nutzt bis F3 fertig ist einen
  Platzhalter).
* **F7** kann parallel zu F2 und F3 laufen, aber **nach F1** (beide ändern
  `KanbanBoard.svelte`).
* **Danach:** Integration F2 + F3 + F7 (Platzhalter durch `ActivityTimeline` und
  `TodoList` ersetzen, „To-Do aus Notiz"), dann F4.
* Nach jedem Feature: zentrale Doku-Zusammenführung (CLAUDE.md-Struktur, Pitfalls).
