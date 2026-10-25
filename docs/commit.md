# Commit und Push beim Live-Coding

Festgelegt und umgesetzt am 25.10.2026.

## Ablauf einer Veranstaltung

Vor einer Veranstaltung wird vom Stand auf `main` ein Branch für das Live-Coding angelegt, meist
`live_coding`, und im Worktree ausgecheckt. In Schrittmacher sind dafür zwei Tabs offen:

- **Live**: der Worktree mit dem ausgecheckten Branch für das Live-Coding
- **Schritte**: derselbe Worktree mit dem Branch `schritte`, nicht ausgecheckt

Der Tab „Schritte“ dient als Spickzettel: Er zeigt den nächsten Schritt und im Diff den Code zum
Kopieren. Im Tab „Live“ wird zwischendurch committet und gepusht, damit die Teilnehmer den Stand
holen können. Die Commits auf `live_coding` entsprechen nicht den Schritten, weil Schritte
fehlen oder Zwischenschritte dazukommen können. Schrittmacher ordnet sie deshalb nicht zu.

## Lokale Änderungen

- Ganz oben in der Commit-Liste steht wie in Fork die Zeile „Lokale Änderungen“, solange der
  Worktree Änderungen hat.
- Die Zeile erscheint nur, wenn der gewählte Branch im Worktree ausgecheckt ist. Im Tab „Schritte“
  fehlt sie also.
- Ist die Zeile gewählt, zeigt die Dateiliste die geänderten Dateien und der Diff ihre Änderungen
  gegen `HEAD`. Neue Dateien erscheinen als hinzugefügt.

## Auswahl der Dateien

- Jede Datei in der Dateiliste hat einen Haken. Ein Klick auf den Haken ändert die Auswahl, ein
  Klick auf den Namen zeigt wie bisher den Diff.
- Über der Liste stehen die Knöpfe „Alle auswählen“ und „Auswahl aufheben“ als Symbole.
- Die Leertaste schaltet den Haken der gewählten Datei um.
- Haken, Nachricht und Force-Push werden je Worktree gemerkt, solange die Seite offen ist. Ein
  Wechsel zum Tab mit den Schritten verliert sie also nicht.
- Anfangs sind alle Dateien angehakt. Eine Datei, die neu in der Liste erscheint, ist ebenfalls
  angehakt. Eine abgewählte Datei bleibt abgewählt, bis committet wird.
- Nach einem Commit sind wieder alle Dateien angehakt.

## Commit

Unten in der Spalte der Dateiliste stehen wie in Fork folgende Elemente:

- ein Feld für die Nachricht, nicht vorbelegt
- die Checkbox „Force-Push“
- der Knopf „Commit“, gesperrt ohne Nachricht oder ohne angehakte Datei; ⌘↩ im Feld committet
  ebenso

Der Commit enthält die angehakten Dateien, auch neue und gelöschte. Danach ist der neue Commit
ausgewählt, auch wenn noch lokale Änderungen übrig sind.

## Push

- Jeder Commit wird sofort gepusht. Mit „Force-Push“ läuft der Push mit `--force-with-lease`.
- Hat der Branch noch kein Ziel auf dem Remote, pusht Schrittmacher mit `-u origin <branch>`.
- Vorausgesetzt wird genau ein Remote `origin`. Andere Fälle werden vorerst nicht behandelt.
- Scheitert der Push, etwa ohne Netz, bleibt der Commit bestehen. Schrittmacher zeigt die Meldung
  von Git und einen Knopf, mit dem sich der Push wiederholen lässt.
- Ein gelungener Push wird kurz unter der Dateiliste gemeldet.
