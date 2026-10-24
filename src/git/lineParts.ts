import type { DiffLine, LinePart } from './types';

// Portiert aus agent-lab (src/main/java/nh/agentlab/git/LineParts.java).

/**
 * Die meisten Felder der Tabelle für die Tokens zwischen gemeinsamem Anfang und gemeinsamem Ende
 * eines Paars. Ein Paar, das mehr braucht, hat keine Teile.
 */
const MAX_CELLS = 250_000;

interface Token {
  start: number;
  end: number;
  text: string;
}

const NO_PARTS = { removed: [], added: [] };

/**
 * Setzt die Teile der entfernten und hinzugefügten Zeilen, die sich unterscheiden. In einem Block
 * geänderter Zeilen wird die n-te entfernte mit der n-ten hinzugefügten Zeile gepaart; eine Zeile
 * ohne Partner hat keine Teile.
 */
export function markParts(lines: DiffLine[]): void {
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  const block = () => {
    for (let index = 0; index < Math.min(removed.length, added.length); index++) {
      const before = removed[index];
      const after = added[index];
      if (before !== undefined && after !== undefined) {
        const pair = between(before.text, after.text);
        before.parts = pair.removed;
        after.parts = pair.added;
      }
    }
    removed = [];
    added = [];
  };
  for (const line of lines) {
    if (line.kind === 'context') {
      block();
    } else if (line.kind === 'removed') {
      if (added.length > 0) {
        block();
      }
      removed.push(line);
    } else {
      added.push(line);
    }
  }
  block();
}

/**
 * Die Teile eines Paars. Das Paar hat keine, wenn sich beide Zeilen nur im Leerraum unterscheiden,
 * wenn auf einer Seite mehr als 60 % der Zeichen ohne Leerraum anders sind oder wenn der Vergleich
 * mehr Felder braucht, als die Grenze erlaubt. Die Einheit ist das Token: eine Folge aus
 * Buchstaben, Ziffern, `_` und `$` ist ein Token, jedes andere Zeichen außer Leerraum ein eigenes.
 */
export function between(removed: string, added: string): { removed: LinePart[]; added: LinePart[] } {
  const before = tokens(removed);
  const after = tokens(added);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix]?.text === after[prefix]?.text) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix]?.text === after[after.length - 1 - suffix]?.text
  ) {
    suffix++;
  }
  const middleBefore = before.slice(prefix, before.length - suffix);
  const middleAfter = after.slice(prefix, after.length - suffix);
  if (middleBefore.length === 0 && middleAfter.length === 0) {
    return NO_PARTS;
  }
  const rows = middleBefore.length;
  const columns = middleAfter.length;
  if ((rows + 1) * (columns + 1) > MAX_CELLS) {
    return NO_PARTS;
  }
  const width = columns + 1;
  const common = new Uint32Array((rows + 1) * width);
  const at = (i: number, j: number) => common[i * width + j] ?? 0;
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = columns - 1; j >= 0; j--) {
      common[i * width + j] =
        middleBefore[i]?.text === middleAfter[j]?.text
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const changedBefore = before.map(() => false);
  const changedAfter = after.map(() => false);
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (middleBefore[i]?.text === middleAfter[j]?.text) {
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      changedBefore[prefix + i++] = true;
    } else {
      changedAfter[prefix + j++] = true;
    }
  }
  while (i < rows) {
    changedBefore[prefix + i++] = true;
  }
  while (j < columns) {
    changedAfter[prefix + j++] = true;
  }
  if (tooMuch(before, changedBefore) || tooMuch(after, changedAfter)) {
    return NO_PARTS;
  }
  return { removed: ranges(before, changedBefore), added: ranges(after, changedAfter) };
}

/** Ob mehr als 60 % der Zeichen ohne Leerraum geändert sind. */
function tooMuch(tokens: Token[], changed: boolean[]): boolean {
  let total = 0;
  let marked = 0;
  tokens.forEach((token, index) => {
    const length = [...token.text].length;
    total += length;
    if (changed[index] === true) {
      marked += length;
    }
  });
  return marked * 5 > total * 3;
}

/** Die Bereiche der geänderten Tokens. Geänderte Tokens in Folge bilden einen Bereich. */
function ranges(tokens: Token[], changed: boolean[]): LinePart[] {
  const found: LinePart[] = [];
  let index = 0;
  while (index < tokens.length) {
    if (changed[index] !== true) {
      index++;
      continue;
    }
    const first = index;
    while (index + 1 < tokens.length && changed[index + 1] === true) {
      index++;
    }
    const start = tokens[first]?.start ?? 0;
    const end = tokens[index]?.end ?? start;
    found.push({ start, end });
    index++;
  }
  return found;
}

const SPACE = /\s/u;
const WORD = /[\p{L}\p{N}_$]/u;

function tokens(text: string): Token[] {
  const found: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const point = String.fromCodePoint(text.codePointAt(index) ?? 0);
    if (SPACE.test(point)) {
      index += point.length;
      continue;
    }
    const start = index;
    index += point.length;
    if (WORD.test(point)) {
      while (index < text.length) {
        const next = String.fromCodePoint(text.codePointAt(index) ?? 0);
        if (!WORD.test(next)) {
          break;
        }
        index += next.length;
      }
    }
    found.push({ start, end: index, text: text.slice(start, index) });
  }
  return found;
}
