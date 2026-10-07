import type { MicroMode } from '~/engines/map/style';

/** The Micro toggle's cycle, and what its button says. */
const MICRO_CYCLE: readonly MicroMode[] = ['full', 'dots', 'off'];
export const MICRO_LABEL: Record<MicroMode, string> = { full: 'Full', dots: 'Dots', off: 'Off' };
export const nextMicro = (current: MicroMode): MicroMode => MICRO_CYCLE[(MICRO_CYCLE.indexOf(current) + 1) % MICRO_CYCLE.length];
