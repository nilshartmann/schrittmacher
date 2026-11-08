import { GFM, parser } from '@lezer/markdown';
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { chunksOf, fenceLanguage, highlightText, languageOf } from '../diff/highlight';
import type { Language } from '../diff/highlight';
import { scopeLabel } from '../notes/markdownNotes';
import type { MdMark, MdScope } from '../notes/markdownNotes';
import { NoteIcon } from './Icons';

/** Der Parser für Markdown mit Tabellen, Aufgaben und durchgestrichenem Text von GFM. */
const PARSER = parser.configure([GFM]);

/** Ein Knoten im Baum, den Lezer aus dem Markdown baut. */
type MdNode = ReturnType<typeof PARSER.parse>['topNode'];

/** Die Zeichen, die Markdown nur auszeichnen und die die Ansicht deshalb weglässt. */
const MARKS: ReadonlySet<string> = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
  'QuoteMark',
  'ListMark',
  'StrikethroughMark',
  'TaskMarker',
  'TableDelimiter',
  'Comment',
  'CommentBlock',
  'LinkReference',
  'ProcessingInstruction',
  'ProcessingInstructionBlock',
]);

/** Eine URL mit Schema wie `https:` oder `mailto:`, die nicht auf eine Datei neben der Datei zeigt. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Die Sprache des Kopfs einer Datei zwischen `---`, wie ihn Skills und Static-Site-Generatoren kennen. */
const YAML: Language | null = languageOf('front.yaml');

/** Ein Link einer Referenz wie `[name]: url "Titel"`. */
interface Reference {
  url: string;
  title: string | undefined;
}

/** Was das Rendern eines Dokuments braucht. */
interface Context {
  source: string;
  dir: string;
  references: ReadonlyMap<string, Reference>;
  /** Die schon vergebenen Anker der Überschriften, damit ein doppelter eine Nummer bekommt. */
  slugs: Map<string, number>;
  onOpen: (path: string) => void;
  /** Die Zeile in der Datei, gezählt ab 1, zu einer Position in `source`. */
  lineOf: (position: number) => number;
  /** Die Abschnitte unter der Zeile ihrer Überschrift; `null` bei ausgeschalteten Hinweisen. */
  sections: ReadonlyMap<number, MdScope> | null;
  /** Der Bezug auf einen Block; `null` bei ausgeschalteten Hinweisen. */
  nodeScope: (node: MdNode, kind: MdScope['kind']) => MdScope | null;
  onScopePreview: (scope: MdScope | null) => void;
  onScopePick: (scope: MdScope) => void;
}

/** Der Bezug, den die Ansicht zeigt, mit dem Vorschlag beim Überfahren eines Knopfs. */
export interface MdNoting {
  scope: MdScope | null;
  preview: MdScope | null;
  /** Wo im Text schon Hinweise stehen. */
  marks: MdMark[];
  onMark: (mark: MdMark) => void;
  /** Solange ein neuer Hinweis geschrieben wird, ändert eine Markierung den Bezug nicht. */
  drafting: boolean;
  onScope: (scope: MdScope | null) => void;
  onPreview: (scope: MdScope | null) => void;
  onDraft: (scope: MdScope) => void;
}

/** Wohin ein Link zeigt: eine Stelle im Dokument, eine Seite im Web oder eine Datei auf der Platte. */
type Target = { kind: 'anchor'; id: string } | { kind: 'web'; url: string } | { kind: 'file'; path: string };

/** Die Kinder eines Knotens, der Reihe nach. */
function childrenOf(node: MdNode): MdNode[] {
  const found: MdNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    found.push(child);
  }
  return found;
}

/** Ein Label einer Referenz so, wie Markdown es vergleicht: ohne Groß- und Kleinschreibung und doppelte Leerzeichen. */
function labelKey(label: string): string {
  return label.replace(/^\[|\]$/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Eine URL ohne die spitzen Klammern, die Markdown um sie erlaubt. */
function urlOf(text: string): string {
  return text.startsWith('<') && text.endsWith('>') ? text.slice(1, -1) : text;
}

/** Die Referenzen des Dokuments, unter ihrem Label. */
function referencesOf(top: MdNode, source: string): Map<string, Reference> {
  const found = new Map<string, Reference>();
  const visit = (node: MdNode) => {
    for (const child of childrenOf(node)) {
      if (child.name === 'LinkReference') {
        const label = child.getChild('LinkLabel');
        const url = child.getChild('URL');
        const title = child.getChild('LinkTitle');
        if (label !== null && url !== null) {
          const key = labelKey(source.slice(label.from, label.to));
          if (!found.has(key)) {
            found.set(key, {
              url: urlOf(source.slice(url.from, url.to)),
              title: title === null ? undefined : source.slice(title.from + 1, title.to - 1),
            });
          }
        }
      } else if (child.name === 'Blockquote' || child.name.endsWith('List') || child.name === 'ListItem') {
        visit(child);
      }
    }
  };
  visit(top);
  return found;
}

/** Ein Zeichen wie `&amp;` als Text; der Browser kennt alle benannten. */
function decodeEntity(entity: string): string {
  const field = document.createElement('textarea');
  field.innerHTML = entity;
  return field.value;
}

/** Der Anker einer Überschrift wie auf GitHub: klein, ohne Satzzeichen, Leerzeichen als `-`. */
function slugOf(text: string, slugs: Map<string, number>): string {
  const base = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
  const count = slugs.get(base) ?? 0;
  slugs.set(base, count + 1);
  return count === 0 ? base : `${base}-${String(count)}`;
}

/** Wohin ein Link zeigt; ein relativer Pfad gilt ab dem Ordner der Datei. */
function targetOf(url: string, dir: string): Target {
  if (url.startsWith('#')) {
    return { kind: 'anchor', id: decodeURIComponent(url.slice(1)) };
  }
  if (SCHEME.test(url)) {
    return { kind: 'web', url };
  }
  const base = `file://${encodeURI(dir.endsWith('/') ? dir : `${dir}/`)}`;
  return { kind: 'file', path: decodeURIComponent(new URL(url, base).pathname) };
}

/** Der Text eines Knotens ohne die Zeichen der Auszeichnung, etwa für einen Anker oder einen Alt-Text. */
function plainText(node: MdNode, source: string, from = node.from, to = node.to): string {
  let text = '';
  let position = from;
  for (const child of childrenOf(node)) {
    if (child.to <= from || child.from >= to) {
      continue;
    }
    text += source.slice(position, child.from);
    if (child.name === 'Escape') {
      text += source.slice(child.from + 1, child.to);
    } else if (child.name === 'Entity') {
      text += decodeEntity(source.slice(child.from, child.to));
    } else if (!MARKS.has(child.name) && child.name !== 'URL' && child.name !== 'LinkLabel' && child.name !== 'LinkTitle') {
      text += plainText(child, source);
    }
    position = child.to;
  }
  return (text + source.slice(position, to)).replace(/\s+/g, ' ');
}

/**
 * Die Teile eines Links oder Bilds: wo sein Text steht und wohin er zeigt. Ohne Ziel ist es kein
 * Link, etwa `[x]` ohne passende Referenz.
 */
function linkParts(node: MdNode, context: Context) {
  const { source } = context;
  const marks = childrenOf(node).filter((child) => child.name === 'LinkMark');
  const open = marks[0];
  const close = marks.find((mark) => source.slice(mark.from, mark.to) === ']');
  if (open === undefined || close === undefined) {
    return null;
  }
  const url = node.getChild('URL');
  const title = node.getChild('LinkTitle');
  if (url !== null) {
    return {
      from: open.to,
      to: close.from,
      url: urlOf(source.slice(url.from, url.to)),
      title: title === null ? undefined : source.slice(title.from + 1, title.to - 1),
    };
  }
  const label = node.getChild('LinkLabel');
  const key = labelKey(label === null ? source.slice(open.to, close.from) : source.slice(label.from, label.to));
  const reference = context.references.get(key === '' ? labelKey(source.slice(open.to, close.from)) : key);
  return reference === undefined ? null : { from: open.to, to: close.from, ...reference };
}

/** Ein Link: im Dokument springt er, ins Web öffnet er Safari, zu einer Markdown-Datei diese Ansicht. */
function LinkTo({ url, title, context, children }: { url: string; title?: string; context: Context; children: ReactNode }) {
  const target = targetOf(url, context.dir);
  if (target.kind === 'web') {
    return (
      <a href={target.url} target="_blank" rel="noreferrer" data-tip={title ?? target.url}>
        {children}
      </a>
    );
  }
  if (target.kind === 'anchor') {
    return (
      <a
        href={`#${target.id}`}
        data-tip={title}
        onClick={(event) => {
          event.preventDefault();
          document.getElementById(target.id)?.scrollIntoView({ block: 'start' });
        }}
      >
        {children}
      </a>
    );
  }
  const path = target.path;
  if (/\.(md|markdown)$/i.test(path)) {
    return (
      <a
        href={`/markdown?path=${encodeURIComponent(path)}`}
        data-tip={title ?? path}
        onClick={(event) => {
          event.preventDefault();
          context.onOpen(path);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <span className="md-file-link" data-tip={path}>
      {children}
    </span>
  );
}

/** Die Quelle eines Bilds: aus dem Web direkt, von der Platte über den Server. */
function imageSource(url: string, dir: string): string {
  const target = targetOf(url, dir);
  if (target.kind === 'web') {
    return target.url;
  }
  return target.kind === 'file' ? `/api/image?path=${encodeURIComponent(target.path)}` : '';
}

/** Der Inhalt eines Absatzes, einer Überschrift oder einer Zelle, zwischen `from` und `to`. */
function inline(node: MdNode, context: Context, from = node.from, to = node.to): ReactNode[] {
  const { source } = context;
  const parts: ReactNode[] = [];
  let position = from;
  const text = (end: number) => {
    if (end > position) {
      parts.push(source.slice(position, end));
    }
  };
  for (const child of childrenOf(node)) {
    if (child.to <= from || child.from >= to) {
      continue;
    }
    text(child.from);
    position = child.to;
    const key = child.from;
    const content = source.slice(child.from, child.to);
    switch (child.name) {
      case 'Emphasis':
        parts.push(<em key={key}>{inline(child, context)}</em>);
        break;
      case 'StrongEmphasis':
        parts.push(<strong key={key}>{inline(child, context)}</strong>);
        break;
      case 'Strikethrough':
        parts.push(<del key={key}>{inline(child, context)}</del>);
        break;
      case 'InlineCode': {
        const marks = childrenOf(child).filter((mark) => mark.name === 'CodeMark');
        let code = source.slice(marks[0]?.to ?? child.from, marks.at(-1)?.from ?? child.to).replace(/\n/g, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') {
          code = code.slice(1, -1);
        }
        parts.push(<code key={key}>{code}</code>);
        break;
      }
      case 'Link': {
        const link = linkParts(child, context);
        parts.push(
          link === null ? (
            content
          ) : (
            <LinkTo key={key} url={link.url} title={link.title} context={context}>
              {inline(child, context, link.from, link.to)}
            </LinkTo>
          ),
        );
        break;
      }
      case 'Image': {
        const image = linkParts(child, context);
        parts.push(
          image === null ? (
            content
          ) : (
            <img
              key={key}
              src={imageSource(image.url, context.dir)}
              alt={plainText(child, source, image.from, image.to).trim()}
              data-tip={image.title}
            />
          ),
        );
        break;
      }
      case 'Autolink':
      case 'URL': {
        const url = urlOf(content);
        const href = /^[^@\s]+@[^@\s]+$/.test(url) ? `mailto:${url}` : SCHEME.test(url) ? url : `https://${url}`;
        parts.push(
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {url}
          </a>,
        );
        break;
      }
      case 'Escape':
        parts.push(content.slice(1));
        break;
      case 'Entity':
        parts.push(decodeEntity(content));
        break;
      case 'HardBreak':
        parts.push(<br key={key} />);
        break;
      case 'HTMLTag':
        // HTML zeigt die Ansicht als Text, weil es sonst Skripte aus einer Datei ausführen könnte.
        parts.push(/^<br\s*\/?>$/i.test(content) ? <br key={key} /> : <span key={key} className="md-html">{content}</span>);
        break;
      default:
        if (!MARKS.has(child.name)) {
          parts.push(<Fragment key={key}>{inline(child, context)}</Fragment>);
        }
    }
  }
  text(to);
  return parts;
}

/**
 * Die Zeilen eines Codeblocks ohne das, was vor seinem Zaun steht: die Einrückung einer Liste und
 * die `>` eines Zitats.
 */
function codeLines(node: MdNode, source: string, from: number, to: number): string[] {
  const lineStart = source.lastIndexOf('\n', node.from - 1) + 1;
  const prefix = node.from - lineStart;
  const start = source.lastIndexOf('\n', from - 1) + 1;
  return source
    .slice(start, to)
    .split('\n')
    .map((line) => {
      let cut = 0;
      while (cut < prefix && (line[cut] === ' ' || line[cut] === '>' || line[cut] === '\t')) {
        cut++;
      }
      return line.slice(cut);
    });
}

/** Die Attribute eines Blocks, die seine Zeilen in der Datei nennen. */
function lineAttributes(from: number, to: number) {
  return { 'data-ref-from': from, 'data-ref-to': to };
}

/** Die Zeilen eines Knotens als Attribute; `node.to` steht schon hinter seinem letzten Zeichen. */
function nodeAttributes(node: MdNode, context: Context) {
  return lineAttributes(context.lineOf(node.from), context.lineOf(Math.max(node.from, node.to - 1)));
}

/** Ein Codeblock mit den Farben seiner Sprache, wie im Diff, und einem Knopf zum Kopieren. */
function CodeBlock({
  code,
  language,
  label,
  firstLine,
  tools,
  hostClass,
}: {
  code: string;
  language: Language | null;
  label?: string;
  /** Der Knopf links neben dem Codeblock. */
  tools?: ReactNode;
  hostClass?: string;
  /** Die Zeile der Datei, in der der Code beginnt. */
  firstLine: number;
}) {
  const ranges = useMemo(() => (language === null ? [] : highlightText(language, code)), [code, language]);
  const [copied, setCopied] = useState(false);
  return (
    <div className={hostClass === undefined ? 'md-code' : `md-code ${hostClass}`}>
      {tools}
      <button
        type="button"
        className="md-copy"
        data-tip="Code in die Zwischenablage"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => {
              setCopied(false);
            }, 1200);
          });
        }}
      >
        {copied ? 'Kopiert' : 'Kopieren'}
      </button>
      {label !== undefined && <span className="md-code-label">{label}</span>}
      <pre>
        <code>
          {code.split('\n').map((line, index) => (
            <span key={index} className="md-code-line" {...lineAttributes(firstLine + index, firstLine + index)}>
              {chunksOf(line, [], ranges[index] ?? []).flatMap((chunk) =>
                chunk.pieces.map((piece, pieceIndex) =>
                  piece.kind === null ? (
                    piece.text
                  ) : (
                    <span key={pieceIndex} className={`code-${piece.kind}`}>
                      {piece.text}
                    </span>
                  ),
                ),
              )}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** Die Ausrichtung je Spalte aus der Zeile mit `---` unter dem Kopf einer Tabelle. */
function alignmentsOf(line: string): ('left' | 'center' | 'right' | undefined)[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => {
      const spec = cell.trim();
      if (spec.startsWith(':') && spec.endsWith(':')) {
        return 'center';
      }
      if (spec.endsWith(':')) {
        return 'right';
      }
      return spec.startsWith(':') ? 'left' : undefined;
    });
}

/** Die Zellen einer Zeile, auch die leeren, für die Lezer keinen Knoten anlegt. */
function cellsOf(row: MdNode, source: string): (MdNode | null)[] {
  const children = childrenOf(row);
  const pipes = children.filter((child) => child.name === 'TableDelimiter');
  const segments: { from: number; to: number }[] = [];
  let start = row.from;
  for (const pipe of pipes) {
    segments.push({ from: start, to: pipe.from });
    start = pipe.to;
  }
  segments.push({ from: start, to: row.to });
  const blank = (segment: { from: number; to: number }) => source.slice(segment.from, segment.to).trim() === '';
  if (pipes.length > 0 && blank(segments[0] ?? { from: 0, to: 0 })) {
    segments.shift();
  }
  if (pipes.length > 0 && segments.length > 0 && blank(segments.at(-1) ?? { from: 0, to: 0 })) {
    segments.pop();
  }
  return segments.map(
    (segment) =>
      children.find((child) => child.name === 'TableCell' && child.from >= segment.from && child.to <= segment.to) ?? null,
  );
}

/** Eine Tabelle von GFM mit der Ausrichtung ihrer Spalten. */
function table(node: MdNode, context: Context): ReactNode {
  const { source } = context;
  const children = childrenOf(node);
  const header = children.find((child) => child.name === 'TableHeader');
  const delimiter = children.find((child) => child.name === 'TableDelimiter');
  const rows = children.filter((child) => child.name === 'TableRow');
  const alignments = delimiter === undefined ? [] : alignmentsOf(source.slice(delimiter.from, delimiter.to));
  const headerCells = header === undefined ? [] : cellsOf(header, source);
  const columns = Math.max(headerCells.length, alignments.length);
  const cells = (row: MdNode | undefined) => {
    const found = row === undefined ? [] : cellsOf(row, source);
    return Array.from({ length: columns }, (_, index) => found[index] ?? null);
  };
  return (
    <div className="md-table" key={node.from}>
      <table>
        <thead>
          <tr {...(header === undefined ? {} : nodeAttributes(header, context))}>
            {cells(header).map((cell, index) => (
              <th key={index} style={{ textAlign: alignments[index] }}>
                {cell === null ? null : inline(cell, context)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.from} {...nodeAttributes(row, context)}>
              {cells(row).map((cell, index) => (
                <td key={index} style={{ textAlign: alignments[index] }}>
                  {cell === null ? null : inline(cell, context)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Die Ebene einer Überschrift aus dem Namen ihres Knotens, etwa 2 für `ATXHeading2`. */
function headingLevel(name: string): number | null {
  const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
  return match === null ? null : Number(match[1]);
}

/** Der Knopf beim Überfahren einer Überschrift oder eines Listenpunkts, der sie als Bezug wählt. */
function ScopeButton({ scope, className, context }: { scope: MdScope; className: string; context: Context }) {
  const label = `Hinweis: ${scopeLabel(scope.kind)}`;
  return (
    <span className={`hover-tools ${className}`}>
      <button
        type="button"
        className="hover-tool"
        aria-label={label}
        data-tip={label}
        onPointerEnter={() => {
          context.onScopePreview(scope);
        }}
        onPointerLeave={() => {
          context.onScopePreview(null);
        }}
        onClick={() => {
          context.onScopePick(scope);
        }}
      >
        <NoteIcon />
      </button>
    </span>
  );
}

/** Der Knopf eines Listenpunkts, wenn sich ein Bezug wählen lässt. */
function itemTools(node: MdNode, context: Context): ReactNode {
  const scope = context.nodeScope(node, 'item');
  return scope === null ? null : <ScopeButton scope={scope} className="md-item-tools" context={context} />;
}

/** Ob ein Block direkt im Dokument steht; nur dort hat er links einen eigenen Knopf. */
function isTopLevel(node: MdNode): boolean {
  return node.parent?.name === 'Document';
}

/** Der Knopf links neben einem Block im Dokument. */
function gutterTools(node: MdNode, context: Context, kind: MdScope['kind']): ReactNode {
  const scope = isTopLevel(node) ? context.nodeScope(node, kind) : null;
  return scope === null ? null : <ScopeButton scope={scope} className="md-gutter-tools" context={context} />;
}

/** Die Klasse eines Blocks mit einem Knopf links. */
function gutterClass(node: MdNode, context: Context): string | undefined {
  return isTopLevel(node) && context.sections !== null ? 'hover-tools-host md-block' : undefined;
}

/** Die Blöcke unter einem Knoten: Absätze, Überschriften, Listen, Zitate, Code und Tabellen. */
function blocks(node: MdNode, context: Context): ReactNode[] {
  return childrenOf(node).map((child) => block(child, context));
}

function block(node: MdNode, context: Context): ReactNode {
  const { source } = context;
  const key = node.from;
  const level = headingLevel(node.name);
  if (level !== null) {
    const Heading = `h${String(level)}` as 'h1';
    const section = context.sections?.get(context.lineOf(node.from));
    return (
      <Heading
        key={key}
        id={slugOf(plainText(node, source), context.slugs)}
        className={section === undefined ? undefined : 'hover-tools-host md-heading'}
        {...nodeAttributes(node, context)}
      >
        {inline(node, context)}
        {section !== undefined && (
          <ScopeButton scope={section} className="md-gutter-tools" context={context} />
        )}
      </Heading>
    );
  }
  switch (node.name) {
    case 'Paragraph':
      return (
        <p key={key} className={gutterClass(node, context)} {...nodeAttributes(node, context)}>
          {gutterTools(node, context, 'paragraph')}
          {inline(node, context)}
        </p>
      );
    case 'Task': {
      const marker = node.getChild('TaskMarker');
      const done = marker !== null && /x/i.test(source.slice(marker.from, marker.to));
      return (
        <p key={key} className="md-task" {...nodeAttributes(node, context)}>
          <input type="checkbox" checked={done} disabled />
          {inline(node, context)}
        </p>
      );
    }
    case 'BulletList':
      return <ul key={key}>{blocks(node, context)}</ul>;
    case 'OrderedList': {
      const mark = node.firstChild?.getChild('ListMark');
      const start = mark == null ? 1 : Number.parseInt(source.slice(mark.from, mark.to), 10);
      return (
        <ol key={key} start={Number.isNaN(start) ? 1 : start}>
          {blocks(node, context)}
        </ol>
      );
    }
    case 'ListItem':
      return (
        <li
          key={key}
          className={
            [node.getChild('Task') === null ? '' : 'md-task-item', context.sections === null ? '' : 'hover-tools-host md-item']
              .filter(Boolean)
              .join(' ') || undefined
          }
        >
          {itemTools(node, context)}
          {blocks(node, context)}
        </li>
      );
    case 'Blockquote':
      return (
        <blockquote key={key} className={gutterClass(node, context)}>
          {gutterTools(node, context, 'quote')}
          {blocks(node, context)}
        </blockquote>
      );
    case 'FencedCode': {
      const info = node.getChild('CodeInfo');
      const text = node.getChild('CodeText');
      const name = info === null ? '' : source.slice(info.from, info.to).trim();
      const code = text === null ? '' : codeLines(node, source, text.from, text.to).join('\n');
      return (
        <CodeBlock
          key={key}
          code={code}
          language={fenceLanguage(name)}
          label={name.split(/\s+/)[0] || undefined}
          firstLine={context.lineOf(text?.from ?? node.from)}
          tools={gutterTools(node, context, 'code')}
          hostClass={gutterClass(node, context)}
        />
      );
    }
    case 'CodeBlock': {
      const code = codeLines(node, source, node.from, node.to)
        .map((line) => line.replace(/^ {1,4}/, ''))
        .join('\n')
        .replace(/\n+$/, '');
      return (
        <CodeBlock
          key={key}
          code={code}
          language={null}
          firstLine={context.lineOf(node.from)}
          tools={gutterTools(node, context, 'code')}
          hostClass={gutterClass(node, context)}
        />
      );
    }
    case 'HorizontalRule':
      return <hr key={key} {...nodeAttributes(node, context)} />;
    case 'Table':
      return table(node, context);
    case 'HTMLBlock':
      return (
        <pre key={key} className="md-html-block" {...nodeAttributes(node, context)}>
          {source.slice(node.from, node.to)}
        </pre>
      );
    default:
      return MARKS.has(node.name) ? null : <Fragment key={key}>{inline(node, context)}</Fragment>;
  }
}

/** Der Kopf zwischen `---` am Anfang einer Datei und der Text danach. */
function splitFrontMatter(text: string): { front: string | null; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return match === null ? { front: null, body: text } : { front: match[1] ?? '', body: text.slice(match[0].length) };
}

/** Die Zeile zu einer Position, über die Anfänge der Zeilen; `offset` zählt die Zeilen davor. */
function lineCounter(body: string, offset: number): (position: number) => number {
  const starts = [0];
  for (let index = body.indexOf('\n'); index !== -1; index = body.indexOf('\n', index + 1)) {
    starts.push(index + 1);
  }
  return (position) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if ((starts[middle] ?? 0) <= position) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1 + offset;
  };
}

/** Die Zeilen `from` bis `to` einer Datei, gezählt ab 1. */
function sourceLines(text: string, from: number, to: number): string {
  return text.split('\n').slice(from - 1, to).join('\n');
}

/** Der Bezug auf die ganze Datei. */
export function fileScope(text: string): MdScope {
  return { kind: 'file', path: [], from: 1, to: text.split('\n').length, marked: null, source: text };
}

/** Eine Überschrift auf der obersten Ebene des Dokuments. */
interface Heading {
  index: number;
  level: number;
  line: number;
  text: string;
}

/** Die Überschriften auf der obersten Ebene, der Reihe nach. */
function headingsOf(children: MdNode[], body: string, lineOf: (position: number) => number): Heading[] {
  return children.flatMap((child, index) => {
    const level = headingLevel(child.name);
    return level === null ? [] : [{ index, level, line: lineOf(child.from), text: plainText(child, body).trim() }];
  });
}

/** Die Überschriften, unter denen eine Zeile steht, von außen nach innen. */
function pathAt(headings: Heading[], line: number): Heading[] {
  const path: Heading[] = [];
  for (const heading of headings) {
    if (heading.line > line) {
      break;
    }
    while ((path.at(-1)?.level ?? 0) >= heading.level) {
      path.pop();
    }
    path.push(heading);
  }
  return path;
}

/** Die Abschnitte: von einer Überschrift bis vor die nächste gleicher oder höherer Ebene. */
function sectionsOf(
  children: MdNode[],
  headings: Heading[],
  text: string,
  lineOf: (position: number) => number,
): Map<number, MdScope> {
  const sections = new Map<number, MdScope>();
  headings.forEach((heading, position) => {
    const next = headings.slice(position + 1).find((other) => other.level <= heading.level);
    const last = children[(next?.index ?? children.length) - 1];
    const to = last === undefined ? heading.line : lineOf(Math.max(last.from, last.to - 1));
    sections.set(heading.line, {
      kind: 'section',
      path: pathAt(headings, heading.line).map((entry) => entry.text),
      from: heading.line,
      to,
      marked: null,
      source: sourceLines(text, heading.line, to),
    });
  });
  return sections;
}

/** Der Teil einer Markierung, der in einem Element liegt, als Text. */
function selectedText(range: Range, element: Element): string {
  const part = document.createRange();
  part.selectNodeContents(element);
  if (part.compareBoundaryPoints(Range.START_TO_START, range) < 0) {
    part.setStart(range.startContainer, range.startOffset);
  }
  if (part.compareBoundaryPoints(Range.END_TO_END, range) > 0) {
    part.setEnd(range.endContainer, range.endOffset);
  }
  return part.toString();
}

/** Text ohne Unterschiede im Leerraum, damit sich Markierung und Block vergleichen lassen. */
function squeezed(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Die Elemente mit Zeilen, die in den Zeilen `from` bis `to` liegen. */
function blocksBetween(article: Element, from: number, to: number): Element[] {
  return [...article.querySelectorAll('[data-ref-from]')].filter(
    (element) => Number(element.getAttribute('data-ref-from')) <= to && Number(element.getAttribute('data-ref-to')) >= from,
  );
}

/** Das Kind von `article`, in dem ein Element steht. */
function topLevelOf(article: Element, element: Element): Element {
  let current = element;
  while (current.parentElement !== null && current.parentElement !== article) {
    current = current.parentElement;
  }
  return current;
}

/** Die Blöcke, über die sich ein Bezug zieht: bei einer Stelle genau seine, sonst die obersten. */
function scopeBlocks(article: Element, scope: MdScope): Element[] {
  const found = blocksBetween(article, scope.from, scope.to);
  return scope.kind === 'place' || scope.kind === 'item' ? found : found.map((element) => topLevelOf(article, element));
}

/** Ein Band über allen Blöcken eines Bezugs, gestrichelt für einen Vorschlag. */
function ScopeBand({ scope, preview }: { scope: MdScope; preview: boolean }) {
  const band = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const article = band.current?.parentElement;
    if (article == null) {
      return;
    }
    const measure = () => {
      const blocks = scopeBlocks(article, scope);
      const first = blocks[0];
      const last = blocks.at(-1);
      if (first === undefined || last === undefined) {
        setBox(null);
        return;
      }
      const origin = article.getBoundingClientRect().top;
      const top = first.getBoundingClientRect().top - origin - BAND_PADDING;
      setBox({ top, height: last.getBoundingClientRect().bottom - origin + BAND_PADDING - top });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(article);
    return () => {
      observer.disconnect();
    };
  }, [scope]);
  return <div ref={band} className={preview ? 'md-band md-band-preview' : 'md-band'} style={box ?? { display: 'none' }} />;
}

/** Die Höhe einer Zahl am Rand samt Abstand; so weit rückt die nächste nach unten, in Pixeln. */
const MARK_STEP = 18;

/** Der Abstand einer Zahl am Rand vom oberen Rand ihres Blocks, in Pixeln. */
const MARK_OFFSET = 4;

/**
 * Die Markierungen links vom Text: je Stelle die Zahl ihrer Hinweise, bei Blöcken mit einem Balken
 * über ihre Höhe. Abschnitte und die ganze Datei haben eine hohle Zahl ohne Balken, weil sie
 * ineinander liegen und sich die Balken sonst decken würden; ihren Umfang zeigt das Überfahren.
 */
function ScopeMarks({
  marks,
  onMark,
  onPreview,
}: {
  marks: MdMark[];
  onMark: (mark: MdMark) => void;
  onPreview: (scope: MdScope | null) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ mark: MdMark; top: number; bar: { top: number; height: number } | null }[]>([]);
  useLayoutEffect(() => {
    const article = layer.current?.parentElement;
    if (article == null) {
      return;
    }
    const measure = () => {
      const origin = article.getBoundingClientRect().top;
      const lastTop = new Map<MdMark['lane'], number>();
      setPlaced(
        marks.flatMap((mark) => {
          const blocks = scopeBlocks(article, mark.scope);
          const first = blocks[0]?.getBoundingClientRect();
          const last = blocks.at(-1)?.getBoundingClientRect();
          if (first === undefined || last === undefined) {
            return [];
          }
          const wanted = first.top - origin + MARK_OFFSET;
          const before = lastTop.get(mark.lane);
          const top = before === undefined ? wanted : Math.max(wanted, before + MARK_STEP);
          lastTop.set(mark.lane, top);
          const bar = mark.lane === 'block' ? { top: first.top - origin, height: last.bottom - first.top } : null;
          return [{ mark, top, bar }];
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(article);
    return () => {
      observer.disconnect();
    };
  }, [marks]);
  return (
    <div ref={layer} className="md-marks">
      {placed.map(({ mark, top, bar }) => (
        <Fragment key={mark.key}>
          {bar !== null && <div className="md-mark-bar" style={bar} />}
          <button
            type="button"
            className={mark.lane === 'block' ? 'md-mark' : 'md-mark md-mark-section'}
            style={{ top }}
            aria-label={`${String(mark.ids.length)} Hinweise an dieser Stelle zeigen`}
            data-tip={`${mark.ids.length === 1 ? '1 Hinweis' : `${String(mark.ids.length)} Hinweise`}: ${scopeLabel(mark.scope.kind)}`}
            onPointerEnter={() => {
              onPreview(mark.scope);
            }}
            onPointerLeave={() => {
              onPreview(null);
            }}
            onClick={() => {
              onPreview(null);
              onMark(mark);
            }}
          >
            {mark.ids.length}
          </button>
        </Fragment>
      ))}
    </div>
  );
}

/** Der Abstand des Knopfs „Hinweis“ unter dem Ende der Markierung, in Pixeln. */
const NOTE_BUTTON_GAP = 6;

/** So weit steht das Band über die Blöcke hinaus, in Pixeln. */
const BAND_PADDING = 4;

/**
 * Eine Markdown-Datei gerendert wie auf GitHub, mit den Farben von Schrittmacher im Code. HTML
 * steht als Text da. Relative Links und Bilder gelten ab `dir`; ein Link auf eine andere
 * Markdown-Datei geht an `onOpen`. Mit `noting` lässt sich ein Bezug für einen Hinweis wählen.
 */
export function MarkdownView({
  text,
  dir,
  onOpen,
  noting = null,
}: {
  text: string;
  dir: string;
  onOpen: (path: string) => void;
  noting?: MdNoting | null;
}) {
  const { front, body } = splitFrontMatter(text);
  const tree = useMemo(() => PARSER.parse(body), [body]);
  const article = useRef<HTMLElement>(null);
  const { lineOf, headings, sections } = useMemo(() => {
    const before = text.slice(0, text.length - body.length).split('\n').length - 1;
    const counter = lineCounter(body, before);
    const children = childrenOf(tree.topNode);
    const found = headingsOf(children, body, counter);
    return { lineOf: counter, headings: found, sections: sectionsOf(children, found, text, counter) };
  }, [text, body, tree]);
  const active = noting !== null;
  const drafting = noting?.drafting === true;
  const onScope = noting?.onScope;
  const onPreview = noting?.onPreview;
  const onDraft = noting?.onDraft;
  const [floating, setFloating] = useState<{ scope: MdScope; top: number; left: number } | null>(null);
  useEffect(() => {
    if (!active || onScope === undefined) {
      setFloating(null);
      return;
    }
    const pick = (): MdScope | null => {
      const selection = window.getSelection();
      const element = article.current;
      if (selection === null || element === null || selection.isCollapsed || selection.rangeCount === 0) {
        return null;
      }
      const range = selection.getRangeAt(0);
      if (!element.contains(range.commonAncestorContainer)) {
        return null;
      }
      // Eine Markierung, die am Anfang eines Blocks endet, etwa nach einem Dreifachklick, nimmt ihn nicht mit.
      const touched = [...element.querySelectorAll('[data-ref-from]')].filter(
        (block) => range.intersectsNode(block) && selectedText(range, block).trim() !== '',
      );
      const first = touched[0];
      const last = touched.at(-1);
      if (first === undefined || last === undefined) {
        return null;
      }
      const from = Number(first.getAttribute('data-ref-from'));
      const to = Number(last.getAttribute('data-ref-to'));
      const marked = squeezed(selection.toString());
      const whole = squeezed(touched.map((block) => block.textContent).join(' '));
      return {
        kind: 'place',
        path: pathAt(headings, from).map((heading) => heading.text),
        from,
        to,
        marked: marked === whole ? null : marked,
        source: sourceLines(text, from, to),
      };
    };
    /** Die Stelle für den Knopf „Hinweis“: unter dem Ende der Markierung. */
    const place = () => {
      const rects = [...(window.getSelection()?.getRangeAt(0).getClientRects() ?? [])];
      const last = rects.filter((rect) => rect.width > 0).at(-1) ?? rects.at(-1);
      return last === undefined
        ? null
        : {
            top: Math.min(last.bottom + NOTE_BUTTON_GAP, window.innerHeight - 40),
            left: Math.min(last.right, window.innerWidth - 110),
          };
    };
    const onPointerUp = (event: PointerEvent) => {
      if (drafting || !(event.target instanceof Element) || event.target.closest('button') !== null) {
        return;
      }
      const inside = article.current?.contains(event.target) === true;
      requestAnimationFrame(() => {
        const picked = pick();
        if (picked !== null || inside) {
          onScope(picked);
        }
        const spot = picked === null ? null : place();
        setFloating(picked === null || spot === null ? null : { scope: picked, ...spot });
      });
    };
    const onSelection = () => {
      if (window.getSelection()?.isCollapsed !== false) {
        setFloating(null);
      }
    };
    const onScroll = () => {
      setFloating((current) => {
        const spot = current === null ? null : place();
        return current === null || spot === null ? null : { ...current, ...spot };
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        window.getSelection()?.removeAllRanges();
        setFloating(null);
        onScope(null);
      }
    };
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('selectionchange', onSelection);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('selectionchange', onSelection);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [active, drafting, onScope, headings, text]);
  const context: Context = {
    source: body,
    dir,
    references: referencesOf(tree.topNode, body),
    slugs: new Map(),
    onOpen,
    lineOf,
    sections: active ? sections : null,
    nodeScope: (node, kind) => {
      if (!active) {
        return null;
      }
      const from = lineOf(node.from);
      const to = lineOf(Math.max(node.from, node.to - 1));
      return {
        kind,
        path: pathAt(headings, from).map((heading) => heading.text),
        from,
        to,
        marked: null,
        source: sourceLines(text, from, to),
      };
    },
    onScopePreview: (scope) => {
      onPreview?.(scope);
    },
    onScopePick: (scope) => {
      // Ein offener Hinweis behält seinen Bezug, sonst wandert er unbemerkt an eine andere Stelle.
      if (drafting) {
        return;
      }
      window.getSelection()?.removeAllRanges();
      onPreview?.(null);
      onDraft?.(scope);
    },
  };
  const shown = noting === null ? null : (noting.preview ?? noting.scope);
  return (
    <article className={['md', active ? 'md-with-notes' : '', drafting ? 'md-drafting' : ''].join(' ').trim()} ref={article}>
      {front !== null && <CodeBlock code={front} language={YAML} label="Kopf" firstLine={2} />}
      {blocks(tree.topNode, context)}
      {shown !== null && <ScopeBand scope={shown} preview={noting?.preview != null} />}
      {noting !== null && noting.marks.length > 0 && (
        <ScopeMarks marks={noting.marks} onMark={noting.onMark} onPreview={noting.onPreview} />
      )}
      {floating !== null &&
        !drafting &&
        createPortal(
          <button
            type="button"
            className="note-button"
            style={{ top: floating.top, left: floating.left }}
            data-tip="Hinweis zur markierten Stelle"
            // Der Klick hebt die Markierung nicht auf, bevor der Knopf sie liest.
            onPointerDown={(event) => {
              event.preventDefault();
            }}
            onClick={() => {
              window.getSelection()?.removeAllRanges();
              onDraft?.(floating.scope);
              setFloating(null);
            }}
          >
            <NoteIcon />
            Hinweis
          </button>,
          document.body,
        )}
    </article>
  );
}
