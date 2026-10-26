# Hinweise zur Überarbeitung

Beim Vorbereiten eines Talks oder Workshops werden die Schritt-Commits durchgesehen. Dabei
entstehen Hinweise, was sich in einem Commit ändern soll. Gesammelt landen sie in einer
Markdown-Datei, die sich ohne weitere Erklärung an Claude Code geben lässt.

## Bedienung

Der Knopf mit der Sprechblase in der Kopfzeile schaltet die Hinweise ein und aus. Eingeschaltet
steht rechts vom Diff die Spalte mit den Hinweisen, und die Zahl neben dem Knopf nennt alle
Hinweise des Repos. Ausgeschaltet, etwa während eines Vortrags, ist alles zu Hinweisen
ausgeblendet: die Spalte, die Knöpfe, die Hervorhebung im Diff und die Zahlen in der Commit-Liste.

Bei eingeschalteten Hinweisen entsteht ein neuer auf zwei Wegen:

- Zeilen im Diff markieren: Am Ende der Markierung erscheint der Knopf „Hinweis“. Er legt einen
  Hinweis zu diesen Zeilen an.
- Knopf mit der Sprechblase in der Leiste über dem Diff: Er legt einen Hinweis zur ganzen Datei an.

In der Spalte stehen wahlweise die Hinweise des gewählten Commits oder alle. Ein Klick auf Datei
und Zeilen eines Hinweises wählt seinen Commit und seine Datei und scrollt zu den Zeilen. Ein Klick
auf den Text ändert ihn; ⌘↩ oder ein Klick daneben speichert, Escape bricht ab. Der Text ist
Markdown und erscheint mit Farben. Über dem Feld steht, was Schrittmacher in der Markdown-Datei vor
dem Text ergänzt: der Commit, die Datei mit den Zeilen, ihr Code und der markierte Teil. Am Griff
rechts unten lässt sich das Feld in der Höhe ziehen; die Höhe gilt danach für jedes Feld. Die
Trennlinie links der Spalte ändert ihre Breite, ein Doppelklick stellt sie zurück. In der Commit-Liste
steht hinter dem Titel eines Commits die Zahl seiner Hinweise.

Unter der Spalte steht die Markdown-Datei. Ihr Inhalt und ihr Pfad lassen sich von dort in die
Zwischenablage kopieren. Der Papierkorb löscht nach einer Rückfrage alle Hinweise des Repos.

## Regeln

- Ein Hinweis gehört zu dem Commit, bis zu dem der Vergleich reicht. Zu den lokalen Änderungen
  gibt es keine Hinweise.
- Die Zeilennummern zählen in der Fassung nach dem Commit. Sind nur entfernte Zeilen markiert,
  zählen sie in der Fassung davor und heißen „vor dem Commit“. Mischt eine Markierung beide Seiten,
  zählen die Zeilen nachher.
- Eine Markierung zählt immer ganze Zeilen; ihr Code steht im Hinweis, damit Claude die Stelle auch
  nach einer Änderung findet. Deckt sie die Zeilen nicht ganz ab, steht der markierte Teil
  zusätzlich unter „Markiert“ und ist in der Spalte hinterlegt. Einrückung davor und Leerzeichen
  danach zählen dabei nicht.
- Nach einem Rebase findet ein Hinweis seinen Commit über die Nummer des Schritts, ohne Nummer über
  den Titel.

## Speicherort

Die Hinweise liegen je Repo im Ordner `hinweise` des Speichers, also unter
`~/.config/schrittmacher/hinweise/`, mit `pnpm dev` im Speicher der Testdaten. Der Dateiname ist
der Pfad des Repos ab dem Home-Verzeichnis, mit `-` statt `/`.

Maßgeblich ist die JSON-Datei. Aus ihr wird die Markdown-Datei daneben nach jeder Änderung neu
geschrieben, eine Änderung von Hand an der Markdown-Datei geht dabei verloren. Git bleibt
unberührt, weil keine der Dateien im Repo liegt.
