# Auswahl von Repo, Worktree, Branch und Ansicht

Festgelegt und umgesetzt am 24.10.2026.

## Kopfzeile

Repo, Worktree und Branch stehen im Tab und nicht in der Kopfzeile. Die Kopfzeile hat dafür
Knöpfe mit einem Symbol, die direkt darunter ein Menü öffnen: einen Ordner für das Repo, ⌂ für
den Worktree und das Symbol eines Branches für den Branch. Den Namen nennt der Tooltip. Der Knopf
für den Worktree fehlt, wenn es nur einen gibt. Die Kopfzeile behält ihre feste Höhe. Die Zeilen
im Menü sind mindestens 36 pt hoch. Ein Suchfeld dient der Tastatur des Macs und wird nie
zwingend gebraucht.

## Repo

- In `~/.config/schrittmacher/config.json` stehen Wurzelverzeichnisse, vorgegeben ist
  `~/develop`. Der Server sucht darin bis in die dritte Ebene nach Git-Repos, auch innerhalb eines
  Repos, weil ein Repo für einen Workshop weitere Repos enthalten kann.
- Ein Worktree wird über `--git-common-dir` seinem Repo zugeordnet und erscheint nicht als eigenes
  Repo.
- Im Menü stehen oben die Repos im Ordner des Projekts, darunter alle gefundenen nach Name und
  zuletzt die über das Textfeld geöffneten. Die zuletzt geöffneten Ansichten stehen hinter der Uhr.
  Das Suchfeld filtert alle Abschnitte.
- Am Ende des Menüs steht ein freies Textfeld für einen Pfad, der per Copy & Paste eingefügt wird.
  Ein so geöffnetes Repo steht danach im Abschnitt „Über den Pfad geöffnet“.
- Der Server öffnet nur Pfade, die in einer Wurzel liegen oder über das Textfeld geöffnet wurden.

## Worktree

- Das Menü listet `git worktree list` mit Ordner und ausgechecktem Branch, der aktuelle ist
  markiert.
- Wird ein Worktree gewählt, wird auch sein ausgecheckter Branch gewählt.
- Hat ein Repo nur einen Worktree, öffnet der Knopf kein Menü.

## Branch

Branch und Worktree sind getrennt. Der gewählte Branch bestimmt nur die Commits der Liste
(`git log <branch>`), ausgecheckt wird nichts. So lassen sich die Schritte aus `schritte` neben
dem Live-Coding in `live_coding` zeigen.

- Im Menü stehen die lokalen Branches, darunter die Remotes eingeklappt wie in Fork. Der
  ausgecheckte Branch des Worktrees ist markiert.
- Weicht der gewählte Branch vom ausgecheckten ab, ist sein Knopf in der Kopfzeile in der Farbe
  der Branch-Badges hinterlegt, und der Tooltip nennt den ausgecheckten.
- Ein Klick auf einen Branch-Badge in der Commit-Liste wählt diesen Branch.
- Die Remotes sind im Menü nach Remote gruppiert, wie in der Seitenleiste von Fork.

### Ausgeblendete Branches

Neben jedem Branch steht im Menü ein Auge wie in Fork. Es blendet den Badge des Branches in der
Commit-Liste aus und wieder ein. Wählbar bleibt der Branch, im Menü steht er blass da.

- Ein Auge haben auch die Gruppen: „Lokal“, „Remotes“ und jedes einzelne Remote. Ein Branch in
  einer ausgeblendeten Gruppe lässt sich erst mit der Gruppe wieder einblenden.
- Der Branch der Liste behält seinen Badge, auch wenn er ausgeblendet ist.
- Gemerkt werden die ausgeblendeten Branches je Repo in `state.json`.

### Alle Branches

Ein Knopf mit dem Symbol zweier Branches, rechts neben dem Knopf für die Dateiliste, schaltet die
Commit-Liste um.
Sie zeigt dann die Commits aller Branches, nach Datum sortiert und mit einem Graphen wie in Fork.

- Die Commits ausgeblendeter Branches fehlen in diesem Modus ganz.
- Der gewählte Branch steht im Graphen in der linken Spalte. Commits anderer Branches sind blasser.
- Der Vorgänger eines Commits ist sein erster Parent, nicht die Zeile darunter.
- Eine Nummer in der URL findet zuerst den Schritt auf dem gewählten Branch. Ein Schritt mit
  derselben Nummer auf einem anderen Branch, etwa auf `live_coding`, steht mit seinem SHA in der
  URL.
- Der Modus gilt für alle Ansichten gleich und wird mit den übrigen Einstellungen gespeichert.

## Ansichten

Eine Ansicht ist die Kombination aus Repo, Worktree und Branch. Zwei Gruppen von Angaben werden
gemerkt:

- Je Ansicht: gewählter Vergleich als Nummer des Schritts (mit dem SHA als Ersatz für einen
  Commit ohne Nummer) und gewählte Datei.
- Für alle Ansichten gleich: Schriftgröße, Zeilenumbruch, Aufteilung des Diffs sowie Breite und
  Höhe von Dateiliste und Commit-Liste.

Beides speichert der Server unter `~/.config/schrittmacher/`, weil die Web-App im Dock einen
anderen Speicher als Safari hat.

- Die Ansicht steht in der URL, etwa `/?repo=…&worktree=live_coding&branch=schritte&to=07&file=…`.
  Zurück, Vor und Lesezeichen funktionieren damit.
- Ein Knopf mit Uhr-Symbol ganz links in der Tableiste, vor dem Projekt, öffnet die zuletzt
  geöffneten Ansichten. Jede Zeile nennt Repo, Branch und Schritt.
- Die Einträge der zuletzt geöffneten Ansichten und der Repos sind Links. Mit ⌘-Klick oder der
  mittleren Maustaste öffnen sie sich in einem neuen Tab der Tableiste.

## Tabs

Die Web-App aus dem Dock hat keine Tabs. Deshalb liegt wie in Fork eine eigene Tableiste über
der Kopfzeile. Jeder Tab ist eine Ansicht. Die Tabs dienen nur zum Lesen; ein Klick wechselt den
Tab, gewechselt wird über die Knöpfe der Kopfzeile.

- Ein neuer Tab öffnet sich im Hintergrund rechts neben dem aktiven.
- Ein Wechsel von Repo, Worktree oder Branch in der Kopfzeile ersetzt die Ansicht des aktiven
  Tabs. Ist die neue Ansicht schon in einem anderen Tab offen, wird dieser aktiv.
- Ein Tab öffnet seine Ansicht mit dem gemerkten Vergleich und der gemerkten Datei.
- Das Schließen-Kreuz steht am aktiven Tab und erscheint beim Überfahren der anderen. Der letzte
  Tab lässt sich nicht schließen.
- Die Beschriftung nennt Repo, Worktree und Branch. Zuerst wird der Name des Repos gekürzt. Der
  aktive Tab ist breiter als die übrigen.
- Das Kommando `schrittmacher <pfad>` öffnet den Worktree zum Pfad in einem neuen Tab und macht
  ihn aktiv, wie `fork <pfad>` in Fork. Ist er schon offen, wird sein Tab aktiv.
- Die offenen Tabs speichert der Server in `state.json`.
- Beim Start öffnet die App die zuletzt geöffnete Ansicht. Beim allerersten Start ist das Menü der
  Repos offen.

## Vergleich zweier Commits

Ein Klick in der Commit-Liste vergleicht einen Commit mit seinem Vorgänger. Ein ⌘-Klick wie in
Fork vergleicht den gewählten mit dem geklickten; dann sind beide blau. Darunter steht eine Zeile
mit beiden Commits, je mit Autor, SHA, Datum und Titel, der ältere oben. Die SHAs haben die
Farben der entfernten und der neuen Zeilen. Mit ⇧ und einer Pfeiltaste wandert ein Ende des
Vergleichs.
