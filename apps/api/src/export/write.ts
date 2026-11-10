import type { ExportData } from '@family-tree/shared';
import type { ObjectStore } from '../storage/objects.js';
import { buildGedcom, personXrefs, photoFileName } from './gedcom.js';
import type { LoadedExport } from './load.js';
import type { ZipWriter } from './zip.js';

/** ASCII only, so Content-Disposition needs no encoding. */
export const exportFileName = (now: Date) => `family-tree-${now.toISOString().slice(0, 10)}.zip`;

/**
 * Writes the archive: the photos first, one in memory at a time, then tree.ged and tree.json,
 * which name only the photos that were really written (a missing object gets `file: null`).
 */
export async function writeExport(
  zip: ZipWriter,
  loaded: LoadedExport,
  store: ObjectStore,
  { exporterName, now }: { exporterName: string; now: Date },
): Promise<{ photos: number; missing: number }> {
  const xrefs = personXrefs(loaded.data.persons);
  const perPerson = new Map<string, number>();
  const written: ExportData['photos'] = [];
  let missing = 0;
  for (const photo of loaded.data.photos) {
    const body = await store.get(loaded.photoKeys.get(photo.id)!);
    if (body === null) {
      missing++;
      written.push({ ...photo, file: null });
      continue;
    }
    const n = (perPerson.get(photo.personId) ?? 0) + 1;
    perPerson.set(photo.personId, n);
    const file = photoFileName(xrefs.get(photo.personId)!, n);
    await zip.add(file, body);
    written.push({ ...photo, file });
  }
  const data: ExportData = { ...loaded.data, photos: written };
  await zip.add('tree.ged', Buffer.from(buildGedcom(data, { exporterName, now }), 'utf8'), {
    compress: true,
  });
  await zip.add('tree.json', Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8'), {
    compress: true,
  });
  await zip.finish();
  return { photos: written.length - missing, missing };
}
