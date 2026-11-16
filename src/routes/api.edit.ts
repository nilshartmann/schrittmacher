import { createFileRoute } from '@tanstack/react-router';
import { requestDraft, requestEdit } from '../editor/editor.functions';

/**
 * Ob eine Anfrage von einer fremden Seite im Browser kommt. Das Kommando schickt keinen `Origin`;
 * ohne diese Prüfung könnte jede Seite einen Ordner als Workspace eintragen und ihn damit für den
 * Editor freigeben.
 */
function fromOtherSite(request: Request): boolean {
  const origin = request.headers.get('Origin');
  return origin !== null && origin !== new URL(request.url).origin;
}

/**
 * Nimmt vom Kommando `schrittmacher edit <pfad>` den Pfad als Text entgegen und merkt die Datei oder
 * den Workspace für den Editor unter `/edit`. Mit `?neu` legt es stattdessen einen Entwurf an
 * (`schrittmacher edit --neu`). Die Seite holt die Anforderung mit `takeRequest` ab.
 */
export const Route = createFileRoute('/api/edit')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (fromOtherSite(request)) {
          return new Response('Nur für das Kommando schrittmacher.\n', { status: 403 });
        }
        try {
          if (new URL(request.url).searchParams.has('neu')) {
            await requestDraft();
          } else {
            await requestEdit((await request.text()).trim());
          }
          return new Response('');
        } catch (failure) {
          return new Response(`${failure instanceof Error ? failure.message : String(failure)}\n`, { status: 400 });
        }
      },
    },
  },
});
