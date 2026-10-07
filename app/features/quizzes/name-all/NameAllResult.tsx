import type { Ref } from 'react';
import { Link } from 'react-router';

import { continentOf, QUIZ_SCOPES, SCOPE_LABELS, type QuizScope } from '~/features/countries';
import { formatDuration } from '~/shared/lib/format';
import type { CountryRecord } from '~/engines/map/types';
import { useResultsReturn } from '~/features/quizzes/engine/use-results-return';
import { NameAllFlag } from './NameAllFlag';
import { NameAllNamedList } from './NameAllNamedList';
import type { Outcome, Phase } from './name-all-types';

/** What the panel shows once a run is over: the result card, the missed countries (grouped by
 *  continent for the World quiz), the named list and the buttons. */
export function NameAllResult({ scope, phase, elapsedMs, named, namedCountries, total, missed, outcome, listEndRef, onRestart, snapshot }: {
  scope: QuizScope;
  phase: Phase;
  elapsedMs: number;
  named: readonly string[];
  namedCountries: readonly CountryRecord[];
  total: number;
  missed: readonly CountryRecord[];
  outcome: Outcome | null;
  listEndRef: Ref<HTMLLIElement>;
  onRestart: () => void;
  /** The finished run, parked in memory when a missed country's dossier is opened. */
  snapshot: () => unknown;
}) {
  const back = useResultsReturn(snapshot, phase);
  const resultHook = (
    <div className="hook">
      <div className="hook__label">{phase === 'done' ? 'Result' : 'Gave up'}</div>
      <p className="quiz-result__time numeric">{formatDuration(elapsedMs)}</p>
      <p style={{ marginBottom: 0 }}>
        <b>{named.length} / {total}</b> named
        {phase === 'gaveup' && <> — {missed.length} missed, shown in red</>}.{' '}
        {phase === 'done' && outcome && (
          outcome.beatBest
            ? outcome.previousBest !== null
              ? <>New personal best — beat <b>{formatDuration(outcome.previousBest)}</b>.</>
              : <>First run of this quiz — now your personal best.</>
            : <>Personal best stays <b>{formatDuration(outcome.previousBest ?? elapsedMs)}</b>.</>
        )}
        {phase === 'gaveup' && <> A given-up run is not saved.</>}
      </p>
    </div>
  );

  /** The missed countries, grouped by continent for the World quiz. */
  const missedGroups = scope === 'world'
    ? QUIZ_SCOPES.filter(s => s !== 'world')
        .map(s => ({ label: SCOPE_LABELS[s], list: missed.filter(c => continentOf(c) === s) }))
        .filter(g => g.list.length > 0)
    : [{ label: '', list: missed }];

  return (
    <>
      {resultHook}
      {missed.length > 0 && (
        <section>
          <h3 className="subhead">Missed — {missed.length}</h3>
          {missedGroups.map(group => (
            <div key={group.label || 'all'} className="name-all__group">
              {group.label && <h4 className="name-all__continent">{group.label} · {group.list.length}</h4>}
              <div className="neighbours">
                {group.list.map(c => (
                  <Link className="neighbour" key={c.iso3} to={`/country/${c.slug}`} {...back}>
                    <NameAllFlag country={c} /> {c.name}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
      {named.length > 0 && (
        <section>
          <h3 className="subhead">Named — {named.length}, in the order you found them</h3>
          <NameAllNamedList countries={namedCountries} listEndRef={listEndRef} />
        </section>
      )}
      <div className="actions">
        <button type="button" className="action action--primary" onClick={onRestart}>Try again</button>
      </div>
    </>
  );
}
