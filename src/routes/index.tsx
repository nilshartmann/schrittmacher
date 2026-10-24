import { createFileRoute } from '@tanstack/react-router';
import { loadRepo } from '../server/repo.functions';
import { Viewer } from '../viewer/Viewer';

export const Route = createFileRoute('/')({
  loader: () => loadRepo(),
  component: function Index() {
    return <Viewer repo={Route.useLoaderData()} />;
  },
});
