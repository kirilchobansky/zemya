/**
 * "Name the Flag"'s Stage: no map. The flag takes over the whole stage area — dark
 * background, the flag centred and large in a FIXED-size box, the typed-answer input below
 * it at a constant position, focused. Nothing else on screen names a country. The right panel (timer, count,
 * skip/reveal/pause/abandon, and the accepted-confusable-pair note) is entirely the
 * generic engine/route scaffold — this Stage renders nothing into the panel slot. See
 * CLAUDE.md's Quizzes section.
 */
import { createPortal } from 'react-dom';

import { Flag } from '~/components/Flag';
import type { QuizStageProps } from '~/lib/quiz/types';
import { QuizControls } from './QuizControls';
import { StartCaption } from './StartCaption';

export function FlagsStage(props: QuizStageProps) {
  const { slot, phase, target, revealed, onStart } = props;

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

  // Portalled to <body> for the same reason as MapStage's dock: a transformed sheet ancestor
  // would trap this `position: fixed` stage inside the panel on phones.
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
    document.body
  );
}
