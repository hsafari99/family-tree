import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';

/** Written into every EXIF fixture; must never appear in a stored image. */
export const SECRET = 'secret-copyright-marker';
const GPS = {
  GPSLatitudeRef: 'N',
  GPSLatitude: '51/1 30/1 0/1',
  GPSLongitudeRef: 'W',
  GPSLongitude: '0/1 7/1 0/1',
};

const canvas = (width: number, height: number, background = '#3366cc') =>
  sharp({ create: { width, height, channels: 3, background } });

const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:rights>${SECRET}</dc:rights></rdf:Description></rdf:RDF></x:xmpmeta>`;

/**
 * A JPEG with camera, copyright and GPS EXIF, a Display P3 ICC profile and an XMP packet holding
 * SECRET, optionally with an EXIF orientation.
 */
export function jpegWithExif({
  width = 400,
  height = 200,
  orientation,
}: { width?: number; height?: number; orientation?: number } = {}) {
  let img = canvas(width, height).jpeg();
  if (orientation) img = img.withMetadata({ orientation });
  return img
    .withExif({ IFD0: { Copyright: SECRET, Make: 'TestCam' }, IFD3: GPS })
    .withIccProfile('p3') // sharp ships a P3 profile under this name
    .withXmp(XMP)
    .toBuffer();
}

/** A PNG with a tEXt chunk and an eXIf chunk, both holding SECRET (inserted after IHDR). */
export async function pngWithTextChunks(): Promise<Buffer> {
  const plain = await png(64, 64);
  const ihdrEnd = 8 + 4 + 4 + 13 + 4; // signature, then IHDR (length, type, data, crc)
  const exif = (await sharp(await jpegWithExif()).metadata()).exif!;
  return Buffer.concat([
    plain.subarray(0, ihdrEnd),
    pngChunk('tEXt', Buffer.from(`Comment\0${SECRET}`, 'latin1')),
    pngChunk('eXIf', exif.subarray(6)), // the TIFF part, without "Exif\0\0"
    plain.subarray(ihdrEnd),
  ]);
}
export const png = (w = 300, h = 300) => canvas(w, h, '#cc6633').png().toBuffer();
export const webp = (w = 300, h = 300) => canvas(w, h, '#33cc66').webp().toBuffer();
export const gif = () => canvas(20, 20).gif().toBuffer();

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

/** A PNG whose header claims width × height but carries no pixels: the decompression-bomb shape. */
export function pngHeaderOnly(width: number, height: number): Buffer {
  const chunk = pngChunk;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(0))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
