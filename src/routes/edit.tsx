import { createFileRoute } from '@tanstack/react-router';
import { EditorLayout, EmptyPane, FilePane } from '../editor/EditorLayout';
import { EditorPage } from '../editor/EditorPage';
import { loadEditorFile } from '../editor/editor.functions';

/** Die Suche der Seite: die Datei, der Workspace oder beides. */
interface EditSearch {
  path?: string;
  root?: string;
}

/**
 * Der Editor unter `/edit`, geöffnet mit `schrittmacher edit <pfad>`: eine Datei, ein Workspace
 * mit seinem Baum oder beides (`docs/editor.md`).
 */
export const Route = createFileRoute('/edit')({
  validateSearch: (search: Record<string, unknown>): EditSearch => ({
    ...(typeof search.path === 'string' && search.path !== '' ? { path: search.path } : {}),
    ...(typeof search.root === 'string' && search.root !== '' ? { root: search.root } : {}),
  }),
  loaderDeps: ({ search }) => ({ path: search.path ?? null }),
  loader: ({ deps }) => (deps.path === null ? null : loadEditorFile({ data: { path: deps.path } })),
  gcTime: 0,
  // Der Editor übernimmt den Text nur beim Anlegen; eine andere Datei bekommt einen neuen.
  component: () => {
    const file = Route.useLoaderData();
    const { root } = Route.useSearch();
    return (
      <EditorLayout root={root ?? null} current={file?.path ?? null}>
        {file === null ? (
          <EmptyPane message={root === undefined ? 'Keine Datei angegeben.' : 'Wähle links eine Datei.'} />
        ) : file.kind === 'text' ? (
          <EditorPage key={file.path} file={file} root={root ?? null} />
        ) : (
          <FilePane file={file} />
        )}
      </EditorLayout>
    );
  },
  errorComponent: ({ error }) => {
    const { root, path } = Route.useSearch();
    return (
      <EditorLayout root={root ?? null} current={path ?? null}>
        <EmptyPane message={error instanceof Error ? error.message : String(error)} />
      </EditorLayout>
    );
  },
});
