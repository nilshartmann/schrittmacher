import { createFileRoute } from '@tanstack/react-router';
import { readImage } from '../server/markdown.functions';

/** Liefert ein Bild, das eine Markdown-Datei mit relativem Pfad einbindet, siehe `/markdown`. */
export const Route = createFileRoute('/api/image')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const path = new URL(request.url).searchParams.get('path') ?? '';
        const image = await readImage(path);
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
