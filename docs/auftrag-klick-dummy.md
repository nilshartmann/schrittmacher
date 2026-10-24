# Schrittmacher: Klick-Dummy der Oberfläche

## Hintergrund

Schrittmacher ist ein Git-Viewer für Talks und Workshops. In meinen Workshop-Repos liegen
Schritt-Commits im Format `NN: Thema` (etwa `25e: Mit @TransactionalEventListener erst nach dem
Commit von registerPlant`). Ich nutze sie als Spickzettel für den nächsten Schritt und als Notlösung
zum Kopieren von Code. Bisher nutze ich Fork dafür, auf einem 11"-iPad Pro im Querformat als
Sidecar-Bildschirm des Macs. Bei Fork geht dort zu viel Breite verloren:

- Die Seitenleiste lässt sich nicht ganz einklappen.
- Die Dateiliste lässt sich nicht ganz einklappen, auch bei nur einer Datei.
- Die beiden Seiten im Side-by-Side-Diff sind immer gleich breit, obwohl mich meist nur die rechte
  Seite („nachher“) interessiert.
- Die Commit-Liste nimmt oben die halbe Höhe ein.
- Lange Zeilen werden abgeschnitten.

## Festgelegt

- Später: lokaler Server auf `127.0.0.1` in TypeScript mit TanStack Start im SPA-Modus. Git läuft
  als Prozess. Die Git-Logik bleibt ein eigenes Modul ohne Import aus dem Framework, damit Electron
  eine spätere Option bleibt.
- Die Oberfläche läuft auf dem Mac als Web-App im Dock (ohne Browserleisten) und wird per Sidecar
  auf dem iPad gezeigt. Mit dem Finger lässt sich dort nur scrollen, geklickt wird mit dem Pencil
  oder vom Mac aus. Bedienelemente müssen deshalb groß genug für den Pencil sein.
- Später geplant, nicht für den Dummy: Wechsel von Branch und Worktree, lokale Änderungen, Commit
  und Reset. Rebase und Ähnliches sind kein Ziel.

## Auftrag

Baue einen Klick-Dummy der Oberfläche, mit dem wir das Layout festlegen. Es gibt keinen Server und
kein Git. Alle Daten sind fest im Code. Nutze schon den Stack des Ziels (TanStack Start im SPA-Modus,
React, TypeScript `strict`), damit der Dummy später weiterwachsen kann. Das Git-Repo in diesem Ordner
ist schon angelegt. Frag vor jeder Bibliothek, die über TanStack, React und Vite hinausgeht.

Der Dummy zeigt Folgendes:

1. Kopfzeile, schmal: Repo, Worktree, Branch und der gewählte Vergleich.
2. Commit-Liste als Spalte links, ganz einklappbar. Eingeklappt bleibt ein schmaler Streifen mit
   „◀ 25e ▶“ zum Blättern.
3. Dateiliste, mit einem Klick ganz einklappbar. Bei nur einer Datei ist sie von selbst zu.
4. Side-by-Side-Diff mit verschiebbarer Trennlinie. Voreinstellungen sind 50/50, 30/70 und „nur
   nachher“. „Nur nachher“ zeigt die ganze Datei mit markierten Änderungen.
5. Zeilenumbruch an/aus und Schriftgröße +/−.
6. Vergleich zweier beliebiger Commits: Klick wählt einen Commit gegen seinen Vorgänger, ⇧-Klick
   auf einen zweiten vergleicht beide.
7. Markierungen in Kommentaren wie `🕵 Zeigen:`, `Erzählen:` und `Fallstrick:` sind hervorgehoben,
   mit Sprung zur nächsten Markierung.

Als Testdaten dient ein erfundenes Workshop-Repo mit etwa zehn Schritten in Java (Spring), mit
Änderungen über eine bis drei Dateien und einigen langen Zeilen.

Prüfe die Ansicht als Screenshot in der Fenstergröße von Sidecar auf einem 11"-iPad Pro im
Querformat (etwa 1194 × 834 Punkte, ermittle den genauen Wert).

## Vorlage aus agent-lab

In `~/develop/agent-lab` gibt es einen Diff-Viewer, dessen Teile wir übernehmen wollen. **Verändere
dort nichts, lies nur.** Für den Dummy sind diese Dateien interessant:

- `src/main/frontend/src/ticket/highlight.ts`: Highlighting mit Lezer in den Farben von IntelliJ
- `src/main/frontend/src/ticket/splitRows.ts`: Zeilen für Side-by-Side
- `src/main/frontend/src/ticket/CodeDiff.tsx`: Rendern des Diffs, mit Ballast aus agent-lab
  (Befunde, Sprungziele, Marken)
- `src/main/frontend/src/ticket/ListSplitter.tsx` und `listWidth.ts`: verschiebbare Breite
- `src/main/frontend/src/ticket/FreeComparison.tsx`: freie Wahl zweier Seiten
- `src/main/frontend/src/ticket/review.css`: das zugehörige CSS, hängt an
  `src/main/frontend/src/shared/variables.css`

Später kommen dazu (nicht für den Dummy): `src/main/java/nh/agentlab/git/Diff.java` (Parser für
`git diff`, zu portieren) und `LineParts.java` (Unterschiede innerhalb einer Zeile).

## Vorgehen

Setze nichts um, bevor du mir einen kurzen Plan für den Dummy vorgelegt hast. Kläre offene Punkte
einzeln mit mir.
