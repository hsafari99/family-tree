import { crc32, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
  /** 0 = stored, 8 = deflated. */
  method: number;
  flags: number;
}

/** Reads a whole ZIP from its central directory and checks every entry's size and CRC-32. */
export function readZip(buf: Buffer): ZipEntry[] {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('zip: no end of central directory');
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central header');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (buf.readUInt32LE(offset) !== 0x04034b50) throw new Error(`zip: bad local header (${name})`);
    const start = offset + 30 + buf.readUInt16LE(offset + 26) + buf.readUInt16LE(offset + 28);
    const raw = buf.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : undefined;
    if (!data) throw new Error(`zip: unsupported method ${method} (${name})`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`zip: bad data (${name})`);
    out.push({ name, data, method, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
