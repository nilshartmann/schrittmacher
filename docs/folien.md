# Folien als PDF in einem Folien-Repo

Festgelegt am 04.11.2026.

## Ablauf eines Vortrags

Die PowerPoint-Datei eines Vortrags liegt in der Werkstatt unter `folien/` auf dem Branch
`werkstatt`. Veröffentlicht werden die Folien nicht im Teilnehmer-Repo, sondern in einem eigenen
Folien-Repo, jeweils als PowerPoint-Datei und als PDF. Die Teilnehmer bekommen den Link auf das
PDF in diesem Repo. Vor dem Vortrag wird das PDF ein- oder mehrmals neu erzeugt und hochgeladen.

## Quellen

- Die Folien-Repos stehen in `config.json` unter `slides` als lokale Pfade. Gebraucht werden:
  - `~/develop/frontend-talk-2024`
  - `~/develop/heise-spring-modulith/spring-modulith-talk`
  - `~/develop/javascript/neuer-react-talk/fullstack-react-slides`
- Im Dialog heißt ein Folien-Repo wie sein Ordner. Angezeigt wird es als `org/name` auf GitHub,
  gelesen aus `origin`.
- Die Zuordnung einer PowerPoint-Datei zu Folien-Repo und Namen steht in `state.json` je Repo, wie
  die Kurzlinks. Sie liegt nur auf diesem Mac.

## Werkstatt-Menü

Je PowerPoint-Datei unter `folien/` steht ein Eintrag „Folien öffnen“. Ein Klick darauf öffnet sie
in PowerPoint. Ist sie einem Folien-Repo zugeordnet, nennt die zweite Zeile das Repo. Beim
Überfahren erscheinen diese Knöpfe:

| Knopf | Wann | Wirkung |
|---|---|---|
| In PowerPoint öffnen | immer | wie ein Klick auf die Zeile |
| PDF in Acrobat öffnen | zugeordnet und das PDF liegt im Folien-Repo | öffnet das PDF in Adobe Acrobat, sonst im Acrobat Reader, nicht in der Vorschau |
| PDF erzeugen und hochladen … | immer | öffnet den Dialog „PDF hochladen“ |
| Link zum PDF kopieren | zugeordnet | kopiert den Link „Download raw“ von GitHub |

Der Link hat die Form `https://github.com/<org>/<repo>/raw/<branch>/<name>.pdf`. Der Branch ist der
auf `origin`, dem der ausgecheckte Branch des Folien-Repos folgt.

## Dialog „PDF hochladen“

1. **Folien-Repo.** Auswahl aus `slides` in `config.json`, vorbelegt mit der gemerkten Zuordnung,
   sonst mit dem ersten Repo.
2. **Name ohne Endung.** Vorbelegt mit der gemerkten Zuordnung, sonst nach der Konvention der
   Folien-Repos: Event, Jahr, Thema. Aus `2026-11-wjax-tanstack-ai-werkstatt` wird
   `wjax-2026-tanstack-ai`. Erlaubt sind Buchstaben, Ziffern, Punkt, Unter- und Bindestrich. Eine
   angehängte Endung `.pptx` oder `.pdf` fällt weg.
3. **Hochladen.** Die Zuordnung wird zuerst gemerkt, damit sie auch gilt, wenn danach etwas
   scheitert. Danach zeigt der Dialog, ob ein Commit entstand, und den Link zum Kopieren.

## Hochladen

- Der ausgecheckte Branch des Folien-Repos muss einem Branch auf `origin` folgen. Liegen darin
  Commits, die noch nicht gepusht sind, bricht der Server ab, weil der Push sie sonst mitnähme.
- Der Server holt den Stand von `origin` und zieht ihn per Fast-Forward nach. Andere lokale
  Änderungen im Folien-Repo bleiben dabei liegen. Der Fast-Forward scheitert nur, wenn er eine
  davon überschreiben müsste.
- Liegt dieselbe PowerPoint-Datei samt PDF schon im letzten Commit, gibt es nichts zu tun. Der
  Vergleich läuft über den Hash von Git, weil PowerPoint bei jedem Export ein anderes PDF erzeugt.
- Sonst speichert PowerPoint die Präsentation über AppleScript als PDF. Gespeichert wird zuerst im
  Ordner `tmp` des Containers von PowerPoint, weil PowerPoint in der Sandbox von macOS läuft und bei
  jedem anderen Ordner nach einer Freigabe fragt. War die Präsentation schon offen, nimmt PowerPoint
  das offene Fenster und lässt es offen; ungesicherte Änderungen landen dann im PDF, aber nicht in
  der kopierten PowerPoint-Datei. Deshalb wird vorher gesichert.
- PowerPoint-Datei und PDF kommen als `<name>.pptx` und `<name>.pdf` ins Folien-Repo. Committet
  werden nur diese beiden Dateien (`git add` und danach `git commit --only`), Betreff
  `Folien <name>`. Danach folgt der Push auf den Branch auf `origin`.

Gemessen am 04.11.2026: Für eine Präsentation mit 44 MB brauchte PowerPoint gut 11 Sekunden, das
PDF hatte 18 MB.
