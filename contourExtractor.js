/**
 * Contour extraction from image data — ported from sketch.js (p5).
 * Produces an edge/contour map for use as a texture in the shader.
 */

const DEFAULT_PARAMS = {
  gridRes: 120,
  edgeThresh: 30,
  minLen: 3,
  isoCount: 7,
  temporalBlend: 0.92,
};

export function createContourExtractor(videoAspect = 4 / 3, params = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  let GRID_W = p.gridRes;
  let GRID_H = Math.round(p.gridRes / videoAspect);
  let total = GRID_W * GRID_H;
  let bri = new Float32Array(total);
  let briPrev = new Float32Array(total);
  let edge = new Uint8Array(total);
  let visited = new Uint8Array(total);
  let frameCounter = 0;

  const dx8 = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dy8 = [-1, -1, -1, 0, 0, 1, 1, 1];

  function recalcGrid(aspect) {
    GRID_W = p.gridRes;
    GRID_H = Math.round(p.gridRes / aspect);
    total = GRID_W * GRID_H;
    bri = new Float32Array(total);
    briPrev = new Float32Array(total);
    edge = new Uint8Array(total);
    visited = new Uint8Array(total);
  }

  /**
   * Extract contour paths from pixel data (RGBA, width * height * 4).
   * Returns { paths: number[][] (flat [x,y,x,y,...] per path), edgeMap: Uint8Array, width, height }
   */
  function extractContours(pixels, width, height) {
    if (width !== GRID_W || height !== GRID_H) {
      recalcGrid(width / height);
    }
    const w = GRID_W;
    const h = GRID_H;

    for (let k = 0; k < total; k++) {
      const i4 = k << 2;
      bri[k] = (pixels[i4] + pixels[i4 + 1] + pixels[i4 + 2]) * 0.3333;
    }
    if (frameCounter > 1 && briPrev.length === total) {
      const tb = p.temporalBlend;
      for (let k = 0; k < total; k++) {
        bri[k] = tb * briPrev[k] + (1 - tb) * bri[k];
      }
    }
    briPrev.set(bri);

    edge.fill(0);
    visited.fill(0);

    const et = p.edgeThresh;
    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const k = j * w + i;
        const gx =
          -bri[k - w - 1] +
          bri[k - w + 1] -
          2 * bri[k - 1] +
          2 * bri[k + 1] -
          bri[k + w - 1] +
          bri[k + w + 1];
        const gy =
          -bri[k - w - 1] -
          2 * bri[k - w] -
          bri[k - w + 1] +
          bri[k + w - 1] +
          2 * bri[k + w] +
          bri[k + w + 1];
        const mag = gx * gx + gy * gy;
        const darkness = 1 - bri[k] * 0.00392;
        const thresh = et + (1 - darkness) * 30;
        if (mag > thresh * thresh) edge[k] = 1;
      }
    }

    const isoCount = p.isoCount;
    for (let li = 0; li < isoCount; li++) {
      const lv = 25 + li * (200 / Math.max(isoCount, 1));
      for (let j = 1; j < h - 1; j++) {
        const row = j * w;
        for (let i = 1; i < w - 2; i++) {
          const k = row + i;
          if ((bri[k] < lv) !== (bri[k + 1] < lv)) edge[k] = 1;
        }
      }
    }

    const result = [];
    const minL = p.minLen * 2;

    for (let j = 1; j < h - 1; j++) {
      for (let i = 1; i < w - 1; i++) {
        const k = j * w + i;
        if (!edge[k] || visited[k]) continue;
        const path = [];
        let cx = i;
        let cy = j;
        let prev = 0;
        for (let it = 0; it < 600; it++) {
          const ck = cy * w + cx;
          if (visited[ck] && it > 0) break;
          visited[ck] = 1;
          path.push(cx, cy);
          let found = false;
          for (let d = 0; d < 8; d++) {
            const nd = (prev + 5 + d) & 7;
            const nx = cx + dx8[nd];
            const ny = cy + dy8[nd];
            if (nx >= 1 && nx < w - 1 && ny >= 1 && ny < h - 1) {
              const nk = ny * w + nx;
              if (edge[nk] && !visited[nk]) {
                prev = nd;
                cx = nx;
                cy = ny;
                found = true;
                break;
              }
            }
          }
          if (!found) break;
        }
        if (path.length >= minL) result.push(path);
      }
    }

    frameCounter++;
    return {
      paths: result,
      edgeMap: new Uint8Array(edge),
      width: w,
      height: h,
    };
  }

  return {
    extractContours,
    getGridSize: () => ({ w: GRID_W, h: GRID_H }),
    setVideoAspect(aspect) {
      recalcGrid(aspect);
    },
  };
}

/**
 * Draw contour edge map to a 2D canvas for use as texture.
 * canvas: HTMLCanvasElement (will be resized to width x height)
 * edgeMap: Uint8Array (width * height), 1 = edge
 */
export function drawContourMapToCanvas(canvas, edgeMap, width, height) {
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const imgData = ctx.createImageData(width, height);
  const d = imgData.data;
  for (let i = 0; i < edgeMap.length; i++) {
    const v = edgeMap[i] ? 255 : 0;
    d[i * 4] = v;
    d[i * 4 + 1] = v;
    d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
}
