# Editor für Markdown-Dateien

Der Editor auf Basis von CodeMirror 6 hat die eigene Seite `/edit`. Geöffnet wird eine Datei
mit `schrittmacher edit <datei.md>` oder über den Stift in der Markdown-Ansicht unter `/markdown`.
Fachlich hängt er nicht vom Rest von Schrittmacher ab und soll später ein eigenes Kommando werden.
Die Seite hat deshalb keinen Weg zu den Tabs und kennt keine Hinweise. Alle Teile liegen unter
`src/editor/`:

- `EditorPage.tsx`: die Seite mit Kopfzeile, Text und Vorschau
- `MarkdownEditor.tsx`: der Editor
- `editor.functions.ts`: Laden, Speichern, Formatieren und Sichern auf dem Server
- `backup.ts`: die automatische Sicherung
- `format.ts`: das Formatieren mit Prettier

Aus dem Rest von Schrittmacher nutzt der Editor die gerenderte Vorschau (`MarkdownView`), die
Prüfung des Pfads (`markdownPath`), den Aufruf von Git (`runGit`), die Tooltips und die Übergabe
vom Kommando (`useRequests`).

## Bedienung

| Aktion | Auslöser |
|---|---|
| Nur Text, Text und Vorschau nebeneinander, nur Vorschau | „Text“, „Geteilt“, „Vorschau“ oder ⌘1 bis ⌘3 |
| Speichern | ⌘S |
| Formatieren | ⌘⇧F oder „Formatieren“ in der Kopfzeile |
| Breite ändern | Strich neben den Zeilennummern ziehen, Escape bricht ab |
| Normale oder volle Breite | „Normal“ und „Voll“ in der Kopfzeile, bei „Geteilt“ nur „Voll“ |
| Verhältnis von Text und Vorschau | Trenner zwischen beiden ziehen, Doppelklick halbiert |

Beim Ziehen am Strich zeigt eine graue Fläche die neue Breite und wie viele Zeichen in eine Zeile
des Texts passen. Bei „Geteilt“ gilt die Breite für Text und Vorschau zusammen. Der Trenner
verschiebt das Verhältnis dagegen sofort.

Die Vorschau zeigt den Text im Editor, auch ungespeichert. Bei „Geteilt“ zeigt sie den Block, in
dem der Cursor steht, und hebt ihn leicht hervor. In einem Codeblock ist das die einzelne Zeile. Ein Link auf eine andere Markdown-Datei
öffnet sie im Editor, bei ungespeicherten Änderungen nach einer Rückfrage. Anzeige, Breiten,
Verhältnis und Schriftgröße merkt sich der Browser.

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
