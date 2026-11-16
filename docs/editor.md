# Editor für Markdown-Dateien

Die Markdown-Ansicht unter `/markdown` hat einen Editor auf Basis von CodeMirror 6. Fachlich hängt
er nicht vom Rest von Schrittmacher ab und soll später ein eigenes Kommando werden. Die Teile
dafür liegen deshalb getrennt:

- `src/viewer/MarkdownEditor.tsx`: der Editor
- `src/editor/backup.ts`: die automatische Sicherung
- `src/editor/format.ts`: das Formatieren mit Prettier

## Bedienung

| Aktion | Auslöser |
|---|---|
| Editor öffnen und schließen | Stift in der Kopfzeile; beim Schließen wird gespeichert |
| Speichern | ⌘S |
| Formatieren | ⌘⇧F oder „Formatieren“ in der Kopfzeile |
| Breite ändern | Strich neben den Zeilennummern ziehen, Escape bricht ab |
| Normale oder volle Breite | „Normal“ und „Voll“ in der Kopfzeile |

Beim Ziehen zeigt eine graue Fläche die neue Breite und wie viele Zeichen in eine Zeile passen.
Die Breite merkt sich der Browser.

## Sicherung

Ungespeicherter Text wird gesichert, sobald fünf Sekunden lang nicht getippt wurde, spätestens aber
30 Sekunden nach der ersten Änderung. Auch jedes Speichern löst eine Sicherung aus. Ohne Änderung
seit der letzten Sicherung entsteht keine neue.

Liegt die Datei in einem Repo mit mindestens einem Commit, landet die Sicherung als Commit auf dem
Branch `sicherung/<branch>`. Der Commit enthält den Tree von `HEAD` mit dem gesicherten Text an der
Stelle der Datei. Sein Elternteil ist die vorige Sicherung, bei der ersten `HEAD`. Worktree, Index
und `HEAD` bleiben unberührt, weil Git mit einem eigenen Index im Temp-Ordner arbeitet. Gepusht wird
der Branch nur von Hand.

Nach jeder Sicherung steht für vier Sekunden in der Kopfzeile, wohin sie ging, in einem Repo mit
der gekürzten ID des Commits. Danach zeigt die Kopfzeile die Uhrzeit der letzten Sicherung, und
ihr Tooltip nennt Branch und Commit.

Außerhalb eines Repos landet die Sicherung als Kopie unter
`~/.config/schrittmacher/sicherung/<Name>-<Hash des Pfads>/<Zeitpunkt>.md`. Je Datei bleiben die
letzten 50 Kopien liegen.

## Formatieren

Formatiert wird mit Prettier auf dem Server. Gilt für die Datei eine Konfiguration wie
`.prettierrc` oder `.editorconfig`, dann mit deren Einstellungen. Ohne Konfiguration bleiben die
Zeilenumbrüche im Fließtext erhalten (`proseWrap: preserve`). Das Ergebnis landet nur im Editor
und ist ein eigener Schritt für ⌘Z. Gespeichert wird erst mit ⌘S.

Prettier vereinheitlicht dabei die Schreibweise, etwa `*` zu `-` in Listen und `*kursiv*` zu
`_kursiv_`, und richtet Tabellen aus.
