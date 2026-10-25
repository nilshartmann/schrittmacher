# Diff-Viewer aus Schrittmacher als Vorlage

Diese Datei beschreibt den Diff-Bereich von Schrittmacher: die Dateileiste mit den Knöpfen und darunter den Diff einer Datei.
Sie dient als Vorlage, um einen Diff-Viewer in einem anderen Projekt an Darstellung und Bedienung anzugleichen.
Vorbild für beides ist Fork.

Die Verweise zeigen auf den Quellcode in `/Users/nils/develop/schrittmacher`.
Zeilennummern geben den Stand vom 25.10.2026 wieder.

## Überblick der Dateien

| Teil | Datei |
|---|---|
| Dateileiste mit Pfad und Knöpfen (`FileBar`) | `/Users/nils/develop/schrittmacher/src/viewer/FileList.tsx` (ab Zeile 116) |
| Diff einer Datei (`DiffView`, `Lines`, `Line`, `LineText`) | `/Users/nils/develop/schrittmacher/src/viewer/DiffView.tsx` |
| Aufbau der Zeilen und Trenner (`splitRows`, `unifiedRows`) | `/Users/nils/develop/schrittmacher/src/diff/rows.ts` |
| Abschnitte um die Änderungen und ihre Überschrift (`hunksOf`, `headingBefore`) | `/Users/nils/develop/schrittmacher/src/git/diff.ts` |
| Geänderte Teile einer Zeile (`markParts`, `between`) | `/Users/nils/develop/schrittmacher/src/git/lineParts.ts` |
| Syntax-Highlighting mit Lezer (`highlightText`, `chunksOf`) | `/Users/nils/develop/schrittmacher/src/diff/highlight.ts` |
| Einstellungen mit Vorgaben und Grenzen | `/Users/nils/develop/schrittmacher/src/viewer/settings.ts` |
| Verdrahtung, aufgeklappte Trenner, Schriftgröße | `/Users/nils/develop/schrittmacher/src/viewer/Viewer.tsx` (ab Zeile 160) |
| Tooltips über `data-tip` | `/Users/nils/develop/schrittmacher/src/viewer/Tooltips.tsx` |
| Typen (`DiffLine`, `LinePart`, `DiffFile`) | `/Users/nils/develop/schrittmacher/src/git/types.ts` |
| Styling | `/Users/nils/develop/schrittmacher/src/app.css` (Variablen ab Zeile 3, Dateileiste ab Zeile 781, Diff ab Zeile 893, Code-Farben ab Zeile 1087) |

## Funktionen

### Dateileiste

Links steht der Pfad der Datei in Monospace.
Der Ordner ist grau, der Dateiname halbfett.
Wird es eng, kürzt der Pfad vorn mit `…`, damit der Dateiname sichtbar bleibt (`direction: rtl` am Ordner, mit `‎` um den Text, damit die Schrägstriche stehen bleiben).
Bei einer umbenannten Datei nennt der Tooltip `alt → neu`.

Rechts stehen die Knöpfe in dieser Reihenfolge:

1. **50/50** und **30/70**: Side-by-Side mit fester Aufteilung. Ein Klick schaltet Side-by-Side ein. Gedrückt erscheint ein Knopf nur, wenn die Aufteilung genau passt.
2. **Zeilenumbruch**: lange Zeilen brechen um, die Fortsetzung ist um `2ch` eingerückt.
3. **Entfernte Zeilen zeigen**: nur untereinander aktiv. Ausgeschaltet bleibt nur die neue Fassung übrig, die sich am Stück kopieren lässt (siehe „Untereinander ohne entfernte Zeilen").
4. **Weniger Zeilen** und **Mehr Zeilen** um die Änderungen: Kontext in Schritten von 3, zwischen 0 und 30, Vorgabe 3 (`CONTEXT` in `settings.ts`). Gesperrt, wenn „Ganze Datei" an ist oder die Grenze erreicht ist. Der Tooltip nennt den aktuellen Wert.
5. **Ganze Datei**: zeigt alle Zeilen ohne Trenner.
6. **Side-by-Side**: schaltet zwischen nebeneinander und untereinander.

Die Knöpfe sind randlos (`.icon-button`), grau, beim Überfahren hellgrau hinterlegt und gedrückt blau hinterlegt (`--accent-tint`, `--accent`).
Die SVG-Symbole stehen als eigene Komponenten am Ende von `FileList.tsx` (ab Zeile 250), jeweils 20 × 16 mit Strichstärke 1,5 und `currentColor`.

### Zeilen und Farben

- Jede Zeile ist genau `1.5em` hoch, auch eine leere. So stehen beide Seiten auf gleicher Höhe.
- Die **Zeilennummer** ist klein (`0.75em`), hellgrau (`#b0b5bd`), rechtsbündig und auf weißem Grund. Eine feine Linie trennt sie vom Code. Die Farbe einer geänderten Zeile beginnt erst beim Code, nicht bei der Nummer.
- Die Nummernspalte richtet sich nach der größten Nummer der Datei (`--number-width`, mindestens `2ch`).
- Die Nummern sind `position: sticky; left: 0` und bleiben beim Scrollen zur Seite stehen.
- **Entfernte Zeilen** haben die alte Nummer und einen roten Hintergrund, **hinzugefügte** die neue Nummer und einen grünen. Untereinander stehen sie beide in derselben Spalte, entfernte zuerst.
- **Geänderte Teile** innerhalb eines Paars aus entfernter und hinzugefügter Zeile sind kräftiger hinterlegt (im Screenshot `getRouteApi,`). Sie haben weder Rundung noch Abstand, damit die Zeichen in ihrer Spalte bleiben.
- Leere Zellen einer Seite (nur nebeneinander) zeigen diagonale Streifen (`.line-empty`).

### Geänderte Teile einer Zeile

Berechnet werden sie in `/Users/nils/develop/schrittmacher/src/git/lineParts.ts`, portiert aus agent-lab:

- In einem Block geänderter Zeilen wird die n-te entfernte mit der n-ten hinzugefügten Zeile gepaart. Eine Zeile ohne Partner hat keine Teile.
- Verglichen wird Token für Token: eine Folge aus Buchstaben, Ziffern, `_` und `$` ist ein Token, jedes andere Zeichen außer Leerraum ein eigenes.
- Gemeinsamer Anfang und gemeinsames Ende werden abgeschnitten, der Rest geht per LCS.
- Keine Teile gibt es, wenn sich beide Zeilen nur im Leerraum unterscheiden, wenn auf einer Seite mehr als 60 % der Zeichen anders sind oder wenn die LCS-Tabelle mehr als 250.000 Felder bräuchte. Dann ist die ganze Zeile einfach rot oder grün.

### Ausgelassene Zeilen (Trenner)

Zwischen den Abschnitten steht ein Trenner, wenn Zeilen ausgelassen sind (im Screenshot `⋯ 4 Zeilen  export default function FavButton({`):

- Links steht ein Knopf mit `⋯` und der Zahl der ausgelassenen Zeilen („1 Zeile", „4 Zeilen"). Nebeneinander steht der Trenner auf beiden Seiten, die Zahl nur rechts.
- Ein Klick klappt die Zeilen direkt unter dem Trenner auf. Der Knopf zeigt dann `⌃` und klappt sie wieder ein. Der Trenner bleibt also stehen.
- Daneben steht die **Überschrift des folgenden Abschnitts** wie bei Git hinter `@@ … @@`: die nächste Zeile der alten Fassung davor, die ganz links mit einem Buchstaben, `_` oder `$` beginnt, gekürzt auf 80 Zeichen (`headingBefore` in `diff.ts`). Sie ist in Code-Schrift gesetzt und lässt sich markieren.
- Am Ende der Datei steht ein Trenner ohne Überschrift (im Screenshot `⋯ 16 Zeilen`).
- Wie in Fork wird nie eine einzelne Zeile ausgelassen, weil ihr Trenner so viel Platz bräuchte wie sie selbst (`hunksOf` in `diff.ts`).
- Ein Trenner heißt nach der Stelle seiner ersten Zeile in der ganzen Datei. Aufgeklappte Trenner gelten je Datei und nur für einen Vergleich und einen Kontext-Umfang, weil sich sonst die Stellen verschieben (`Viewer.tsx`, Zeilen 160–178).
- Der Trenner hat eine feste Höhe von 22 px, UI-Schrift in 11 px und grauen Text auf `--diff-gap`.

Damit das funktioniert, holt Schrittmacher jede Datei als Ganzes (`git diff --unified=2147483647`, `/Users/nils/develop/schrittmacher/src/git/gitRepo.ts` Zeile 210) und schneidet die Abschnitte selbst zu.
Ein Viewer, der nur die Hunks von Git bekommt, kann die ausgelassenen Zeilen nicht aufklappen.

### Untereinander ohne entfernte Zeilen

Ist „Entfernte Zeilen zeigen" aus, fallen die entfernten Zeilen weg und werden an der Zeile danach gezählt (`removedBefore` in `unifiedRows`).
Ein roter Strich oben an dieser Zeile zeigt, wo Zeilen entfernt wurden.
Der Tooltip nennt ihre Zahl („2 Zeilen davor entfernt").

### Nebeneinander

- Jede Seite steht in einer eigenen Spalte, die für sich zur Seite scrollt. Nach oben und unten scrollen beide gemeinsam: nur die rechte Spalte hat einen senkrechten Balken, die linke folgt ihr, und ein Scrollen über der linken wird an die rechte weitergereicht (`useSyncedScroll`).
- Unveränderte Zeilen stehen auf beiden Seiten. Entfernte und hinzugefügte Zeilen eines Blocks stehen paarweise, die fehlende Seite ist gestreift.
- Zwischen den Spalten liegt eine Trennlinie zum Ziehen, begrenzt auf 15 % bis 85 %. Ein Doppelklick stellt 50/50 her. Beim Überfahren wird die Linie 3 px breit und blau.
- Mit Umbruch bekommen die Zeilen beider Seiten dieselbe Höhe, nämlich die der höheren (`useEvenRows`). Neu gemessen wird, wenn sich die Breite einer Spalte oder die Schriftgröße ändert.
- Die horizontalen Balken stehen immer da (`overflow-x: scroll`), sonst springt der Text, sobald einer erscheint.

### Markieren und Kopieren

Zeilennummern, Trenner-Knöpfe und leere Zellen haben `user-select: none`.
Wer Code markiert, kopiert nur den Code.
Eine leere Zeile enthält ein Leerzeichen der Breite null (`​`), damit sie ihre Höhe behält und beim Kopieren als Zeile mitkommt.

### Syntax-Highlighting

Die Farben stammen aus IntelliJ IDEA (über agent-lab).
Geparst wird mit Lezer, und zwar jede Fassung als Ganzes, damit Kommentare über mehrere Zeilen stimmen (`rangesOf` in `rows.ts`, `highlightText` in `highlight.ts`).
Unterstützt werden Java, Markdown, JavaScript, TypeScript, JSX/TSX und JSON (`LANGUAGES` in `highlight.ts`, Zeile 70).

Schlüsselwörter und Konstanten sind kursiv.
Funktionen, Aufrufe und Properties sind violett.

Ein geänderter Teil und die Farben des Codes überlagern sich.
Die Bereiche des Codes werden deshalb an den Grenzen jedes Teils geschnitten (`chunksOf` in `highlight.ts`), sodass jeder Teil als ein Element mit eigenem Hintergrund dasteht und darin die farbigen Spans liegen.

### Weitere Einstellungen

- **Schriftgröße** 9 bis 24 px, Vorgabe 12, als CSS-Variable `--code-size` an `.app` (`Viewer.tsx`, Zeile 199). Alle Größen im Diff hängen in `em` davon ab.
- **Tooltips** über `data-tip`, weil die Web-App aus Safari `title` nicht anzeigt. Sie erscheinen nach 500 ms unter dem Element, in der rechten Bildschirmhälfte rechtsbündig.
- Alle Einstellungen werden 400 ms nach der letzten Änderung gespeichert (`useSettings`).

## Struktur im DOM

```html
<div class="file-bar">
  <code class="file-path"><span class="path">
    <span class="path-folder">tanstack2025/src/components/</span>
    <span class="path-name">FavButton.tsx</span>
  </span></code>
  <div class="file-tools">
    <button class="icon-button preset" aria-pressed="false">50/50</button>
    …
  </div>
</div>

<div class="diff [diff-wrap]" style="--share: 0; --number-width: 2ch">
  <!-- nur nebeneinander: <div class="pane pane-old">…</div><div class="divider"></div> -->
  <div class="pane pane-new">
    <div class="pane-lines">
      <div class="line line-context">
        <span class="number">1</span>
        <span class="text"><span class="code-keyword">import</span> { twMerge } …</span>
      </div>
      <div class="line line-added">
        <span class="number">2</span>
        <span class="text"><span class="code-keyword">import</span> { <span class="part">getRouteApi,</span> useNavigate …</span>
      </div>
      <div class="gap">
        <button class="gap-toggle">⋯ 4 Zeilen</button>
        <span class="gap-heading">export default function FavButton({</span>
      </div>
      <div class="line line-empty"></div>
      <div class="line line-added line-removed-before" data-tip="1 Zeile davor entfernt">…</div>
    </div>
  </div>
</div>
```

## CSS

### Variablen

Aus `/Users/nils/develop/schrittmacher/src/app.css`, Zeilen 3–69, nur die für den Diff nötigen:

```css
:root {
  --surface: #ffffff;
  --ink: #1d232c;
  --quiet: #5a6270;
  --sign: #8a919c;
  --line: #d8dce2;
  --line-soft: #e5e8ec;
  --hover: #eceff2;
  --accent: #3e5c9a;
  --accent-tint: #e8edf6;

  /* Die Farben des Diffs wie in Fork. */
  --diff-removed: #ffe4e4;
  --diff-added: #e2fbe2;
  --diff-removed-part: #fcb6b6;
  --diff-added-part: #a6efa6;
  --diff-removed-ink: #c83a3a;
  --diff-added-ink: #2e8b2e;
  --diff-empty: #f6f7f8;
  --diff-gap: #f4f5f7;

  /* Farben des Codes wie in IntelliJ IDEA. */
  --code-keyword: #2770c0;
  --code-type: #367b42;
  --code-string: #3d9189;
  --code-number: #3778b7;
  --code-constant: #2770c0;
  --code-escape: #012339;
  --code-comment: #969896;
  --code-doc-tag: #a56416;
  --code-todo: #969896;
  --code-annotation: #1e4c84;
  --code-function: #a44185;
  --code-call: #a44185;
  --code-parameter: #012339;
  --code-property: #a44185;
  --code-regexp: #3d9189;
  --code-jsx-tag: #a56416;
  --code-jsx-attribute: #2770c0;
  --code-heading: #a44185;
  --code-marker: #2770c0;
  --code-markdown-code: #3d9189;
  --code-link-text: #2770c0;
  --code-url: #2770c0;
  --code-quote: #3d9189;
  --code-json-key: #2770c0;

  --font-ui: system-ui, -apple-system, sans-serif;
  --font-code: "MonoLisa", ui-monospace, monospace;
  --size-small: 12px;
}
```

### Dateileiste

Aus `app.css`, Zeilen 781–870:

```css
.file-bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 4px 0 8px;
  border-bottom: 1px solid var(--line);
}

.file-path {
  display: flex;
  overflow: hidden;
  flex: 0 1 auto;
  min-width: 0;
  margin-right: auto;
  font-family: var(--font-code);
  font-size: 13px;
  white-space: nowrap;
}

/* Ein Pfad kürzt vorn, wenn es eng wird, damit der Dateiname bleibt. */
.path { display: flex; overflow: hidden; flex: 1 1 auto; min-width: 0; white-space: nowrap; }
.path-folder { overflow: hidden; min-width: 0; color: var(--quiet); text-overflow: ellipsis; direction: rtl; }
.path-name { flex: none; font-weight: 600; }

.file-tools { display: flex; align-items: center; gap: 2px; flex: none; }

.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 30px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--quiet);
  cursor: pointer;
}
.icon-button:hover:not(:disabled) { background: var(--hover); }
.icon-button[aria-pressed='true'] { background: var(--accent-tint); color: var(--accent); }
.icon-button:disabled { opacity: 0.35; cursor: default; }

/* 50/50 und 30/70 */
.preset { width: auto; padding: 0 6px; font-size: var(--size-small); font-variant-numeric: tabular-nums; }
```

### Diff

Aus `app.css`, Zeilen 893–1085:

```css
.diff {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  font-family: var(--font-code);
  font-size: var(--code-size, 14px);
  line-height: 1.5;
}

.pane {
  overflow: auto;
  min-width: 0;
  overscroll-behavior: contain;
  /* Die Balken stehen immer da, sonst springt der Text, sobald einer erscheint. */
  overflow-x: scroll;
}

/* Die linke Spalte folgt der rechten nach oben und unten und braucht dafür keinen eigenen Balken. */
.pane-old { flex: 0 0 calc(var(--share) * 100%); overflow-y: hidden; }
.pane-new { flex: 1 1 0; overflow-y: scroll; }

/* Die Zeilen sind so breit wie die längste, damit ihr Hintergrund beim Scrollen zur Seite mitgeht. */
.pane-lines { width: max-content; min-width: 100%; }

.divider { position: relative; flex: none; width: 9px; margin: 0 -4px; z-index: 2; cursor: col-resize; touch-action: none; }
.divider::before { content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 1px; background: var(--line); }
.divider:hover::before,
.divider:active::before { left: 3px; width: 3px; background: var(--accent); }

.line {
  display: flex;
  /* Jede Zeile ist eine Zeile hoch, auch eine leere; so stehen beide Seiten auf gleicher Höhe. */
  height: 1.5em;
}

.number {
  position: sticky;
  left: 0;
  flex: none;
  /* Wie in Fork: klein und grau auf weißem Grund, mit einer feinen Linie zum Code. Die Farbe der
     Zeile beginnt erst beim Code. */
  width: calc(var(--number-width) + 20px);
  margin-right: 6px;
  padding: 0 8px 0 4px;
  border-right: 1px solid var(--line-soft);
  background: var(--surface);
  color: #b0b5bd;
  font-size: 0.75em;
  line-height: calc(1.5em / 0.75);
  text-align: right;
  user-select: none;
  -webkit-user-select: none;
}

.text { flex: 1 1 auto; padding-right: 12px; white-space: pre; }

.line-added .text { background: var(--diff-added); }
.line-removed .text { background: var(--diff-removed); }

/* Der geänderte Teil, ohne Rundung und Abstand, damit die Zeichen in ihrer Spalte bleiben. */
.line-removed .part { background: var(--diff-removed-part); }
.line-added .part { background: var(--diff-added-part); }

/* Mit Umbruch füllt eine lange Zeile die Breite und rückt die Fortsetzung etwas ein. */
.diff-wrap .pane-lines { width: auto; }
.diff-wrap .line { height: auto; min-height: 1.5em; }
.diff-wrap .text { min-width: 0; padding-left: 2ch; text-indent: -2ch; white-space: pre-wrap; word-break: break-all; }

/* Untereinander ohne entfernte Zeilen zeigt ein roter Strich, wo Zeilen entfernt wurden. */
.line-removed-before .text { box-shadow: inset 0 2px 0 var(--diff-removed-ink); }

.line-empty {
  user-select: none;
  -webkit-user-select: none;
  background: repeating-linear-gradient(135deg, var(--diff-empty) 0 6px, #eef0f2 6px 7px);
}

.gap {
  display: flex;
  align-items: center;
  height: 22px;
  padding-left: 4px;
  border-top: 1px solid var(--line-soft);
  border-bottom: 1px solid var(--line-soft);
  background: var(--diff-gap);
  color: var(--sign);
  font-family: var(--font-ui);
  font-size: 11px;
  line-height: 20px;
  white-space: nowrap;
}

.gap-toggle {
  flex: none;
  height: 20px;
  padding: 0 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-family: var(--font-ui);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
}
.gap-toggle:hover { background: var(--hover); color: var(--accent); }

/* Die Überschrift des Abschnitts wie bei Git. Sie lässt sich markieren und kopieren. */
.gap-heading {
  margin-left: 6px;
  font-family: var(--font-code);
  font-size: calc(var(--code-size, 14px) * 0.9);
  white-space: pre;
}
```

### Code-Farben

Aus `app.css`, Zeilen 1087–1197:

```css
.code-keyword { color: var(--code-keyword); font-style: italic; }
.code-type { color: var(--code-type); }
.code-string { color: var(--code-string); }
.code-number { color: var(--code-number); }
.code-constant { color: var(--code-constant); font-style: italic; }
.code-escape { color: var(--code-escape); font-weight: 500; }
.code-comment { color: var(--code-comment); }
.code-doc-tag { color: var(--code-doc-tag); }
.code-todo { color: var(--code-todo); font-weight: 500; }
.code-annotation { color: var(--code-annotation); }
.code-function,
.code-call,
.code-property { color: var(--code-function); }
.code-parameter { color: var(--code-parameter); }
.code-regexp { color: var(--code-regexp); }
.code-jsx-tag { color: var(--code-jsx-tag); }
.code-jsx-attribute { color: var(--code-jsx-attribute); }
.code-heading { color: var(--code-heading); }
.code-marker { color: var(--code-marker); }
.code-strong { color: var(--ink); font-weight: 500; }
.code-emphasis { color: var(--ink); font-style: italic; }
.code-strikethrough { color: var(--ink); text-decoration: line-through; }
.code-markdown-code { color: var(--code-markdown-code); }
.code-link-text { color: var(--code-link-text); text-decoration: underline; }
.code-url { color: var(--code-url); text-decoration: underline; }
.code-quote { color: var(--code-quote); }
.code-json-key { color: var(--code-json-key); }
```

## Hinweise zur Übernahme

- Die Zeilen werden aus der ganzen Datei aufgebaut, nicht aus den Hunks von Git. Erst so lassen sich Trenner aufklappen und der Kontext frei einstellen. Kommt im Zielprojekt nur ein gewöhnlicher Unified Diff an, braucht es entweder beide Fassungen der Datei oder einen Diff mit maximalem Kontext.
- Die Zeilenhöhe `1.5em` an `.line` und die Höhe von `.number` über `line-height: calc(1.5em / 0.75)` gehören zusammen. Wer die Schriftgröße der Nummern ändert, passt beide an.
- Ein geänderter Teil darf weder `padding` noch `border-radius` haben, sonst verrutschen die Spalten zwischen roter und grüner Zeile.
- Die Schrift MonoLisa ist lokal installiert. Fehlt sie, greift `ui-monospace`.
