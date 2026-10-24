# Schrittmacher

Git-Viewer für Talks und Workshops. Er zeigt die Schritt-Commits eines Workshop-Repos
(`NN: Thema`) als Spickzettel und zum Kopieren von Code. Er läuft auf dem Mac als Web-App aus
Safari im Dock und wird per Sidecar auf einem iPad Pro 11" im Querformat gezeigt. Vorbild für
Darstellung und Bedienung ist Fork; wer zwischen beiden wechselt, soll sich nicht umstellen müssen.

Der ursprüngliche Auftrag steht in `docs/auftrag-klick-dummy.md`, offene Punkte stehen in
`docs/offen.md`.

## Stack und Befehle

- TanStack Start im SPA-Modus, React, TypeScript `strict`, Vite, pnpm
- `pnpm dev`: Server mit den Testdaten aus `src/git/demoRepo.ts`, beim Start als Repo mit Worktree
  unter `$TMPDIR/schrittmacher-testdaten` aufgebaut
- `pnpm dev:wjax`: Server mit einem echten Worktree (`SCHRITTMACHER_REPO`)
- `pnpm typecheck`: Typprüfung, vor jedem Commit
- `pnpm screenshots`: Screenshots mit WebKit in der Fenstergröße unter Sidecar, gegen den Server
  mit Testdaten (anderer Server mit `URL=…`)

Frag vor jeder Bibliothek, die über TanStack, React, Vite und Lezer hinausgeht.

## Vorgaben

- `src/git/` importiert nichts aus React oder TanStack, damit Electron später eine Option bleibt.
- Git läuft nur lesend und mit `--no-optional-locks`, weil Fork parallel auf demselben Repo
  arbeitet.
- Fenstergröße zum Prüfen: 1194 × 764 pt (Sidecar abzüglich Menü- und Titelleiste der Web-App)
- Bedienung mit Pencil oder vom Mac aus; mit dem Finger wird nur gescrollt.
- Farben des Diffs, Symbole der Dateiarten und Zeilennummern wie in Fork
- Neuester Commit oben; Dateinamen in der Liste nicht fett; Kopfzeile und Leisten mit fester Höhe
- Tooltips über `data-tip` statt `title`, weil die Web-App aus Safari `title` nicht anzeigt.
- Zeilennummern, Trenner und leere Zeilen lassen sich nicht mitmarkieren.
- Prüfe jede Änderung an der Oberfläche als Screenshot.
