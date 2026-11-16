import { createFileRoute } from '@tanstack/react-router';
import { EditorPage } from '../editor/EditorPage';
import { loadEditorFile } from '../editor/editor.functions';
import { Tooltips } from '../viewer/Tooltips';

/** Der Editor für eine Markdown-Datei, geöffnet mit `schrittmacher edit <datei.md>`. */
export const Route = createFileRoute('/edit')({
  validateSearch: (search: Record<string, unknown>): { path: string } => ({
    path: typeof search.path === 'string' ? search.path : '',
  }),
  loaderDeps: ({ search }) => ({ path: search.path }),
  loader: ({ deps }) => loadEditorFile({ data: { path: deps.path } }),
  gcTime: 0,
  // Der Editor übernimmt den Text nur beim Anlegen; eine andere Datei bekommt einen neuen.
  component: () => {
    const file = Route.useLoaderData();
    return <EditorPage key={file.path} file={file} />;
  },
  errorComponent: ({ error }) => (
    <div className="app">
      <p className="empty">{error instanceof Error ? error.message : String(error)}</p>
      <Tooltips />
    </div>
  ),
});
