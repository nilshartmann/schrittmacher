import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { LRLanguage } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { parser as javaParser } from '@lezer/java';
import { parser as javascriptParser } from '@lezer/javascript';
import { parser as jsonParser } from '@lezer/json';
import { parser as xmlParser } from '@lezer/xml';
import { parser as yamlParser } from '@lezer/yaml';

/**
 * Die Sprachen für die Hervorhebung im Editor. Sie kommen aus denselben Lezer-Parsern wie die
 * Hervorhebung im Diff, damit keine Pakete `@codemirror/lang-*` nötig sind.
 */

/** Die Endung eines Pfads in Kleinbuchstaben, ohne Punkt; leer ohne Endung. */
function endingOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Ob eine Datei Markdown ist, nach ihrer Endung. */
export function isMarkdownPath(path: string): boolean {
  return ['md', 'markdown'].includes(endingOf(path));
}

const JAVASCRIPT = new Set(['js', 'mjs', 'cjs', 'jsx']);
const TYPESCRIPT = new Set(['ts', 'mts', 'cts', 'tsx']);

/** Die Sprache einer Datei für CodeMirror nach ihrer Endung; ohne passende nur Text. */
export function languageFor(path: string): Extension {
  const ending = endingOf(path);
  if (ending === 'md' || ending === 'markdown') {
    return markdown({ base: markdownLanguage });
  }
  if (JAVASCRIPT.has(ending)) {
    return LRLanguage.define({ name: 'javascript', parser: javascriptParser.configure({ dialect: 'jsx' }) });
  }
  if (TYPESCRIPT.has(ending)) {
    const dialect = ending === 'tsx' ? 'ts jsx' : 'ts';
    return LRLanguage.define({ name: 'typescript', parser: javascriptParser.configure({ dialect }) });
  }
  if (ending === 'json') {
    return LRLanguage.define({ name: 'json', parser: jsonParser });
  }
  if (ending === 'yaml' || ending === 'yml') {
    return LRLanguage.define({ name: 'yaml', parser: yamlParser });
  }
  if (ending === 'java') {
    return LRLanguage.define({ name: 'java', parser: javaParser });
  }
  if (ending === 'xml' || ending === 'svg') {
    return LRLanguage.define({ name: 'xml', parser: xmlParser });
  }
  return [];
}
