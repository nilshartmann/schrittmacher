# Veröffentlichen für die Teilnehmer

Festgelegt am 31.10.2026.

## Ablauf einer Veranstaltung

Vorbereitet wird alles im Werkstatt-Repo (`<slug>-werkstatt`, bei älteren Repos `<slug>-prepare`).
Die Teilnehmer bekommen ein eigenes Repo, das Teilnehmer-Repo. Es entsteht kurz vor der
Veranstaltung und bekommt nacheinander:

| Wann | Was |
|---|---|
| einige Tage vorher | `main` mit dem Startpunkt |
| vor Beginn | `live_coding`, aus `main` angelegt |
| während der Veranstaltung | jeder Commit auf `live_coding`, über Commit und Push im Tab „Live“ (`docs/commit.md`) |
| danach | `schritte` mit den Musterlösungen |

Im Werkstatt-Repo heißt das Teilnehmer-Repo als Remote `teilnehmer`. Bei älteren Repos, die es
als `workshop` kennen, gilt dieser Name, solange es kein `teilnehmer` gibt.

## Dialog „Veröffentlichen …“

Der Dialog öffnet sich über den Eintrag „Veröffentlichen …“ im Repo-Menü, neben „Kurzlink
anlegen …“. Er ist kein Assistent, sondern eine Übersicht: Er zeigt für jeden Schritt den Stand
und einen Knopf für das, was als Nächstes geht. Er lässt sich jederzeit öffnen. Beim Öffnen holt
er den Stand des Teilnehmer-Repos mit `git fetch`.

| Schritt | Stand | Knopf |
|---|---|---|
| Teilnehmer-Repo | fehlt; oder vorhanden als `<org>/<name>`, privat oder öffentlich | „Anlegen“; Schalter für die Sichtbarkeit |
| Startpunkt | Platzhalter steht noch auf `main`; `main` nicht veröffentlicht; veröffentlicht und gleich; veröffentlicht, aber abweichend | „`main` veröffentlichen“ |
| Live-Coding | `live_coding` fehlt; angelegt, folgt `teilnehmer`, im Worktree ausgecheckt | „`live_coding` anlegen“ |
| Musterlösungen | `schritte` nicht veröffentlicht; veröffentlicht und gleich; abweichend | „`schritte` veröffentlichen“ |

`werkstatt` und `backup/…` kommen im Dialog nicht vor. Gepusht wird immer ein einzelner Branch mit
ausdrücklichem Ziel (`refs/heads/<branch>:refs/heads/<branch>`), nie `--all` oder `--mirror`.

## Teilnehmer-Repo anlegen

- Vorgeschlagen wird `<org>/<slug>`: der Name des Werkstatt-Repos ohne `-werkstatt` oder
  `-prepare`, in derselben Organisation. Der Name lässt sich vor dem Anlegen ändern.
- Angelegt wird mit `gh repo create`, immer privat. Die Beschreibung ist die erste Überschrift aus
  `WORKSHOP.md` auf `werkstatt`, falls es sie gibt.
- Danach setzt Schrittmacher das Remote `teilnehmer`.

## Sichtbarkeit

- Ein Schalter zeigt „privat“ oder „öffentlich“ und schaltet mit
  `gh repo edit --visibility … --accept-visibility-change-consequences` um.
- Jedes Umschalten wird bestätigt. Die Bestätigung nennt die Folgen:
  - Öffentlich: Jeder sieht die ganze Historie aller gepushten Branches. Was einmal öffentlich war,
    kann schon geklont sein.
  - Privat: Sterne und Watcher gehen verloren, öffentliche Forks lösen sich.

## Startpunkt veröffentlichen

- Solange auf `main` der Platzhalter `https://github.com/ORG/TEILNEHMER-REPO` steht
  (`git grep` auf dem Branch, nicht im Worktree), ist der Knopf gesperrt. Der Dialog nennt die
  Dateien. Ersetzt wird der Platzhalter von Claude per `--amend` im Startpunkt, weil danach
  `schritte` neu aufgesetzt werden muss.
- Vor dem Push zeigt eine Bestätigung, welche Commits dazukommen.

## Push und Force-Push

- Jeder Push an `teilnehmer` wird bestätigt, denn danach sehen ihn alle, die das Repo sehen.
- Geht ein Push nur mit Force, etwa weil das Teilnehmer-Repo falsch aufgesetzt wurde, bietet der
  Dialog ihn ausdrücklich an. Die Bestätigung nennt die Commits, die im Teilnehmer-Repo
  verschwinden, und dass vorhandene Klone der Teilnehmer danach nicht mehr passen. Gepusht wird
  mit `--force-with-lease` auf den zuletzt geholten Stand.

## Live-Coding vorbereiten

- „`live_coding` anlegen“ legt den Branch aus `main` an, pusht ihn an `teilnehmer` und setzt das
  Ziel dorthin (`-u`). Danach geht jeder Push aus dem Tab „Live“ ohne weiteres Zutun an die
  Teilnehmer. An `origin` geht `live_coding` nicht, das Teilnehmer-Repo ist zugleich die Sicherung.
- Der Worktree entsteht neben den anderen Worktrees des Repos:
  - Liegt `werkstatt` im Haupt-Checkout und liegen die Worktrees darin, entsteht `live_coding/`
    dort, wie es `bin/worktrees.sh` der Vorlage erwartet.
  - Sonst entsteht er im Ordner, in dem `main` oder `schritte` als Worktree liegen.
- Danach öffnet der Dialog den Worktree als Tab „Live“ und schließt sich. Ist `live_coding` schon
  angelegt, öffnet „Als Tab öffnen“ den Tab.

## Verbindung zu GitHub

Wie beim Gist über `gh`. Fehlt es oder ist es nicht angemeldet, zeigt der Dialog die Meldung mit
dem Hinweis auf `gh auth login`.
