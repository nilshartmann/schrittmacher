import { LOCAL } from '../git/repo';
import type { Comparison } from '../git/repo';
import type { DiffFile } from '../git/types';

/** Die Adresse eines Bildes aus dem Vergleich, siehe `/api/file`. */
function imageUrl(worktree: string, revision: string, path: string, version: string): string {
  const search = new URLSearchParams({ worktree, revision, path, version });
  return `/api/file?${search.toString()}`;
}

/**
 * Eine Bilddatei des Vergleichs als Bild. Eine neue Datei zeigt nur das neue Bild, eine gelöschte
 * nur das alte, eine geänderte beide nebeneinander. `version` ändert sich mit jeder lokalen
 * Änderung, damit der Browser ein geändertes Bild neu lädt.
 */
export function ImageView({
  worktree,
  comparison,
  file,
  version,
}: {
  worktree: string;
  comparison: Comparison;
  file: DiffFile;
  version: string;
}) {
  const local = comparison.to === LOCAL;
  const before = local ? 'HEAD' : (comparison.from ?? `${comparison.to}^`);
  const sides = [
    file.kind !== 'added' && { label: 'Vorher', className: 'removed', url: imageUrl(worktree, before, file.oldPath, '') },
    file.kind !== 'deleted' && {
      label: 'Nachher',
      className: 'added',
      url: imageUrl(worktree, comparison.to, file.path, local ? version : ''),
    },
  ].filter((side) => side !== false);
  return (
    <div className="image-view">
      {sides.map((side) => (
        <figure key={side.label} className={`image-side ${side.className}`}>
          {sides.length > 1 && <figcaption>{side.label}</figcaption>}
          <img src={side.url} alt={side.label} />
        </figure>
      ))}
    </div>
  );
}
