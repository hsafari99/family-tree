import { existsSync } from 'node:fs';
import sharp from 'sharp';
import { statePath } from './env';

/** Hidden in the test photo's EXIF; the stored photo must not contain it (spec §8). */
export const SECRET_MARKER = 'e2e-secret-marker';
export const GPS_JPEG = statePath('gps.jpg');

/** A JPEG with camera, copyright and GPS EXIF, written once into e2e/.state/. */
export async function writeFixtures() {
  if (existsSync(GPS_JPEG)) return;
  await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#7a5' } })
    .jpeg()
    .withExif({
      IFD0: { Copyright: SECRET_MARKER, Make: 'E2ECam' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '51/1 30/1 0/1',
        GPSLongitudeRef: 'W',
        GPSLongitude: '0/1 7/1 0/1',
      },
    })
    .toFile(GPS_JPEG);
}
