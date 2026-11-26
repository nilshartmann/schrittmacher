# Editor

Der Editor auf Basis von CodeMirror 6 hat die eigene Seite `/edit`. Sein Schwerpunkt ist Markdown,
bearbeiten lässt sich aber jede Textdatei. Geöffnet wird eine Datei oder ein Workspace mit
`schrittmacher edit` oder eine Markdown-Datei über den Stift in der Markdown-Ansicht unter
`/markdown`. Fachlich hängt er nicht vom Rest von Schrittmacher ab und soll später ein eigenes
Kommando werden. Die Seite hat deshalb keinen Weg zu den Tabs. Alle Teile liegen unter
`src/editor/`:

- `EditorLayout.tsx`: der Rahmen mit dem Baum eines Workspace und dem Menü „Zuletzt geöffnet“, das
  er mit dem Viewer teilt (`src/viewer/RecentMenu.tsx`)
- `EditorPage.tsx`: die Seite mit Kopfzeile, Text und Vorschau
- `MarkdownEditor.tsx`: der Editor
- `languages.ts`: die Hervorhebung je Art von Datei
- `editor.functions.ts`: Laden, Speichern, Formatieren und Sichern auf dem Server
- `workspace.ts`: Workspaces, Entwürfe, die Liste „Zuletzt geöffnet“ und die Prüfung des Zugriffs
- `scrollSync.ts`: der Abgleich von Text und Vorschau beim Scrollen
- `backup.ts`: die automatische Sicherung
- `format.ts`: das Formatieren mit Prettier
- `highlights.ts`: das Speichern und Wiederfinden der Markierungen
- `noteMarks.ts`: Hinweise und Anmerkungen im Text, also Zahlen am Rand, unterlegte Stellen und der
  Knopf „Hinweis“
- `Comments.tsx`: die Anmerkungen von Claude, ihr Abfragen und ihre Liste in der Spalte

Aus dem Rest von Schrittmacher nutzt der Editor die gerenderte Vorschau (`MarkdownView`), den
Aufruf von Git (`runGit`), das Menü, die Tooltips, die Übergabe vom Kommando (`useRequests`) und
das gemeinsame Menü „Zuletzt geöffnet“ mit Projekten und Ansichten des Viewers. Dazu kommen die
Hinweise zu Markdown-Dateien mit ihrer Spalte und dem Dialog für Claude (`src/viewer/MarkdownNotes.tsx`,
`src/viewer/NotesClaude.tsx`).

## Bedienung

| Aktion | Auslöser |
|---|---|
| Nur Text, Text und Vorschau nebeneinander, nur Vorschau (bei Markdown) | „Text“, „Geteilt“, „Vorschau“ oder ⌘1 bis ⌘3 |
| Zuletzt geöffnete Projekte, Ansichten, Workspaces und Dateien | Uhr links in der Kopfzeile |
| Zur vorherigen Datei, mit jedem weiteren E eine weiter zurück | ⌘E, ⌘ gedrückt halten; ⇧E geht wieder vor, Loslassen von ⌘ öffnet, Escape bricht ab |
| Workspace in Fork (sein Repo), ForkLift oder iTerm2 öffnen | Pfeil neben dem Namen des Workspace |
| Neue Datei im Workspace, neuer Entwurf | Plus über dem Baum |
| Datei im Baum umbenennen | Datei anklicken, dann Enter oder F2; Enter oder Klick daneben benennt um, Escape bricht ab |
| Datei hinter einem markierten Pfad umbenennen, etwa einem Bild | F2 |
| Datei schließen | × rechts in der Kopfzeile |
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
| Hinweise ein- und ausblenden (bei Markdown) | Sprechblase in der Kopfzeile |
| Hinweis zur Auswahl oder, in einer Überschrift ohne Auswahl, zum Abschnitt | Knopf „Hinweis“ oder ⌘⌥K |
| Datei von Claude prüfen lassen (bei Markdown) | „Prüfen …“ in der Kopfzeile |

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

## Editor und Viewer in zwei Fenstern

Mit ⌘N öffnet die Web-App ein zweites Fenster, etwa für eine Werkstatt im Viewer neben dem Artikel
im Editor. Jedes Fenster sagt beim Abholen der Anforderungen, ob es Viewer oder Editor ist
(`useRequests`, `src/server/requests.ts`). Danach verteilen sie sich so:

- `schrittmacher edit …` geht an den Editor.
- `schrittmacher <ordner>` und `schrittmacher <datei.md>` gehen an den Viewer.
- Hat sich einige Sekunden lang kein Fenster der passenden Art gemeldet, nimmt das andere die
  Anforderung und wechselt die Ansicht. Mit einem einzigen Fenster bleibt es deshalb beim
  Wechsel.

Gefragt wird auch im Hintergrund, damit ein verdecktes Fenster seine Anforderung bekommt. Nach vorn
holt das Kommando nur das zuletzt benutzte Fenster der Web-App.

## Hinweise

Zu einer Markdown-Datei zeigt der Editor dieselben Hinweise wie die Markdown-Ansicht
(`docs/markdown-hinweise.md`). Sie liegen am selben Ort, ein Hinweis aus der einen Ansicht steht
also auch in der anderen. Die Sprechblase in der Kopfzeile blendet sie ein und aus, die Zahl daneben
nennt alle Hinweise der Datei. Der Browser merkt sich die Einstellung. Eine neue Datei bekommt
Hinweise erst nach dem ersten Speichern.

Eingeblendet stehen die Hinweise rechts in einer eigenen Spalte, neben Text und Vorschau. Der
Trenner links davon ändert ihre Breite, ein Doppelklick stellt sie zurück. Im Text steht links der
Zeilennummern je Stelle die Zahl ihrer Hinweise. Die Zeilen einer Stelle sind dezent unterlegt,
Abschnitte und die ganze Datei haben dagegen eine hohle Zahl ohne Unterlegung. Ein Klick auf die
Zahl hebt die Hinweise in der Spalte hervor und unterlegt die Stelle kräftiger. Ein Klick auf den
Kopf eines Hinweises setzt den Cursor an seine Stelle.

Ein neuer Hinweis entsteht auf drei Wegen:

- Text auswählen: Am Ende der Auswahl erscheint der Knopf „Hinweis“, alternativ gilt ⌘⌥K. Der
  Hinweis bezieht sich auf die ganzen Zeilen. Deckt die Auswahl sie nicht ganz ab, steht der
  ausgewählte Teil unter „Markiert“.
- Cursor in eine Überschrift setzen, ohne Auswahl: Derselbe Knopf und ⌘⌥K legen einen Hinweis zum
  Abschnitt an. Der Knopf erscheint erst, wenn der Cursor dorthin bewegt wurde, nicht beim Öffnen
  und nicht beim Tippen.
- Sprechblase oben in der Spalte: Sie legt einen Hinweis zur ganzen Datei an.

Die Bezüge „Absatz“, „Listenpunkt“, „Codeblock“ und „Zitat“ entstehen nur in der Markdown-Ansicht,
erscheinen aber auch im Editor. Wiedergefunden wird eine Stelle im Text des Editors, auch
ungespeichert. Neu geladen werden die Hinweise beim Speichern.

### Prüfen durch Claude

„Prüfen …“ in der Kopfzeile öffnet den Dialog „Von Claude prüfen“. Er gleicht dem Dialog „In Claude
…“ der Hinweise, beginnt aber mit dem Auftrag, die Datei wie in einem Review zu prüfen und die
Hinweise dabei zu berücksichtigen. Gibt es ungespeicherte Änderungen, fragt der Editor vorher, ob er
speichern soll, weil Claude die Datei von der Platte liest. Claude Code startet in iTerm im Worktree
der Datei, ohne Repo in ihrem Ordner.

Hinter den Prompt setzt Schrittmacher, wohin Claude seine Anmerkungen schreibt und in welchem Format.
Dieser Teil steht nicht im Dialog, damit sich das Format nicht versehentlich ändert
(`commentsFormat` in `src/notes/markdownComments.ts`). Nach dem Start blendet der Editor die
Hinweise ein.

### Anmerkungen von Claude

Claude schreibt seine Anmerkungen als JSON in eine Datei je Markdown-Datei. Jede Anmerkung besteht
aus drei Teilen:

- `quote`: der zitierte Text aus der Datei, leer für eine Anmerkung zur ganzen Datei
- `before`: ein Stück Text direkt davor, damit sich ein Zitat zuordnen lässt, das mehrmals vorkommt
- `text`: die Anmerkung als Markdown

Der Editor fragt alle anderthalb Sekunden, ob sich die Datei geändert hat. Die Anmerkungen erscheinen
deshalb, sobald Claude sie geschrieben hat. Sie stehen oben in der Spalte der Hinweise, in Violett
statt in Gelb. Im Text ist jedes Zitat violett unterstrichen, und am Rand steht eine violette Zahl.
Ein Klick auf die Zahl hebt die Anmerkung in der Spalte hervor, ein Klick auf ihren Kopf setzt den
Cursor an die Stelle. Der Haken verwirft eine Anmerkung als erledigt.

Wiedergefunden wird ein Zitat wörtlich im Text des Editors, auch ungespeichert. Fehlt es wörtlich,
wird es ohne Leerraum am Rand gesucht. Steht es mehrmals da, gilt die Stelle, vor der am meisten von
`before` übereinstimmt. Lässt es sich nicht finden, bleibt die Anmerkung mit „Stelle nicht gefunden“
in der Spalte.

Eine neue Prüfung ersetzt die bisherigen Anmerkungen. Vor dem Start von Claude legt der Server sie
mit Zeitstempel unter `sicherung` ab und entfernt sie, damit bis zum Ergebnis keine alten zu sehen
sind. Je Datei bleiben die letzten 20 Sicherungen liegen. Wiederherstellen geht vorerst nur von Hand.

Die Anmerkungen liegen unter `~/.config/schrittmacher/hinweise/claude/anmerkungen/`, die Sicherungen
im Unterordner `sicherung`. Der Name ist derselbe wie bei den Hinweisen der Datei. Sie liegen nicht
neben den Hinweisen unter `hinweise/markdown`, weil Claude Code über `--add-dir` nur den Ordner
`claude` erreicht.

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

## Umbenennen über eine Referenz

Ist im Text ein Pfad markiert, etwa `abb-002.png` in `![](abb-002.png)`, öffnet F2 einen Dialog
für den neuen Namen der Datei. Der Pfad gilt relativ zum Ordner der offenen Datei.

- Umbenannt wird nur im selben Ordner. Die Datei muss in einem bekannten Workspace liegen.
- Danach ändern sich die Markierung und jedes Ziel eines Links `](…)` mit demselben Pfad im Text.
  Ein Name mit Leerzeichen steht in spitzen Klammern.
- Die Änderung am Text ist ein Schritt für ⌘Z und wird erst mit ⌘S gespeichert. ⌘Z nimmt nur den
  Text zurück, die Datei behält ihren neuen Namen.
- Links in anderen Dateien bleiben unverändert.

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
Beim Formatieren und beim Neuladen der Datei wird jede Markierung über ihren Text
wiedergefunden, wie beim Öffnen. ⌘Z stellt danach Text und Markierungen zusammen wieder her.

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
| `schrittmacher edit` | öffnet den zuletzt gezeigten Stand, wie `/edit` ohne Angaben |
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
- Ein Klick auf eine Zeile im Baum gibt ihr den Fokus, wie im Explorer von VS Code. Der Editor
  übernimmt ihn erst nach einem Klick in den Text. Enter auf einer Datei öffnet ein Feld mit ihrem
  Namen, in dem der Name ohne Endung ausgewählt ist. Umbenannt wird nur im selben Ordner, und eine
  vorhandene Datei bleibt unberührt. Markierungen und der Eintrag in „Zuletzt geöffnet“ gehen mit.
  Ist die Datei offen, öffnet sie sich unter dem neuen Namen, bei ungespeicherten Änderungen nach
  einer Rückfrage.
- Der Baum fragt alle paar Sekunden nach neuen Dateien. Die aufgeklappten Ordner merkt sich der
  Browser je Workspace.

### Entwürfe

Der Workspace „Entwürfe“ sammelt schnelle Notizen. Seine Wurzel ist
`~/.config/schrittmacher/entwuerfe/`. Er steht immer im Menü „Zuletzt geöffnet“ und lässt sich
nicht entfernen.

- Ein Entwurf ist eine Datei, benannt nach dem Zeitpunkt, etwa `2026-11-16-1432.md`.
- Im Baum zeigt er seine erste Überschrift oder Zeile, darunter das Datum. Der neueste steht oben.
- ⌘S speichert ihn an seinem Ort, ohne Rückfrage. Das Plus über dem Baum legt einen neuen an.
- Ein leerer Entwurf wird beim Schließen gelöscht, damit ein versehentlicher Klick auf das Plus
  keine Spuren hinterlässt.

### Zuletzt geöffnet

Das Menü „Zuletzt geöffnet“ unter der Uhr in der Kopfzeile ist in Viewer und Editor gleich. Es hat
zwei Teile:

- **Schrittmacher:** die Projekte und die zuletzt gemerkten Ansichten des Viewers. Eine Wahl wechselt
  zum Viewer. Ein Projekt ersetzt dort die Tableiste, eine Ansicht öffnet sich in einem Tab ganz
  links, wie im Menü der Repos.
- **Editor:** oben Workspaces, darunter Dateien. Entwürfe zählen als Dateien. Im Viewer wechselt
  eine Wahl zum Editor.

Bei ungespeicherten Änderungen fragt der Editor vor jedem Wechsel nach. Ansichten, Workspaces und
Dateien haben beim Überfahren rechts einen Knopf, der sie in einem neuen Fenster der Web-App öffnet.
Für Projekte gibt es ihn noch nicht.

Für den Teil „Editor“ gilt: Je Liste merkt sich der Server die letzten 20. Die Liste liegt in
`~/.config/schrittmacher/editor.json` und nicht in `state.json`, weil der Editor nicht vom Rest von
Schrittmacher abhängen soll. Auch `schrittmacher edit` ergänzt sie.
Eine Datei, die es nicht mehr gibt, steht ausgegraut darin. Ein Klick darauf nimmt sie heraus.
Ein eigenes Menü zum Wechseln der Workspaces gibt es nicht, weil es dieselbe Liste wäre.

Daneben steht in `editor.json` unter `last` der zuletzt gezeigte Stand, also Datei und Workspace.
Die Seite `/edit` ohne Angaben öffnet ihn, ebenso `schrittmacher edit` ohne Angabe. Gibt es die
Datei nicht mehr, öffnet sich nur der Workspace. Fehlt beides, bleibt die Seite leer. Ein Eintrag,
der aus der Liste verschwindet, verschwindet auch aus dem gemerkten Stand.

Das × in der Kopfzeile schließt die offene Datei. Ungespeicherte Änderungen fragt es vorher ab. Beim
Schließen passiert Folgendes:

1. Die Datei verschwindet aus der Liste der Dateien und damit auch aus ⌘E.
2. Ist sie ein leerer Entwurf, wird sie gelöscht.
3. Es öffnet sich die nächste Datei der Liste. Ist die Liste leer, bleibt der Workspace ohne Datei
   offen.

Weil die geschlossene Datei aus der Liste verschwindet, geht jedes weitere Schließen eine Datei
weiter zurück. Ein ⌘W gibt es nicht, weil Safari damit das Fenster der Web-App schließt.

### Zugriff

Jede Seite im Browser kann die Funktionen des Servers aufrufen. Lesen und Schreiben gehen deshalb
nur bei Markdown-Dateien, innerhalb bekannter Workspaces und bei zuletzt geöffneten Dateien. Andere
Dateien, etwa `~/.zshrc`, bleiben unerreichbar. Bekannt sind „Entwürfe“ und die Workspaces in der
Liste „Zuletzt geöffnet“. Eintragen kann sie nur das Kommando: `/api/edit` lehnt jede Anfrage ab,
die eine fremde Seite im Browser schickt (`Origin`).
