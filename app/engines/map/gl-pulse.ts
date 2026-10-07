/** The expanding ring drawn over a point (the quiz's "here it is"): a circle layer whose paint is
 *  animated for a second, skipped under reduced motion. */
import type { GeoJSONSource } from 'maplibre-gl';

import type { GlHost } from './gl-host';
import { SOURCE } from './gl-style';

const PULSE_MS = 1000;
const PULSE_START_RADIUS = 8;
const PULSE_GROWTH = 90;

export class GlPulse {
  private handle = 0;

  constructor(private readonly host: GlHost) {}

  play(lon: number, lat: number): void {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const { map } = this.host;
    cancelAnimationFrame(this.handle);
    (map.getSource(SOURCE.pulse) as GeoJSONSource).setData({
      type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] }
    });
    const start = performance.now();
    const tick = () => {
      if (this.host.destroyed) return;
      const t = (performance.now() - start) / PULSE_MS;
      const eased = 1 - Math.pow(1 - t, 3);
      if (t >= 1) {
        map.setPaintProperty('pulse', 'circle-stroke-opacity', 0);
        return;
      }
      map.setPaintProperty('pulse', 'circle-radius', PULSE_START_RADIUS + PULSE_GROWTH * eased);
      map.setPaintProperty('pulse', 'circle-stroke-width', 3.5 - 2 * t);
      map.setPaintProperty('pulse', 'circle-stroke-opacity', 0.9 * (1 - t));
      this.handle = requestAnimationFrame(tick);
    };
    tick();
  }

  cancel(): void {
    cancelAnimationFrame(this.handle);
  }
}
