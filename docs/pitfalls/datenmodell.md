# Datenmodell: Unternehmen, Kontakte, Leads

Lesen, bevor du eine Collection, Relation oder Lösch-Logik änderst oder eine neue
Seite mit Live-Daten baust.

## Collections (`pocketbase/pb_migrations/1793180000_crm.js`)

| Collection | Wichtige Felder | Relationen |
|---|---|---|
| `companies` | `name`* , `website`, `email`, `phone`, `address`, `notes` | – |
| `contacts` | `last_name`*, `first_name`, `position`, `email`, `phone`, `notes` | `company` → companies (optional) |
| `activities` | `type`* (`note`, `meeting`, `email_in`, `email_out`), `body`* (HTML, ≤ 1 MB), `occurred_at`*, `subject`, `attachments` (≤ 10 × 20 MB, **protected**) | `lead`* → leads (cascade), `contacts` → contacts, `author`* → users |
| `todos` | `title`*, `due`*, `due_has_time`, `done`, `done_at` | `lead`* → leads (cascade), `source_activity` → activities (ohne cascade), `created_by`* → users |
| `lead_last_activity` | View: je Lead die letzte Aktivität (Art, Zeitpunkt, Auszug) | nur lesbar, keine Realtime-Events |
| `stage_requirements` | `label`*, `type`* (`flag`, `text`), `hint`, `rank` | `column`* → board_columns (cascade, unveränderlich) |
| `lead_checks` | `value` (bei `flag` `"true"`, Text getrimmt) · Unique (`lead`, `requirement`) | `lead`* → leads (cascade), `requirement`* → stage_requirements (cascade), `by` → users |
| `lead_check_events` | Protokoll, nur per Hook: `action` (`confirmed`, `changed`, `revoked`), `value`, `requirement_label` (Kopie) | `lead`* (cascade), `requirement` (wird geleert), `by` |
| `api_tokens` | `name`, `token_hash` + `key_check` (*hidden*, nur sha256), `last_used` · anlegen nur per Route | `user`* → users (cascade); nur eigene sichtbar, nur `name` änderbar |
| `leads` | `title`*, `expected_close` (optional), `rank`* | `company`* → companies, `contacts`* → contacts (1–50), `owner`* → users, `column`* → board_columns |

`*` = Pflicht. `created`/`updated` sind `autodate`-Felder; das Erstellungsdatum eines
Leads ist `created`. Regeln: jeder angemeldete Nutzer darf alles (keine Rollen), außer
Boards anlegen/löschen. `users` ist für Angemeldete les- und listbar (Namen für
„Zuständig"); E-Mails bleiben verborgen, solange `emailVisibility` aus ist — danach
filtern kann ein normaler Nutzer deshalb auch nicht. Konten legt nur ein Superuser an
und löscht nur ein Superuser (`createRule`/`deleteRule` = `null`); das eigene Profil
darf jeder bearbeiten. Ein Konto, das noch Leads als Zuständiger hat, lässt sich auch als
Superuser nicht löschen (`leads.owner` ist Pflicht): erst die Leads umhängen. Zum
Sperren eines Mitarbeiters genügt es, sein Passwort zu ändern.

## Löschen (nachgemessen gegen PocketBase 0.40.6)

* **Unternehmen mit Leads:** Löschen schlägt mit `400` fehl („… part of a required
  relation reference"), weil `leads.company` Pflicht ist und nicht kaskadiert.
  `deleteErrorMessage()` macht daraus eine verständliche Meldung.
* **Unternehmen mit Kontakten (ohne Leads):** geht; die Kontakte bleiben, ihr `company`
  wird leer.
* **Kontakt, der einer von mehreren eines Leads ist:** geht; PocketBase nimmt ihn aus
  `leads.contacts` heraus.
* **Kontakt, der der einzige eines Leads ist:** `400` wie oben.
* **Phase löschen** löscht ihre Leads mit (cascade); der Dialog sagt, wie viele.
* **Lead löschen** löscht seine Aktivitäten und To-Dos mit (cascade). Eine gelöschte Notiz
  lässt ihre To-Dos stehen und leert `source_activity`. Konten mit To-Dos (`created_by`)
  lassen sich nicht löschen.
* **Kontakt löschen** entfernt ihn auch aus `activities.contacts`.
* **Konten mit Aktivitäten** lassen sich (wie bei `leads.owner`) nicht löschen:
  `activities.author` ist Pflicht ohne cascade.

## Rule-Muster

* **Feld beim Anlegen erzwingen:** `@request.body.author = @request.auth.id`.
* **Feld unveränderlich:** `@request.body.author:isset = false || @request.body.author = author`.
  PocketBase normalisiert Modifier (`author+`, `+author`) vor der Rule; Fälschungsversuche
  darüber wurden im Review geprüft und abgewiesen.
* `lead` und `author` einer Aktivität sind unveränderlich (Muster oben). `+lead` passiert die
  Rule bei einer Einfach-Relation, PocketBase behält aber den alten Wert.
* **Feld nur durch Hook:** `activities.attachment_names` (gespeicherter → Original-Name) schreibt
  nur der Hook; Create/Update-Rules enthalten `@request.body.attachment_names:isset = false`.
* **Relation im Request-Body folgen:** `@request.body.source_activity.lead = @request.body.lead`
  (eine To-Do-Quelle muss zum selben Lead gehören) funktioniert in 0.40.
* `board_columns.closed`: abgeschlossene Phase (Gewonnen/Verloren), dort kein Hinweis
  „Kein nächster Schritt".
* **Bedingungen (F12):** gelten kumuliert nach `rank` für die eigene und alle späteren Phasen
  desselben Boards; Durchsetzung im Hook `stage-gates` (auch für Superuser), Auswertung im
  Client identisch (`lib/gates/evaluate.ts` ↔ `stage-gates-lib.js`, gemeinsame Testfälle).
  `board_columns.gates_exempt` (Standard: „Verloren"): dort gilt nichts, die Phase bekommt keine
  neuen Bedingungen (Rule), ihre alten zählen aber **für spätere Phasen weiter**.
  `lead_checks.by` ist optional, weil Superuser (Admin-UI, Import) keine `users` sind; für
  Nutzer erzwingt die Rule `by = @request.auth.id`.
* **Hidden-Felder im Body eines Nutzers werden still verworfen** (200, nichts ändert sich),
  bevor die Rule sie sieht — `@request.body.x:isset = false` greift dort nie. Prüfen über die
  Superuser-Ansicht, nicht über den Statuscode.
* **Update-Rule verletzt → 404, nicht 400/403.** Symptom: PATCH mit falschem `by` liefert „The
  requested resource wasn't found". PocketBase wendet die Update-Rule als Filter an; API-Tests
  erwarten 404.
* `users.name` ist Pflicht (Pattern `\S`); Konten ohne Namen hat die Migration mit „Ohne Namen
  (abc123)" gefüllt, sonst schlüge jedes spätere Speichern (z. B. Passwort-Reset) fehl.

## Daten im Client: `LiveCollection` (`lib/collection.svelte.ts`)

* `companies` und `contacts` liegen **komplett** im Speicher und live (wenige hundert bis
  einige tausend kleine Datensätze). Listen-Seiten, Picker im Lead-Dialog und die Namen
  auf den Lead-Karten lesen alle daraus — kein `expand`, und eine Umbenennung erscheint
  überall gleichzeitig.
* **Ref-gezählt:** jede Komponente, die die Daten braucht, ruft `$effect(() => x.use())`.
  Realtime läuft, solange mindestens eine sie braucht; beim Abmelden verschwinden die
  Seiten, und die letzte Teardown-Funktion (Rückgabe von `use()`) beendet das Abo.
* `create`/`update`/`delete` warten auf den Server (nicht optimistisch) und gleichen das
  Ergebnis sofort in die Liste ab; das eigene Realtime-Event danach ist dedupliziert.
* Sortierung deutsch (`localeCompare('de')`), nicht per `sort=` des Servers — der sortiert
  binär (`Ä` nach `Z`).
* Nutzer ohne Namen erscheinen als „Ohne Namen (abc123)" (ID-Anfang), damit man zwei
  unterscheiden und das Konto im Dashboard finden kann.
* `users` ist ebenfalls eine `LiveCollection` (Namen für „Zuständig"): Umbenennungen und
  neue Konten erscheinen ohne Reload, und eine leere Gast-Antwort bleibt nicht hängen.

## Formulare

* **Kontakte eines Leads als Differenz speichern:** Board und Detailseite senden
  `contacts+` / `contacts-` (gegen den Stand beim Öffnen des Dialogs). PocketBase hängt ohne
  Duplikate an und ignoriert unbekannte IDs in `-`; alle entfernen ergibt 400
  `validation_required`. Nur die Reihenfolge geändert: nichts wird gesendet.
* **Nur geänderte Felder speichern** (`changedFields()` gegen den Stand beim Öffnen),
  sonst überschreibt ein Dialog still, was jemand anders inzwischen gespeichert hat.
* `LiveCollection.update` übernimmt die Server-Antwort nur, wenn sie nicht älter ist als
  der lokale Stand (`updated`): ein neueres Realtime-Event eines anderen gewinnt.
* Pflichtfelder eines Leads prüft der Dialog selbst (`validate()`), bevor er sendet; die
  Server-Regeln sind die zweite Linie.
* Feldfehler des Servers stecken in `err.response.data` (`{feld: {code, message}}`);
  `errorMessage()` setzt sie zusammen, `err.message` allein ist nur „Failed to create
  record.".
* Datum: PocketBase speichert `YYYY-MM-DD HH:MM:SS.sssZ`, `<input type="date">` will
  `YYYY-MM-DD` — immer über `toDateInput`/`fromDateInput` (`lib/types.ts`).
