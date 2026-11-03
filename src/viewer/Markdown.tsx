import { GFM, parser } from '@lezer/markdown';
import { Fragment, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { chunksOf, fenceLanguage, highlightText, languageOf } from '../diff/highlight';
import type { Language } from '../diff/highlight';

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

/** Ein Codeblock mit den Farben seiner Sprache, wie im Diff, und einem Knopf zum Kopieren. */
function CodeBlock({ code, language, label }: { code: string; language: Language | null; label?: string }) {
  const ranges = useMemo(() => (language === null ? [] : highlightText(language, code)), [code, language]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="md-code">
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
            <Fragment key={index}>
              {index > 0 && '\n'}
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
            </Fragment>
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
          <tr>
            {cells(header).map((cell, index) => (
              <th key={index} style={{ textAlign: alignments[index] }}>
                {cell === null ? null : inline(cell, context)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.from}>
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
    return (
      <Heading key={key} id={slugOf(plainText(node, source), context.slugs)}>
        {inline(node, context)}
      </Heading>
    );
  }
  switch (node.name) {
    case 'Paragraph':
      return <p key={key}>{inline(node, context)}</p>;
    case 'Task': {
      const marker = node.getChild('TaskMarker');
      const done = marker !== null && /x/i.test(source.slice(marker.from, marker.to));
      return (
        <p key={key} className="md-task">
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
        <li key={key} className={node.getChild('Task') === null ? undefined : 'md-task-item'}>
          {blocks(node, context)}
        </li>
      );
    case 'Blockquote':
      return <blockquote key={key}>{blocks(node, context)}</blockquote>;
    case 'FencedCode': {
      const info = node.getChild('CodeInfo');
      const text = node.getChild('CodeText');
      const name = info === null ? '' : source.slice(info.from, info.to).trim();
      const code = text === null ? '' : codeLines(node, source, text.from, text.to).join('\n');
      return <CodeBlock key={key} code={code} language={fenceLanguage(name)} label={name.split(/\s+/)[0] || undefined} />;
    }
    case 'CodeBlock': {
      const code = codeLines(node, source, node.from, node.to)
        .map((line) => line.replace(/^ {1,4}/, ''))
        .join('\n')
        .replace(/\n+$/, '');
      return <CodeBlock key={key} code={code} language={null} />;
    }
    case 'HorizontalRule':
      return <hr key={key} />;
    case 'Table':
      return table(node, context);
    case 'HTMLBlock':
      return (
        <pre key={key} className="md-html-block">
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

/**
 * Eine Markdown-Datei gerendert wie auf GitHub, mit den Farben von Schrittmacher im Code. HTML
 * steht als Text da. Relative Links und Bilder gelten ab `dir`; ein Link auf eine andere
 * Markdown-Datei geht an `onOpen`.
 */
export function MarkdownView({ text, dir, onOpen }: { text: string; dir: string; onOpen: (path: string) => void }) {
  const { front, body } = splitFrontMatter(text);
  const tree = useMemo(() => PARSER.parse(body), [body]);
  const context: Context = {
    source: body,
    dir,
    references: referencesOf(tree.topNode, body),
    slugs: new Map(),
    onOpen,
  };
  return (
    <article className="md">
      {front !== null && <CodeBlock code={front} language={YAML} label="Kopf" />}
      {blocks(tree.topNode, context)}
    </article>
  );
}
