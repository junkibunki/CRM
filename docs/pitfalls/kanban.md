# Leads-Pipeline (Kanban-Board)

Lesen, bevor du an `lib/board.svelte.ts`, `lib/kanban/`, `lib/live.ts` oder der
Reihenfolge von Phasen und Leads arbeitest. Das Datenmodell drumherum steht in
[datenmodell.md](datenmodell.md).

## Modell

`boards` → `board_columns` (Phasen; Relation `board`, cascade) → `leads` (Relation
`column`, cascade). Es gibt genau **ein** Board, die Pipeline „Leads"; die Migration legt
es samt Standard-Phasen an, Anlegen/Löschen von Boards ist per Rule gesperrt
(`createRule`/`deleteRule` = `null`). Die Leads-Seite nimmt das älteste Board.

Leads haben **kein** `board`-Feld; die Leads eines Boards holt der Filter
`column.board = {:id}` (Liste *und* Realtime-Subscription). Welche Felder eine Karte zeigt,
steht als JSON-Array in `boards.card_fields`. Im Code heißt der Datensatz `Lead`, das
UI-Element weiter „Karte" (`KanbanCard`, Drag-Typ `card`).

## Reihenfolge: `rank` (fractional-indexing)

* Ein Verschieben ist **ein** `update` (`column` + `rank`), kein Umnummerieren. Der neue
  Rank liegt zwischen den Nachbarn: `generateKeyBetween(prev, next)` (`lib/rank.ts`).
* **Sortiert wird per Code-Point-Vergleich** (`a < b`), nie mit `localeCompare` — nur der
  passt zu SQLites BINARY-Collation hinter `sort=rank`. Großbuchstaben liegen vor
  Kleinbuchstaben (`Zz` < `a0`).
* **Gleiche Ranks sind möglich** (zwei Personen legen gleichzeitig an derselben Stelle
  ab). Dann sortiert `id` als Tiebreak, und `generateKeyBetween` wirft beim nächsten
  Einfügen zwischen die beiden. `rankAt()` vergibt dann der ganzen Liste neue Ranks.
* **Keys wachsen.** Wer immer wieder an dieselbe Stelle einfügt, verlängert den Key alle
  paar Moves um ein Zeichen; das Schema erlaubt 100. `rankAt()` vergibt deshalb schon ab
  `MAX_RANK_LENGTH` (50) neue Ranks für die ganze Liste.
* Ranks nicht von Hand ausdenken, außer gültigen Keys (`a0`, `a1`, …); ein ungültiger
  Key lässt `generateKeyBetween` werfen.

## Laden und Realtime: `liveSync()` (`lib/live.ts`)

Der Board-Store, `LiveCollection` (Unternehmen, Kontakte) und alles Künftige mit Realtime
laufen darüber. Selbst nachbauen heißt, diese Fehler erneut zu machen:

* **Vor jedem Laden die Session prüfen** (`auth.refresh()`, mehrere gleichzeitige Aufrufe
  teilen sich einen Request): mit ungültigem Token käme sonst eine leere Gast-Antwort.
* **Abonnieren vor dem Laden, Events puffern, bis das Laden fertig ist**, dann in
  Reihenfolge nachspielen. Ohne Puffer geht eine Änderung verloren, die nach der
  Server-Abfrage, aber vor dem Zuweisen passiert: ihr Event trifft auf den leeren Zustand
  und wird vom (älteren) Ladeergebnis überschrieben.
* **Nach einem Reconnect neu laden** (`PB_CONNECT` ab der zweiten Verbindung, auch nach
  einem fehlgeschlagenen ersten Laden). Das SDK abonniert nach Standby, Netzabbruch oder
  dem Idle-Timeout selbst neu, verpasste Events holt es nicht.
* **Überlappende Ladevorgänge** (Verbindung flattert): nur der letzte gilt
  (Generationszähler); der Puffer bleibt, bis der letzte fertig ist.
* Der Board-Store **gleicht nach einem Reconnect ab** (`reconcile`), statt zu ersetzen:
  unveränderte Leads (`updated` gleich) behalten ihr Objekt — kein Re-Render, keine neue
  DnD-Registrierung, ein laufender Drag übersteht es.

## Store

* Phasen und *pro Phase* die Leads liegen sortiert in `$state`; Änderungen nur per
  `splice`/`insertSorted`. Ein Move fasst so genau zwei Listen an.
* Realtime-Events für eigene Änderungen kommen zurück; `onLead`/`onColumn` finden den
  Datensatz und gleichen nur Felder ab (Dedup für `create` steht in CLAUDE.md). Ob ein
  Lead umzieht, entscheidet die Liste, in der er *liegt*, nicht sein `column`-Feld.
* **Die Antwort eines `updateLead` wird nicht übernommen.** Der optimistische Stand hat
  unsere Werte schon, und eine neuere Änderung eines anderen kann per Realtime vor der
  Antwort eingetroffen sein. `column`/`rank` ändert nur die Move-Logik.
* **Rollbacks:** ein `404` heißt „von jemand anderem gelöscht" — dann lokal entfernen,
  nicht zurückrollen (sonst bleibt eine Geisterkarte). *Aber erst die Session prüfen*
  (`isGone()` ruft `auth.refresh()`): mit ungültigem Token antwortet PocketBase ebenfalls
  404, dann wird abgemeldet statt die Karte zu entfernen. Zurückgerollt wird nur, wenn der
  eigene Stand noch steht; hat ein Realtime-Event inzwischen umsortiert, gewinnt das.
* Neue Leads entstehen über den Dialog (`LeadDialog`), weil Unternehmen, Kontakt und
  Zuständiger Pflicht sind; `addLead` meldet per `boolean`, ob es geklappt hat, damit der
  Dialog bei einem Fehler offen bleibt. Bearbeiten ist optimistisch und schließt sofort.
* **Dialoge speichern nur geänderte Felder** (`changedFields()`, `lib/diff.ts`), verglichen
  mit dem Stand beim Öffnen. Das ganze Formular zu senden würde still überschreiben, was
  jemand anders inzwischen an *anderen* Feldern gespeichert hat. Gilt für alle Dialoge
  (Lead, Phase, Pipeline, Unternehmen, Kontakt); beim selben Feld gewinnt der Letzte.

## Drag & Drop (Pragmatic DnD)

* **Imports nur über den Bundler.** `@atlaskit/pragmatic-drag-and-drop/element/adapter`
  & Co. haben keine `exports`-Map; Node selbst meldet `Directory import … is not
  supported`. Vite löst sie über die `package.json` im Unterordner auf — für ein
  Node-Skript die `dist/cjs/…`-Pfade nehmen.
* **Ein Element, eine Drop-Target-Registrierung.** Deshalb ist die Phase (`<section>`)
  Ziel für *Phasen* und ihre Kartenliste (das innere `div`) Ziel für *Karten* in den
  leeren Bereich; die Karten selbst sind Ziel für Karten mit Kante oben/unten.
* `location.current.dropTargets[0]` ist das innerste Ziel: über einer Karte die Karte,
  sonst die Liste. Die Auswertung steht zentral im Monitor in `KanbanBoard.svelte`.
* **Die gezogene Karte ist selbst Drop-Ziel** (ohne Kantenlinie). Schließt man sie aus,
  ist beim Loslassen an der Ausgangsstelle die Liste darunter das innerste Ziel — die
  Karte wandert ans Spaltenende. So landet der Drop auf ihr selbst und `drop()` tut nichts.
* **Indizes zählen ohne das gezogene Element** (`moveLead(id, col, toIndex)`). Wer mit dem
  Index der vollen Liste rechnet, landet in derselben Phase eine Position zu weit unten.
* Die Drag-Daten lesen `lead.column` erst im Callback, nicht im `$effect` — sonst
  registriert jede Verschiebung die Karte neu.

## Performance (gemessen mit dem Vorgänger-Kartenmodell, Produktions-Build, 1000 Karten in einer Spalte)

Laden + Rendern ~270 ms (≈170 ms JS, ≈95 ms Layout/Paint), Netzwerk ~125 ms für 280 KB.
Ein Drag erzeugt einen Long Task von ~50 ms. Teuer waren `Intl`-Formatter pro Karte
(jetzt in `<script module>`). Wird eine Phase deutlich größer, ist der nächste Schritt
Virtualisierung pro Phase, nicht weiteres Mikro-Tuning.
