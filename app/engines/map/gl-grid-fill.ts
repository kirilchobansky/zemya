/**
 * The graticule beyond the poles. The projection ends at ±85° latitude, so a portrait screen
 * zoomed out to the whole world shows bare ocean above and below it, with the grid stopping at
 * the world's edge. Meridians are evenly spaced on screen (Mercator x is linear in longitude), so
 * two plain CSS gradient bands carry them on through those areas: no geometry, and per camera move
 * only a handful of style writes — and nothing at all once the world fills the height.
 */
import type { Map as GlMap } from 'maplibre-gl';

import { COLORS } from './style';
import { MAX_LATITUDE } from './projection';

/** The coarsest graticule step, the only one that shows when the world is small enough to leave a gap. */
const STEP_DEG = 30;
const STEPS_PER_WORLD = 360 / STEP_DEG;

export class GlGridFill {
  private top = this.band();
  private bottom = this.band();

  constructor(private map: GlMap, private container: HTMLElement) {
    container.append(this.top, this.bottom);
    this.applyColours();
    map.on('move', this.update);
    map.on('resize', this.update);
    this.update();
  }

  private band(): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;left:0;right:0;pointer-events:none;display:none;background-repeat:repeat-x,repeat-x';
    return el;
  }

  /** A theme change: the lines take the palette's colours again. */
  applyColours(): void {
    const line = (c: string) => `linear-gradient(90deg, ${c} 1px, transparent 1px)`;
    for (const el of [this.top, this.bottom]) el.style.backgroundImage = `${line(COLORS.graticuleMajor)}, ${line(COLORS.graticule)}`;
  }

  update = (): void => {
    const h = this.container.clientHeight;
    const topEdge = this.map.project([0, MAX_LATITUDE]).y;
    const bottomEdge = this.map.project([0, -MAX_LATITUDE]).y;
    const showTop = topEdge > 0.5;
    const showBottom = bottomEdge < h - 0.5;
    this.top.style.display = showTop ? 'block' : 'none';
    this.bottom.style.display = showBottom ? 'block' : 'none';
    if (!showTop && !showBottom) return;

    const west = this.map.project([-180, 0]).x;
    const world = this.map.project([180, 0]).x - west;
    const step = world / STEPS_PER_WORLD;
    if (!(step > 0)) return;
    const mod = (x: number, period: number) => ((x % period) + period) % period;
    const centre = this.map.project([0, 0]).x;
    const size = `${world}px 100%, ${step}px 100%`;
    const position = `${mod(centre, world)}px 0, ${mod(west, step)}px 0`;
    for (const el of [this.top, this.bottom]) {
      el.style.backgroundSize = size;
      el.style.backgroundPosition = position;
    }
    this.top.style.top = '0';
    this.top.style.height = `${Math.min(h, topEdge)}px`;
    this.bottom.style.top = `${Math.max(0, bottomEdge)}px`;
    this.bottom.style.height = `${h - Math.max(0, bottomEdge)}px`;
  };

  destroy(): void {
    this.map.off('move', this.update);
    this.map.off('resize', this.update);
    this.top.remove();
    this.bottom.remove();
  }
}
