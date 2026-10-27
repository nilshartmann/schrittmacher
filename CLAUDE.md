# Schrittmacher

Git-Viewer für Talks und Workshops. Er zeigt die Schritt-Commits eines Workshop-Repos
(`NN: Thema`) als Spickzettel und zum Kopieren von Code. Er läuft auf dem Mac als Web-App aus
Safari im Dock und wird per Sidecar auf einem iPad Pro 11" im Querformat gezeigt. Vorbild für
Darstellung und Bedienung ist Fork; wer zwischen beiden wechselt, soll sich nicht umstellen müssen.

Der ursprüngliche Auftrag steht in `docs/auftrag-klick-dummy.md`, offene Punkte stehen in
`docs/offen.md`. Die Hinweise zur Überarbeitung der Commits beschreibt `docs/hinweise.md`.

## Stack und Befehle

- TanStack Start im SPA-Modus, React, TypeScript `strict`, Vite, pnpm
- `pnpm dev`: Server mit den Testdaten aus `src/git/demoRepo.ts`, beim Start als Repo mit Worktree
  unter `$TMPDIR/schrittmacher-testdaten` aufgebaut, mit eigenem Speicher daneben
- `pnpm dev:echt`: Server mit den echten Repos aus `~/.config/schrittmacher/config.json`; dort liegt
  auch der Zustand (`state.json`), ein anderer Ordner mit `SCHRITTMACHER_CONFIG=…`
- `pnpm dev:wjax`: wie `dev:echt`, mit einem Worktree für den allerersten Start (`SCHRITTMACHER_REPO`)
- `schrittmacher [pfad]` (`bin/schrittmacher`, verlinkt nach `~/.local/bin`): öffnet den Worktree
  zum Pfad als Tab wie `fork <pfad>` und holt die Web-App nach vorn; anderer Server mit
  `SCHRITTMACHER_URL=…`, ohne Web-App mit leerem `SCHRITTMACHER_APP`
- `schrittmacher-start` (`bin/schrittmacher-start`, verlinkt nach `~/.local/bin`): startet
  `pnpm dev:echt` im Hintergrund, falls unter Port 5310 nichts antwortet, und holt die Web-App nach
  vorn; die Ausgabe des Servers steht in `$TMPDIR/schrittmacher-server.log`
- `schrittmacher-stop` (`bin/schrittmacher-stop`, verlinkt nach `~/.local/bin`): beendet die
  Web-App und den Vite-Server auf Port 5310, egal wie er gestartet wurde; die Web-App bleibt offen
  mit leerem `SCHRITTMACHER_APP`
- `pnpm typecheck`: Typprüfung, vor jedem Commit
- `pnpm screenshots`: Screenshots mit WebKit in der Fenstergröße unter Sidecar, gegen den Server
  mit Testdaten (anderer Server mit `URL=…`)

Frag vor jeder Bibliothek, die über TanStack, React, Vite und Lezer hinausgeht.

## Vorgaben

- `src/git/` importiert nichts aus React oder TanStack, damit Electron später eine Option bleibt.
- Git läuft nur lesend und mit `--no-optional-locks`, weil Fork parallel auf demselben Repo
  arbeitet. Die einzigen Ausnahmen sind Commit und Push im Worktree eines Tabs
  (`docs/commit.md`), der Fetch aus dem Branch-Menü (immer mit `--prune`), Merge und harter Reset
  eines Branches mit seinem Branch auf dem Remote (Abstand im Badge) und das Kopieren einer Datei in
  den Worktree eines anderen Tabs.
- Fenstergröße zum Prüfen: 1194 × 764 pt (Sidecar abzüglich Menü- und Titelleiste der Web-App)
- Bedienung mit Maus oder Trackpad des MacBooks, nicht mit dem Pencil; mit dem Finger wird nur
  gescrollt.
- Farben des Diffs, Symbole der Dateiarten und Zeilennummern wie in Fork
- Neuester Commit oben; Dateinamen in der Liste nicht fett; Kopfzeile und Leisten mit fester Höhe
- Tooltips über `data-tip` statt `title`, weil die Web-App aus Safari `title` nicht anzeigt.
- Zeilennummern, Trenner und leere Zeilen lassen sich nicht mitmarkieren.
- Prüfe jede Änderung an der Oberfläche als Screenshot.
