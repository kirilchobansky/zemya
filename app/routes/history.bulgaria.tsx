/**
 * First render of the history timeline. Not linked from any navigation and marked
 * noindex (see CLAUDE.md's history exception) — canvas drawing only, no dossier, no
 * hover, no selection, no quiz yet.
 */
import { useEffect, useRef } from 'react';

import { bulgariaTimeline } from '~/lib/history/catalog.server';
import { HistoryTimeline } from '~/lib/history/timeline';
import { pageMeta } from '~/lib/seo';
import type { Route } from './+types/history.bulgaria';

export function loader() {
  return { entries: bulgariaTimeline() };
}

export function meta({ location }: Route.MetaArgs) {
  return pageMeta({
    title: 'Bulgaria — history timeline — Zemya',
    description: 'An early, unfinished build of the history timeline.',
    path: location.pathname,
    noindex: true
  });
}

export default function HistoryBulgaria({ loaderData }: Route.ComponentProps) {
  const { entries } = loaderData;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HistoryTimeline | null>(null);

  useEffect(() => {
    if (!canvasRef.current || timelineRef.current) return;
    const timeline = new HistoryTimeline(canvasRef.current, { axis: 'horizontal', entries });
    timelineRef.current = timeline;
    return () => {
      timeline.destroy();
      timelineRef.current = null;
    };
  }, [entries]);

  return (
    <div className="history-page">
      <main className="stage">
        <canvas ref={canvasRef} className="stage__canvas" aria-label="Bulgaria history timeline" />
      </main>
    </div>
  );
}
