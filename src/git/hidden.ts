import type { Ref } from './types';

/**
 * Ausgeblendete Branches werden als Namen aus `refs/` gemerkt. Ein Name mit `/` am Ende steht für
 * eine Gruppe: `refs/heads/` für alle lokalen Branches, `refs/remotes/` für alle Remotes,
 * `refs/remotes/origin/` für die Branches eines Remotes. Jeder andere Name steht für genau einen
 * Branch.
 */
export type Hidden = readonly string[];

export const LOCAL_GROUP = 'refs/heads/';
export const REMOTES_GROUP = 'refs/remotes/';

export function refPath(ref: Ref): string {
  return `${ref.kind === 'local' ? LOCAL_GROUP : REMOTES_GROUP}${ref.name}`;
}

/** Die Gruppe eines Remotes, etwa `refs/remotes/origin/`. */
export function remoteGroup(remote: string): string {
  return `${REMOTES_GROUP}${remote}/`;
}

/** Der Name des Remotes, zu dem ein Branch gehört; `origin` für `origin/main`. */
export function remoteOf(ref: Ref): string {
  return ref.name.slice(0, ref.name.indexOf('/'));
}

/** Die Gruppe, über die ein Name ausgeblendet ist, sonst `null`; bei einem Branch auch er selbst. */
export function hiddenBy(hidden: Hidden, path: string): string | null {
  return hidden.find((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry)) ?? null;
}

export function isHidden(hidden: Hidden, ref: Ref): boolean {
  return hiddenBy(hidden, refPath(ref)) !== null;
}

/**
 * Blendet einen Branch oder eine Gruppe aus oder wieder ein. Wird eine Gruppe ausgeblendet, fallen
 * die Einträge darin weg, damit sie beim Einblenden nicht ausgeblendet zurückbleiben.
 */
export function toggleHidden(hidden: Hidden, path: string): string[] {
  if (hidden.includes(path)) {
    return hidden.filter((entry) => entry !== path);
  }
  const group = path.endsWith('/');
  return [...hidden.filter((entry) => !(group && entry.startsWith(path))), path];
}
