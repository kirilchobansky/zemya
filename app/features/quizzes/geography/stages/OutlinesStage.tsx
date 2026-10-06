/**
 * "Name the Country from its Outline"'s Stage: no map, laid out exactly like the flags quiz
 * (FlagsStage.tsx) — a fixed-size box so the input never moves, with the target's silhouette
 * drawn inside it on a canvas, flat ink on the stage background. It reuses the world's own
 * Path2D (the coarse payload, indistinguishable from 1:10m at silhouette size) and draws every part of the
 * country, offshore islands included. Size comes from outlineShare() (area, normalised to the
 * quiz pool). Nothing on screen names a country until a reveal.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { outlineShare, outlineTransform } from '~/features/countries';
import type { QuizStageProps } from '~/features/quizzes/engine/types';
import { QuizControls } from '~/features/quizzes/engine/QuizControls';
import { StartCaption } from '~/features/quizzes/engine/StartCaption';

export function OutlinesStage(props: QuizStageProps) {
  const { slot, phase, target, revealed, onStart, world, pool } = props;

  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => setHost(document.querySelector('main.stage')), []);

  const boxRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // bumped on a theme change, so the silhouette is redrawn
  const [redraw, setRedraw] = useState(0);
  useEffect(() => {
    // the ink colour is resolved from the token at draw time; only a theme change needs a repaint
    const observer = new MutationObserver(() => setRedraw(n => n + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => observer.disconnect();
  }, []);

  const showing = (phase === 'running' || phase === 'paused') && target;
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    if (!box || !canvas || !showing || !world) return;
    const draw = () => {
      const feature = world.byIso3.get(target.iso3);
      const ctx = canvas.getContext('2d');
      const path = feature && (feature.fullPath ?? feature.path);
      if (!ctx) return;
      const { width, height } = box.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (!feature?.bbox || !path) return;
      const { scale, tx, ty } = outlineTransform(feature.bbox, outlineShare(target, pool), width, height);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#888';
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * tx, dpr * ty);
      ctx.fill(path, 'nonzero');
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(box);
    return () => observer.disconnect();
  }, [showing, target, world, pool, redraw, host]);

  if (slot === 'panel') return null;

  const controls = (
    <QuizControls
      stage={props}
      placeholder="Which country is this?"
      ariaLabel="Which country is this?"
      answer={revealed && target ? target.name : null}
    />
  );

  if (phase === 'done') {
    return createPortal(<div className="quiz-dock" data-phase={phase}>{controls}</div>, document.body);
  }

  if (!host) return null;
  return createPortal(
    <div className="quiz-flag-stage" data-phase={phase}>
      {phase === 'idle' && (
        <>
          <button type="button" className="quiz-dock__start" onClick={onStart}>
            START
          </button>
          <StartCaption />
        </>
      )}
      {showing && (
        <div className="quiz-flag-stage__flag quiz-flag-stage__outline" ref={boxRef}>
          <canvas ref={canvasRef} role="img" aria-label="Country outline" />
        </div>
      )}
      {controls}
    </div>,
    host
  );
}
