/**
 * The history timeline's time axis: decimal-year time representation, viewport
 * projection, the zoom ladder and tier-based visibility. Pure logic, mirroring
 * app/engines/map/projection.ts + camera.ts for the geography side (no React, no canvas, no
 * DOM) — CLAUDE.md already anticipated this module when it said the map's projection and
 * the history timeline would share a renderer-agnostic shape.
 *
 * Never uses `Date`: dates before 1 April 1916 are old style (Julian), and `Date` would
 * silently shift them onto the Gregorian calendar. A "day" here is one of 31 equal-width
 * synthetic slots within a month (see decimalYearOfDate below) — a uniform axis position,
 * not a claim that every month has 31 real days. That keeps every conversion in this file
 * exact and invertible without a days-in-month or leap-year table.
 *
 * The date parser (scripts/lib/history.mjs) is the single canonical implementation,
 * reused here rather than duplicated — it has zero Node dependencies, so it bundles into
 * the client exactly as any other pure-logic module would.
 */

export * from './scale-config';
export * from './scale-time';
export * from './scale-viewport';
export * from './scale-ticks';
export * from './scale-visibility';
