import { highlightTree, styleTags, Tag, tagHighlighter, tags } from '@lezer/highlight';
import type { Highlighter } from '@lezer/highlight';
import { parser as javaParser } from '@lezer/java';
import { parser as javascriptParser } from '@lezer/javascript';
import { parser as jsonParser } from '@lezer/json';
import { GFM, parseCode, parser as markdownParser } from '@lezer/markdown';

// Taken from agent-lab (src/main/frontend/src/ticket/highlight.ts), without the parts that work on
// the lines of its diff.

/** The kinds of code that the diff sets apart, in the order of the table of S201. */
export const CODE_KINDS = [
  'keyword',
  'type',
  'string',
  'number',
  'constant',
  'escape',
  'regexp',
  'comment',
  'doc-tag',
  'todo',
  'annotation',
  'function',
  'call',
  'parameter',
  'property',
  'jsx-tag',
  'jsx-attribute',
  'heading',
  'marker',
  'strong',
  'emphasis',
  'strikethrough',
  'markdown-code',
  'link-text',
  'url',
  'quote',
  'json-key',
] as const;

/** A kind of code, each with its own class in `review.css` and its own variable in `variables.css`. */
export type CodeKind = (typeof CODE_KINDS)[number];

/** A range of one line, in UTF-16 units like the parts of a line. `end` is not included. */
export interface CodeRange {
  start: number;
  end: number;
  kind: CodeKind;
}

/** A piece of the text of a line, with the kind of code it stands in, none for plain text. */
export interface Piece {
  text: string;
  kind: CodeKind | null;
}

/** The pieces that stand together: either all inside one changed part of the line, or all outside of parts. */
export interface Chunk {
  part: boolean;
  pieces: Piece[];
}

/** The language of a file and the dialect that its parser needs, empty without one. */
export interface Language {
  name: 'java' | 'markdown' | 'javascript' | 'json';
  dialect: string;
}

const LANGUAGES = new Map<string, Language>([
  ['java', { name: 'java', dialect: '' }],
  ['md', { name: 'markdown', dialect: '' }],
  ['js', { name: 'javascript', dialect: '' }],
  ['mjs', { name: 'javascript', dialect: '' }],
  ['cjs', { name: 'javascript', dialect: '' }],
  ['jsx', { name: 'javascript', dialect: 'jsx' }],
  ['ts', { name: 'javascript', dialect: 'ts' }],
  ['tsx', { name: 'javascript', dialect: 'ts jsx' }],
  ['json', { name: 'json', dialect: '' }],
]);

/** The language that the ending of the path names, none for every other file. */
export function languageOf(path: string): Language | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  if (dot < 0) {
    return null;
  }
  return LANGUAGES.get(name.slice(dot + 1)) ?? null;
}

/** The ending of a file that a fenced code block of Markdown names with its language. */
const FENCE_ENDINGS = new Map<string, string>([
  ['java', 'java'],
  ['ts', 'ts'],
  ['typescript', 'ts'],
  ['tsx', 'tsx'],
  ['js', 'js'],
  ['javascript', 'js'],
  ['jsx', 'jsx'],
  ['json', 'json'],
  ['md', 'md'],
  ['markdown', 'md'],
]);

/** The class of a name; whether it is a constant depends on its spelling, which only the text shows. */
const NAME = 'name';

/**
 * The class of the name after a dot in Java, where a field is read: the tree gives the same tag to
 * the object before the dot, so the text before the name decides.
 */
const ACCESS = 'access';

/** The key of a property in JSON, which `@lezer/json` names like the property of an object. */
const JSON_KEY = Tag.define('JsonKey');

/** A name in a place where Java reads a field; the object before the dot has the same place. */
const FIELD_ACCESS = Tag.define('FieldAccess');

/** A string of Java, whose escapes the grammar has no node for. */
const JAVA_STRING = Tag.define('JavaString', tags.string);

/** A string of JSON, whose escapes the grammar has no node for. */
const JSON_STRING = Tag.define('JsonString', tags.string);

/** The name of an annotation in Java, whose sign `@` the grammar has no node for. */
const JAVA_ANNOTATION = Tag.define('JavaAnnotation', tags.annotation);

const KIND_OF_TAG = tagHighlighter([
  { tag: JAVA_STRING, class: 'java-string' },
  { tag: JSON_STRING, class: 'json-string' },
  { tag: JAVA_ANNOTATION, class: 'java-annotation' },
  { tag: [tags.keyword, tags.self], class: 'keyword' },
  { tag: [tags.typeName, tags.className, tags.namespace], class: 'type' },
  { tag: [tags.string, tags.character], class: 'string' },
  { tag: tags.number, class: 'number' },
  { tag: [tags.bool, tags.null, tags.atom, tags.constant(tags.variableName)], class: 'constant' },
  { tag: tags.escape, class: 'escape' },
  { tag: tags.regexp, class: 'regexp' },
  { tag: tags.comment, class: 'comment' },
  { tag: [tags.annotation, tags.meta], class: 'annotation' },
  {
    tag: [
      tags.function(tags.definition(tags.variableName)),
      tags.function(tags.definition(tags.propertyName)),
    ],
    class: 'function',
  },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'call' },
  { tag: tags.local(tags.definition(tags.variableName)), class: 'parameter' },
  { tag: tags.propertyName, class: 'property' },
  { tag: FIELD_ACCESS, class: ACCESS },
  { tag: tags.tagName, class: 'jsx-tag' },
  { tag: tags.attributeName, class: 'jsx-attribute' },
  { tag: tags.heading, class: 'heading' },
  { tag: tags.processingInstruction, class: 'marker' },
  { tag: tags.strong, class: 'strong' },
  { tag: tags.emphasis, class: 'emphasis' },
  { tag: tags.strikethrough, class: 'strikethrough' },
  { tag: tags.monospace, class: 'markdown-code' },
  { tag: tags.link, class: 'link-text' },
  { tag: tags.url, class: 'url' },
  { tag: tags.quote, class: 'quote' },
  { tag: JSON_KEY, class: 'json-key' },
  { tag: tags.variableName, class: NAME },
]);

/** Whether the name of a class is a kind; the other names are no kind. */
function isKind(name: string): name is CodeKind {
  return (CODE_KINDS as readonly string[]).includes(name);
}

/** The class of a node: the one of its first tag, because a node has one kind. */
const HIGHLIGHTER: Highlighter = {
  style: (nodeTags) => KIND_OF_TAG.style(nodeTags)?.split(' ')[0] ?? null,
};

const CONSTANT = /^[A-Z][A-Z0-9_]+$/;

const DOC_TAG_AT_LINE_START = /^[ \t]*(?:\/\*+|\*)[ \t]*(@[A-Za-z]+)/gm;
const DOC_TAG_IN_BRACES = /\{@[A-Za-z]+/g;
const TODO = /\b(?:TODO|FIXME|HACK)\b/g;
const JAVA_ESCAPE = /\\(?:u+[0-9a-fA-F]{4}|[0-3]?[0-7]{1,2}|[btnfrs"'\\\n])/g;
const JSON_ESCAPE = /\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])/g;

/** What a grammar without a node for it needs for a class: the escapes of a string, the sign of an annotation. */
const SPECIAL = new Map<string, { kind: CodeKind; escape?: RegExp; sign?: boolean }>([
  ['java-string', { kind: 'string', escape: JAVA_ESCAPE }],
  ['json-string', { kind: 'string', escape: JSON_ESCAPE }],
  ['java-annotation', { kind: 'annotation', sign: true }],
]);

/** The kind of a stretch of text, with what its grammar leaves to the text. */
interface Found {
  kind: CodeKind;
  escape?: RegExp;
  sign?: boolean;
}

/** The built-in types of TypeScript, which are keywords like `void`. */
const BUILT_IN_TYPES: ReadonlySet<string> = new Set([
  'any',
  'bigint',
  'boolean',
  'never',
  'number',
  'object',
  'string',
  'symbol',
  'undefined',
  'unknown',
  'void',
]);

/** Whether the text before `position` ends with a dot, white space aside. */
function followsDot(source: string, position: number): boolean {
  let at = position - 1;
  while (at >= 0 && /\s/.test(source.charAt(at))) {
    at--;
  }
  return source.charAt(at) === '.';
}

/**
 * The kind of a stretch of text from the classes that Lezer set on it: the innermost class wins, a
 * name counts only if it is spelled like a constant, and otherwise the class around it stands. A
 * property is a constant too if it is spelled like one.
 */
function kindOf(classes: string, source: string, start: number, to: number): Found | null {
  const text = source.slice(start, to);
  const found = classes.split(' ');
  for (let index = found.length - 1; index >= 0; index--) {
    const name = found[index];
    if (name === undefined) {
      continue;
    }
    const special = SPECIAL.get(name);
    if (special !== undefined) {
      return special;
    }
    if (name === NAME || name === ACCESS) {
      if (CONSTANT.test(text)) {
        return { kind: 'constant' };
      }
      if (name === ACCESS && followsDot(source, start)) {
        return { kind: 'property' };
      }
    } else if (isKind(name)) {
      return { kind: refine(name, text) };
    }
  }
  return null;
}

/** The kind of the text where the parser is not exact: a constant spelling and a TypeScript type, `super` too. */
function refine(kind: CodeKind, text: string): CodeKind {
  if (kind === 'property' && CONSTANT.test(text)) {
    return 'constant';
  }
  if (kind === 'type' && BUILT_IN_TYPES.has(text)) {
    return 'keyword';
  }
  if (kind === 'constant' && text === 'super') {
    return 'keyword';
  }
  return kind;
}

/**
 * The Java parser with changes: the name of an annotation is a kind of its own, and the sign
 * before it joins it in `highlightText`; a primitive type such as `int` is a keyword, like `void`;
 * and the places of declarations that Lezer leaves without a tag get theirs.
 */
const JAVA = javaParser.configure({
  props: [
    styleTags({
      'Annotation/Identifier Annotation/ScopedIdentifier/...': JAVA_ANNOTATION,
      'MarkerAnnotation/Identifier MarkerAnnotation/ScopedIdentifier/...': JAVA_ANNOTATION,
      'StringLiteral TextBlock CharacterLiteral': JAVA_STRING,
      PrimitiveType: tags.keyword,
      'ClassDeclaration/Definition InterfaceDeclaration/Definition EnumDeclaration/Definition RecordDeclaration/Definition AnnotationTypeDeclaration/Definition TypeParameter/Definition':
        tags.definition(tags.typeName),
      'MethodDeclaration/Definition ConstructorDeclaration/Definition': tags.function(
        tags.definition(tags.variableName),
      ),
      'FormalParameter/Definition': tags.local(tags.definition(tags.variableName)),
      'FieldDeclaration/VariableDeclarator/Definition': tags.definition(tags.propertyName),
      'FieldAccess/Identifier': FIELD_ACCESS,
      'EnumConstant/Definition': tags.constant(tags.variableName),
    }),
  ],
});

/** The parser of TypeScript and JavaScript, with the places that Lezer leaves without a tag. */
function javascriptOf(dialect: string) {
  return javascriptParser.configure({
    dialect,
    props: [
      styleTags({
        'Decorator/VariableName Decorator/CallExpression/VariableName': tags.annotation,
        'ParamList/VariableDefinition': tags.local(tags.definition(tags.variableName)),
        'MethodDeclaration/PropertyDefinition MethodType/PropertyDefinition': tags.function(
          tags.definition(tags.propertyName),
        ),
        'JSXMemberExpression/JSXIdentifier': tags.tagName,
      }),
    ],
  });
}

/** The parser of JSON, whose keys are a kind of their own. */
const JSON_PARSER = jsonParser.configure({
  props: [styleTags({ PropertyName: JSON_KEY, String: JSON_STRING })],
});

/** What the parsers of Lezer have in common for this file: text in, tree out. */
type TextParser = typeof javaParser | typeof markdownParser;

const JAVASCRIPT_PARSERS = new Map<string, TextParser>();

/**
 * The parser of Markdown with the tables, the crossed-out text and the tasks of GFM, and with the
 * parsers of this file for the code in a fenced block. An entity counts as an escape, and the
 * signs of a task and the language of a block as signs of Markdown.
 */
const MARKDOWN: TextParser = markdownParser.configure([
  GFM,
  {
    props: [
      styleTags({
        Entity: tags.escape,
        TaskMarker: tags.processingInstruction,
        CodeInfo: tags.processingInstruction,
      }),
    ],
  },
  parseCode({
    codeParser: (info) => {
      const ending = FENCE_ENDINGS.get(info.trim().split(/\s+/)[0]?.toLowerCase() ?? '');
      const language = ending === undefined ? null : languageOf(`code.${ending}`);
      return language === null ? null : parserOf(language);
    },
  }),
]);

function parserOf(language: Language): TextParser {
  switch (language.name) {
    case 'java':
      return JAVA;
    case 'markdown':
      return MARKDOWN;
    case 'json':
      return JSON_PARSER;
    case 'javascript': {
      let parser = JAVASCRIPT_PARSERS.get(language.dialect);
      if (parser === undefined) {
        parser = javascriptOf(language.dialect);
        JAVASCRIPT_PARSERS.set(language.dialect, parser);
      }
      return parser;
    }
  }
}

/** A range of text in `source`, `to` not included. */
interface Span {
  from: number;
  to: number;
  kind: CodeKind;
}

/** The stretches of `text` that the expression matches, as spans of the kind. */
function matches(
  text: string,
  offset: number,
  expression: RegExp,
  kind: CodeKind,
  group = 0,
): Span[] {
  const found: Span[] = [];
  for (const match of text.matchAll(expression)) {
    const word = match[group];
    if (word !== undefined) {
      const from = offset + match.index + (group === 0 ? 0 : match[0].indexOf(word));
      found.push({ from, to: from + word.length, kind });
    }
  }
  return found;
}

/**
 * The pieces of one range of a kind: a comment has its doc tags and its TODO words as pieces of
 * their own, and a string of Java or JSON has its escapes, which these two grammars have no node
 * for. The pieces cover the range without a gap, in order.
 */
function piecesOf(source: string, from: number, to: number, found: Found) {
  const { kind, escape } = found;
  const text = source.slice(from, to);
  let marked: Span[] = [];
  if (kind === 'comment') {
    if (text.startsWith('/**') && !text.startsWith('/**/')) {
      marked = [
        ...matches(text, from, DOC_TAG_AT_LINE_START, 'doc-tag', 1),
        ...matches(text, from, DOC_TAG_IN_BRACES, 'doc-tag'),
      ];
    }
    marked.push(...matches(text, from, TODO, 'todo'));
  } else if (escape !== undefined) {
    marked = matches(text, from, escape, 'escape');
  }
  marked.sort((a, b) => a.from - b.from);
  const pieces: Span[] = [];
  let position = from;
  for (const span of marked) {
    if (span.from < position) {
      continue;
    }
    if (span.from > position) {
      pieces.push({ from: position, to: span.from, kind });
    }
    pieces.push(span);
    position = span.to;
  }
  if (position < to) {
    pieces.push({ from: position, to, kind });
  }
  return pieces;
}

/** The words of Java that are a keyword only at a place that the line shows, with that place. */
const JAVA_KEYWORDS: RegExp[] = [
  /\brecord(?=\s+[A-Za-z_$][\w$]*\s*[(<])/g,
  /(?<![\w$-])(?:non-)?sealed(?=\s+(?:(?:public|protected|private|abstract|static|final|strictfp|non-sealed|sealed)\s+)*(?:class|interface)\b)/g,
  /(?:^\s*|[\w>)\]]\s+)permits(?=\s+[A-Za-z_$])/g,
  /(?:^|[{;}:]|->)\s*yield(?=\s+(?![=.[])\S|\s*\()/g,
  /\bvar(?=\s+[A-Za-z_$][\w$]*\s*[=:])/g,
];

/** The kinds that a keyword never replaces: text in a string or a comment is no code. */
const NOT_CODE: ReadonlySet<CodeKind> = new Set(['string', 'comment', 'doc-tag', 'todo', 'escape']);

/**
 * Makes the words of `JAVA_KEYWORDS` a keyword in the ranges of a line of Java, where the
 * surroundings in the line show the place of a keyword and the word is not in a string or a
 * comment. A word that Lezer gave another kind is a keyword then.
 */
function javaKeywordsIn(ranges: CodeRange[], line: string): void {
  const found: CodeRange[] = [];
  for (const word of JAVA_KEYWORDS) {
    for (const match of line.matchAll(word)) {
      const text = match[0];
      const name = /(?:non-sealed|sealed|record|permits|yield|var)$/.exec(text)?.[0];
      if (name === undefined) {
        continue;
      }
      const start = match.index + text.length - name.length;
      found.push({ start, end: start + name.length, kind: 'keyword' });
    }
  }
  const whenAt = /\bwhen\b/.exec(line);
  const caseAt = /\bcase\b/.exec(line);
  if (whenAt !== null && caseAt !== null && caseAt.index < whenAt.index) {
    found.push({ start: whenAt.index, end: whenAt.index + 4, kind: 'keyword' });
  }
  for (const keyword of found) {
    const blocked = ranges.some(
      (range) => range.start < keyword.end && keyword.start < range.end && NOT_CODE.has(range.kind),
    );
    if (blocked) {
      continue;
    }
    const kept = ranges.filter((range) => range.end <= keyword.start || keyword.end <= range.start);
    kept.push(keyword);
    kept.sort((a, b) => a.start - b.start);
    ranges.splice(0, ranges.length, ...kept);
  }
}

/**
 * The ranges of each line of a text, in the order of the lines. A range over several lines, such as
 * a Javadoc, is cut at each end of a line, and the lines stay in the text without their break.
 */
export function highlightText(language: Language, text: string): CodeRange[][] {
  const rows: { from: number; to: number; ranges: CodeRange[] }[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    rows.push({ from: offset, to: offset + line.length, ranges: [] });
    offset += line.length + 1;
  }
  let index = 0;
  const place = (span: Span, sign: boolean): void => {
    // The parser has no node for the `@` of an annotation in Java, so it belongs to the name after it.
    const from = sign && text[span.from - 1] === '@' ? span.from - 1 : span.from;
    while ((rows[index + 1]?.from ?? Infinity) <= from) {
      index++;
    }
    let position = from;
    for (let row = rows[index]; row !== undefined && position < span.to; row = rows[++index]) {
      position = Math.max(position, row.from);
      const end = Math.min(span.to, row.to);
      if (end > position) {
        const last = row.ranges.at(-1);
        if (last?.end === position - row.from && last.kind === span.kind) {
          last.end = end - row.from;
        } else {
          row.ranges.push({ start: position - row.from, end: end - row.from, kind: span.kind });
        }
      }
      if (span.to <= row.to) {
        break;
      }
    }
  };
  highlightTree(parserOf(language).parse(text), HIGHLIGHTER, (start, to, classes) => {
    const found = kindOf(classes, text, start, to);
    if (found !== null) {
      for (const span of piecesOf(text, start, to, found)) {
        place(span, found.sign === true && span.kind === found.kind);
      }
    }
  });
  if (language.name === 'java') {
    for (const row of rows) {
      javaKeywordsIn(row.ranges, text.slice(row.from, row.to));
    }
  }
  return rows.map((row) => row.ranges);
}

/**
 * The text of a line as chunks: every changed part stays one chunk, whole, and the ranges of the
 * code are cut at its borders, so that they stand inside the part or beside it. The text stays the
 * same, character for character, in each chunk and in all of them.
 */
export function chunksOf(
  text: string,
  parts: { start: number; end: number }[],
  ranges: CodeRange[],
): Chunk[] {
  const borders = new Set<number>([0, text.length]);
  for (const part of parts) {
    borders.add(part.start);
    borders.add(part.end);
  }
  for (const range of ranges) {
    borders.add(range.start);
    borders.add(range.end);
  }
  const sorted = [...borders].filter((at) => at >= 0 && at <= text.length).sort((a, b) => a - b);
  const chunks: Chunk[] = [];
  let rangeIndex = 0;
  let partOfLast = -2;
  for (const [index, start] of sorted.entries()) {
    const end = sorted[index + 1];
    if (end === undefined) {
      break;
    }
    while ((ranges[rangeIndex]?.end ?? Infinity) <= start) {
      rangeIndex++;
    }
    const range = ranges[rangeIndex];
    const kind = range !== undefined && range.start <= start ? range.kind : null;
    const partIndex = parts.findIndex((part) => part.start <= start && end <= part.end);
    const piece = { text: text.slice(start, end), kind };
    const last = chunks.at(-1);
    if (last !== undefined && partOfLast === partIndex) {
      last.pieces.push(piece);
    } else {
      chunks.push({ part: partIndex >= 0, pieces: [piece] });
      partOfLast = partIndex;
    }
  }
  return chunks;
}
