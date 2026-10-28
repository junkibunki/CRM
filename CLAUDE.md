# CLAUDE.md — CRM

Notizen für zukünftige Sessions. Ergänzt das [README](README.md) (das erklärt Setup und
Deploy für Menschen); hier steht, was beim Arbeiten am Code stolpert.

## Workflow

### Review vor jedem Commit

* **Vor dem Committen muss ein unabhängiger Subagent ohne Vorwissen das Entwickelte
  reviewen.**
* Der Agent bekommt **nur eine kurze Einleitung zur Anforderung an das Feature** — nicht,
  was umgesetzt wurde, nicht welche Dateien betroffen sind, keine Begründungen. Er soll
  unvoreingenommen gegen die Anforderung prüfen, nicht die eigene Erzählung bestätigen.
* Er soll keine UI-Tests durchführen. Reine UI-Änderungen kann der Nutzer selbst testen,
  das spart Token.
* **Nur committen, wenn der Agent grünes Licht gibt.** Bei Findings: erst beheben.

**Nach dem Beheben ist ein zweites Review nicht automatisch fällig** — entscheide nach dem
Umfang der Korrektur, nicht nach der Zahl der Findings:

* **Klein → direkt committen.** Die Korrektur blieb im schon geprüften Code, hat keinen
  neuen Ablaufpfad geschaffen und nichts angefasst, was außerhalb liegt: eine
  Bedingung gedreht, einen Fehlerfall ergänzt, umbenannt, Text- und Layoutkram, eine
  vergessene `expand`-Option.
* **Groß → erneut reviewen.** Sobald die Korrektur eine neue Ablauflogik einführt, weitere
  Dateien mitzieht, Schema/Migration/API-Rules berührt, an Auth, Import oder dem
  MCP-Server dreht, oder wenn du beim Beheben gemerkt hast, dass der Ansatz selbst nicht
  stimmte. Dann sieht der zweite Agent faktisch neuen Code — der war noch nie geprüft.
* Im Zweifel reviewen. Ein zweiter Durchlauf kostet weniger als ein Fehler, der über
  `main` auf den VPS geht.

### Tests: immer mitentwickeln

* **Jede Änderung bringt ihre Unit-Tests mit** (Vitest, `*.test.ts` neben der Datei). Ohne
  Tests ist ein Feature nicht fertig; der Reviewer prüft das mit.
* Getestet wird vor allem Logik: reine Funktionen (Rank, Diff, Datums-/Fälligkeitsregeln,
  E-Mail-Erkennung), Stores (`BoardStore`, `LiveCollection`, `liveSync`) mit gemocktem
  PocketBase-Client, Realtime-Merge, Rollback und Fehlerpfade. Ein behobener Bug bekommt
  einen Test, der ihn ohne die Korrektur zeigt.
* API-Regeln, Migrationen und Hooks: Integrationstests gegen eine **Wegwerf-PocketBase**
  (eigenes `--dir`, eigener Port), nie gegen `pocketbase/pb_data`.
* **`npm run dev` führt vorher die Unit-Tests aus** und zeigt das Ergebnis an, damit beim
  Starten sichtbar ist, ob alles noch funktioniert. `npm run build` bricht bei roten Tests
  ab. Vor jedem Commit: `npm test` grün, bei Schema/Rules/Hooks zusätzlich
  `npm run test:api` (beides aus `web/`). `auth.refresh(maxAge)` darf eine wenige Sekunden
  alte erfolgreiche Prüfung desselben Tokens wiederverwenden; `liveSync` tut das nur fürs
  erste Laden (5 s), damit eine Seite mit mehreren Live-Quellen nicht mehrfach fragt.
* Werkzeuge: `web/src/lib/test/pb-mock.ts` (PocketBase-Client im Speicher: Realtime-Events,
  Reconnect, Fehler, angehaltene Requests, ungültige Session) und `scripts/test-api.mjs`
  (Wegwerf-PocketBase). Beispiele: `board.test.ts`, `live.test.ts`. Fallstricke in
  [testen.md](docs/pitfalls/testen.md#unit-tests).

### Pitfalls dokumentieren

**Wann.** Wenn dich bei der Entwicklung etwas Zeit gekostet hat, weil es nicht
offensichtlich war: eine Fehlermeldung, die in die Irre führt, eine API, die sich anders
verhält als erwartet, ein Tool-/Umgebungsproblem, das wie ein Bug im Code aussieht.
Kein Pitfall ist: was der Code oder die git-History ohnehin schon zeigt.

**Wohin.** In dieser Reihenfolge prüfen:

1. Gehört er zu einem Thema der Tabelle unten → in *diese* Datei, in den passenden
   Abschnitt. Nicht ans Ende hängen.
2. Betrifft er Svelte-Runes oder das PocketBase-SDK/Realtime → in die entsprechende Liste
   hier in CLAUDE.md. Das sind die einzigen zwei Themen, die dauerhaft im Kontext bleiben.
3. Sonst: **neue Datei unter `docs/pitfalls/`**, benannt nach dem Thema, mit einer
   Kopfzeile „Lesen, bevor du …" — und **eine neue Zeile in der Tabelle unten**. Ohne den
   Tabelleneintrag findet die Datei nie jemand.

Ein neues Thema anzulegen ist der Normalfall, nicht die Ausnahme: lieber eine sechste
kurze Datei als ein siebter Absatz in einer fremden.

**Wie.** Kurz, im Stil der vorhandenen Einträge:

* **Symptom zuerst** (die Fehlermeldung oder das beobachtete Verhalten wörtlich), dann
  **Ursache**, dann die Lösung. Beim nächsten Mal erkennt man den Fall am Symptom wieder —
  deshalb steht es vorn.
* **Ein Absatz oder ein Listenpunkt, Richtwert 3–8 Zeilen.** Kein Verlaufsprotokoll der
  Fehlersuche, keine Begründung, warum man erst woanders gesucht hat.
* Messwerte nur, wenn sie das Erkennen tragen, nicht als Beleg dafür, dass gemessen wurde.
* Wird ein Abschnitt beim Ergänzen länger als ~80 Zeilen, teile ihn auf, statt ihn wachsen
  zu lassen. Diese Datei soll unter ~200 Zeilen bleiben.

## Vertiefung: erst lesen, wenn das Thema dran ist

Diese Dateien sind bewusst *nicht* in diese Datei eingebunden (auch nicht per `@import`),
damit sie nur Kontext kosten, wenn sie gebraucht werden.

| Datei | Lesen, bevor du … |
|---|---|
| [migrationen.md](docs/pitfalls/migrationen.md) | eine Migration in `pocketbase/pb_migrations/` anlegst oder änderst |
| [pocketbase-hooks.md](docs/pitfalls/pocketbase-hooks.md) | etwas in `pocketbase/pb_hooks/` schreibst (Request-Hook, Route, Cron) |
| [testen.md](docs/pitfalls/testen.md) | die App lokal startest oder im Browser verifizierst |
| [designsystem.md](docs/pitfalls/designsystem.md) | an UI-Komponenten, `app.css`, `components.json` oder Layout arbeitest |
| [datenmodell.md](docs/pitfalls/datenmodell.md) | eine Collection, Relation oder Lösch-Logik änderst oder eine Seite mit Live-Daten baust |
| [richtext-dateien.md](docs/pitfalls/richtext-dateien.md) | an Aktivitäten, dem Editor, HTML-Bereinigung oder geschützten Dateien arbeitest |
| [kanban.md](docs/pitfalls/kanban.md) | an der Leads-Pipeline, Drag & Drop, `rank` oder `liveSync()` arbeitest |

## Struktur

```
/
├── web/                           # SvelteKit 3, Svelte 5 Runes, TypeScript, SPA
│   ├── vite.config.ts             # Tailwind-Plugin, adapter-static (Output ->
│   │                              # ../pocketbase/pb_public, Fallback index.html),
│   │                              # Dev-Proxy /api + /_/ -> :8090
│   ├── components.json            # shadcn-svelte-Config (vega, neutral, #lib-Aliase)
│   └── src/
│       ├── app.css                # Tailwind-Entry: Design-Tokens hell/dunkel
│       ├── lib/
│       │   ├── pb.ts              # PB-Client (same origin), 401 -> abmelden, Fehlertexte
│       │   ├── auth.svelte.ts     # authStore-Spiegel, login/logout, refresh() prüft Session
│       │   │                      # (bei Reconnect + Tab-Fokus; abgelaufen = Gast, kein 401)
│       │   ├── types.ts           # Record-Typen (Company, Contact, Lead, …), Farben,
│       │   │                      # Kartenfelder, Datums-Helfer, DnD-Daten
│       │   ├── live.ts            # liveSync(): Abo + Laden ohne Lücke, Reconnect-Reload
│       │   ├── collection.svelte.ts # LiveCollection: companies, contacts, users komplett live
│       │   ├── diff.ts            # changedFields(): Dialoge speichern nur Geändertes
│       │   ├── rank.ts            # fractional-indexing: byRank, rankBetween, insertSorted
│       │   ├── board.svelte.ts    # BoardStore: Pipeline laden, Realtime, optimistische Moves
│       │   ├── kanban/            # KanbanBoard (DnD-Monitor), KanbanColumn, KanbanCard,
│       │   │                      # LeadDialog, ColumnDialog, BoardSettingsDialog,
│       │   │                      # LeadPreview (Schnellansicht), preview.ts + drop.ts (rein)
│       │   ├── lead/              # LeadStore (ein Lead live, Phasenwechsel), Kacheln, format.ts
│       │   ├── activities/        # ActivityStore, Timeline, Formular, Tiptap-Editor (lazy,
│       │   │                      # Bilder/Tabellen), sanitize.ts (DOMPurify), files.ts (Datei-Token)
│       │   ├── todos/             # To-Dos: due.ts (Fälligkeit, rein), Pipeline-Store (eine Abfrage,
│       │   │                      # nächstes To-Do je Lead), Lead-Store, Liste, Formular, Badge
│       │   ├── last-activity/     # letzte Aktivität je Lead (View lead_last_activity)
│       │   ├── test/pb-mock.ts    # PocketBase-Mock für Unit-Tests (*.test.ts neben dem Code)
│       │   ├── crm/               # CompanyDialog, ContactDialog, email-suggest.ts (Name und
│       │   │                      # Unternehmen aus der E-Mail, rein), company-lookup.ts
│       │   │                      # (Website-Daten über die Hook-Route)
│       │   ├── components/        # ConfirmDialog, PageHeader (Titel + Suche + Aktionen)
│       │   ├── components/ui/     # shadcn-svelte, CLI-Output (nicht händisch pflegen)
│       │   └── utils.ts           # cn() = clsx + tailwind-merge
│       └── routes/                # +layout.ts (ssr=false), +layout.svelte (Guard +
│                                  # Navigation), +page.svelte (-> /leads),
│                                  # leads/ (Pipeline), leads/[id]/ (Detailseite),
│                                  # kontakte/, unternehmen/, login/
├── pocketbase/
│   ├── pocketbase(.exe)           # gitignored, gepinnt in scripts/get-pocketbase.sh
│   ├── pb_migrations/             # JS-Migrationen, laufen beim Start automatisch
│   ├── pb_hooks/                  # attachment-names (Original-Dateinamen), company-lookup
│   │                              # (GET /api/crm/company-lookup, ruft curl auf), je *.pb.js + -lib.js
│   ├── pb_data/                   # gitignored, die SQLite-DB
│   └── pb_public/                 # gitignored, Build-Output
├── scripts/get-pocketbase.sh      # lädt das gepinnte PocketBase-Binary (+ Prüfsumme)
├── scripts/seed-dev.mjs           # nur lokal: Superuser, Dev-User, dann scripts/seed/*.mjs
├── scripts/seed/                  # Demo-Daten, eine Datei pro Feature (idempotent)
├── scripts/test-api*.mjs          # API-/Rule-Tests gegen Wegwerf-PocketBase; npm run test:api
│                                  # führt alle aus (neue Datei wird automatisch mitgetestet)
├── scripts/agent-env.sh           # eigene Ports (PB 810n, Vite 518n) + Datenbank pro Worktree;
│                                  # dort nie launch.json/Browser-Pane (siehe testen.md)
└── web/scripts/predev.mjs         # Unit-Tests vor npm run dev, Ergebnis gut sichtbar
```

Ein Prozess serviert alles: PocketBase liefert `pb_public/` inkl. SPA-Fallback auf
`index.html`, dazu die API unter `/api` und das Admin-UI unter `/_`.

## Svelte-5-Fallstricke

* **Runes nur in `.svelte` und `.svelte.ts`/`.svelte.js`.** `$state` in einer normalen
  `.ts` wird nicht kompiliert. Deshalb heißt die Lib-Datei `auth.svelte.ts`.
* **Der `#lib`-Alias braucht die Dateiendung.** Symptom: `svelte-check` meldet
  `Cannot find module '#lib/auth.svelte'`, der Build ist trotzdem grün. Ursache: SvelteKit 3
  nutzt Node-Subpath-Imports (`"#lib/*": "./src/lib/*"` in `package.json`) statt `$lib`,
  dort wird nichts ergänzt. Richtig: `'#lib/auth.svelte.js'` (`.js` löst auf `.ts` auf).
* **Kein Export einer neu zugewiesenen `$state`-Variablen.** `export let items = $state([])`
  ist `state_invalid_export`. Lösung: ein `$state`-Objekt oder eine Klasse mit
  `$state`-Feldern exportieren und deren Properties mutieren.
* **`$effect` braucht einen Effekt-Kontext.** Auf Modulebene aufgerufen wirft es
  `effect_orphan`. Lade-/Subscription-Logik daher als Funktion exportieren
  (`syncX()`, gibt das Teardown zurück) und aus dem `$effect` der Seite aufrufen.
* Ein `bind:this`, das in einem `$effect` gelesen wird, braucht `$state` — sonst warnt
  `svelte-check` mit `non_reactive_update` und der Effekt läuft nie.
* **Was ein `$effect` liest, darf sein eigener Ablauf nicht schreiben.** Im Vorgängerprojekt
  real passiert: ein `$effect` entschied den Ladehinweis mit
  `store.loading = store.items.length === 0` und hing damit an `store.items` — genau dem,
  was sein `getFullList().then()` neu zuweist. Ergebnis: Endlosschleife aus Laden und
  Realtime-Neuanmeldung, **über 100 Requests in 1,2 Sekunden**. Es fällt nicht auf (Anzeige
  richtig, `svelte-check` still, Build grün — nur der Netzwerk-Tab schreit) und frisst
  nebenbei jede Meldung in `store.error` auf. Ein Zustand, der nur *steuert*, wie geladen
  wird, gehört in eine gewöhnliche Modulvariable (`let loadedOnce = false`), nicht in
  `$state`. Nach jeder `$effect`-Änderung die Requests zählen, nicht nur die Anzeige ansehen.
* **Vite-Plugin-Import:** `import { sveltekit } from '@sveltejs/kit/vite'` — *nicht* aus
  `@sveltejs/vite-plugin-svelte`, das exportiert kein `sveltekit`.

## Realtime / PocketBase-SDK

* **Immer nur einzelne Records mutieren** (`push` / `splice` / `list[i] = …`), nie
  `list = list.filter(...)`. Sonst überschreiben sich gleichzeitige Änderungen zweier
  Personen gegenseitig.
* **Create-Events deduplizieren.** `pb.create()` liefert den Record zurück *und* die
  Subscription feuert ein `create`-Event für denselben Record — ohne `findIndex`-Check
  steht der Eintrag doppelt in der Liste.
* **`pb.authStore.record`**, nicht `.model` (seit SDK 0.22).
* **Ein Realtime-`filter` wird gegen den Datensatz *nach* der Änderung geprüft.** Symptom: ein
  Abo mit `done = false` bekommt das Abhaken eines To-Dos nie mit, die Karte zeigt es weiter.
  Nach dem breiteren Kriterium abonnieren (z. B. pro Board) und im Client filtern.
* **View-Collections senden keine Realtime-Events.** Die Basis-Collection abonnieren und die
  betroffene View-Zeile neu lesen (`lib/last-activity/`).
* `fields` mit Modifiern (`body:excerpt(120,true)`) und Realtime-`expand` + `fields`
  (`*,expand.x.y`) funktionieren in Listen, Views und `subscribe`-Optionen.
* **Ein abgelaufenes Token ergibt kein 401, sondern Gast-Antworten.** Symptom: Listen
  kommen leer zurück (200), `getOne` liefert 404, Realtime schweigt — die Seite sieht
  „leer" aus statt abgemeldet. Nur `authRefresh` antwortet mit 401. Typischer Auslöser:
  der Admin ändert das Passwort eines Mitarbeiters. Deshalb prüft `auth.refresh()` die
  Session vor jedem `liveSync`-Laden (auch dem ersten), nach fehlgeschlagenen Schreibzugriffen
  (`LiveCollection.guard`; im Board nach fehlgeschlagenem Anlegen und Neu-Nummerieren bei
  400/403/404, beim Ändern/Verschieben/Löschen bei 404 über `isGone`), beim Tab-Fokus und minütlich. Neue
  Live-Daten immer über `liveSync()` / `LiveCollection` laden, dann ist das abgedeckt.
* **`expand` kommt leer zurück, wenn die View-Rule der Zielcollection zumacht.** Symptom:
  `record.expand` ist `{}`, kein Fehler, kein Log. Ursache bei `users`: die Standard-Rule
  `id = @request.auth.id` lässt nur den eigenen Datensatz durch. Siehe
  [migrationen.md](docs/pitfalls/migrationen.md#api-rules).
* **`expand` muss an *jeden* Call**, sonst fehlt der Name genau im ungetesteten Pfad:
  `getFullList({ expand })`, `create(data, { expand })`, `update(id, data, { expand })`
  und — leicht übersehen — `subscribe('*', cb, { expand })` als **drittes** Argument.
* Optimistische Updates rollen bei einem Fehler den vorherigen Zustand zurück; dabei auch
  `expand`-Felder lokal setzen, sonst springt die Anzeige erst mit dem Realtime-Event nach.

## Sonstiges

* `npm run build` (adapter-static) leert `pocketbase/pb_public/` vor jedem Build; dort
  abgelegte Dateien (auch ein `.gitkeep`) überleben das nicht.
* Der Bash-Tool-Arbeitsordner bleibt zwischen Aufrufen bestehen — kein blindes
  `cd web && …` voranstellen.
* Lange Markdown-Dateien über das `Write`-Tool schreiben; als Bash-Heredoc brechen sie am
  Quoting.
* **Kein `npx prettier --write`.** Es gibt keine Prettier-Konfiguration im Repo — `npx`
  greift auf die Defaults zurück (doppelte Anführungszeichen, zwei Leerzeichen) und kann
  `.svelte` ohne Plugin gar nicht parsen. Im Stil der Nachbardatei schreiben (Tabs,
  einfache Anführungszeichen).
* **`command not found` für ein Kommando, das es offensichtlich gibt**, mit
  `bash: $'\033[200~systemctl': command not found` (bzw. `^[[200~`). Das ist der
  Bracketed-Paste-Marker des Terminals. Abstellen mit
  `bind 'set enable-bracketed-paste off'` oder die Zeile tippen statt einfügen.
