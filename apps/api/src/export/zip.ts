import { PassThrough } from 'node:stream';
import { crc32, deflateRawSync } from 'node:zlib';

/** The stream was destroyed (the client went away, or the export failed) before the end. */
export class ZipAborted extends Error {
  override name = 'ZipAborted';
}

/** The archive would need ZIP64 (over 4 GiB or 65,535 entries), which this writer doesn't do. */
export class ZipTooLarge extends Error {
  override name = 'ZipTooLarge';
}

const MAX_U32 = 0xffff_ffff;
const MAX_ENTRIES = 0xffff;
const UTF8_NAMES = 0x0800;
const VERSION = 20; // PKZIP 2.0: deflate
const MADE_BY_UNIX = (3 << 8) | VERSION;
const FILE_MODE = 0o100644;
// Plain relative paths only: no leading "/", no "." or ".." segment, no backslash or space.
const SAFE_NAME = /^(?!\/)(?!(?:.*\/)?\.\.?(?:\/|$))[A-Za-z0-9._\-/]+$/;

interface Central {
  name: Buffer;
  crc: number;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

/** MS-DOS date and time (UTC: ZIP has no time zone), 2-second resolution, 1980–2107. */
export function dosDateTime(d: Date): { date: number; time: number } {
  const y = d.getUTCFullYear();
  if (y < 1980) return { date: (0 << 9) | (1 << 5) | 1, time: 0 };
  const year = Math.min(y, 2107);
  return {
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
  };
}

/**
 * A streaming ZIP writer (decision 7). Each entry is in memory when added (one photo, or the
 * GEDCOM/JSON), so headers carry the real sizes and CRC and no data descriptors are needed.
 * `add` resolves once the reader has taken the bytes, so memory stays at about one entry.
 */
export class ZipWriter {
  /** Pipe this to the response. */
  readonly stream = new PassThrough();
  private offset = 0;
  private readonly entries: Central[] = [];
  private readonly names = new Set<string>();
  private readonly stamp: { date: number; time: number };
  private finished = false;

  constructor(now: Date = new Date()) {
    this.stamp = dosDateTime(now);
  }

  /** Text compresses well (`compress: true`); WebP photos are stored as they are. */
  async add(name: string, data: Uint8Array, { compress = false } = {}): Promise<void> {
    if (this.stream.destroyed) throw new ZipAborted('zip stream closed');
    if (this.finished) throw new Error('zip: already finished');
    if (!SAFE_NAME.test(name)) throw new Error(`zip: unsafe entry name ${JSON.stringify(name)}`);
    if (this.names.has(name)) throw new Error(`zip: duplicate entry ${name}`);
    if (this.entries.length >= MAX_ENTRIES) throw new ZipTooLarge('too many entries');
    const body = compress ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const offset = this.offset;
    if (offset + 30 + nameBuf.length + body.length > MAX_U32) {
      throw new ZipTooLarge('archive over 4 GiB');
    }
    const method = compress ? 8 : 0;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(VERSION, 4);
    h.writeUInt16LE(UTF8_NAMES, 6);
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(this.stamp.time, 10);
    h.writeUInt16LE(this.stamp.date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(body.length, 18);
    h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(nameBuf.length, 26);
    h.writeUInt16LE(0, 28);
    this.names.add(name);
    this.entries.push({
      name: nameBuf,
      crc,
      method,
      compressed: body.length,
      size: data.length,
      offset,
    });
    await this.write(h);
    await this.write(nameBuf);
    await this.write(body);
  }

  /** Writes the central directory and ends the stream. */
  async finish(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(MADE_BY_UNIX, 4);
      c.writeUInt16LE(VERSION, 6);
      c.writeUInt16LE(UTF8_NAMES, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(this.stamp.time, 12);
      c.writeUInt16LE(this.stamp.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.compressed, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.name.length, 28);
      // extra (30), comment (32), disk (34) and internal attributes (36) stay 0
      c.writeUInt32LE((FILE_MODE << 16) >>> 0, 38);
      c.writeUInt32LE(e.offset, 42);
      await this.write(c);
      await this.write(e.name);
    }
    const size = this.offset - start;
    if (this.offset + 22 > MAX_U32) throw new ZipTooLarge('archive over 4 GiB');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(size, 12);
    end.writeUInt32LE(start, 16);
    await this.write(end);
    this.stream.end();
  }

  /** Stops the archive: the reader sees an error or a premature end, never a valid file. */
  abort(err?: Error): void {
    this.stream.destroy(err);
  }

  private write(chunk: Uint8Array): Promise<void> {
    if (this.stream.destroyed) return Promise.reject(new ZipAborted('zip stream closed'));
    this.offset += chunk.length;
    if (this.stream.write(chunk)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const done = (err?: Error) => {
        this.stream.off('drain', onDrain);
        this.stream.off('close', onClose);
        if (err) reject(err);
        else resolve();
      };
      const onDrain = () => done();
      const onClose = () => done(new ZipAborted('zip stream closed'));
      this.stream.on('drain', onDrain);
      this.stream.on('close', onClose);
    });
  }
}
