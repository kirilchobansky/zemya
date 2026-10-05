/**
 * A minimal PMTiles v3 writer (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md):
 * everything scripts/build-tiles.mjs needs and nothing more — vector (MVT) tiles, gzip
 * internal and tile compression, no deduplication, no run-length merging. The `pmtiles`
 * package on npm only reads; this is the other half, about a hundred lines.
 *
 * Layout: [127-byte header][root directory][metadata JSON][leaf directories][tile data].
 * The root directory plus header must fit the first 16,384 bytes (the reader's first
 * request), so a large tile set spills its directory into leaf directories.
 */
import { gzipSync } from 'node:zlib';
import { zxyToTileId } from 'pmtiles';

const HEADER_BYTES = 127;
const ROOT_BUDGET = 16384 - HEADER_BYTES;
const LEAF_ENTRIES = 4096;
const COMPRESSION_GZIP = 2;
const TILE_TYPE_MVT = 1;

function varint(out, value) {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

/** entries: { tileId, offset, length, runLength }, sorted by tileId. */
function serializeDirectory(entries) {
  const out = [];
  varint(out, entries.length);
  let last = 0;
  for (const e of entries) { varint(out, e.tileId - last); last = e.tileId; }
  for (const e of entries) varint(out, e.runLength);
  for (const e of entries) varint(out, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i > 0 && e.offset === entries[i - 1].offset + entries[i - 1].length) varint(out, 0);
    else varint(out, e.offset + 1);
  }
  return gzipSync(Buffer.from(out));
}

/**
 * tiles: [{ z, x, y, data: Buffer }] where data is an UNCOMPRESSED MVT.
 * Returns the whole archive as a Buffer.
 */
export function writePmtiles(tiles, { metadata, bounds, minZoom, maxZoom, center }) {
  const sorted = tiles
    .map(t => ({ tileId: zxyToTileId(t.z, t.x, t.y), data: gzipSync(t.data, { level: 9 }) }))
    .sort((a, b) => a.tileId - b.tileId);

  const entries = [];
  const chunks = [];
  let offset = 0;
  for (const t of sorted) {
    entries.push({ tileId: t.tileId, offset, length: t.data.length, runLength: 1 });
    chunks.push(t.data);
    offset += t.data.length;
  }
  const tileData = Buffer.concat(chunks);

  let root = serializeDirectory(entries);
  let leaves = Buffer.alloc(0);
  if (root.length > ROOT_BUDGET) {
    const leafBuffers = [];
    const rootEntries = [];
    let leafOffset = 0;
    for (let i = 0; i < entries.length; i += LEAF_ENTRIES) {
      const leaf = serializeDirectory(entries.slice(i, i + LEAF_ENTRIES));
      rootEntries.push({ tileId: entries[i].tileId, offset: leafOffset, length: leaf.length, runLength: 0 });
      leafBuffers.push(leaf);
      leafOffset += leaf.length;
    }
    leaves = Buffer.concat(leafBuffers);
    root = serializeDirectory(rootEntries);
    if (root.length > ROOT_BUDGET) throw new Error('pmtiles: root directory too large — raise LEAF_ENTRIES');
  }

  const meta = gzipSync(Buffer.from(JSON.stringify(metadata)));

  const header = Buffer.alloc(HEADER_BYTES);
  header.write('PMTiles', 0, 'latin1');
  header.writeUInt8(3, 7);
  const rootOffset = HEADER_BYTES;
  const metaOffset = rootOffset + root.length;
  const leafOffset = metaOffset + meta.length;
  const dataOffset = leafOffset + leaves.length;
  const u64 = (value, at) => header.writeBigUInt64LE(BigInt(value), at);
  u64(rootOffset, 8); u64(root.length, 16);
  u64(metaOffset, 24); u64(meta.length, 32);
  u64(leafOffset, 40); u64(leaves.length, 48);
  u64(dataOffset, 56); u64(tileData.length, 64);
  u64(entries.length, 72); u64(entries.length, 80); u64(entries.length, 88);
  header.writeUInt8(1, 96);                 // clustered: tile data is in tile-id order
  header.writeUInt8(COMPRESSION_GZIP, 97);  // internal compression
  header.writeUInt8(COMPRESSION_GZIP, 98);  // tile compression
  header.writeUInt8(TILE_TYPE_MVT, 99);
  header.writeUInt8(minZoom, 100);
  header.writeUInt8(maxZoom, 101);
  const e7 = v => Math.round(v * 1e7);
  header.writeInt32LE(e7(bounds[0]), 102); header.writeInt32LE(e7(bounds[1]), 106);
  header.writeInt32LE(e7(bounds[2]), 110); header.writeInt32LE(e7(bounds[3]), 114);
  header.writeUInt8(center.zoom, 118);
  header.writeInt32LE(e7(center.lon), 119); header.writeInt32LE(e7(center.lat), 123);

  return Buffer.concat([header, root, meta, leaves, tileData]);
}
