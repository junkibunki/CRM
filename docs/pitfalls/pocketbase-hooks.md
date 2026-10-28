# PocketBase-Hooks

Lesen, bevor du etwas in `pocketbase/pb_hooks/` schreibst (Request-Hook, Route, Cron).

Wie eine neue Hook-Datei überhaupt geladen wird (Neustart nötig, `touch` genügt nicht),
steht in [migrationen.md](migrationen.md#fallstricke).

## Die API-Rule läuft *vor* dem Hook

Symptom: `create rule failure: sql: no rows in result set` im `_logs`, Antwort ein nacktes
`{"data":{},"message":"Failed to create record.","status":400}` — und der Hook, der das
fehlende Feld setzen sollte, hat nie geloggt. Er ist registriert, er kommt nur nicht mehr
dran.

`onRecordCreateRequest` feuert erst, wenn die CreateRule schon zugestimmt hat. Ein Feld,
auf das die Rule sich bezieht, kann der Hook also nicht beisteuern — es muss aus dem
Request kommen (Client schickt z. B. `owner` selbst mit, die Rule
`owner = @request.auth.id` weist jeden anderen Wert ab). Das PocketBase-Beispiel
`e.record.set("status", "pending")` täuscht hier — es funktioniert nur, weil keine Rule
`status` liest.

Umgekehrt: was nur die Rule prüfen kann, gehört in die Rule, nicht in einen Hook. Ein Hook
als einzige Sperre fällt mit seiner Datei aus, die Rule steht in der Datenbank.

## Ein Feldfehler muss ein `ValidationError` sein

Symptom: `throw new BadRequestError('…', { text: { code: 'x', message: 'y' } })` kommt beim
Client als `data.text = {"code":{"code":"validation_invalid_value","message":"Invalid
value."}, "message":{…}}` an — der eigene Text ist lautlos weg. PocketBase hält die
einfache Map für eine verschachtelte Fehlerstruktur und ersetzt die Blätter.

Richtig ist der eigene Typ; er wird zu genau dem `{code, message}`, das das SDK unter
`err.response.data.<feld>` erwartet:

```js
throw new BadRequestError(message, { text: new ValidationError('duplicate', message) });
```

## Fallstricke der JS-VM

**Ein Hook-Callback sieht den Modulscope seiner Datei nicht.** Jeder Callback läuft in
einer eigenen JS-VM. Eine Funktion daneben zu definieren und darin aufzurufen endet in
`ReferenceError: <name> is not defined` — erst zur Laufzeit, bei einer Route als nacktes
`400`. Gemeinsames in ein Modul legen, das *innerhalb* des Callbacks geladen wird
(``require(`${__hooks}/x-lib.js`)``), daher die Trennung `x.pb.js` / `x-lib.js`.

**`require()` löst `node_modules` nicht auf**, nur relative Pfade — sonst
`GoError: Invalid module`. Fremdcode vorher zu *einer* Datei bündeln und ins Repo legen.

**Binäre Daten gehen nur als `Uint8Array` durch `$http.send`.** Ein „Binärstring" wird beim
Übergang nach Go als UTF-8 kodiert (6 Bytes kommen als 9 an), ein `ArrayBuffer` kommt als
**leerer** Body an, ohne Fehler. Dieselbe Falle macht `$security.sha256` & Co. für
beliebige Bytes unbrauchbar; für ASCII sind sie in Ordnung.

**Keine WebCrypto, kein `TextEncoder`, kein `setTimeout`.** Alles läuft synchron im Request
mit. Sekundengenaues Warten geht nur über einen Kindprozess
(`$os.exec('sleep', '2').run()`, unter Windows
`powershell -NoProfile -Command Start-Sleep`), beides in `try`, weil `run()` wirft, wenn
das Programm fehlt.

**`res.body` einer `$http.send`-Antwort ist ein Byte-Array.** Im Log steht dann
`"112,101,114,109,…"` statt Text — vor dem Loggen dekodieren.

**Änderungen in `pb_hooks/` wirken erst nach einem Neustart.** PocketBase schreibt nur
`File … changed, please restart the app manually` und läuft mit dem alten Code weiter.

## Logs

**`app.logger()` schreibt nicht nach stdout**, sondern in die `_logs`-Collection; die
Server-Konsole zeigt nur `console.log`. Ansehen mit
`GET /api/logs?perPage=30&sort=-created` als Superuser.

**`/api/logs` findet den eigenen Log-Eintrag nicht.** Symptom: `filter=message~"DBG"`
liefert `totalItems: 0`, dieselbe Abfrage ohne Filter zeigt den Eintrag. Nicht nach dem
Text filtern, sondern sortiert holen und in Node über `items` gehen.

**Der Log-Eintrag kommt verspätet.** PocketBase schreibt die Logs gesammelt; direkt nach
dem Request ist noch nichts da. Ein paar Sekunden später erneut abfragen (nach 1,5 s leer,
beim nächsten Aufruf da).
