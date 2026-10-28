# CRM

Schlankes internes CRM. Backend: [PocketBase](https://pocketbase.io) (pinned 0.40.6), Frontend: SvelteKit / Svelte 5 als statische SPA.

- **Leads** – Pipeline als Kanban-Board (Phasen konfigurierbar, Drag & Drop, live für alle).
  Ein Lead hat Titel, Unternehmen, einen oder mehrere Kontakte, optional ein
  voraussichtliches Abschlussdatum, einen zuständigen Mitarbeiter und das Erstellungsdatum.
- **Kontakte** und **Unternehmen** – pflegen, suchen; Kontakte gehören optional zu einem
  Unternehmen.

## Struktur

- `pocketbase/` – PocketBase-Instanz; `pb_migrations/` ist versioniert (Schema), `pb_data/` nicht
- `web/` – SvelteKit-Frontend; `npm run build` schreibt nach `pocketbase/pb_public/`
- `scripts/get-pocketbase.sh` – lädt das gepinnte PocketBase-Binary

## Entwicklung

Unter Windows in Git Bash, jeweils vom Repo-Root aus. Einmalig:

```bash
scripts/get-pocketbase.sh
```

Terminal 1 – API + Admin unter http://127.0.0.1:8090/_/:

```bash
cd pocketbase && ./pocketbase serve
```

Terminal 2 – Frontend unter http://localhost:5173 (leitet `/api` an PocketBase weiter):

```bash
cd web && npm install && npm run dev
```

Optional, nur lokal: Superuser, Login-User und Demo-Daten (Unternehmen, Kontakte, Leads) anlegen (Zugangsdaten
stehen im Skript; nie gegen Produktion laufen lassen):

```bash
node scripts/seed-dev.mjs
```

Tests (aus `web/`): `npm test` (Unit-Tests, laufen auch automatisch vor `npm run dev`
und `npm run build`), `npm run test:api` (API-Regeln gegen eine Wegwerf-PocketBase).

Öffentliche Registrierung ist per Migration abgeschaltet; Benutzer legt ein Superuser im
PocketBase-Dashboard (`/_/`) in der Collection `users` an.
Schemaänderungen im Dashboard erzeugen automatisch Migrationen in `pb_migrations/` – diese committen.

## Produktion (VPS)

Voraussetzung: Node.js ≥ 22.17 (SvelteKit 3; `engine-strict` bricht sonst `npm install` ab).
Vom Repo-Root aus:

```bash
(cd web && npm ci && npm run build)
scripts/get-pocketbase.sh
cd pocketbase && ./pocketbase serve meinedomain.de   # automatisches HTTPS via Let's Encrypt
```

Das bindet die Ports 80 und 443. Als Nicht-root-Nutzer vorher einmalig
`sudo setcap 'cap_net_bind_service=+ep' pocketbase/pocketbase` (nach jedem Binary-Update
wiederholen).

## Lizenz

MIT, siehe [LICENSE](LICENSE).
