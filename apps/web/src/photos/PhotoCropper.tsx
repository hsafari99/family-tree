import { useEffect, useRef, useState } from 'react';
import { type CropBox, initialCrop, moveCrop, type Size, ZOOM_MAX, zoomCrop } from './crop';

const VIEW = 320;
const KEYS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** Spec §6 "crop in the browser": a square crop with zoom, drag and arrow keys (decision 5). */
export function PhotoCropper({
  file,
  busy,
  onDone,
  onCancel,
}: {
  file: File;
  busy: boolean;
  onDone: (box: CropBox | null) => void;
  onCancel: () => void;
}) {
  // Created and revoked in one effect: StrictMode runs effects twice in dev, and a URL made in
  // useMemo would be revoked by the first cleanup and never recreated.
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const [img, setImg] = useState<Size | null>(null);
  const [box, setBox] = useState<CropBox | null>(null);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const scale = img ? VIEW / Math.max(img.width, img.height) : 1;

  return (
    <div className="cropper">
      <p>Choose the part to keep, or use the whole photo.</p>
      <div
        className="crop-view"
        style={img ? { width: img.width * scale, height: img.height * scale } : undefined}
      >
        {url && (
          <img
            src={url}
            alt="The chosen photo"
            onLoad={(e) => {
              const s = {
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              };
              setImg(s);
              setBox(initialCrop(s));
            }}
          />
        )}
        {img && box && (
          <div
            className="crop-box"
            role="group"
            tabIndex={0}
            aria-label="Crop area. Use the arrow keys to move it."
            style={{
              left: box.x * scale,
              top: box.y * scale,
              width: box.size * scale,
              height: box.size * scale,
            }}
            onKeyDown={(e) => {
              const d = KEYS[e.key];
              if (!d) return;
              e.preventDefault();
              const step = Math.max(1, Math.round(box.size / 20));
              setBox(moveCrop(box, img, d[0] * step, d[1] * step));
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture?.(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              setBox(
                (b) => b && moveCrop(b, img, (e.clientX - d.x) / scale, (e.clientY - d.y) / scale),
              );
              drag.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          />
        )}
      </div>
      <label>
        Zoom{' '}
        <input
          type="range"
          min={1}
          max={ZOOM_MAX}
          step={0.1}
          value={zoom}
          disabled={!img}
          onChange={(e) => {
            const z = Number(e.target.value);
            setZoom(z);
            if (img && box) setBox(zoomCrop(box, img, z));
          }}
        />
      </label>
      <p>
        <button type="button" disabled={!box || busy} onClick={() => onDone(box)}>
          Upload this part
        </button>{' '}
        <button type="button" className="secondary" disabled={busy} onClick={() => onDone(null)}>
          Use the whole photo
        </button>{' '}
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </p>
    </div>
  );
}
