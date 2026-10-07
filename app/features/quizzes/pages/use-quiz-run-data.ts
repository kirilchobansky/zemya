/**
 * What one geography quiz run is made of: the route's params resolved to a subject, a quiz
 * definition, a scope, a size and an order; the loaded world; the scope's pool and the drawn
 * set of countries (and a Restart's newly drawn set).
 */
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";

import { isQuizScope, isQuizSize, loadWorld, poolForQuiz, sizesForPool, type QuizSize } from '~/features/countries';
import type { CountryRecord, World } from "~/engines/map/types";
import { useGo } from "~/shared/lib/navigation";
import { quizInSubject, subjectById } from '../engine/subjects';
import { selectQuizCountries, type QuizSelectionMode } from '../geography/quizzes';

export function useQuizRunData() {
  const go = useGo();
  const [searchParams] = useSearchParams();
  const params = useParams<{
    subject: string;
    quizId: string;
    scope: string;
    size: string;
  }>();
  const subject = params.subject ? subjectById(params.subject) : undefined;
  const definition =
    subject && params.quizId
      ? quizInSubject(subject, params.quizId)
      : undefined;
  const scope = params.scope && isQuizScope(params.scope) ? params.scope : null;
  const requestedSize =
    params.size && isQuizSize(params.size) ? params.size : null;
  const mode: QuizSelectionMode =
    searchParams.get("order") === "population" ? "population" : "random";
  const backTo = `/quizzes/${params.subject}`;

  const [stageHost, setStageHost] = useState<Element | null>(null);
  useEffect(() => setStageHost(document.querySelector("main.stage")), []);
  const [world, setWorld] = useState<World | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadWorld().then((w) => {
      if (!cancelled) setWorld(w);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** The whole scope's pool, before any Top-N cut — its length decides which sizes exist. */
  const pool = useMemo(
    () =>
      world && scope && definition
        ? poolForQuiz(world.data.countries, definition.id, scope)
        : [],
    [world, scope, definition],
  );
  /** A size the pool can't offer (e.g. 50 of Oceania's 14, or a hand-typed URL) is not a
   *  run — the catalogue is the only thing that should be linking here. */
  const size: QuizSize | null =
    requestedSize &&
    pool.length &&
    sizesForPool(pool.length).includes(requestedSize)
      ? requestedSize
      : null;

  const drawnCountries = useMemo(
    () => (definition && size ? selectQuizCountries(pool, size, mode) : []),
    [definition, mode, pool, size],
  );
  /* A Restart's newly drawn set, valid only for the draw it replaced: a different quiz, scope,
     size or mode produces a new `drawnCountries`, which drops it. */
  const [redraw, setRedraw] = useState<{
    from: CountryRecord[];
    list: CountryRecord[];
  } | null>(null);
  const countries =
    redraw && redraw.from === drawnCountries ? redraw.list : drawnCountries;

  return {
    go, params, subject, definition, scope, requestedSize, mode, backTo,
    stageHost, world, pool, size, drawnCountries, countries, setRedraw
  };
}
