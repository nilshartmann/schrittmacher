# Hinweise zu Markdown-Dateien

In der Markdown-Ansicht unter `/markdown` entstehen Hinweise zu einer Datei. Gesammelt gehen sie an
Claude Code, ähnlich wie die Hinweise zu Commits (`docs/hinweise.md`).

## Bedienung

Der Knopf mit der Sprechblase in der Kopfzeile schaltet die Hinweise ein und aus. Die Ansicht merkt
sich die Einstellung im Browser.

Ein neuer Hinweis entsteht auf drei Wegen:

- Text markieren: Am Ende der Markierung erscheint der Knopf „Hinweis“.
- Symbol links neben einem Block: Es erscheint beim Überfahren des Blocks oder des Rands links davon.
- Symbol oben in der Spalte: Es legt einen Hinweis zur ganzen Datei an.

Überfahren zeigt den Bezug als gestricheltes Band, ein gewählter Bezug hat ein durchgehendes Band.
Solange ein neuer Hinweis offen ist, bleibt sein Bezug fest. Für eine andere Stelle ist er erst zu
speichern oder abzubrechen.

| Bezug | Umfang |
|---|---|
| Abschnitt | Überschrift bis vor die nächste gleicher oder höherer Ebene |
| Listenpunkt | der Punkt samt seinen Unterlisten |
| Absatz, Codeblock, Zitat | der ganze Block, nur direkt im Dokument |
| Stelle | alle Blöcke einer Markierung, der markierte Teil steht unter „Markiert“ |
| Ganze Datei | die Datei |

Ein Klick auf den Kopf eines Hinweises scrollt zu seiner Stelle, ein Klick auf den Text ändert ihn.
Unter der Spalte stehen die gesammelte Markdown-Datei und „In Claude …“. Das Menü „Kopieren“ legt
das Markdown, den Pfad dieser Datei oder einen fertigen Prompt für Claude mit dem Auftrag, sie zu
lesen, in die Zwischenablage.

Der Pfeil in der Kopfzeile eines Felds zeigt, was Schrittmacher in der Markdown-Datei ergänzt.
Eingeklappt ist das die Vorgabe.

Ein Screenshot aus der Zwischenablage landet mit ⌘V als Datei in
`~/.config/schrittmacher/hinweise/claude/bilder/`, und ihr Pfad steht danach im Text. Claude Code
darf diesen Ordner lesen. Das Löschen eines Hinweises entfernt die Bilddatei nicht.

Links vom Text steht an jeder Stelle die Zahl ihrer Hinweise. Ein Block hat dazu einen Balken über
seine Höhe. Abschnitte und die ganze Datei haben eine hohle Zahl ohne Balken, weil sie ineinander
liegen können. Überfahren zeigt den Umfang, ein Klick scrollt in der Spalte zu den Hinweisen.

## Regeln

- Eine Stelle wird über ihren Quelltext wiedergefunden, ein Abschnitt über seine Überschrift. Bei
  mehreren Treffern gilt der nächste zu den gespeicherten Zeilen.
- Lässt sich die Stelle nicht mehr finden, bleibt der Hinweis mit „Stelle nicht gefunden“ stehen.
- Bei einem Abschnitt und der ganzen Datei fehlt der Quelltext in der Markdown-Datei, weil Claude
  die Datei selbst liest.
- Claude Code startet im Worktree der Datei, ohne Repo in ihrem Ordner.

## Speicherort

Die Hinweise liegen je Datei unter `~/.config/schrittmacher/hinweise/markdown/`, also außerhalb der
Datei. Maßgeblich ist die JSON-Datei, die Markdown-Datei daneben wird nach jeder Änderung neu
geschrieben.

## Öffnen mit …

`bin/schrittmacher-markdown-installieren` baut die Helfer-App `~/Applications/Schrittmacher
Markdown.app` und meldet sie für Markdown-Dateien bei macOS an. Die Web-App aus Safari kann sich
selbst für keine Dateitypen anmelden. Nach einem Umzug des Projekts oder einem Wechsel der
Node-Version ist das Skript noch einmal aufzurufen.
