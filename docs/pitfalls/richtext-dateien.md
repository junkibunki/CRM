# Rich-Text, HTML-Bereinigung und geschützte Dateien

Lesen, bevor du an `web/src/lib/activities/` (Editor, `sanitize.ts`, `files.ts`) arbeitest,
HTML aus Nutzereingaben anzeigst oder Dateifelder mit `protected: true` nutzt.

## HTML bereinigen (`sanitize.ts`, DOMPurify)

* **Allowlist, nie Denylist.** Eine Prüfung wie `^(https?:)?//` auf das rohe `src` lässt
  `h&#10;ttps://tracker…` durch: DOMPurify ignoriert Whitespace beim URL-Check, schreibt ihn
  aber zurück, und der Browser entfernt Tabs/Zeilenumbrüche in URLs — das Tracking-Pixel
  lädt bei allen. Deshalb: URL zuerst normalisieren (`normalizeUrl()`: ASCII-Whitespace,
  Steuerzeichen `\x00-\x20`, `\x7f-\x9f` und die Unicode-Leerzeichen entfernen), dann gegen
  eine Allowlist prüfen und **den normalisierten Wert zurückschreiben**. Bilder ohne
  ausdrückliches „Bilder anzeigen" nur als `data:image/…`; Links nur `https?:`, `mailto:`,
  `tel:`.
* **Ein eigenes `ALLOWED_URI_REGEXP` prüft auch Nicht-URI-Attribute.** Symptom:
  `<ol start="3">` verliert `start`. Lösung: `ADD_URI_SAFE_ATTR: ['start']`.
* **DOMPurify liefert `null` für Dokumente ohne `<body>`** (`<frameset>`, `<!--x--><frameset>`).
  Ein `querySelectorAll` darauf wirft — und eine einzige solche Aktivität legt die ganze
  Timeline des Leads lahm. `null` als leer behandeln.
* DOMPurify akzeptiert `data:` nur kleingeschrieben; `DATA:IMAGE/…` wird verworfen (sicher).
* Externe Links lösen sonst DNS-Prefetch aus (Tracking per DNS): in `app.html` steht
  `<meta http-equiv="x-dns-prefetch-control" content="off">`.

## Tiptap (v3)

* **`StarterKit` enthält Link und Underline schon.** Über `StarterKit.configure({ link })`
  konfigurieren, `@tiptap/extension-link` nicht zusätzlich laden (sonst doppelte Extension).
* **`Mod-Enter` gehört dem HardBreak.** Strg+Enter zum Speichern deshalb per
  `onkeydowncapture` am Formular abfangen; Datei-Drop genauso per `ondropcapture`, sonst
  landet die Datei im Text.
* **In das `element` des Editors keine Svelte-Kinder rendern** — Tiptap übernimmt es; den
  Lade-Hinweis daneben setzen.
* Der Editor wird nur im Formular per dynamischem Import geladen (eigener Chunk ≈ 380 KB).
  Damit der Dev-Server beim ersten Öffnen nicht neu optimiert und die Seite neu lädt, stehen
  die Tiptap-Pakete in `optimizeDeps.include` (`web/vite.config.ts`) — bei einer neuen
  Extension dort ergänzen.
* Geladen sind StarterKit, Image (inline; im Editor nur `data:`-Bilder sichtbar, andere als
  Platzhalter), die Tabellen-Teile und Überschriften h1–h6. `colspan`/`rowspan` werden beim
  Parsen auf 1–99 begrenzt (sonst: Stack-Overflow beim Öffnen).
* **Tiptaps `getHTML()` lädt externe Bilder:** es baut `<img>` im Seitendokument, und ein
  `<img>` lädt sein `src` auch ungehängt (Tracking beim Bearbeiten). Das eigene `editorHtml()`
  serialisiert in `document.implementation.createHTMLDocument()`, das nichts lädt.
* **HTML → Text (MCP, `mcp/src/format.js`):** Tiptap setzt `<p>` in jedes `<li>` und `<td>`;
  vorher entfernen, sonst Leerzeilen zwischen Listenpunkten und zerrissene Tabellenzeilen.
  `fields=body:excerpt(…)` macht aus Listen Fließtext — für Struktur den vollen Body holen.
* **Tabellen im Bereiniger:** erlaubt sind table/thead/tbody/tfoot/tr/th/td, `colspan`/`rowspan`
  nur 1–99 und in `ADD_URI_SAFE_ATTR` (sonst verwirft das eigene `ALLOWED_URI_REGEXP` sie);
  kein style/width/background.

## Geschützte Dateien (`protected: true`)

* **Ohne `?token=` gibt es 404 — auch mit `Authorization`-Header.** Token per
  `pb.files.getToken()` holen; er ist kurz gültig. Für Downloads beim Klick immer einen
  frischen holen, nicht cachen; Vorschau/Größe teilen sich einen Token (60 s, `files.ts`).
* **Der Record kennt nur Dateinamen, keine Größe.** Größe per `HEAD …?token=` aus
  `content-length`.
* **Gespeicherte Namen sind umgebaut:** kleingeschrieben, Umlaute → `_`, Suffix
  `_<10 Zeichen>`. **Den Originalnamen** schreibt der Hook `attachment-names` in
  `attachment_names`; `onFileDownloadRequest` setzt ihn als Download-Namen (`e.servedName`).
  Browser schicken `"` in Multipart-Dateinamen als `%22`.
* **PocketBase maskiert in `Content-Disposition` Zeichen, die Go für nicht druckbar hält**
  (U+00A0, U+202F, U+2028 …) als wörtliches `\u00a0` — der Hook macht Unicode-Leerzeichen zu
  `" "` und entfernt U+00AD/U+061C/U+2028/U+2029. Beim Kürzen auf 200 Zeichen bleibt die
  Endung erhalten.
* Datei-Antworten kommen mit `Content-Disposition: attachment` und einer Sandbox-CSP, auch
  für hochgeladenes HTML/SVG.
