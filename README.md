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
- `mcp/` – MCP-Server für Agents (nur lesen), eigener Node-Dienst; muss neben `pocketbase/` liegen
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
und `npm run build`), `npm run test:api` (API-Regeln gegen eine Wegwerf-PocketBase),
`npm run test:mcp` (MCP-Dienst inkl. Ende-zu-Ende-Test; vorher einmalig `cd mcp && npm ci`).

Optional, MCP-Server lokal (Terminal 3). PocketBase dafür mit demselben Secret starten
(`CRM_MCP_SECRET=… ./pocketbase serve`, mindestens 32 Zeichen); ohne Secret ist der
Token-Tausch abgeschaltet, die App läuft normal:

```bash
cd mcp && npm ci && CRM_MCP_SECRET=… PB_URL=http://127.0.0.1:8090 MCP_PORT=8200 npm start
```

Der Dev-Server leitet `/mcp` an `:8200` weiter. Token unter „Profil" anlegen, dann
`claude mcp add --transport http crm http://localhost:5173/mcp --header "Authorization: Bearer crm_…"`.

Öffentliche Registrierung ist per Migration abgeschaltet; Benutzer legt ein Superuser im
PocketBase-Dashboard (`/_/`) in der Collection `users` an.
Schemaänderungen im Dashboard erzeugen automatisch Migrationen in `pb_migrations/` – diese committen.

## Produktion (VPS)

Voraussetzungen: Node.js ≥ 22.17 (SvelteKit 3; `engine-strict` bricht sonst `npm install` ab)
und **`curl`** im PATH (der Abruf von Unternehmensdaten von Websites läuft darüber; ohne curl
meldet die Funktion „curl fehlt", der Rest der App läuft normal).
Vom Repo-Root aus:

```bash
(cd web && npm ci && npm run build)
scripts/get-pocketbase.sh
cd pocketbase && ./pocketbase serve meinedomain.de   # automatisches HTTPS via Let's Encrypt
```

Das bindet die Ports 80 und 443. Als Nicht-root-Nutzer vorher einmalig
`sudo setcap 'cap_net_bind_service=+ep' pocketbase/pocketbase` (nach jedem Binary-Update
wiederholen).

### Mit MCP-Server für Agents

Der MCP-Dienst braucht einen Reverse-Proxy vor PocketBase, der `/mcp` an den Dienst leitet.
PocketBase läuft dann nur auf `127.0.0.1:8090`, der Proxy macht HTTPS.

1. Secret erzeugen (≥ 32 Zeichen), z. B. `openssl rand -hex 24`. Derselbe Wert kommt in
   PocketBase und den Dienst.
2. `cd mcp && npm ci --omit=dev` (nach jedem Deploy).
3. systemd-Units (Beispiel, Pfade anpassen):

```ini
# /etc/systemd/system/crm-pocketbase.service
[Service]
WorkingDirectory=/opt/crm/pocketbase
ExecStart=/opt/crm/pocketbase/pocketbase serve --http 127.0.0.1:8090
Environment=CRM_MCP_SECRET=<secret>
User=crm
Restart=on-failure
[Install]
WantedBy=multi-user.target

# /etc/systemd/system/crm-mcp.service
[Unit]
After=network.target crm-pocketbase.service
[Service]
WorkingDirectory=/opt/crm/mcp
ExecStart=/usr/bin/node src/server.js
Environment=PB_URL=http://127.0.0.1:8090
Environment=MCP_HOST=127.0.0.1
Environment=MCP_PORT=8200
Environment=CRM_MCP_SECRET=<secret>
Environment=CRM_APP_URL=https://meinedomain.de
Environment=CRM_TZ=Europe/Berlin
User=crm
Restart=on-failure
[Install]
WantedBy=multi-user.target
```

   `systemctl daemon-reload && systemctl enable --now crm-pocketbase crm-mcp`; Kontrolle:
   `curl http://127.0.0.1:8200/health`. Optional `MCP_ALLOWED_HOSTS` / `MCP_ALLOWED_ORIGINS`
   (kommagetrennt), falls der Dienst unter weiteren Namen erreichbar ist.
4. Proxy, z. B. Caddy (`/etc/caddy/Caddyfile`). Der Token-Tausch wird von außen gesperrt,
   nur der Dienst ruft ihn über `127.0.0.1` auf:

```
meinedomain.de {
	@exchange path /api/crm/token-exchange
	respond @exchange 404
	reverse_proxy /mcp* 127.0.0.1:8200
	reverse_proxy 127.0.0.1:8090
}
```

Mitarbeiter legen unter „Profil" ein Token an (wird einmal angezeigt) und verbinden ihren Agent:
`claude mcp add --transport http crm https://meinedomain.de/mcp --header "Authorization: Bearer crm_…"`.
Der Agent kann nur lesen, was die Person auch in der App sieht. Widerrufen auf der Profilseite;
eine Passwortänderung widerruft alle Tokens der Person.

## Lizenz

MIT, siehe [LICENSE](LICENSE).
