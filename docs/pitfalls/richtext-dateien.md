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
  `@tiptap/core` und `@tiptap/starter-kit` in `optimizeDeps.include` (`web/vite.config.ts`).
* StarterKit hat keine Image- und Table-Extension, Überschriften nur h2/h3: solche Inhalte
  (z. B. per API gespeichert) gehen beim Bearbeiten verloren — siehe F13 in `IDEAS.md`.

## Geschützte Dateien (`protected: true`)

* **Ohne `?token=` gibt es 404 — auch mit `Authorization`-Header.** Token per
  `pb.files.getToken()` holen; er ist kurz gültig. Für Downloads beim Klick immer einen
  frischen holen, nicht cachen; Vorschau/Größe teilen sich einen Token (60 s, `files.ts`).
* **Der Record kennt nur Dateinamen, keine Größe.** Größe per `HEAD …?token=` aus
  `content-length`.
* **Gespeicherte Namen sind umgebaut:** kleingeschrieben, Umlaute → `_`, Suffix
  `_<10 Zeichen>`; `Content-Disposition` nennt den Namen mit Suffix. Den Originalnamen gibt
  es nicht mehr (F13).
* Datei-Antworten kommen mit `Content-Disposition: attachment` und einer Sandbox-CSP, auch
  für hochgeladenes HTML/SVG.
