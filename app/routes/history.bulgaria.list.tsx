/**
 * Plain proofreading table for content/history/bg.yaml — no canvas, no atlas shell,
 * intentionally outside routes/atlas.tsx's layout (this is a content QA tool, not a nav
 * destination). noindex: it exists so the owner can read the data, not for search.
 */
import { bulgariaHistoryList } from '~/lib/history/catalog.server';
import { pageMeta } from '~/lib/seo';
import type { Route } from './+types/history.bulgaria.list';

export function loader() {
  return { rows: bulgariaHistoryList() };
}

export function meta() {
  return pageMeta({
    title: 'Bulgaria history — list — Zemya',
    description: 'Plain table of the Bulgaria history timeline data, for proofreading.',
    path: '/history/bulgaria/list',
    noindex: true
  });
}

function range(start: string, end: string | null): string {
  return end && end !== start ? `${start} – ${end}` : start;
}

export default function HistoryBulgariaList({ loaderData }: Route.ComponentProps) {
  const { rows } = loaderData;
  return (
    <table>
      <thead>
        <tr>
          <th>year</th>
          <th>kind</th>
          <th>role</th>
          <th>name.bg</th>
          <th>tier</th>
          <th>precision</th>
          <th>category</th>
          <th>parent</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.id}>
            <td>{range(row.start, row.end)}</td>
            <td>{row.kind}</td>
            <td>{row.role ?? ''}</td>
            <td>{row.nameBg}</td>
            <td>{row.tier}</td>
            <td>{row.precision}</td>
            <td>{row.category ?? ''}</td>
            <td>{row.parent ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
