# PocketBase-Migrationen

Lesen, bevor du eine Migration in `pocketbase/pb_migrations/` anlegst oder änderst.

## API-Stand

* v0.23+: `migrate((app) => { … }, (app) => { … })`, Collections über
  `new Collection({ …, fields: [...] })`, gespeichert mit `app.save(collection)`.
* Das `id`-Feld explizit mitgeben (`system: true, primaryKey: true`) — es entsteht nicht
  automatisch.
* Relations brauchen eine `collectionId`. Zur Laufzeit holen
  (`app.findCollectionByNameOrId('users').id`), nicht hardcoden.
* `bool` kennt kein `default`. "Nicht gesetzt" ist `false`, das genügt.

## Fallstricke

**Migrationen laufen bei *jedem* Bootstrap**, auch bei `superuser upsert`, nicht nur bei
`serve`. Eine Migration darf deshalb nicht werfen, wenn das Erwartete fehlt: ein
`users.fields.getByName('x').y = …` auf ein nicht vorhandenes Feld nimmt die ganze App
mit runter statt nur die Migration. Erst holen, prüfen, dann setzen.

**Eine Migration mit kleinerer Nummer nachschieben ist unkritisch.** PocketBase führt
Buch pro Datei (Tabelle `_migrations`), nicht über einen Höchststand. Nur wenn zwei
Migrationen dasselbe Feld anfassen, muss man die Reihenfolge selbst durchdenken.

**`field.type` ist in der JS-VM eine Methode.** Symptom: eine Bedingung wie
`if (f.type === 'select')` ist still immer falsch, danach scheitert der Start mit
`fields: (…: Field type cannot be changed..)` oder `Duplicated or invalid field name`.
Richtig: `f.type() === 'select'`. Den Typ eines Feldes ändert PocketBase nie — umbenennen,
neues Feld (mit eigener `id`) daneben, per SQL umkopieren, altes entfernen.

**Ein Feld ändern statt anlegen:** `fields.getByName(…)` liefert eine echte Referenz,
keine Kopie — mutieren und `app.save(collection)` genügt. Der von PocketBase selbst
generierte `fields.addAt(index, new Field({…}))`-Stil braucht dagegen die volle Feld-JSON
inklusive `id` und die richtige Position.

**Die Werte eines `select`-Feldes ändern heißt auch: Bestandsdaten umschreiben.**
PocketBase prüft beim Speichern den *ganzen* Record, nicht nur die geschickten Felder —
ein Record mit einem Wert, der nicht mehr in `values` steht, ließe sich nicht mehr
speichern. Umschreiben in derselben Migration per
`app.db().newQuery('UPDATE …').execute()`.

**`migrate up` sagt „No new migrations to apply", *nachdem* es die Migration ausgeführt
hat.** Das Kommando bootstrappt die App, der Bootstrap führt die offenen Migrationen
selbst aus; die eigentliche Prüfung läuft danach und findet nichts mehr. Nachsehen, ob die
Änderung schon da ist.

**Ein `grep` in `pb_data/data.db` beweist nichts.** Frische Änderungen stehen im WAL
(`data.db-wal`). Zum Prüfen einen temporären Hook in `pb_hooks/` legen, der über `$app`
liest, und ihn hinterher löschen. Dabei lieferte
`$app.db().newQuery(…).all(arr, new DynamicModel(…))` still nichts;
`$app.findAllRecords('<collection>')` funktioniert.

**Ein Prüf-Hook in `onBootstrap` sieht eine *neue* Collection nicht.** Symptom:
`GoError: sql: no rows in result set` aus `findCollectionByNameOrId('…')`, obwohl die
Migration in derselben Sitzung lief — `onBootstrap` (auch nach `e.next()`) ist früher als
die Migrationen. Stattdessen eine temporäre Route registrieren
(`routerAdd('GET', '/zz-tmp-check', (e) => e.json(200, …))`) und per `fetch` abrufen.

**Eine neu angelegte Hook-Datei wird nicht eingelesen**, `touch` genügt auch nicht — der
Server muss neu starten. Erst die Datei schreiben, *dann* `serve`.

**Eine Migration erneut anwenden** heißt: mit `migrate down 1` zurücknehmen und beim
nächsten Start wieder hochlaufen lassen. `down` fragt interaktiv nach und braucht deshalb
ein `echo "y" |` davor, sonst bricht es mit „The command has been cancelled" ab.

## API-Rules

**Eine Mehrfach-Relation über `@collection` braucht `.id`.** Symptom: die Rule speichert
ohne Fehler, greift aber nie — `expand` bleibt leer, der Einzelabruf liefert 404.
`@collection.x.multi_rel ?= id` (Relation mit `maxSelect` > 1) trifft nicht;
`@collection.x.multi_rel.id ?= id` (oder `multi_rel:each ?= id`) schon. Bei einer
Einfach-Relation genügt das Feld allein.

`expand` kommt leer zurück, wenn die View-Rule der Zielcollection zumacht — Details in
[Realtime / PocketBase-SDK](../../CLAUDE.md#realtime--pocketbase-sdk). Für `users` muss
eine Migration View- und ListRule öffnen, sobald Namen anderer Nutzer angezeigt werden
(z. B. „zuständig") — sonst liefert `getFullList('users')` nur den eigenen Datensatz.
