/**
 * Plain proofreading table for content/history/<file>.yaml — no canvas, no atlas shell,
 * intentionally outside routes/atlas.tsx's layout (this is a content QA tool, not a nav
 * destination). noindex: it exists so the owner can read the data, not for search.
 */
import { historyListFor } from '~/lib/history/catalog.server';
import { historyCountryFor } from '~/lib/history/countries';
import { pageMeta } from '~/lib/seo';
import type { Route } from './+types/history.$slug.list';

export function loader({ params }: Route.LoaderArgs) {
  const country = historyCountryFor(params.slug);
  if (!country) throw new Response('Not found', { status: 404 });
  return { country, rows: historyListFor(country.slug) };
}

export function meta({ loaderData, location }: Route.MetaArgs) {
  const name = loaderData?.country.nameEn ?? 'History';
  return pageMeta({
    title: `${name} history — list — Zemya`,
    description: `Plain table of the ${name} history timeline data, for proofreading.`,
    path: location.pathname,
    noindex: true
  });
}

function range(start: string, end: string | null): string {
  return end && end !== start ? `${start} – ${end}` : start;
}

export default function HistoryList({ loaderData }: Route.ComponentProps) {
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
