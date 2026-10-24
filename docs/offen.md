# Offene Punkte

- Umbenennungen erkennen; Fork zeigt sie mit lila Pfeil. Bisher erscheinen sie als gelöschte und
  neue Datei, weil Git mit `--no-renames` aufgerufen wird.
- Der Diff wird aus beiden Fassungen selbst berechnet. Paare aus entfernten und hinzugefügten
  Zeilen können deshalb anders stehen als in Fork. Abhilfe wäre ein Parser für die Ausgabe von
  `git diff`, etwa nach `Diff.java` aus agent-lab.
- Später geplant: Wechsel von Branch und Worktree, lokale Änderungen, Commit und Reset. Rebase und
  Ähnliches sind kein Ziel.
