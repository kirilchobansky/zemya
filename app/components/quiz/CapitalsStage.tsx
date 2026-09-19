/**
 * "Name the Capital"'s Stage — the countries quiz's map Stage (MapStage.tsx) configured to
 * ask for a capital's name. The player sees the target country in brass and a ring on its
 * capital and types the city; the highlight IS the question (which country's capital), so
 * nothing on screen names the country or the city until a reveal. No neighbour-glow toggle:
 * the country is already lit. See CLAUDE.md's Quizzes section.
 */
import type { QuizStageProps } from '~/lib/quiz/types';
import { MapStage, type MapStageConfig } from './MapStage';

const CONFIG: MapStageConfig = {
  placeholder: "Type the capital's name…",
  ariaLabel: "Type the capital's name",
  answerOf: target => target.capital ?? target.name,
  neighbourToggle: false
};

export function CapitalsStage(props: QuizStageProps) {
  return <MapStage {...props} config={CONFIG} />;
}
