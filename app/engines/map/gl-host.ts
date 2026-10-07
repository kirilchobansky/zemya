/**
 * What the GlAtlas collaborators (gl-camera, gl-hover, gl-compare, gl-styling, gl-view-sync,
 * gl-picking) may read of the atlas. GlAtlas owns the state; these are live views of it, so a
 * restyle or resize is seen by everyone at once.
 */
import type { Map as GlMap } from 'maplibre-gl';

import type { CameraState, Insets, Viewport } from './camera';
import type { AtlasCallbacks } from './controller';
import type { Style } from './style';
import type { World } from './types';

export interface GlHost {
  readonly map: GlMap;
  readonly world: World;
  readonly container: HTMLElement;
  readonly callbacks: AtlasCallbacks;
  readonly style: Style;
  readonly viewport: Viewport;
  readonly insets: Insets;
  readonly destroyed: boolean;
  /** The camera as drawn right now, in the app's unit-square terms. */
  readonly camera: CameraState;
}
