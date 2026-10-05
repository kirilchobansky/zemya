export type LonLat = [number, number];
export type Ring = LonLat[];

export function decodeArcs(data: {
  grid: { x0: number; y0: number; xs: number; ys: number };
  arcs: [number, number][][];
}): LonLat[][];
export function buildRing(indices: number[], arcs: LonLat[][]): Ring;
export function unwrapRing(ring: Ring): Ring;
export function nearestBranch(lon: number, reference: number): number;
export function meanLon(ring: Ring): number;
export function frameToReference(polygons: Ring[][], reference: number): Ring[][];
