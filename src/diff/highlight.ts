import { highlightTree, styleTags, Tag, tagHighlighter, tags } from '@lezer/highlight';
import type { Highlighter } from '@lezer/highlight';
import { parser as javaParser } from '@lezer/java';
import { parser as javascriptParser } from '@lezer/javascript';
import { parser as jsonParser } from '@lezer/json';
import { GFM, parseCode, parser as markdownParser } from '@lezer/markdown';
import { parser as xmlParser } from '@lezer/xml';
import { parser as yamlParser } from '@lezer/yaml';

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
  name: 'java' | 'markdown' | 'javascript' | 'json' | 'sql' | 'shell' | 'xml' | 'yaml' | 'properties';
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
  ['sql', { name: 'sql', dialect: '' }],
  ['sh', { name: 'shell', dialect: '' }],
  ['bash', { name: 'shell', dialect: '' }],
  ['zsh', { name: 'shell', dialect: '' }],
  ['xml', { name: 'xml', dialect: '' }],
  ['yaml', { name: 'yaml', dialect: '' }],
  ['yml', { name: 'yaml', dialect: '' }],
  ['properties', { name: 'properties', dialect: '' }],
]);

/** The first line of a script for a shell, such as `#!/usr/bin/env bash`. */
const SHELL_SHEBANG = /^#!\S*(?:\/|\s)(?:ba|z|da|k)?sh\b/;

/**
 * The language that the ending of the path names. A file without a known ending is a script for
 * a shell if its text begins with the shebang of one, as a script in `bin/` does; every other
 * file has none.
 */
export function languageOf(path: string, text = ''): Language | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const language = dot < 0 ? undefined : LANGUAGES.get(name.slice(dot + 1));
  if (language !== undefined) {
    return language;
  }
  return SHELL_SHEBANG.test(text) ? { name: 'shell', dialect: '' } : null;
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
  ['xml', 'xml'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
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

/** A value of YAML without quotes, whose text decides whether it is a number or a constant. */
const YAML_LITERAL = Tag.define('YamlLiteral');

/** The class of `YAML_LITERAL`. */
const YAML_VALUE = 'yaml-value';

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
  { tag: tags.attributeValue, class: 'string' },
  { tag: YAML_LITERAL, class: YAML_VALUE },
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

/** A number of YAML, with the infinity and the not-a-number of its core schema. */
const YAML_NUMBER = /^[-+]?(?:\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+|0x[0-9a-fA-F]+|0o[0-7]+|\.inf|\.nan)$/i;

/** A constant of YAML: the truth values and the empty value, `~` too. */
const YAML_CONSTANT = /^(?:true|false|null|~)$/i;

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
    if (name === YAML_VALUE) {
      return YAML_NUMBER.test(text) ? { kind: 'number' } : YAML_CONSTANT.test(text) ? { kind: 'constant' } : null;
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

/**
 * The parser of XML: an entity counts as an escape, and the declaration at the beginning and a
 * doctype as an annotation, the way a line with `<?xml` sets itself apart in Fork.
 */
const XML_PARSER = xmlParser.configure({
  props: [
    styleTags({
      'EntityReference CharacterReference': tags.escape,
      'ProcessingInst DoctypeDecl': tags.meta,
    }),
  ],
});

/**
 * The parser of YAML: keys like those of JSON, a value without quotes as a number or constant by
 * its text, the text of a block such as `|` as a string, and an anchor as an annotation.
 */
const YAML_PARSER = yamlParser.configure({
  props: [
    styleTags({
      'Key/Literal Key/QuotedLiteral': JSON_KEY,
      Literal: YAML_LITERAL,
      BlockLiteralContent: tags.string,
      'Anchor Alias': tags.annotation,
    }),
  ],
});

/** What the parsers of Lezer have in common for this file: text in, tree out. */
type TextParser = typeof javaParser | typeof markdownParser | typeof xmlParser | typeof yamlParser;

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

/**
 * The parser of a language, none for SQL, the shell and the properties of Java, which have no
 * parser of Lezer and go through `TOKENIZED`.
 */
function parserOf(language: Language): TextParser | null {
  switch (language.name) {
    case 'java':
      return JAVA;
    case 'markdown':
      return MARKDOWN;
    case 'json':
      return JSON_PARSER;
    case 'xml':
      return XML_PARSER;
    case 'yaml':
      return YAML_PARSER;
    case 'sql':
    case 'shell':
    case 'properties':
      return null;
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
  return filled(from, to, kind, marked);
}

/**
 * The spans that cover the range from `from` to `to` without a gap, in order: the marked spans,
 * and the kind of the range between them. A marked span inside another one is left out.
 */
function filled(from: number, to: number, kind: CodeKind, marked: Span[]): Span[] {
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

/** The keywords of PostgreSQL that a migration or a query uses, in lower case. */
const SQL_KEYWORDS: ReadonlySet<string> = new Set(
  `add all alter always and any as asc begin between by cascade case check collate column commit
  comment concurrently constraint create cross current_date current_time current_timestamp cycle
  database default deferrable deferred delete desc distinct do drop each else end except exists
  extension filter first for foreign from full function generated grant group having identity if
  ilike in increment index inherits initially inner insert intersect into is join key language last
  lateral left like limit local materialized maxvalue minvalue natural no not nothing nulls of offset
  on only or order outer over owned partition policy primary procedure references rename replace
  restrict returning returns revoke right rollback row rows schema select sequence set start stored
  table temp temporary then to transaction trigger truncate union unique unlogged update using values
  view when where window with`.split(/\s+/),
);

/** The types of PostgreSQL, in lower case; `double precision` and the like are two words of a type. */
const SQL_TYPES: ReadonlySet<string> = new Set(
  `bigint bigserial bit bool boolean bytea char character date decimal double float int int2 int4 int8
  integer interval json jsonb money numeric precision real serial smallint smallserial text time
  timestamp timestamptz timetz uuid varchar varying xml zone`.split(/\s+/),
);

/** The constants of SQL, in lower case. */
const SQL_CONSTANTS: ReadonlySet<string> = new Set(['null', 'true', 'false']);

/**
 * The tokens of SQL: a comment with `--` or `/* *\/`, a string in single quotes or between two
 * dollar quotes, a quoted name, a parameter such as `$1`, a number and a word.
 */
const SQL_TOKEN =
  /--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|[Ee]?'(?:[^']|'')*(?:'|$)|(\$[A-Za-z_]*\$)[\s\S]*?(?:\1|$)|"(?:[^"]|"")*"?|\$\d+|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|[A-Za-z_][\w$]*/g;

/**
 * The kind of a word of SQL: a word right before a bracket that is no keyword is a call. A space
 * before the bracket marks a table with its columns, as in `INSERT INTO loan (isbn)`.
 */
function sqlWordKind(word: string, source: string, end: number): CodeKind | null {
  const lower = word.toLowerCase();
  if (SQL_CONSTANTS.has(lower)) {
    return 'constant';
  }
  if (SQL_TYPES.has(lower)) {
    return 'type';
  }
  if (SQL_KEYWORDS.has(lower)) {
    return 'keyword';
  }
  return source.charAt(end) === '(' ? 'call' : null;
}

/**
 * The spans of a text of SQL, in order. Without a parser of Lezer for SQL, the tokens decide, as
 * they do in the grammar of SQL of CodeMirror.
 */
function sqlSpans(source: string): Span[] {
  const spans: Span[] = [];
  for (const match of source.matchAll(SQL_TOKEN)) {
    const token = match[0];
    const from = match.index;
    const to = from + token.length;
    const first = token.charAt(0);
    if (token.startsWith('--') || token.startsWith('/*')) {
      spans.push(...piecesOf(source, from, to, { kind: 'comment' }));
    } else if (first === "'" || match[1] !== undefined || /^[Ee]'/.test(token)) {
      spans.push({ from, to, kind: 'string' });
    } else if (first === '$') {
      spans.push({ from, to, kind: 'parameter' });
    } else if (/\d/.test(first)) {
      spans.push({ from, to, kind: 'number' });
    } else if (first !== '"') {
      const kind = sqlWordKind(token, source, to);
      if (kind !== null) {
        spans.push({ from, to, kind });
      }
    }
  }
  return spans;
}

/**
 * The words of the shell that build its structure, and the builtins that declare a variable or
 * leave a function or a loop.
 */
const SHELL_KEYWORDS: ReadonlySet<string> = new Set(
  `if then else elif fi for in do done while until case esac function select time break continue
  declare exit export local readonly return shift source typeset unset`.split(/\s+/),
);

/** The keywords after which a command follows, as it does at the beginning of a line. */
const SHELL_BEFORE_COMMAND: ReadonlySet<string> = new Set(
  `if then else elif do while until time !`.split(/\s+/),
);

/** The keywords after which the name of a variable follows and then `in`. */
const SHELL_BEFORE_IN: ReadonlySet<string> = new Set(['for', 'case', 'select']);

/** A variable of the shell: `$name`, `${…}`, and a special one such as `$1` or `$?`. */
const SHELL_VARIABLE = /\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*|[0-9@*#?$!-])/g;

/** An escape in a heredoc; elsewhere outside of quotes a backslash stays as it is. */
const SHELL_HEREDOC_ESCAPE = /\\[$`\\\n]/g;

/** An escape in a string in `$'…'`. */
const SHELL_ANSI_ESCAPE = /\\(?:x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|[0-7]{1,3}|[\s\S])/g;

/**
 * The tokens of the shell, one group for each: a comment, a character after a backslash, a string
 * in `$'…'` and in single quotes, the start of a string in double quotes and of a heredoc, a
 * variable, the start of a command substitution and of an arithmetic expansion, a closing bracket,
 * a redirection, a sign that ends a command, the assignment to a variable, and a word.
 */
const SHELL_TOKEN = new RegExp(
  [
    /(#[^\n]*)/,
    /(\\[\s\S])/,
    /(\$'(?:[^'\\]|\\[\s\S])*'?)/,
    /('[^']*'?)/,
    /(")/,
    // A string, because a backreference in a literal counts only the groups of that literal.
    "(<<-?[ \\t]*(['\"]?)([A-Za-z_]\\w*)\\7)",
    /(\$(?:\{[^}\n]*\}?|[A-Za-z_]\w*|[0-9@*#?$!-]))/,
    /(\$\((?!\()|`)/,
    /(\$\(\()/,
    /(\))/,
    /(\d*(?:<<<|<>|>>|[<>])&?(?:\d+-?|-)?)/,
    /(&&|\|\||;;|[;&|(\n]|\{(?=\s))/,
    /([A-Za-z_]\w*(?:\[[^\]\n]*\])?\+?=)/,
    /([^\s;&|()<>"'`$\\]+)/,
  ]
    .map((part) => (typeof part === 'string' ? part : part.source))
    .join('|'),
  'g',
);

/** The spans of a string in which the shell replaces variables, with them and its escapes. */
function expandedPieces(source: string, from: number, to: number, escape: RegExp): Span[] {
  const text = source.slice(from, to);
  return filled(from, to, 'string', [
    ...matches(text, from, SHELL_VARIABLE, 'parameter'),
    ...matches(text, from, escape, 'escape'),
  ]);
}

/** The spans of a script for the shell, in order. */
function shellSpans(source: string): Span[] {
  const spans: Span[] = [];
  shellCommands(source, 0, null, spans);
  return spans;
}

/**
 * Places the spans of the commands from `start` on, up to the end of the text or, inside a
 * command substitution, up to the sign `end` that closes it, and gives the position after it.
 * Without a parser of Lezer for the shell, the tokens decide, and the place of a word: at the
 * beginning of a command, it is a keyword or the call of a command; behind it, an argument.
 */
function shellCommands(source: string, start: number, end: ')' | '`' | null, spans: Span[]): number {
  const token = new RegExp(SHELL_TOKEN);
  token.lastIndex = start;
  /** Whether the next word begins a command. */
  let command = true;
  /** Where the value of an assignment begins, which is no command, though one may follow it. */
  let valueAt = -1;
  /** The keyword before a word `in`, which makes it a keyword: `for`, `case` or `select`. */
  let expectIn: string | null = null;
  /** Whether the words are a pattern of `case`, up to its `)`. */
  let pattern = false;
  /** Whether the next word names a function, after the keyword `function`. */
  let definition = false;
  /** The brackets that are open, of a subshell or an arithmetic expansion. */
  let depth = 0;
  /** The heredocs of the line, whose texts begin after its end. */
  const heredocs: Heredoc[] = [];
  for (let match = token.exec(source); match !== null; match = token.exec(source)) {
    const text = match[0];
    const from = match.index;
    const to = from + text.length;
    const value = from === valueAt;
    if (end === '`' && text === '`') {
      return to;
    }
    if (match[1] !== undefined) {
      if (from === 0 || /[\s;&|()]/.test(source.charAt(from - 1))) {
        spans.push(...piecesOf(source, from, to, { kind: 'comment' }));
      } else {
        token.lastIndex = from + 1;
      }
      continue;
    }
    if (match[2] !== undefined) {
      continue;
    }
    if (match[3] !== undefined) {
      spans.push(...expandedPieces(source, from, to, SHELL_ANSI_ESCAPE));
    } else if (match[4] !== undefined) {
      spans.push({ from, to, kind: 'string' });
    } else if (match[5] !== undefined) {
      token.lastIndex = doubleQuoted(source, from, spans);
    } else if (match[6] !== undefined) {
      heredocs.push({ word: match[8] ?? '', tabs: text.startsWith('<<-'), quoted: match[7] !== '' });
      continue;
    } else if (match[9] !== undefined) {
      spans.push({ from, to, kind: 'parameter' });
    } else if (match[10] !== undefined) {
      token.lastIndex = shellCommands(source, to, text === '`' ? '`' : ')', spans);
    } else if (match[11] !== undefined) {
      token.lastIndex = arithmetic(source, to, spans);
    } else if (match[12] !== undefined) {
      depth--;
      if (depth < 0 && end === ')') {
        return to;
      }
      depth = Math.max(depth, 0);
      command = pattern;
      pattern = false;
      continue;
    } else if (match[13] !== undefined) {
      continue;
    } else if (match[14] !== undefined) {
      command = !(value && text === '(');
      expectIn = null;
      pattern ||= text === ';;';
      if (text === '(') {
        depth++;
      }
      if (text === '\n') {
        for (const heredoc of heredocs.splice(0)) {
          token.lastIndex = heredocText(source, token.lastIndex, heredoc, spans);
        }
      }
      continue;
    } else if (match[15] !== undefined) {
      const name = text.length - (text.endsWith('+=') ? 2 : 1);
      spans.push({ from, to: from + name, kind: 'parameter' });
      valueAt = to;
      continue;
    } else if (pattern && text !== 'esac') {
      continue;
    } else {
      const kind = shellWordKind(text, source, to, {
        command: command && !value,
        expectIn: expectIn !== null,
        definition,
      });
      if (kind !== null) {
        spans.push({ from, to, kind });
      }
      definition = kind === 'keyword' && text === 'function';
      if (kind === 'keyword') {
        pattern = text === 'in' && expectIn === 'case';
        if (SHELL_BEFORE_IN.has(text)) {
          expectIn = text;
        } else if (text === 'in') {
          expectIn = null;
        }
        command = SHELL_BEFORE_COMMAND.has(text);
        continue;
      }
    }
    if (!value) {
      command = false;
    }
  }
  return source.length;
}

/**
 * Places the spans of an arithmetic expansion whose expression begins at `start`, with its
 * variables and its numbers, and gives the position after the brackets that close it.
 */
function arithmetic(source: string, start: number, spans: Span[]): number {
  let depth = 2;
  let at = start;
  while (at < source.length && depth > 0) {
    const sign = source.charAt(at++);
    depth += sign === '(' ? 1 : sign === ')' ? -1 : 0;
  }
  const text = source.slice(start, at);
  const found = [
    ...matches(text, start, SHELL_VARIABLE, 'parameter'),
    ...matches(text, start, /\b\d+\b/g, 'number'),
  ];
  spans.push(...found.sort((a, b) => a.from - b.from));
  return at;
}

/**
 * Places the spans of a string in double quotes that begins at `from`, with its variables, its
 * escapes and the commands of a substitution in it, and gives the position after it.
 */
function doubleQuoted(source: string, from: number, spans: Span[]): number {
  const variable = new RegExp(SHELL_VARIABLE.source, 'y');
  let plain = from;
  let at = from + 1;
  const flush = (to: number): void => {
    if (to > plain) {
      spans.push({ from: plain, to, kind: 'string' });
    }
  };
  while (at < source.length) {
    const sign = source.charAt(at);
    if (sign === '"') {
      flush(at + 1);
      return at + 1;
    }
    if (sign === '\\') {
      if (/[$`"\\\n]/.test(source.charAt(at + 1))) {
        flush(at);
        spans.push({ from: at, to: at + 2, kind: 'escape' });
        plain = at + 2;
      }
      at += 2;
      continue;
    }
    const substitution = sign === '`' ? 1 : source.startsWith('$(', at) && !source.startsWith('$((', at) ? 2 : 0;
    if (substitution > 0) {
      flush(at);
      at = shellCommands(source, at + substitution, sign === '`' ? '`' : ')', spans);
      plain = at;
      continue;
    }
    variable.lastIndex = at;
    const found = sign === '$' ? variable.exec(source) : null;
    if (found !== null) {
      flush(at);
      at += found[0].length;
      spans.push({ from: at - found[0].length, to: at, kind: 'parameter' });
      plain = at;
      continue;
    }
    at++;
  }
  flush(source.length);
  return source.length;
}

/** A heredoc: the word that ends its text, whether tabs may stand before it, and whether it is in quotes. */
interface Heredoc {
  word: string;
  tabs: boolean;
  quoted: boolean;
}

/** The place of a word of the shell, as `shellCommands` follows it. */
interface ShellPlace {
  command: boolean;
  expectIn: boolean;
  definition: boolean;
}

/**
 * The kind of a word of the shell: a keyword at the beginning of a command, and `in` where a loop
 * or a `case` expects it; the name of a function where it is defined; the call of a command; or a
 * number as an argument.
 */
function shellWordKind(word: string, source: string, end: number, place: ShellPlace): CodeKind | null {
  if (place.definition || /^\s*\(\s*\)/.test(source.slice(end, end + 8))) {
    return 'function';
  }
  if (word === 'in' && place.expectIn) {
    return 'keyword';
  }
  if (place.command) {
    if (SHELL_KEYWORDS.has(word) || word === '!') {
      return word === '!' ? null : 'keyword';
    }
    return /^[}\]]+$/.test(word) || word === '[' || word === '[[' ? null : 'call';
  }
  return /^-?\d+$/.test(word) ? 'number' : null;
}

/**
 * Places the text of a heredoc, which begins at `start`, as a string up to the line with its word,
 * with the variables and escapes the shell replaces unless the word is in quotes. The result is
 * the end of the line with the word, where the tokens go on.
 */
function heredocText(
  source: string,
  start: number,
  heredoc: Heredoc,
  spans: Span[],
): number {
  const end = new RegExp(`^${heredoc.tabs ? '\\t*' : ''}${heredoc.word}$`, 'm');
  const found = end.exec(source.slice(start));
  const bodyEnd = found === null ? source.length : start + found.index;
  if (bodyEnd > start) {
    if (heredoc.quoted) {
      spans.push({ from: start, to: bodyEnd, kind: 'string' });
    } else {
      spans.push(...expandedPieces(source, start, bodyEnd, SHELL_HEREDOC_ESCAPE));
    }
  }
  return found === null ? source.length : bodyEnd + found[0].length;
}

/**
 * A line of the properties of Java: the white space before it, then a comment with `#` or `!`, or
 * a key up to the first `=`, `:` or white space without a backslash before it, then the sign and
 * the value. The value goes on in the next line if the line ends with a backslash.
 */
const PROPERTIES_LINE =
  /^([ \t\f]*)(?:([#!][^\n]*)|((?:[^\s=:\\]|\\[\s\S])+)([ \t\f]*[=:]?[ \t\f]*)((?:[^\n\\]|\\[\s\S])*))/gm;

/** An escape in a key or a value of the properties of Java; a backslash before a break goes on in the next line. */
const PROPERTIES_ESCAPE = /\\(?:u[0-9a-fA-F]{4}|[\s\S])/g;

/**
 * The spans of a file with the properties of Java, in order: comments, keys like those of JSON,
 * and values as strings, each with its escapes.
 */
function propertiesSpans(source: string): Span[] {
  const spans: Span[] = [];
  for (const match of source.matchAll(PROPERTIES_LINE)) {
    const [, indent = '', comment, key, separator = '', value = ''] = match;
    let from = match.index + indent.length;
    if (comment !== undefined) {
      spans.push(...piecesOf(source, from, from + comment.length, { kind: 'comment' }));
      continue;
    }
    if (key === undefined) {
      continue;
    }
    for (const [text, kind] of [
      [key, 'json-key'],
      [separator, null],
      [value, 'string'],
    ] as const) {
      if (kind !== null && text !== '') {
        spans.push(...filled(from, from + text.length, kind, matches(text, from, PROPERTIES_ESCAPE, 'escape')));
      }
      from += text.length;
    }
  }
  return spans;
}

/** The languages without a parser of Lezer, whose tokens decide. */
const TOKENIZED: Partial<Record<Language['name'], (source: string) => Span[]>> = {
  sql: sqlSpans,
  shell: shellSpans,
  properties: propertiesSpans,
};

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
  const parser = parserOf(language);
  if (parser === null) {
    for (const span of TOKENIZED[language.name]?.(text) ?? []) {
      place(span, false);
    }
    return rows.map((row) => row.ranges);
  }
  highlightTree(parser.parse(text), HIGHLIGHTER, (start, to, classes) => {
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
