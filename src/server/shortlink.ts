import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { basename, dirname, join } from 'node:path';
import QRCode from 'qrcode';
import { runGit } from '../git/process';
import type { SavedShortlink } from './store';

/** Ein Vortrag oder Workshop von der Homepage, siehe `docs/kurzlink.md`. */
export interface Talk {
  type: string;
  title: string;
  event: string;
  date: string;
  location: string;
  /** Ob die Veranstaltung noch kommt: nicht als erledigt markiert und ihr Datum nicht vorbei. */
  upcoming: boolean;
  /** Die Seite der Veranstaltung auf der Homepage. */
  url: string;
}

/** Eine Zeile aus `_redirects`: der Pfad ohne `/` am Anfang und das Ziel. */
export interface Redirect {
  path: string;
  target: string;
}

/** Ein Redirect-Repo mit seiner Domain und den vorhandenen Kurzlinks. */
export interface ShortlinkDomain {
  /** Die Domain ohne Protokoll, etwa `spring.schule`. */
  domain: string;
  baseUrl: string;
  repoPath: string;
  redirects: Redirect[];
}

/** Was der Dialog „Kurzlink anlegen“ beim Öffnen bekommt; die Pfade der Repos bleiben beim Server. */
export interface ShortlinkData {
  talks: Talk[];
  domains: Omit<ShortlinkDomain, 'repoPath'>[];
  /** Ob das Repo des offenen Tabs einen Worktree `werkstatt` für den QR-Code hat. */
  werkstatt: boolean;
  /** Die Kurzlinks, die dem Repo des offenen Tabs zugeordnet sind. */
  assigned: SavedShortlink[];
  /** Quellen, die fehlen oder sich nicht lesen ließen. */
  problems: string[];
}

/** Die Adresse der Homepage, unter der die Seiten der Veranstaltungen liegen. */
const HOMEPAGE_URL = 'https://nilshartmann.net';

/** Die Dateien mit den Veranstaltungen in der Homepage. */
const TALK_FILES = /^app\/data\/raw\/talks-and-workshops-.*-data\.ts$/;

/** So lange darf eine Anfrage an eine fremde Seite dauern. */
const REQUEST_TIMEOUT = 8000;

/**
 * Bildet `slugify` aus `@sindresorhus/slugify` nach, wie es die Homepage für die Adresse einer
 * Veranstaltung benutzt: Umlaute umschreiben, Akzente weglassen, Wörter in CamelCase trennen,
 * alles andere als Trennstrich.
 */
export function slugify(text: string): string {
  const german: [string, string][] = [
    ['&', ' and '],
    ['ä', 'ae'],
    ['ö', 'oe'],
    ['ü', 'ue'],
    ['Ä', 'Ae'],
    ['Ö', 'Oe'],
    ['Ü', 'Ue'],
    ['ß', 'ss'],
  ];
  let result = text.normalize();
  for (const [from, to] of german) {
    result = result.replaceAll(from, to);
  }
  result = result
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize()
    .replace(/([A-Z]{2,})(\d+)/g, '$1 $2')
    .replace(/([a-z\d]+)([A-Z]{2,})/g, '$1 $2')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-rt-z\d]+)/g, '$1 $2')
    .toLowerCase()
    .replace(/([a-z\d]+)'([ts])(\s|$)/g, '$1$2$3')
    .replace(/[^a-z\d]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return result;
}

const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];

/**
 * Der letzte Tag einer Datumsangabe der Homepage, etwa aus „2. November 2026“, „12. 2. 2026“ oder
 * „30.03.26 - 01.04.26“; `null`, wenn sich keins lesen lässt.
 */
export function lastDayOf(date: string): Date | null {
  const found: { at: number; day: number; month: number; year: number }[] = [];
  for (const match of date.matchAll(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})/g)) {
    found.push({ at: match.index, day: Number(match[1]), month: Number(match[2]) - 1, year: Number(match[3]) });
  }
  for (const match of date.matchAll(/(\d{1,2})\.\s*(\p{L}+)\s+(\d{4})/gu)) {
    const month = MONTHS.indexOf((match[2] ?? '').toLowerCase());
    if (month !== -1) {
      found.push({ at: match.index, day: Number(match[1]), month, year: Number(match[3]) });
    }
  }
  const last = found.sort((a, b) => b.at - a.at)[0];
  if (last === undefined) {
    return null;
  }
  return new Date(last.year < 100 ? 2000 + last.year : last.year, last.month, last.day);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Wertet eine Datendatei der Homepage aus. Sie enthält nur ein Array von Objekten, exportiert als
 * Konstante mit einem Typ aus einem anderen Modul. Ohne Typen, ohne den Import und mit `return`
 * statt `export const` lässt sie sich als Funktion ausführen.
 */
function dataOf(source: string): unknown[] {
  const code = stripTypeScriptTypes(source)
    .replace(/^\s*import\s[^;]*;?\s*$/gm, '')
    .replace(/export\s+const\s+[\w$]+\s*=/, 'return');
  const value: unknown = new Function(code)();
  return Array.isArray(value) ? value : [];
}

/** Die Reihenfolge der Dateien: `until-…` vor den einzelnen Jahren. */
function fileRank(name: string): string {
  return name.includes('-until-') ? `0${name}` : `1${name}`;
}

/**
 * Die Veranstaltungen der Homepage im gepushten Stand, kommende zuerst in ihrer Reihenfolge,
 * danach die vergangenen, die neueste zuerst.
 */
export async function readTalks(homepage: string, today = new Date()): Promise<Talk[]> {
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const names = (await runGit(homepage, ['ls-tree', '-r', '--name-only', 'origin/main', 'app/data/raw/']))
    .split('\n')
    .filter((name) => TALK_FILES.test(name))
    .sort((a, b) => fileRank(a).localeCompare(fileRank(b)));
  const sources = await Promise.all(names.map((name) => runGit(homepage, ['show', `origin/main:${name}`])));
  const talks = sources.flatMap(dataOf).filter(isRecord).map((raw): Talk => {
    const isPast = (date: unknown) => {
      const day = lastDayOf(textOf(date));
      return day !== null && day < startOfToday;
    };
    const title = textOf(raw.title);
    const event = textOf(raw.event);
    const slug = typeof raw.slug === 'string' ? raw.slug : slugify(`${title}-${event}`);
    return {
      type: textOf(raw.type),
      title,
      event,
      date: textOf(raw.date),
      location: textOf(raw.location),
      upcoming: !(raw.done === true || (Array.isArray(raw.material) && raw.material.length > 0)) && !isPast(raw.date),
      url: `${HOMEPAGE_URL}/t/${slug}`,
    };
  });
  return [...talks.filter((talk) => talk.upcoming), ...talks.filter((talk) => !talk.upcoming).reverse()];
}

/** Die Zeilen aus `_redirects` außer der Weiterleitung `/*` für alles Übrige. */
function redirectsOf(text: string): Redirect[] {
  return text
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(([from, to]) => from?.startsWith('/') === true && from !== '/*' && to !== undefined)
    .map(([from = '', to = '']) => ({ path: from.slice(1), target: to }));
}

/** Ein Redirect-Repo mit der Domain aus `baseUrl` seiner `package.json`. */
export async function readDomain(repoPath: string): Promise<ShortlinkDomain> {
  const [pkg, redirects] = await Promise.all([
    readFile(join(repoPath, 'package.json'), 'utf8'),
    readFile(join(repoPath, '_redirects'), 'utf8'),
  ]).catch(() => {
    throw new Error(`Im Ordner ${repoPath} fehlt package.json oder _redirects.`);
  });
  const parsed: unknown = JSON.parse(pkg);
  const baseUrl = isRecord(parsed) ? textOf(parsed.baseUrl).replace(/\/+$/, '') : '';
  if (baseUrl === '') {
    throw new Error(`In ${repoPath}/package.json fehlt baseUrl.`);
  }
  return { domain: new URL(baseUrl).host, baseUrl, repoPath, redirects: redirectsOf(redirects) };
}

/** Prüft einen Pfad für einen Kurzlink: nicht leer, ohne `/` und ohne Leerzeichen. */
export function checkPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, '');
  if (trimmed === '' || !/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(`„${path}“ taugt nicht als Pfad, erlaubt sind Buchstaben, Ziffern, Punkt, Unter- und Bindestrich.`);
  }
  return trimmed;
}

/**
 * Trägt den Kurzlink in `_redirects` ein, committet nur diese Datei und pusht. Vorher wird der
 * Stand von `origin` per Fast-Forward nachgezogen; lokale Änderungen brechen ab. Die Zeile kommt
 * vor die Weiterleitung `/*`, weil Netlify die erste passende Zeile nimmt.
 */
export async function addRedirect(repoPath: string, path: string, target: string): Promise<void> {
  if ((await runGit(repoPath, ['status', '--porcelain'])).trim() !== '') {
    throw new Error(`Im Redirect-Repo ${repoPath} liegen lokale Änderungen. Bitte erst aufräumen.`);
  }
  await runGit(repoPath, ['fetch', 'origin']);
  await runGit(repoPath, ['merge', '--ff-only', '@{u}']);
  const file = join(repoPath, '_redirects');
  const text = await readFile(file, 'utf8');
  if (redirectsOf(text).some((redirect) => redirect.path === path)) {
    throw new Error(`Den Pfad /${path} gibt es schon.`);
  }
  const lines = text.replace(/\n+$/, '').split('\n');
  const fallback = lines.findIndex((line) => line.trim().split(/\s+/)[0] === '/*');
  const line = `/${path} ${target}`;
  if (fallback === -1) {
    lines.push(line);
  } else {
    lines.splice(fallback, 0, line);
  }
  await writeFile(file, `${lines.join('\n')}\n`);
  await runGit(repoPath, ['commit', '--only', '-m', `Kurzlink /${path}`, '--', '_redirects']);
  await runGit(repoPath, ['push', 'origin', 'HEAD']);
}

/** Ob die Seite antwortet, mit dem Status; `null` ohne Antwort. */
export async function checkUrl(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
    return response.status;
  } catch {
    return null;
  }
}

/** Ob der Kurzlink schon auf das Ziel weiterleitet, also ob Netlify ihn ausliefert. */
export async function isLive(shortUrl: string, target: string): Promise<boolean> {
  try {
    const response = await fetch(shortUrl, { redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
    const location = response.headers.get('location') ?? '';
    const strip = (url: string) => url.replace(/\/+$/, '');
    return response.status >= 300 && response.status < 400 && strip(location) === strip(target);
  } catch {
    return false;
  }
}

/** Der QR-Code für die Adresse als SVG. */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 2, width: 512, errorCorrectionLevel: 'M' });
}

/** Der Ordner des Worktrees mit dem Branch `werkstatt`, sonst `null`. */
export async function werkstattOf(repoPath: string): Promise<string | null> {
  const list = await runGit(repoPath, ['worktree', 'list', '--porcelain']);
  for (const block of list.split('\n\n')) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    if (path !== undefined && /^branch refs\/heads\/werkstatt$/m.test(block)) {
      return path;
    }
  }
  return null;
}

/**
 * Legt den QR-Code im Worktree `werkstatt` unter `folien/` ab und committet nur diese Datei, auch
 * wenn dort weitere Änderungen liegen oder schon etwas vorgemerkt ist. Gepusht wird nicht.
 */
export async function saveQr(werkstatt: string, name: string, svg: string, message: string): Promise<string> {
  const relative = `folien/qr-${basename(name)}.svg`;
  const file = join(werkstatt, relative);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, svg);
  await runGit(werkstatt, ['add', '--', relative]);
  await runGit(werkstatt, ['commit', '--only', '-m', message, '--', relative]);
  return relative;
}
