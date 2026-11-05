import { createFileRoute } from '@tanstack/react-router';
import { readRepoImage } from '../server/repo.functions';

/**
 * Liefert ein Bild aus einem Vergleich, damit die Oberfläche eine Bilddatei anzeigt statt ihrer
 * Zeilen. Gelesen wird es im Worktree `worktree` im Commit `revision`, mit `lokal` im Worktree.
 */
export const Route = createFileRoute('/api/file')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const search = new URL(request.url).searchParams;
        const image = await readRepoImage(
          search.get('worktree') ?? '',
          search.get('revision') ?? '',
          search.get('path') ?? '',
        ).catch(() => null);
        if (image === null) {
          return new Response('Kein Bild.\n', { status: 404 });
        }
        return new Response(new Uint8Array(image.bytes), {
          headers: {
            'Content-Type': image.type,
            // Ein SVG, das direkt geöffnet wird, führt so kein Skript aus.
            'Content-Security-Policy': "script-src 'none'",
            'Cache-Control': 'no-cache',
          },
        });
      },
    },
  },
});
