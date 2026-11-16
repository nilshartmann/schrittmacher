# Editor

Der Editor auf Basis von CodeMirror 6 hat die eigene Seite `/edit`. Sein Schwerpunkt ist Markdown,
bearbeiten lässt sich aber jede Textdatei. Geöffnet wird eine Datei oder ein Workspace mit
`schrittmacher edit` oder eine Markdown-Datei über den Stift in der Markdown-Ansicht unter
`/markdown`. Fachlich hängt er nicht vom Rest von Schrittmacher ab und soll später ein eigenes
Kommando werden. Die Seite hat deshalb keinen Weg zu den Tabs und kennt keine Hinweise. Alle Teile
liegen unter `src/editor/`:

- `EditorLayout.tsx`: der Rahmen mit dem Baum eines Workspace und dem Menü „Zuletzt geöffnet“
- `EditorPage.tsx`: die Seite mit Kopfzeile, Text und Vorschau
- `MarkdownEditor.tsx`: der Editor
- `languages.ts`: die Hervorhebung je Art von Datei
- `editor.functions.ts`: Laden, Speichern, Formatieren und Sichern auf dem Server
- `workspace.ts`: Workspaces, Entwürfe, die Liste „Zuletzt geöffnet“ und die Prüfung des Zugriffs
- `scrollSync.ts`: der Abgleich von Text und Vorschau beim Scrollen
- `backup.ts`: die automatische Sicherung
- `format.ts`: das Formatieren mit Prettier
- `highlights.ts`: das Speichern und Wiederfinden der Markierungen

Aus dem Rest von Schrittmacher nutzt der Editor die gerenderte Vorschau (`MarkdownView`), den
Aufruf von Git (`runGit`), das Menü, die Tooltips und die Übergabe vom Kommando (`useRequests`).

## Bedienung

| Aktion | Auslöser |
|---|---|
| Nur Text, Text und Vorschau nebeneinander, nur Vorschau (bei Markdown) | „Text“, „Geteilt“, „Vorschau“ oder ⌘1 bis ⌘3 |
| Zuletzt geöffnete Workspaces und Dateien | Uhr links in der Kopfzeile |
| Zur vorherigen Datei, mit jedem weiteren E eine weiter zurück | ⌘E, ⌘ gedrückt halten; ⇧E geht wieder vor, Loslassen von ⌘ öffnet, Escape bricht ab |
| Neue Datei im Workspace, neuer Entwurf | Plus über dem Baum |
| Speichern | ⌘S |
| Stand der Datei neu laden | Pfeil im Kreis in der Kopfzeile |
| Pfad kopieren, Ordner in ForkLift, Repo in Fork, Datei in BBEdit öffnen | Knöpfe beim Überfahren des Dateinamens |
| Formatieren | ⌘⇧F oder „Formatieren“ in der Kopfzeile |
| Bild aus der Zwischenablage als Abbildung einfügen (bei Markdown) | ⌘V |
| Auswahl markieren oder Markierung aufheben | ⌘⇧M oder „Markieren“ in der Kopfzeile |
| Zur nächsten Markierung | Zahl neben „Markieren“ |
| Breite ändern | Strich neben den Zeilennummern ziehen, Escape bricht ab |
| Normale oder volle Breite | „Normal“ und „Voll“ in der Kopfzeile, bei „Geteilt“ nur „Voll“ |
| Verhältnis von Text und Vorschau | Trenner zwischen beiden ziehen, Doppelklick halbiert |

Beim Ziehen am Strich zeigt eine graue Fläche die neue Breite und wie viele Zeichen in eine Zeile
des Texts passen. Bei „Geteilt“ gilt die Breite für Text und Vorschau zusammen. Der Trenner
verschiebt das Verhältnis dagegen sofort.

Der Editor fragt regelmäßig nach der letzten Änderung der Datei. Hat sie sich außerhalb des
Editors geändert, steht neben dem Knopf zum Neuladen „Datei geändert“. Neu geladen wird erst auf
Klick, und zwar als eigener Schritt für ⌘Z. Ungespeicherte Änderungen werden vorher gesichert und
erst nach einer Rückfrage verworfen.

Die Vorschau zeigt den Text im Editor, auch ungespeichert. Bei „Geteilt“ legt der Umschalter
„Folgen“ fest, wie sie dem Text folgt:

- **Aus:** Die Vorschau bleibt, wo sie ist.
- **Cursor:** Die Vorschau scrollt den Block der Cursorzeile in den sichtbaren Bereich. In einem
  Codeblock ist das die einzelne Zeile.
- **Scrollen:** Text und Vorschau scrollen gemeinsam, in beide Richtungen.

Bei „Cursor“ und „Scrollen“ ist der Block der Cursorzeile leicht hervorgehoben. Abgeglichen wird
über die erste Zeile, die jeder Block der Vorschau in der Datei hat (`src/editor/scrollSync.ts`).
Zwischen zwei Blöcken wird gleichmäßig verteilt. Ein Link auf eine andere Markdown-Datei
öffnet sie im Editor, bei ungespeicherten Änderungen nach einer Rückfrage. Anzeige, Folgen,
Breiten, Verhältnis und Schriftgröße merkt sich der Browser.

## Abbildungen einfügen

Liegt ein Bild in der Zwischenablage, etwa ein Screenshot, fragt ⌘V in einer Markdown-Datei nach
dem Namen einer neuen Datei. Enthält die Zwischenablage außerdem Text, wird wie gewohnt der Text
eingefügt.

- Vorgeschlagen wird die nächste freie Nummer, etwa `abb-013`. Gezählt werden alle Dateien, deren
  Name mit `abb-<nr>` beginnt, auch mit Suffix wie `abb-012-listing-ts-query-beispiel.png`. In
  einem Workspace zählt der ganze Workspace, sonst der Ordner der Datei.
- Der Cursor steht hinter der Nummer, sodass sich gleich ein Suffix anhängen lässt. Die Endung
  ergibt sich aus dem Bild.
- Das Bild landet im Ordner der Markdown-Datei. Eine Datei, die es schon gibt, wird nicht
  überschrieben.
- An der Stelle des Cursors steht danach der Link, etwa `![](abb-013.png)`.

## Markierungen

Eine Markierung hebt eine Stelle mit gelbem Hintergrund und roter Schrift hervor, etwa einen
Platzhalter, an den noch einmal heranzugehen ist. Sie erscheint im Text und in der Vorschau, in
einem Codeblock der Vorschau aber nicht. Es gibt nur eine Art Markierung.

⌘⇧M wirkt je nach Auswahl:

- Ohne Auswahl entfernt es die Markierung, in der der Cursor steht.
- Berührt die Auswahl Markierungen, entfernt es den ausgewählten Teil daraus.
- Sonst markiert es die Auswahl. Überlappende Markierungen werden zusammengefasst.

Beim Tippen wandert eine Markierung mit dem Text mit. Text am Rand gehört nicht dazu, Text darin
schon. Wird der markierte Text ganz gelöscht, verschwindet die Markierung.

Die Markierungen liegen außerhalb der Datei unter
`~/.config/schrittmacher/markierungen/<Pfad>.json`. Gespeichert werden sie kurz nach jeder
Änderung, mit dem Text im Editor, also auch ungespeichert. Zu jeder Markierung gehören ihr Text, ein
Stück Text davor und danach und ihre Position. Beim Öffnen wird jede über ihren Text
wiedergefunden. Unter mehreren Treffern gilt der mit der passendsten Umgebung, bei Gleichstand der
nächste zur alten Position. Eine Markierung, deren Text in der Datei fehlt, bleibt gespeichert und
steht als „nicht gefunden“ in der Kopfzeile. Ein Klick darauf verwirft sie nach einer Rückfrage.

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

## Workspaces

Gedacht ist der Editor zum Schreiben von Artikeln und Büchern in Markdown. Ein Kapitel ist dann eine Datei. Daneben
braucht es das Material, über das geschrieben wird, etwa JavaScript-Dateien.

Ein Workspace ist ein Ordner, wie in VS Code. Der Begriff „Projekt“ ist in Schrittmacher schon
für gespeicherte Sammlungen von Tabs vergeben, der Begriff „Ordner“ für die Gruppen im Menü der
Repos.

### Kommandos

| Kommando | Wirkung |
|---|---|
| `schrittmacher edit <ordner>` | öffnet den Ordner als Workspace |
| `schrittmacher edit <datei>` | öffnet die Datei; liegt sie in einem bekannten Workspace, mit dessen Baum |
| `schrittmacher edit <neue-datei>` | öffnet einen leeren Editor; die Datei entsteht beim ersten ⌘S, ihr Ordner muss es geben |
| `schrittmacher edit --neu` | legt einen Entwurf im Workspace „Entwürfe“ an und öffnet ihn |

### Baum und Dateien

- Links steht der Baum des Workspace mit allen Dateien. Es fehlt nur, was Git ignoriert. In einem
  Repo liefert das `git ls-files --cached --others --exclude-standard`. Außerhalb eines Repos
  überspringt der Server versteckte Ordner und `node_modules`.
- Jede Textdatei lässt sich öffnen und speichern. Als Text gilt eine Datei, die in den ersten
  Kilobytes kein Null-Byte enthält und unter einer Größengrenze bleibt.
- Markdown ist das Dokument, an dem geschrieben wird, und behält Vorschau und Folgen. Alle anderen
  Textdateien sind Material. Sie zeigen nur den Text, mit Hervorhebung für JavaScript, TypeScript,
  JSON, YAML, Java und XML. Die Hervorhebung kommt aus denselben Lezer-Parsern wie im Diff, ohne
  Pakete `@codemirror/lang-*`. Andere Dateien wie CSS oder HTML erscheinen ohne Hervorhebung.
- Formatieren gibt es für alle Dateien, die Prettier kennt. Markierungen und Sicherung hängen nur am
  Pfad und gelten deshalb für jede Textdatei.
- Bilder öffnen sich als Ansicht. Andere Binärdateien stehen im Baum, lassen sich aber nicht öffnen.
- Das Plus über dem Baum öffnet ein Feld für den Pfad einer neuen Datei, vorbelegt mit dem Ordner
  der offenen Datei. Enter legt sie an, Escape bricht ab. Ein Pfad wie `kapitel/03-zustand.md` legt
  fehlende Ordner mit an.
- Der Baum fragt alle paar Sekunden nach neuen Dateien. Die aufgeklappten Ordner merkt sich der
  Browser je Workspace.

### Entwürfe

Der Workspace „Entwürfe“ sammelt schnelle Notizen. Seine Wurzel ist
`~/.config/schrittmacher/entwuerfe/`. Er steht immer im Menü „Zuletzt geöffnet“ und lässt sich
nicht entfernen.

- Ein Entwurf ist eine Datei, benannt nach dem Zeitpunkt, etwa `2026-11-16-1432.md`.
- Im Baum zeigt er seine erste Überschrift oder Zeile, darunter das Datum. Der neueste steht oben.
- ⌘S speichert ihn an seinem Ort, ohne Rückfrage. Das Plus über dem Baum legt einen neuen an.

### Zuletzt geöffnet

Das Menü „Zuletzt geöffnet“ in der Kopfzeile listet oben Workspaces, darunter Dateien. Entwürfe
zählen als Dateien. Je Liste merkt sich der Server die letzten 20. Die Liste liegt in
`~/.config/schrittmacher/editor.json` und nicht in `state.json`, weil der Editor nicht vom Rest von
Schrittmacher abhängen soll. Auch `schrittmacher edit` ergänzt sie.
Eine Datei, die es nicht mehr gibt, steht ausgegraut darin. Ein Klick darauf nimmt sie heraus.
Ein eigenes Menü zum Wechseln der Workspaces gibt es nicht, weil es dieselbe Liste wäre.

### Zugriff

Jede Seite im Browser kann die Funktionen des Servers aufrufen. Lesen und Schreiben gehen deshalb
nur bei Markdown-Dateien, innerhalb bekannter Workspaces und bei zuletzt geöffneten Dateien. Andere
Dateien, etwa `~/.zshrc`, bleiben unerreichbar. Bekannt sind „Entwürfe“ und die Workspaces in der
Liste „Zuletzt geöffnet“. Eintragen kann sie nur das Kommando: `/api/edit` lehnt jede Anfrage ab,
die eine fremde Seite im Browser schickt (`Origin`).
