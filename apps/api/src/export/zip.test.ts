import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readZip } from '../../test/zip-reader.js';
import { dosDateTime, ZipAborted, ZipWriter } from './zip.js';

const NOW = new Date('2026-11-10T09:05:03Z');

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function sampleZip() {
  const zip = new ZipWriter(NOW);
  const out = collect(zip.stream); // read while writing: add() waits for the reader
  const text = Buffer.from('0 HEAD\r\n1 CHAR UTF-8\r\n'.repeat(200), 'utf8');
  const photo = Buffer.from(Array.from({ length: 100_000 }, (_, i) => (i * 7919) % 251));
  await zip.add('tree.ged', text, { compress: true });
  await zip.add('photos/I1-1.webp', photo);
  await zip.add('tree.json', Buffer.from('{"name":"Zoë 🌳"}', 'utf8'), { compress: true });
  await zip.finish();
  return { buf: await out, text, photo };
}

function hasUnzip(): boolean {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('dosDateTime', () => {
  it('packs UTC date and time with 2-second resolution', () => {
    expect(dosDateTime(NOW)).toEqual({
      date: (46 << 9) | (11 << 5) | 10,
      time: (9 << 11) | (5 << 5) | 1,
    });
  });

  it('writes dates before 1980 as 1980-01-01', () => {
    expect(dosDateTime(new Date('1970-06-15T00:00:00Z')).date).toBe((0 << 9) | (1 << 5) | 1);
  });
});

describe('ZipWriter', () => {
  it('round-trips stored and deflated entries with UTF-8 names flagged', async () => {
    const { buf, text, photo } = await sampleZip();
    const entries = readZip(buf);
    expect(entries.map((e) => e.name)).toEqual(['tree.ged', 'photos/I1-1.webp', 'tree.json']);
    expect(entries[0]!.method).toBe(8);
    expect(entries[0]!.data.equals(text)).toBe(true);
    expect(entries[1]!.method).toBe(0);
    expect(entries[1]!.data.equals(photo)).toBe(true);
    expect(entries[2]!.data.toString('utf8')).toBe('{"name":"Zoë 🌳"}');
    for (const e of entries) expect(e.flags & 0x0800).toBe(0x0800);
    expect(buf.length).toBeLessThan(text.length + photo.length); // the text compressed
  });

  it.skipIf(!hasUnzip())('is accepted by unzip -t', async () => {
    const { buf } = await sampleZip();
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    try {
      writeFileSync(join(dir, 'a.zip'), buf);
      const out = execFileSync('unzip', ['-t', join(dir, 'a.zip')], { encoding: 'utf8' });
      expect(out).toMatch(/No errors detected/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses unsafe and duplicate names', async () => {
    const zip = new ZipWriter(NOW);
    zip.stream.resume();
    for (const bad of ['/etc/passwd', '../x', 'a/../b', 'a\\b', 'a b', '', 'photos/./x']) {
      await expect(zip.add(bad, Buffer.from('x'))).rejects.toThrow(/unsafe entry name/);
    }
    await zip.add('ok.txt', Buffer.from('x'));
    await expect(zip.add('ok.txt', Buffer.from('y'))).rejects.toThrow(/duplicate entry/);
  });

  it('waits for the reader (backpressure) and continues once it reads', async () => {
    const zip = new ZipWriter(NOW);
    let done = false;
    const p = zip.add('big.bin', Buffer.alloc(5_000_000)).then(() => {
      done = true;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(done).toBe(false);
    zip.stream.resume();
    await p;
    expect(done).toBe(true);
  });

  it('rejects with ZipAborted when destroyed while waiting, and on every later add', async () => {
    const zip = new ZipWriter(NOW);
    const p = zip.add('big.bin', Buffer.alloc(5_000_000));
    zip.abort();
    await expect(p).rejects.toBeInstanceOf(ZipAborted);
    await expect(zip.add('more.bin', Buffer.from('x'))).rejects.toBeInstanceOf(ZipAborted);
  });
});
