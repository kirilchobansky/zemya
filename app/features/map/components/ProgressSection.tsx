import { MASTERY_COLOURS, type MasteryTotals } from '~/features/countries';
import { useTheme } from '~/shared/lib/theme';

/** Mastered / learning / new, as a tally and a meter. */
export function ProgressSection({ totals }: { totals: MasteryTotals }) {
  useTheme(); // MASTERY_COLOURS is a getComputedStyle cache — see LayerControls's note
  const pct = (n: number) => (totals.total ? (n / totals.total) * 100 : 0);
  return (
    <section className="group">
      <h2 className="group__title">Your progress</h2>
      <div className="tally" data-testid="tally">
        <div className="tally__cell">
          <span className="tally__n numeric" style={{ color: MASTERY_COLOURS.mastered }}>
            {totals.mastered}
          </span>
          <span className="tally__label">Mastered</span>
        </div>
        <div className="tally__cell">
          <span className="tally__n numeric" style={{ color: MASTERY_COLOURS.learning }}>
            {totals.learning}
          </span>
          <span className="tally__label">Learning</span>
        </div>
        <div className="tally__cell">
          <span className="tally__n numeric" style={{ color: MASTERY_COLOURS.new }}>
            {totals.new}
          </span>
          <span className="tally__label">New</span>
        </div>
      </div>
      <div
        className="meter"
        role="img"
        aria-label={`${totals.mastered} mastered and ${totals.learning} learning of ${totals.total}`}
      >
        <span
          className="meter__seg"
          style={{ width: `${pct(totals.mastered)}%`, background: MASTERY_COLOURS.mastered }}
        />
        <span
          className="meter__seg"
          style={{ width: `${pct(totals.learning)}%`, background: MASTERY_COLOURS.learning }}
        />
      </div>
    </section>
  );
}
