// Die Anmerkungen von Claude zu einer Markdown-Datei, ohne Zugriff auf Dateien, für Server und Oberfläche.

import { isRecord } from './notes';

/**
 * Eine Anmerkung, wie Claude sie schreibt: der zitierte Text aus der Datei, ein Stück Text davor und
 * die Anmerkung als Markdown. Ein leeres Zitat gilt für die ganze Datei. Die `id` ergänzt der Server
 * aus dem Inhalt, damit sich eine Anmerkung als erledigt verwerfen lässt.
 */
export interface MdComment {
  id: string;
  quote: string;
  before: string;
  text: string;
}

/** Die Anmerkungen einer Datei mit der Datei, in die Claude sie schreibt. */
export interface MdComments {
  comments: MdComment[];
  file: string;
  /** Die letzte Änderung dieser Datei in Millisekunden; `null`, solange es sie nicht gibt. */
  changed: number | null;
  /** Warum sich die Datei nicht lesen ließ, etwa weil Claude ungültiges JSON geschrieben hat. */
  error: string | null;
}

/** Eine Anmerkung ohne `id`, wie sie in der Datei steht; `null` für einen Eintrag ohne Text. */
export function commentOf(value: unknown): Omit<MdComment, 'id'> | null {
  if (!isRecord(value) || typeof value.text !== 'string' || value.text.trim() === '') {
    return null;
  }
  return {
    quote: typeof value.quote === 'string' ? value.quote : '',
    before: typeof value.before === 'string' ? value.before : '',
    text: value.text,
  };
}

/** Die Zahl der Zeichen, in denen `a` und `b` von hinten übereinstimmen. */
function commonSuffix(a: string, b: string): number {
  let count = 0;
  while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) {
    count++;
  }
  return count;
}

/**
 * Wo das Zitat einer Anmerkung im aktuellen Text steht, als Positionen von Zeichen. Steht es mehrmals
 * da, gilt die Stelle, vor der am meisten von `before` übereinstimmt, bei Gleichstand die erste.
 * Findet sich das Zitat nicht wörtlich, wird es ohne Leerraum am Rand gesucht. `null` heißt nicht
 * gefunden; ein leeres Zitat gilt für die ganze Datei und hat keine Stelle.
 */
export function locateComment(comment: Pick<MdComment, 'quote' | 'before'>, text: string): { from: number; to: number } | null {
  for (const quote of [comment.quote, comment.quote.trim()]) {
    if (quote === '') {
      return null;
    }
    let best: { from: number; score: number } | null = null;
    for (let index = text.indexOf(quote); index !== -1; index = text.indexOf(quote, index + 1)) {
      const score = commonSuffix(text.slice(Math.max(0, index - comment.before.length), index), comment.before);
      if (best === null || score > best.score) {
        best = { from: index, score };
      }
    }
    if (best !== null) {
      return { from: best.from, to: best.from + quote.length };
    }
  }
  return null;
}

/**
 * Der Teil des Prompts, den Schrittmacher hinter den Auftrag setzt: wohin Claude die Anmerkungen
 * schreibt und in welchem Format. Er steht nicht im Dialog, damit sich das Format nicht versehentlich
 * ändert.
 */
export function commentsFormat(path: string, file: string): string {
  const example = JSON.stringify(
    {
      file: path,
      comments: [
        { quote: 'wörtlich zitierter Text aus der Datei', before: 'die Zeichen direkt davor', text: 'Die Anmerkung als Markdown.' },
        { quote: '', before: '', text: 'Eine Anmerkung zur ganzen Datei.' },
      ],
    },
    null,
    2,
  );
  return [
    `Schreib deine Anmerkungen als JSON in die Datei ${file}. Leg sie neu an, auch wenn es sie schon gibt. Das Format:`,
    ['```json', example, '```'].join('\n'),
    [
      '- `quote`: wörtlich aus der Datei kopierter Text, auf den sich die Anmerkung bezieht. Möglichst kurz, aber eindeutig, höchstens ein Absatz. Leer für eine Anmerkung zur ganzen Datei.',
      '- `before`: die rund 30 Zeichen direkt vor dem Zitat, ebenfalls wörtlich. Damit lässt sich ein Zitat zuordnen, das mehrmals vorkommt.',
      '- `text`: die Anmerkung als Markdown. Ein Vorschlag für einen neuen Wortlaut steht darin als Zitat mit `>`.',
    ].join('\n'),
    'Ändere die Markdown-Datei selbst nicht. Nenn zum Schluss im Terminal nur die Zahl der Anmerkungen.',
  ].join('\n\n');
}
