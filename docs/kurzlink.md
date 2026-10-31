# Kurzlink und QR-Code zu einem Vortrag

Festgelegt am 31.10.2026.

## Ablauf eines Vortrags

Zu jedem Vortrag und Workshop gibt es einen Kurzlink wie `https://spring.schule/jughh-2026`. Er
leitet auf die Seite der Veranstaltung auf nilshartmann.net weiter, auf der Repo, Folien und
Aufzeichnung verlinkt sind. Auf der letzten Folie steht der Kurzlink mit einem QR-Code.

Die Kurzlinks liegen als Zeilen in der Datei `_redirects` eines Repos je Domain, veröffentlicht
über Netlify. Die Seite auf nilshartmann.net wird von Hand gepflegt, Schrittmacher liest sie nur.

## Quellen

- Die Redirect-Repos stehen in `config.json` unter `redirects` als lokale Pfade. Die Domain liest
  Schrittmacher aus der `package.json` des Repos (`baseUrl`). Gebraucht werden:
  - `~/develop/spring-schule-urls` für spring.schule
  - `~/develop/graphql-schule-urls` für graphql.schule
  - `~/develop/javascript/nilsh-urls` für react.schule
- Der Pfad der Homepage `~/develop/javascript/nextjs-nilshartmann.net` steht in `config.json`
  unter `homepage`. Die Vorträge und Workshops liegen dort in `app/data/raw/*-data.ts` als Arrays von
  Objekten mit `title`, `event`, `date`, `location`, `type` und `done`.
- Gelesen wird der gepushte Stand mit `git show origin/main:<datei>`, nur lesend. Die Dateien sind
  TypeScript mit reinen Daten. Der Server entfernt die Typen mit `stripTypeScriptTypes` aus
  `node:module`, lässt den Import des Typs weg und führt den Rest als Funktion aus. Ein Bundler ist
  dafür nicht nötig.
- Kommend ist eine Veranstaltung ohne `done` und ohne `material`, deren Datum nicht vorbei ist. Das
  Datum steht als Text in verschiedenen Formen da („2. November 2026“, „12. 2. 2026“,
  „30.03.26 - 01.04.26“). Gilt der letzte Tag darin, lässt sich keiner lesen, zählt nur `done`.
- Die Adresse einer Veranstaltung ist `https://nilshartmann.net/t/<slug>`. Der Slug ist das Feld
  `slug`, sonst `slugify(title + "-" + event)` wie in `app/data/talks-and-workshops.ts` der
  Homepage. Schrittmacher bildet `slugify` nach, geprüft am 31.10.2026 gegen die Bibliothek für
  alle Veranstaltungen der Homepage.
- Mehrere Einträge der Homepage können dieselbe Seite haben, etwa ein Workshop an zwei Terminen
  mit gleichem Titel und Event.

## Dialog „Kurzlink anlegen“

1. **Ziel.** Ein Suchfeld durchsucht Titel, Event, Ort und Datum der Veranstaltungen, auch ohne
   Satz- und Leerzeichen („wjax“ findet „W-Jax“). Kommende
   (ohne `done`) stehen oben, danach die vergangenen, die neuesten zuerst. Die Wahl eines Eintrags
   setzt das Ziel auf seine Seite. Das Ziel lässt sich auch frei eingeben, mit oder ohne Eintrag
   als Ausgangspunkt.
2. **Prüfung des Ziels.** Der Server fragt das Ziel ab. Antwortet es nicht mit Erfolg, zeigt der
   Dialog eine Warnung. Anlegen lässt sich der Kurzlink trotzdem, etwa für eine Seite, die erst
   noch veröffentlicht wird.
3. **Domain.** Vorgeschlagen nach dem Thema des Eintrags, in dieser Reihenfolge: GraphQL →
   graphql.schule; React, Next.js, TanStack, TypeScript, Frontend → react.schule; Spring, Java →
   spring.schule. Frontend steht vor Spring, damit Next.js für Java-Entwickler bei react.schule
   landet. Wählbar sind alle Domains aus `config.json`.
4. **Pfad.** Vorgeschlagen aus Event und Jahr, etwa `wjax-2026`. Ist der Pfad in der Domain schon
   vergeben, kommt ein Stichwort aus dem Titel dazu, etwa `wjax-2026-tanstack`. Der Pfad lässt
   sich frei ändern. Neben dem Feld stehen die vorhandenen Einträge der Domain, gefiltert nach dem
   Pfad. Ein vergebener Pfad lässt sich nicht anlegen.
5. **Anlegen.** Enter oder „Anlegen“ bestätigt, Escape und „Abbrechen“ brechen ab.

## Eintragen

- Vor dem Eintragen holt der Server den Stand des Redirect-Repos und zieht ihn per Fast-Forward
  nach. Hat das Repo lokale Änderungen oder geht der Fast-Forward nicht, bricht er mit einer
  Meldung ab.
- Die Zeile `/<pfad> <ziel>` kommt vor die Weiterleitung `/*` am Ende, denn Netlify nimmt die
  erste passende Zeile. Fehlt `/*`, kommt sie ans Ende.
- Commit mit dem Betreff `Kurzlink /<pfad>` und Push auf `origin`.
- Danach fragt der Server den Kurzlink ab, bis er auf das Ziel weiterleitet, höchstens einige
  Minuten. Der Dialog zeigt, ob Netlify ihn schon ausliefert.

## QR-Code

- Erzeugt wird ein SVG für den Kurzlink mit der Bibliothek `qrcode`.
- Der Dialog zeigt den Code nach dem Anlegen. Er lässt sich als PNG in die Zwischenablage kopieren,
  damit Keynote und PowerPoint ihn als Bild einfügen, und im
  Worktree `werkstatt` des Repos als `folien/qr-<pfad>.svg` ablegen.
- Abgelegt wird mit Commit auf `werkstatt`, Betreff `QR-Code für <domain>/<pfad>`. Committet wird
  nur diese Datei (`git add` und danach `git commit --only -- folien/qr-<pfad>.svg`), auch wenn im Worktree weitere
  Änderungen liegen oder schon etwas vorgemerkt ist. Gepusht wird nicht.
- Für einen vorhandenen Kurzlink aus der Liste der Domain lässt sich der Code ebenso erzeugen.

## Kurzlinks eines Repos

- Ein angelegter Kurzlink wird dem Repo des offenen Tabs zugeordnet. Ein vorhandener lässt sich im
  Dialog über „Diesem Repo zuordnen“ nachträglich zuordnen, nachdem er in der Liste der Domain
  gewählt wurde.
- Die Zuordnung steht in `state.json` je Repo, wie die Gists, der zuletzt zugeordnete zuerst. Sie
  gilt für jedes Repo, auch ohne Branch `werkstatt`, liegt aber nur auf diesem Mac.
- Im Repo-Menü stehen die zugeordneten Kurzlinks unter „Kurzlink anlegen …“, mit dem Ziel darunter.
  Beim Überfahren hat jeder Knöpfe für „Kurzlink kopieren“, „QR-Code als Bild kopieren“ und
  „Zuordnung zum Repo lösen“. Der Kurzlink selbst bleibt dabei im Redirect-Repo. Ein Klick auf die
  Zeile öffnet den Dialog mit dem QR-Code.
- Im Dialog lässt sich zu jedem QR-Code auch der Kurzlink selbst kopieren.

## Einstieg

Der Dialog öffnet sich über den Eintrag „Kurzlink anlegen …“ im Repo-Menü, unter „Projekte“. Ein
Kurzlink gehört zu einer Veranstaltung und nicht zu einem Commit oder einer Datei, und das
Repo-Menü ist von jedem Tab aus erreichbar.
