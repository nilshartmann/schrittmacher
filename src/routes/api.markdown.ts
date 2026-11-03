import { createFileRoute } from '@tanstack/react-router';
import { requestMarkdown } from '../server/markdown.functions';

/**
 * Nimmt vom Kommando `schrittmacher <datei.md>` den Pfad als Text entgegen und merkt die Datei für
 * die Ansicht unter `/markdown`. Die Seite holt sie mit `takeRequest` ab.
 */
export const Route = createFileRoute('/api/markdown')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const path = (await request.text()).trim();
        try {
          await requestMarkdown(path);
          return new Response('');
        } catch (failure) {
          return new Response(`${failure instanceof Error ? failure.message : String(failure)}\n`, { status: 400 });
        }
      },
    },
  },
});
