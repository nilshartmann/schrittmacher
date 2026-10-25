import { createFileRoute } from '@tanstack/react-router';
import { requestTab } from '../server/repo.functions';

/**
 * Nimmt vom Kommando `schrittmacher <pfad>` den Pfad als Text entgegen und merkt ihn als neuen Tab.
 * Die Seite holt ihn mit `takeTabRequest` ab.
 */
export const Route = createFileRoute('/api/tab')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const path = (await request.text()).trim();
        try {
          await requestTab(path);
          return new Response('');
        } catch (failure) {
          return new Response(`${failure instanceof Error ? failure.message : String(failure)}\n`, { status: 400 });
        }
      },
    },
  },
});
