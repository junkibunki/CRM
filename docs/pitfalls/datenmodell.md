# Datenmodell: Unternehmen, Kontakte, Leads

Lesen, bevor du eine Collection, Relation oder Lösch-Logik änderst oder eine neue
Seite mit Live-Daten baust.

## Collections (`pocketbase/pb_migrations/1793180000_crm.js`)

| Collection | Wichtige Felder | Relationen |
|---|---|---|
| `companies` | `name`* , `website`, `email`, `phone`, `address`, `notes` | – |
| `contacts` | `last_name`*, `first_name`, `position`, `email`, `phone`, `notes` | `company` → companies (optional) |
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
* `users` ist ebenfalls eine `LiveCollection` (Namen für „Zuständig"): Umbenennungen und
  neue Konten erscheinen ohne Reload, und eine leere Gast-Antwort bleibt nicht hängen.

## Formulare

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
