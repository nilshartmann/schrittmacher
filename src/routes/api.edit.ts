import { createFileRoute } from '@tanstack/react-router';
import { requestEdit } from '../editor/editor.functions';

/**
 * Nimmt vom Kommando `schrittmacher edit <datei.md>` den Pfad als Text entgegen und merkt die Datei
 * für den Editor unter `/edit`. Die Seite holt sie mit `takeRequest` ab.
 */
export const Route = createFileRoute('/api/edit')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const path = (await request.text()).trim();
        try {
          await requestEdit(path);
          return new Response('');
        } catch (failure) {
          return new Response(`${failure instanceof Error ? failure.message : String(failure)}\n`, { status: 400 });
        }
      },
    },
  },
});
