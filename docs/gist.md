# Aufgaben in ein Gist kopieren

Festgelegt am 27.10.2026.

## Ablauf eines Workshops

Die Teilnehmenden finden die Beschreibungen der Aufgaben in einem secret Gist, dessen URL sie zu
Beginn bekommen. Im Laufe des Tages kommen die Aufgaben dort nacheinander hinzu. Die Aufgaben
stehen in den Schritt-Commits des Workshop-Repos, meist unter `AUFGABEN/`.

Zu einem Workshop gehören mehrere Gists: einer oder mehrere zum Ausprobieren in der Vorbereitung
und einer für die Veranstaltung selbst. Vorbild ist das Skript `gist.sh` aus der Planung der
JavaScript Days 2026.

## Gists eines Repos

- Die Gists werden je Repo in `state.json` gespeichert, mit Kennung und Beschreibung. Alle
  Worktrees und Branches des Repos nutzen dieselbe Liste.
- Im Untermenü „Kopieren nach …“ stehen sie nach den Tabs im Abschnitt „Gists“, der neueste oben.
- Beim Überfahren hat jeder Gist die Knöpfe „Im Browser öffnen“ und „URL kopieren“. Geöffnet
  wird er mit `open` im Standardbrowser des Macs, nicht in der Web-App aus Safari.
- Unter den Gists stehen folgende Einträge, die jeweils einen Dialog öffnen:
  - „Neuer Gist …“: Nach Eingabe einer Beschreibung wird ein secret Gist mit der gewählten Datei
    als erstem Inhalt angelegt. Ein leerer Gist ist bei GitHub nicht möglich. Die URL des neuen
    Gists landet in der Zwischenablage.
  - „Gist eintragen …“: Ein vorhandener Gist wird über seine URL oder Kennung in die Liste
    aufgenommen. Danach folgt die Bestätigung, die gewählte Datei in ihn hochzuladen.

## Kopieren

- Kopiert wird wie beim Kopieren in einen Tab die Fassung nach der Änderung im gewählten Commit,
  bei den lokalen Änderungen die Datei im Worktree.
- Im Gist bekommt die Datei ihren Namen ohne Pfad, aus `AUFGABEN/2-pflanzenuebersicht.md` wird
  `2-pflanzenuebersicht.md`. Eine vorhandene Datei gleichen Namens wird ersetzt, URL und Anker
  bleiben dabei gleich.
- GitHub zeigt die Dateien eines Gists alphabetisch. Die Reihenfolge ergibt sich deshalb aus den
  Nummern in den Dateinamen.
- Kopiert wird immer eine einzelne Datei. Eine Freigabe bis Nummer N wie in `gist.sh` gibt es
  nicht. Ein Index mit Links auf die freigegebenen Aufgaben wird in den Schritt-Commits gepflegt
  und bei Bedarf aus demselben Commit mitkopiert.
- Entfernt werden Dateien nur auf github.com.

## Bestätigung

Eine Datei im Gist ist sofort für alle mit dem Link sichtbar. Vor dem Hochladen erscheint deshalb
eine Bestätigung als Dialog mit folgenden Angaben:

- dem Dateinamen im Gist
- der Beschreibung des Gists
- ob die Datei neu hinzukommt oder eine vorhandene ersetzt

Ein Dialog ist es, weil die Dateiliste unten steht und das Untermenü dort wenig Platz hat. Enter oder ein Klick auf „Hochladen“ bestätigt, Escape und „Abbrechen“ brechen ab.

## Verbindung zu GitHub

- Der Server ruft `gh api` auf, wie `gist.sh`. Die Anmeldung übernimmt `gh`, Schrittmacher
  speichert kein Token.
- Fehlt `gh` oder ist es nicht angemeldet, zeigt der Dialog die Meldung mit dem Hinweis auf
  `gh auth login`.
