/**
 * "Name the Country"'s Stage — the shared map Stage (MapStage.tsx) configured to ask for a
 * country's name and reveal it. The generic atlas bridge in routes/quiz.$quizId.tsx paints
 * the target brass and answered countries green/amber, moves the camera to the world view
 * on START and hides the search box and hover tooltip for every quiz alike (see CLAUDE.md's
 * Quizzes section); this quiz alone also gets the neighbour-glow toggle, since no other
 * quiz has a notion of map neighbours.
 */
import type { QuizStageProps } from '~/lib/quiz/types';
import { MapStage, type MapStageConfig } from './MapStage';

const CONFIG: MapStageConfig = {
  placeholder: "Type the country's name…",
  ariaLabel: "Type the country's name",
  answerOf: target => target.name,
  neighbourToggle: true
};

export function CountriesStage(props: QuizStageProps) {
  return <MapStage {...props} config={CONFIG} />;
}
