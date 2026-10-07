import { setTheme, useTheme, type Theme } from '~/shared/lib/theme';

const THEME_OPTIONS: { id: Theme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' }
];

/** The System / Light / Dark switch. Shared by the desktop rail and the phone Layers sheet,
 *  same pattern as LayerControls. */
export function ThemeControls() {
  const theme = useTheme();
  return (
    <section className="group">
      <h2 className="group__title">Appearance</h2>
      <div className="chips">
        {THEME_OPTIONS.map(o => (
          <button
            key={o.id}
            type="button"
            className="chip"
            aria-pressed={theme === o.id}
            onClick={() => setTheme(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
