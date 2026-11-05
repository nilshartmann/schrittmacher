/** Die Bilder, die Schrittmacher anzeigt, mit ihrem Medientyp. */
const IMAGE_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
]);

/** Der Medientyp eines Bildes nach der Endung des Pfads; `undefined` für eine andere Datei. */
export function imageTypeOf(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  return dot < path.lastIndexOf('/') + 1 ? undefined : IMAGE_TYPES.get(path.slice(dot).toLowerCase());
}
