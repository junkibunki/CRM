# Beim Testen

Lesen, bevor du die App lokal startest oder im Browser verifizierst.

## Weiße Seite mit `TypeError: Cannot read properties of undefined (reading 'data')`

Kein Svelte-Fehler, sondern ein zerrissener Build in `pocketbase/pb_public/`: SvelteKit
legt seinen Laufzeit-Zustand unter einem pro Build neu gewürfelten Global
`__sveltekit_<hash>` ab, das `index.html` inline setzt und die Chunks lesen. Laufen zwei
Builds ineinander (z. B. zwei Sessions parallel), passt das `index.html` des einen nicht zu
den Chunks des anderen. Prüfen statt raten:

```bash
grep -ro "__sveltekit_[a-z0-9]*" pocketbase/pb_public | sed 's/.*://' | sort -u
```

Muss **genau einen** Namen ausgeben. Heilmittel ist ein erneutes `npm run build`.

## Server starten

* **Testdaten und Logins kommen aus `scripts/seed-dev.mjs`** (Superuser, Dev-User,
  Demo-Unternehmen, -Kontakte und -Leads; Zugangsdaten stehen im Skript). Bei laufendem PocketBase vom Repo-Root:
  `node scripts/seed-dev.mjs`. Der Dev-Server startet über `.claude/launch.json` (`web`).
* **`ERR_CONNECTION_REFUSED` auf `localhost:5173`, obwohl der Dev-Server „läuft".** Vite
  bündelt nach dem Start erst die Abhängigkeiten vor und lauscht nur auf `[::1]`. Mit
  `curl -s -o /dev/null -w '%{http_code}' http://localhost:5173/` warten, bis 200 kommt.
* **Der erste Klick nach dem Start verpufft.** Symptom: Link geklickt, URL bleibt,
  Titel „Loading …". Vite hat neue Abhängigkeiten entdeckt und lädt die Seite komplett
  neu. Nochmal klicken; kein App-Bug.
* **`browser_drag` des Playwright-MCP läuft auf großen Seiten in ein 30s-Timeout**, obwohl
  der Drop durchging (1000 Karten). Ergebnis im DOM prüfen statt dem Fehler zu glauben.
* **`browser_drag` von einer Karte auf sich selbst ist ein Klick**, kein Drag (keine
  Bewegung → der Dialog öffnet sich). Für „loslassen, wo man angefangen hat" per
  `browser_run_code_unsafe` mit `page.mouse` wegziehen und zurück.
* **Realtime-Reconnect lässt sich über den Vite-Dev-Server nicht testen.** Der Proxy hält
  die SSE-Verbindung zum Browser offen, auch wenn PocketBase dahinter neu startet — der
  Client merkt nichts. Gegen `:8090` (Produktions-Build) testen. Playwrights
  `setOffline(true)` kappt eine bestehende SSE-Verbindung zu localhost ebenfalls nicht.
* **Resource-Timing zählt nach ~250 Einträgen nicht mehr mit.** Im Dev-Server lädt die App
  hunderte Module, danach landet kein API-Request mehr in
  `performance.getEntriesByType('resource')`. Requests im Netzwerk-Log des Playwright-MCP
  (`browser_network_requests`) zählen.
* **Git Bash schreibt `/api/…`-Argumente in Windows-Pfade um** (`C:/Program Files/Git/api/…`).
  Für Node-Skripte mit URL-Pfad als Argument `MSYS_NO_PATHCONV=1` voranstellen.

* **Ein mit `(cmd &)` in den Hintergrund geschickter Server überlebt den Bash-Aufruf
  nicht.** Symptom: Minuten später schlagen alle Requests fehl. PocketBase für Tests über
  das `run_in_background` des Bash-Tools starten und mit `/api/health` prüfen, *bevor* man
  einem Browserergebnis glaubt.
* **Eine Pipe hinter dem Serverstart verschluckt jede Zeile.** Symptom: die Task-Datei von
  `run_in_background` bleibt 0 Byte, obwohl `/api/health` antwortet. `tail` schreibt erst,
  wenn der Server sich beendet, `grep`/`head` puffern blockweise. Den Serverstart nie
  durch eine Pipe schicken; zum Mitlesen `> datei 2>&1` und hinterher darin suchen.
* **Umlaute in Bash-`curl`-Payloads werden auf Windows zerlegt**, PocketBase antwortet mit
  einem nichtssagenden `400`. Für Requests mit Umlauten `node -e "fetch(…)"` benutzen,
  Token per Env-Variable übergeben.
* **Nach dem Löschen von `pb_data/` sieht die App eingeloggt aus, zeigt aber leere
  Listen.** Der Token im localStorage überlebt den DB-Reset, ist gegen die neue DB aber
  ungültig — jeder Request läuft in ein 401. Einmal abmelden, neu anmelden.
* Testdaten liegen in `pocketbase/pb_data/` — zum Zurücksetzen den Ordner löschen und den
  Superuser neu anlegen (`./pocketbase superuser upsert <mail> <pw>`).
* **Eine Rule per API oder Dashboard ausprobieren schreibt eine Migration ins Repo.**
  Symptom: eine korrigierte Rule kommt beim nächsten Start in der alten Form zurück, und in
  `pocketbase/pb_migrations/` liegt eine fremde Datei `<zeitstempel>_updated_<name>.js`.
  Ursache: Automigrate ist an — jede Collection-Änderung über die API wird als Migration
  gespeichert. Für Experimente `--automigrate=false` mitgeben oder ein Wegwerf-
  `--migrationsDir` nehmen, und hinterher `git status pocketbase/pb_migrations` ansehen.
* **Eine Datenkopie zeigt Migrationen schon als gelaufen, die du gerade erst schreibst.**
  Läuft irgendwo ein Server auf `pocketbase/pb_data` (eigener Test, parallele Session),
  wendet er jede neue Datei in `pb_migrations/` sofort an. Eine danach korrigierte
  Migration läuft dort nie wieder — Korrekturen gehören dann in eine neue Migration.

## Browser

* **Der eingebettete Browser-Pane lässt Klicks gern in 30s-Timeouts laufen.** Das ist kein
  App-Bug. Für echte Verifikation den Playwright-MCP nehmen.
* **Screenshot einer lokalen HTML-Vorschau im Browser-Pane.** Symptom: `This tab shows a
  local file, not a web page; page tools can't act on it here`. Was funktioniert hat: die
  Datei in den Projektordner legen *und* mit `navigate` statt `preview_start` öffnen.
  `zoom` mit `region` kann der Pane nicht, er liefert still den ganzen Screenshot.
* **Der Playwright-MCP lädt nur Dateien aus dem Projektordner hoch** (z. B. Excel/CSV für
  den Import-Test). Symptom: `File access denied: … is outside allowed roots`. Testdateien
  also im Repo ablegen (und hinterher wegräumen), nicht im Temp-Ordner.

### Ausweg: `playwright-core` aus dem npx-Cache

Ist der Playwright-MCP belegt (`Browser is already in use`), geht es auch von Hand:
`playwright-core` liegt im npx-Cache
(`find "$LOCALAPPDATA/npm-cache/_npx" -maxdepth 4 -name playwright-core`), per absolutem
Pfad `require`n und `chromium.launch({ executablePath: …/chrome.exe, args:
['--no-sandbox'] })` mit der Binary von unten. Skript als `.cjs` in den Scratchpad legen.

### Ausweg: Chromium selbst per CDP fahren

Die Playwright-Binary liegt unter
`%LOCALAPPDATA%\ms-playwright\chromium-*/chrome-win64/chrome.exe`, Node ≥ 22 hat ein
globales `WebSocket` (`--remote-debugging-port`, dann `/json/list` und
`Target.attachToTarget`). Zwei Fallen:

* **Ohne `--no-sandbox` stirbt der Netzwerkdienst dieses Builds beim Start** („Sandbox
  cannot access executable … Access is denied", dann „Network service crashed"). Die Seite
  ist danach ein Fehlerdokument mit *korrekter* URL — `fetch` schlägt fehl, was wie ein
  App-Problem aussieht.
* **Ziel über `/json/list` suchen, nicht über `Target.getTargets`.** Chromium führt neben
  dem Tab eigene WebUI-Seiten als Ziel; hängt man am falschen, gilt dasselbe Symptom.
