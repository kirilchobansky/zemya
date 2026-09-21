/**
 * The phone's "visible map area": what the bottom sheet and tab bar cover is subtracted from the
 * viewport wherever the camera frames something (camera.ts's frame / homeCamera), and the bottom
 * sheet's snap geometry (sheet.ts). Pure maths — the gesture itself is test/smoke.mjs's job.
 *
 *   npm run test:unit
 */
import { describe, expect, it } from 'vitest';

import { frame, homeCamera, NO_INSETS, worldToScreen } from '~/lib/map/camera';
import { nearestSnap, PEEK_PX, sheetVisible, stepSnap } from '~/lib/sheet';

const phone = { width: 390, height: 664 };
const box = { x0: 0.5, x1: 0.52, y0: 0.4, y1: 0.42 };
const centre = { x: 0.51, y: 0.41 };

describe('frame with insets', () => {
  it('is unchanged without insets', () => {
    expect(frame(box, phone, 0.55, Infinity, NO_INSETS)).toEqual(frame(box, phone));
  });

  it('centres the box in the visible area, not in the whole viewport', () => {
    const insets = { top: 64, right: 0, bottom: 332, left: 0 }; // sheet at half
    const camera = frame(box, phone, 0.55, Infinity, insets);
    const [sx, sy] = worldToScreen(camera, phone, centre.x, centre.y);
    expect(sx).toBeCloseTo(phone.width / 2, 3);
    expect(sy).toBeCloseTo(insets.top + (phone.height - insets.top - insets.bottom) / 2, 3);
  });

  it('fits the box inside the visible area, not the viewport', () => {
    const wide = { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 };
    const open = frame(wide, phone, 0.55);
    const covered = frame(wide, phone, 0.55, Infinity, { top: 0, right: 0, bottom: 400, left: 0 });
    expect(covered.zoom).toBeLessThan(open.zoom); // 264 px of height to work with instead of 664
  });
});

describe('homeCamera with insets', () => {
  it('is the plain world view without insets', () => {
    expect(homeCamera(phone, NO_INSETS).zoom).toBe(homeCamera(phone).zoom);
  });

  it('centres the world in the visible area, not the viewport', () => {
    const insets = { top: 64, right: 0, bottom: 144, left: 0 };
    const camera = homeCamera(phone, insets);
    const [, sy] = worldToScreen(camera, phone, 0.5, 0.5); // the clamp centres a world shorter than the area
    expect(sy).toBeCloseTo(insets.top + (phone.height - insets.top - insets.bottom) / 2, 0);
  });
});

describe('sheet geometry', () => {
  const vh = 844;
  const tab = 83; // 49px bar + 34px home-indicator inset, as on an iPhone 13

  it('peek is the tab bar plus 88px; half is 50%; full is 90%', () => {
    expect(sheetVisible('peek', vh, tab)).toBe(PEEK_PX + tab);
    expect(sheetVisible('half', vh, tab)).toBe(vh * 0.5);
    expect(sheetVisible('full', vh, tab)).toBe(vh * 0.9);
  });

  it('steps up through the snaps and back down from full', () => {
    expect(stepSnap('peek')).toBe('half');
    expect(stepSnap('half')).toBe('full');
    expect(stepSnap('full')).toBe('half');
  });

  it('settles on the nearest snap', () => {
    expect(nearestSnap(150, vh, tab)).toBe('peek');
    expect(nearestSnap(400, vh, tab)).toBe('half');
    expect(nearestSnap(700, vh, tab)).toBe('full');
  });
});
