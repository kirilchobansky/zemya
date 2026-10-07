/**
 * The atlas layout route: the shared stylesheets (their ORDER matters — see docs/structure.md
 * "CSS") and the provider around the shell (features/map's AtlasShell), which owns the canvas,
 * the camera and every piece of map state; the child routes render only the right-hand panel.
 */
import '~/shared/styles/phone.css';
import '~/shared/styles/layout.css';
import '~/shared/styles/panels.css';
import '~/shared/styles/content.css';
import '~/shared/styles/buttons.css';
import '~/shared/styles/sheet.css';
import '~/shared/styles/progress.css';
import '~/shared/styles/dossier.css';
import '~/shared/styles/empty.css';
import '~/shared/styles/subject-list.css';
import '~/shared/styles/pointer.css';
import { AtlasShell } from '~/features/map';
import { ProgressProvider } from '~/features/progress';
import './atlas.css';
import './atlas.phone.css';

/**
 * The provider wraps the shell rather than the app root because progress is only ever read
 * inside the atlas — the panel routes render as its children, so one provider covers the
 * map, the rail and the dossier.
 */
export default function AtlasLayout() {
  return (
    <ProgressProvider>
      <AtlasShell />
    </ProgressProvider>
  );
}
