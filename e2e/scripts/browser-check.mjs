// Phase 7 Task 1 gate: the Playwright browser must run on this CPU (no AVX2).
// Usage: pnpm --filter @family-tree/e2e exec node scripts/browser-check.mjs
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ timeout: 30_000 });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(30_000);
  await page.setContent(
    '<canvas id="c" width="300" height="150"></canvas>' +
      '<script>const x = document.getElementById("c").getContext("2d");' +
      'x.fillStyle = "#c33"; x.fillRect(0, 0, 300, 150);' +
      'x.font = "20px sans-serif"; x.fillStyle = "#fff"; x.fillText("Zoë 🌳", 20, 80);</script>',
  );
  const png = await page.screenshot();
  const result = await page.evaluate(async () => {
    const wasm = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    const worker = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker timed out')), 10_000);
      const src = URL.createObjectURL(
        new Blob(['postMessage(6 * 7)'], { type: 'text/javascript' }),
      );
      const w = new Worker(src);
      w.onmessage = (e) => {
        clearTimeout(timer);
        resolve(e.data);
      };
      w.onerror = (e) => {
        clearTimeout(timer);
        reject(new Error(`worker failed: ${e.message}`));
      };
    });
    // A little real work for the JIT and the SIMD paths of typed arrays.
    const a = new Float64Array(1_000_000).map((_, i) => Math.sin(i));
    return { wasm, worker, sum: Math.round(a.reduce((s, v) => s + v, 0)) };
  });
  console.log(JSON.stringify({ version: browser.version(), png: png.length > 1000, ...result }));
} finally {
  await browser.close();
}
