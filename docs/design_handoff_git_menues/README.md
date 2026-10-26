# Handoff: Repo-Menü, Branch-Menü und Buttonbar (helles Design)

## Prompt für Claude Code

> Lies `design_handoff_git_menues/README.md` vollständig. Passe in unserer App das Repo-Menü, das Branch-Menü und die Buttonbar an das dort beschriebene Design an (Varianten 1a, 2a, 2b). Die HTML-Datei ist nur eine Referenz für Aussehen und Verhalten. Setze das Design mit dem Framework, den Komponenten und den Styling-Konventionen um, die das Projekt schon verwendet. Funktionen, Datenquellen und Reihenfolge der Einträge bleiben unverändert; es geht um Typografie, Farben, Abstände, Icons und Hover-Verhalten. Lege die Werte aus „Design Tokens“ zentral ab (CSS-Variablen oder bestehendes Theme), statt sie zu verstreuen. Geh Menü für Menü vor und zeig mir nach jedem kurz, was du geändert hast.

## Überblick

Die drei Elemente wirkten zu grau und zu „rustikal“. Ziel ist ein klares, natives Erscheinungsbild:

- Systemschrift (SF Pro auf macOS) statt der bisherigen Schrift.
- Namen fast schwarz (`#1c1c1e`), Metadaten dunkelgrau statt hellgrau.
- Blau nur für Auswahl (aktueller Eintrag) und Primäraktion.
- Zeilenaktionen (×, Fenster, Link) erscheinen erst beim Hover.
- Buttonbar 32 px hoch statt ca. 48 px, Icons 15 px, Buttons ohne Rahmen.

## Über die Design-Dateien

`Repo-Menü.dc.html` ist eine **Design-Referenz in HTML**, kein Produktionscode. Öffnen im Browser genügt (`support.js` muss daneben liegen). Die Datei enthält mehrere Varianten; umgesetzt werden nur **1a**, **2a** und **2b**. 1b und 1c sind verworfene Alternativen. Die Bilder in `assets/` zeigen den alten Stand.

## Fidelity

**High-fidelity.** Farben, Schriftgrößen, Abstände und Hover-Zustände sind final. Bitte möglichst exakt übernehmen. Breiten (380 px, 340 px) sind Entwurfswerte; die echte Breite darf sich nach dem Inhalt oder dem bestehenden Popover richten.

Die Beispieldaten (Repo-Namen, Unterordner, Branches) sind teilweise erfunden. Inhalte kommen weiter aus der App.

---

## Gemeinsame Basis (alle Menüs)

**Schrift:** `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, sans-serif`, Antialiasing `-webkit-font-smoothing: antialiased`.

**Popover-Panel**
- Hintergrund `#ffffff`
- Border `1px solid rgba(0,0,0,.09)`
- Radius `12px`
- Schatten `0 18px 50px rgba(20,20,30,.16), 0 2px 8px rgba(20,20,30,.06)`

**Abschnittsüberschrift** (z. B. „Dieses Repo“, „Lokal“): 11px, Weight 600, Farbe `#6a6a71`, letter-spacing `.01em`, keine Großbuchstaben.

**Listenzeile**
- Radius `7px`, Hover-Hintergrund `#f3f3f6`
- Name: 13px / line-height 18px, Weight 500, `#1c1c1e`, einzeilig mit Ellipsis
- Ausgewählt/aktuell: Hintergrund `#e7f1ff`, Name Weight 600, Häkchen 14px in `#156cdd` (stroke 2.2)

**Ikon-Button in Zeilen** (×, Fenster, Link, Auge)
- 24×24 (Repo-Menü) bzw. 26×26 (Branch-Menü), Radius 6px, kein Rahmen, transparenter Hintergrund
- Ikonfarbe `#55555c` bzw. `#6a6a71`, Hover: Hintergrund `rgba(0,0,0,.06)` (Branch-Menü) / `#e5e5ea` (Repo-Menü), Ikonfarbe `#1c1c1e`
- × Icon 12px, stroke 1.8, round caps

**Gruppen-Zeile mit Kindern**
- Chevron 12px, stroke 2, `#6a6a71` (unten = offen, rechts = zu)
- Name 13px / 600
- Zähler-Badge rechts: 11px / 600, `#4a4a50` auf `#efeff2`, Radius 10px, padding `1px 7px`, line-height 16px
- Kinder-Container: `margin-left 16px`, `padding-left 6px`, `border-left 1px solid #e3e3e8`

**Icons:** Outline, 16er-Viewbox, stroke 1.5–1.7, round caps/joins. Wenn das Projekt eine Icon-Bibliothek nutzt (z. B. Lucide, SF Symbols, Codicons), deren passende Outline-Icons verwenden.

---

## 1a · Repo-Menü

Aufbau von oben nach unten: Filterfeld, „Dieses Repo“, „Andere Repos“, „Zuletzt geändert“ mit Umschalter, Liste mit Gruppen, Fußzeile mit Pfadfeld.

**Filterfeld** (Container padding `10px 10px 4px`)
- Höhe 34px, padding `0 10px`, Hintergrund `#f1f1f4`, Radius 8px, kein Rahmen
- Lupe 14px `#6e6e75`, gap 8px, Input 13px, Placeholder „Filtern“ (50 % Deckkraft)

**Scrollbereich:** padding `0 6px 10px`.

**Abschnittsüberschriften:** padding `12px 10px 5px` (erste), `14px 10px 5px` (weitere).

**Repo-Zeile („Dieses Repo“, „Andere Repos“)**
- Grid `18px | 1fr`, gap 4px, padding `7px 36px 8px 8px` (rechts Platz für ×)
- Zeile 1: Name
- Zeile 2 (margin-top 3px, 11.5px / 16px, `#55555c`, gap 8px):
  - Ordner: Haus-Icon 11px + Ordnername, Ellipsis
  - Branch-Chip: Branch-Icon 11px + Name, padding `1px 6px`, Radius 4px, Hintergrund `#efeff2` (in der ausgewählten Zeile `#ffffff`), Text `#2a2a30` Weight 500, schrumpft nicht
- Aktuelles Repo: ausgewählter Zustand (siehe Basis)
- × nur beim Hover, absolut `right 6px`, vertikal zentriert. Tooltip „Aus dem Menü ausschließen“

**Zeile „Zuletzt geändert“ + Umschalter** (padding `16px 4px 6px 10px`, space-between)
- Segmented Control: Container padding 2px, Hintergrund `#ececf0`, Radius 7px, gap 2px
- Segment: padding `3px 10px`, Radius 5px, 11.5px
  - aktiv: Hintergrund `#ffffff`, Schatten `0 1px 2px rgba(0,0,0,.14), 0 0 0 .5px rgba(0,0,0,.06)`, Weight 600, `#1c1c1e`
  - inaktiv: transparent, Weight 500, `#4a4a50`, Hover `#1c1c1e`
- Segmente: „develop“, „javascript“, „Beide“ (bestehende Werte der App)

**Zuletzt geänderte Einträge**
- Gruppe: padding `7px 10px 7px 8px`, Grid `18px | 1fr | auto` (Chevron, Name, Zähler). Klick klappt auf/zu
- Kind-Zeile: padding `6px 36px 7px 8px`, Name 13/500, darunter Pfad 11.5px / 16px `#62626a`, margin-top 1px, Ellipsis
- Einzel-Eintrag ohne Kinder: wie Repo-Zeile, zweite Zeile ist der Pfad
- × beim Hover wie oben
- Leerer Zustand: „Keine Treffer“, 12.5px `#55555c`, padding `10px 10px 4px 30px`

**Fußzeile**
- padding 10px, gap 8px, `border-top 1px solid #ececf0`, Hintergrund `#fafafb`
- Pfadfeld: Höhe 32px, padding `0 10px`, Border `1px solid #d9d9de`, Radius 7px, 12.5px. Focus: Border `#377ee3` + Ring `0 0 0 3px rgba(55,126,227,.18)`. Placeholder-Text aus der App übernehmen
- Button „Öffnen“: Höhe 32px, padding `0 14px`, Radius 7px, 12.5px / 600
  - aktiv: `#156cdd`, Text weiß, Hover `#005ccc`
  - deaktiviert (Feld leer): Hintergrund `#ececf0`, Text `#9a9aa1`

---

## 2a · Branch-Menü

Panel wie Basis, padding `4px 6px 6px`. Alle Zeilen haben rechts eine **feste 28-px-Spalte für das Auge**, damit die Augen exakt untereinander stehen.

**Kopf „Lokal“:** Grid `1fr | 28px`, padding `8px 0 4px 10px`, Überschrift-Stil + Auge (schaltet alle lokalen Branches).

**Lokaler Branch**
- Grid `18px | 1fr | auto | 28px`, gap 4px, Radius 7px
- Aktueller Branch: min-height 44px, padding `5px 0 5px 8px`, ausgewählter Zustand mit Häkchen. Unter dem Namen optional „ausgecheckt“ (11.5px / 16px `#55555c`)
- Andere Branches: min-height 34px, padding `3px 0 3px 8px`, Hover `#f3f3f6`, Klick = Checkout (bestehendes Verhalten)
- Spalte `auto`: Fenster-Icon (14px) und × erscheinen **nur beim Hover**

**Trenner:** 1px `#ececf0`, margin `6px 4px`.

**Remotes**
- Gruppen-Zeile: Chevron, „Remotes“ 13/600, Zähler-Badge, Auge. Klick klappt auf/zu
- Remote (z. B. „origin“): Kinder-Container wie Basis; Grid `18px | 1fr | 28px`, min-height 32px, padding `3px 0 3px 4px`; Wolken-Icon 14px `#55555c`, Name 13/600, Auge
- Remote-Branch: weiterer Kinder-Container (`margin-left 13px`, `padding-left 6px`, Border-left); Grid `1fr | auto | 28px`, min-height 32px, padding `3px 0 3px 8px`, Name 13/500; Link-Icon 14px nur beim Hover

**Auge**
- Icon 15px, stroke 1.5; ausgeblendet = Auge mit Schrägstrich
- Ausgeblendete Einträge: Name mit `opacity: .4`
- Ist ein Elternteil (Lokal, Remotes, origin) ausgeblendet, erscheinen die Kinder ebenfalls ausgeblendet

---

## 2b · Buttonbar

Nur die Leiste unter den Tabs ändert sich; die Tabs bleiben wie sie sind.

- Höhe **32px**, padding `0 6px`, gap 2px, Hintergrund `#ffffff`, `border-bottom 1px solid #ececf0`
- Reihenfolge und Funktionen der Buttons wie im Bestand

**Icon-Button:** 24×24, Radius 6px, kein Rahmen, transparent, Icon **15px** stroke 1.5, Farbe `#3a3a40`; Hover Hintergrund `#f1f1f4`, Icon `#1c1c1e`.

**Toggle aktiv** (z. B. Seitenleiste eingeblendet): Hintergrund `#dfecff`, Icon `#005ccc`.

**Menü-Buttons** (Repos, Branches): Höhe 24px, padding `0 4px 0 5px`, gap 2px, Icon 15px + Chevron 8px (stroke 2.4), zeigt an, dass ein Menü aufgeht.

**Trennlinie** zwischen Gruppen: 1×16px, `#e3e3e8`, margin `0 5px`.

**Schriftgröße A− / A+:** Container Höhe 24px, padding 2px, gap 1px, Hintergrund `#f1f1f4`, Radius 6px. Buttons 26px breit, Radius 4px, 11.5px / 600, `#3a3a40`; Hover Hintergrund `#ffffff`, Text `#1c1c1e`.

Rechtsbündige Gruppe (Timer, A−/A+) durch einen flexiblen Spacer.

---

## Interaktionen

- Hover auf Zeile: Hintergrund `#f3f3f6`, Zeilenaktionen einblenden. Keine Animation nötig; falls das Projekt Übergänge nutzt, max. 100 ms.
- × entfernt den Eintrag aus dem Menü (bestehende Funktion „ausschließen“). Klick darf nicht die Zeile auslösen (`stopPropagation`).
- Auge-Klick darf nicht die Zeile auslösen.
- Filter: filtert alle Abschnitte live; bei aktivem Filter sind Gruppen aufgeklappt. Gruppen ohne Treffer verschwinden.
- Umschalter „Zuletzt geändert“: wechselt die Quelle der Liste.
- „Öffnen“ ist deaktiviert, solange das Pfadfeld leer ist.

## Design Tokens

| Token | Wert |
|---|---|
| text-primary | `#1c1c1e` |
| text-strong-secondary | `#2a2a30` |
| text-icon | `#3a3a40` |
| text-muted | `#4a4a50` |
| text-secondary | `#55555c` |
| text-path | `#62626a` |
| text-label | `#6a6a71` |
| icon-search | `#6e6e75` |
| text-disabled | `#9a9aa1` |
| bg-panel | `#ffffff` |
| bg-footer | `#fafafb` |
| bg-hover | `#f3f3f6` |
| bg-field / bg-toolbar-hover | `#f1f1f4` |
| bg-chip / bg-badge | `#efeff2` |
| bg-segmented / bg-disabled | `#ececf0` |
| border-divider | `#ececf0` |
| border-tree | `#e3e3e8` |
| border-input | `#d9d9de` |
| bg-remove-hover | `#e5e5ea` |
| accent | `#156cdd` (oklch 0.55 0.19 258) |
| accent-hover / toolbar-active-fg | `#005ccc` (oklch 0.5 0.19 258) |
| accent-focus | `#377ee3` (oklch 0.6 0.17 258) |
| bg-selected | `#e7f1ff` (oklch 0.955 0.022 258) |
| toolbar-active-bg | `#dfecff` (oklch 0.94 0.03 258) |

**Schriftgrößen:** 11 (Labels, Badges) · 11.5 (Meta, Segmente, Pfade) · 12.5 (Fußzeile) · 13 (Namen, Inputs).
**Gewichte:** 500 (Namen), 600 (Labels, Auswahl, Gruppen, Buttons).
**Radien:** 4 (Chips, kleine Buttons) · 5 (Segment) · 6 (Icon-Buttons) · 7 (Zeilen, Inputs) · 8 (Filterfeld) · 12 (Panel).

## Dateien

- `Repo-Menü.dc.html`: interaktive Referenz (im Browser öffnen, Varianten 1a, 2a, 2b)
- `support.js`: Laufzeit für die Referenzdatei, nicht ins Projekt übernehmen
- `assets/vorher*.png`: alter Stand zum Vergleich
- `screenshots/1a-repo-menue.png`, `screenshots/2a-branch-menue.png`, `screenshots/2b-buttonbar.png`: neue Entwürfe in 2× Auflösung (ohne Hover-Zustände; die zeigt die HTML-Referenz)
