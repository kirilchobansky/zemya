/**
 * "Name the Flag"'s Stage: no map. The flag takes over the whole stage area — dark
 * background, the flag centred and large in a FIXED-size box, the typed-answer input below
 * it at a constant position, focused. Nothing else on screen names a country. The right panel (timer, count,
 * skip/reveal/pause/abandon, and the accepted-confusable-pair note) is entirely the
 * generic engine/route scaffold — this Stage renders nothing into the panel slot. See
 * CLAUDE.md's Quizzes section.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { Flag } from '~/shared/components/Flag';
import type { QuizStageProps } from '~/features/quizzes/engine/types';
import { QuizControls } from '~/features/quizzes/engine/QuizControls';
import { StartCaption } from '~/features/quizzes/engine/StartCaption';
import './quiz-flag-stage.css';

export function FlagsStage(props: QuizStageProps) {
  const { slot, phase, target, revealed, onStart } = props;

  // Hooks first: the host is the shell's <main class="stage"> (see below), found after mount.
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => setHost(document.querySelector('main.stage')), []);

  if (slot === 'panel') return null;

  const controls = (
    <QuizControls
      stage={props}
      placeholder="Which country is this?"
      ariaLabel="Which country is this?"
      answer={revealed && target ? target.name : null}
    />
  );

  // The results screen has no flag stage — it must not cover the map behind the results sheet —
  // but the input stays mounted (hidden) so "Run it again" can focus it inside the tap.
  if (phase === 'done') {
    return createPortal(<div className="quiz-dock" data-phase={phase}>{controls}</div>, document.body);
  }

  // Portalled into <main class="stage"> like the History fill quiz: it is then exactly the grid cell
  // between the rail and the panel, so it follows sidebar resizing and collapsing (the shell's
  // CSS variables are not inherited by <body>). A phone makes it `fixed` over the screen; the
  // sheet is not an ancestor of <main>, so nothing traps it.
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
      {(phase === 'running' || phase === 'paused') && target && (
        <div className="quiz-flag-stage__flag">
          <Flag iso2={target.iso2} emoji={target.emoji} flagRatio={target.flagRatio} size="xl" alt="" />
        </div>
      )}
      {controls}
    </div>,
    host
  );
}
