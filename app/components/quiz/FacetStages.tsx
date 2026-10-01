/**
 * "Name the Currency / Language / Religion" Stages — the capitals quiz's screen (MapStage.tsx)
 * with a different question: the target country is lit in brass and the player types the value.
 * No marker is drawn (no `markCapital`), and nothing on screen says the country's name or the
 * answer until a reveal. See docs/quizzes.md.
 */
import type { QuizStageProps } from '~/lib/quiz/types';
import { MapStage, type MapStageConfig } from './MapStage';

const CURRENCY: MapStageConfig = {
  placeholder: "Type the currency's name…",
  ariaLabel: "Type the currency's name",
  answerOf: target =>
    target.currencyName ? `${target.currencyName} (${target.currencyCode})` : target.name,
  neighbourToggle: false
};

const LANGUAGE: MapStageConfig = {
  placeholder: 'Type an official language…',
  ariaLabel: 'Type an official language',
  // every official language: the quiz accepts any, so a reveal shows them all
  answerOf: target => target.languages.join(', '),
  neighbourToggle: false
};

const RELIGION: MapStageConfig = {
  placeholder: "Type the predominant religion…",
  ariaLabel: 'Type the predominant religion',
  answerOf: target => target.religion,
  neighbourToggle: false
};

export const CurrencyStage = (props: QuizStageProps) => <MapStage {...props} config={CURRENCY} />;
export const LanguageStage = (props: QuizStageProps) => <MapStage {...props} config={LANGUAGE} />;
export const ReligionStage = (props: QuizStageProps) => <MapStage {...props} config={RELIGION} />;
