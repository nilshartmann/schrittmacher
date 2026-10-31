# Werkstatt

Festgelegt am 31.10.2026.

## Was eine Werkstatt ist

Eine Werkstatt ist ein Repo mit einem Branch `werkstatt`, lokal oder auf `origin`. Der Branch
enthält Planung und Konventionen, die anderen Branches den Code (`docs/veroeffentlichen.md`).
Das gilt für den neuen Aufbau (`<slug>-werkstatt`, `werkstatt` im Haupt-Checkout, die Worktrees
darin) und für ältere Repos (`<slug>-prepare`, `werkstatt` in einem Worktree daneben). Wo der
Worktree von `werkstatt` liegt, ermittelt Schrittmacher mit `git worktree list`; er muss nicht der
Haupt-Checkout sein.

Erkennt Schrittmacher eine Werkstatt, ändern sich drei Dinge: der Knopf „Werkstatt“, die
Tab-Titel und der Knopf „Probe“ an den Commits.

## Knopf „Werkstatt“

Der Knopf steht in der Werkzeugleiste rechts neben dem Menü der Branches, in jedem Tab des Repos.
Er öffnet ein Menü mit einer Zeile je Branch. Darunter steht, wo der Worktree liegt, vom
Haupt-Checkout aus gesehen. Ein Klick auf die Zeile öffnet den Worktree als Tab; die übrigen Knöpfe
erscheinen beim Überfahren.

| Zeile | Stand | Einträge |
|---|---|---|
| `werkstatt` | Worktree vorhanden | als Tab, im Terminal, in Claude Code öffnen |
| `main`, `schritte` | Worktree vorhanden | als Tab, im Terminal öffnen |
| | Branch ohne Worktree, lokal oder nur auf `origin` | „Worktree anlegen“ |
| | Branch fehlt | „fehlt noch“, ohne Eintrag |
| `live_coding` | Worktree vorhanden | als Tab, im Terminal öffnen |
| | fehlt | Hinweis auf „Veröffentlichen …“ |
| `probe` | Worktree vorhanden | Commit, auf dem die Probe beginnt; als Tab, im Terminal öffnen; „Probe verwerfen …“ |
| | fehlt | Hinweis auf den Knopf „Probe“ an den Commits |

Darunter stehen „Veröffentlichen …“ und „Kurzlink anlegen …“, dieselben Dialoge wie im Repo-Menü.

Claude Code startet nur im Worktree von `werkstatt`. In einem anderen Worktree findet es die
`CLAUDE.md` der Werkstatt nicht, weil es nur bis zur Wurzel des Git-Arbeitsverzeichnisses sucht
und jeder Worktree eine eigene hat. Im Worktree `werkstatt` beginnt die Session wie in der Cloud.

Ein neuer Worktree entsteht wie `live_coding` beim Veröffentlichen: Liegt `werkstatt` im
Haupt-Checkout und liegen die Worktrees darin, entsteht er dort, sonst neben `main` oder
`schritte`. Liegt der Branch nur auf `origin`, wird er dabei lokal angelegt und folgt `origin`.

## Tab-Titel

In einer Werkstatt zeigt der Tab den Namen des Repos ohne das Datum vorn (`JJJJ-MM-TT-`) und ohne
`-werkstatt` oder `-prepare` hinten. Aus `2026-11-02-wjax-spring-modulith-werkstatt · schritte`
wird `wjax-spring-modulith · schritte`. Der Tooltip nennt wie bisher den Pfad des Worktrees, und
darin steht der volle Name. Gemerkt werden in `state.json` weiter die vollen Namen.

Der Worktree, in dem `werkstatt` ausgecheckt ist, heißt `werkstatt`, auch wenn er der
Haupt-Checkout mit dem Namen des Repos ist. Ist im Haupt-Checkout ein anderer Branch ausgecheckt,
wie bei älteren Repos, nennt der Tab ihn nicht eigens.

## Probe

Zum Proben des Live-Codings gibt es den Branch `probe`, getrennt von `live_coding`. Geprobt wird
meist ab einem Commit auf `schritte`, weil `main` nur ab und zu nachgezogen wird.

- In einer Werkstatt erscheint an jedem Commit der Liste, über dem der Zeiger steht, rechts in der
  Zeile der Knopf „Probe“ (`HoverTools`). Er öffnet ein Menü:
  - „Probe ab hier“, solange es `probe` nicht gibt: legt den Branch auf diesem Commit an, dazu den
    Worktree `probe/`, und öffnet ihn als Tab.
  - „Probe hierher neu aufsetzen …“, wenn es `probe` gibt: Die Bestätigung nennt die Commits und
    lokalen Änderungen auf `probe`, die verloren gehen. Verloren ist ein Commit, der weder auf dem
    Ziel noch auf einem anderen Branch liegt. Danach setzt `reset --hard` im Worktree `probe` auf
    den Commit, und `clean -d --force` löscht neue Dateien, die Git nicht ignoriert. Was in der
    letzten Probe entstanden ist, stört so die nächste nicht.
- „Probe verwerfen …“ im Werkstatt-Menü entfernt nach Bestätigung Worktree und Branch und schließt
  den Tab der Probe.
- Vor jeder Änderung prüft der Server, ob `probe` noch auf dem Commit steht, den die Bestätigung
  gezeigt hat.
- Den Commit, auf dem die Probe beginnt, liest Schrittmacher aus dem Reflog von `probe`.
- `probe` wird nie gepusht, weder an `origin` noch an `teilnehmer`, und fehlt im Dialog
  „Veröffentlichen …“. Eine Cloud-Session sieht die Probe nicht.
- In `.gitignore` der Vorlage steht `/probe/` neben den anderen Worktrees.
