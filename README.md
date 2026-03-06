# Mondrian — Shader + Webcam Contours

Noise shader driven by webcam contour extraction (from the p5 sketch). No build step.

## How to run

**You need a local server** — browsers block camera access and ES modules when opening files via `file://`.

### Option 1: npx (Node)

```bash
npx serve .
```

Then open **http://localhost:3000** (or the URL shown). Use **index.html** for the shader + contours, or **index-p5.html** for the original p5 sketch only.

### Option 2: Python 3

```bash
python3 -m http.server 8000
```

Open **http://localhost:8000** and choose **index.html** or **index-p5.html**.

### Option 3: VS Code Live Server

Right‑click **index.html** → “Open with Live Server”.

---

## Pages

| File | What it runs |
|------|----------------|
| **index.html** | Full-screen noise shader; webcam contours modulate the pattern. **Ripples** are driven by body pose keypoints (when pose-detection is loaded) or a single contour centroid. No mouse. |
| **index-p5.html** | Original p5.js sketch: webcam contours drawn on canvas, parametric panel, SVG export. |

The **HeaderShader.tsx** component is for use inside a React/Next app (e.g. with `@/contexts/ScrollContext`). The standalone **index.html** reproduces the same shader + contour behavior without React.

### Optional: body pose ripples

By default the app uses a **single ripple** at the **centroid of contour pixels** (center of detected edges). For **one ripple per body pose keypoint** (33 points with BlazePose — nose, shoulders, elbows, wrists, hips, knees, ankles, etc.), load TensorFlow and pose-detection before `main.js`. Example (add in `index.html` before the `main.js` script):

```html
<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.11.0"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.11.0"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.11.0"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.0"></script>
```

If the global `poseDetection` is present, the app uses BlazePose and creates exactly 33 ripples (one per keypoint).
