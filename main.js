/**
 * Standalone runner: WebGL noise shader driven by webcam contours.
 * Open index.html via a local server (see README).
 */

import {
  createContourExtractor,
  drawContourMapToCanvas,
} from "./contourExtractor.js";

const VERTEX_SHADER = `
  attribute vec2 position;
  varying vec2 vUv;
  void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  #define MAX_POSE_POINTS 33
  uniform vec2 u_resolution;
  uniform float u_opacity;
  uniform float u_time;
  uniform vec2 u_posePoints[MAX_POSE_POINTS];
  uniform float u_posePointCount;
  uniform sampler2D u_contour;
  uniform float u_contourStrength;
  uniform float u_rippleFreqCenter;
  uniform float u_rippleFreqEdge;
  uniform float u_rippleAmp;
  uniform float u_rippleFalloff;
  uniform float u_rippleSinAmp;
  uniform float u_rippleSinFreq;
  uniform float u_flowSpeed;
  uniform float u_obstacleRadius;
  uniform float u_obstacleSoft;
  uniform float u_ripplePresence;
  varying vec2 vUv;

  vec2 random2(vec2 st) {
    vec2 p = vec2(dot(st, vec2(127.1, 311.7)), dot(st, vec2(269.5, 183.3)));
    vec2 t = vec2(fract(sin(p.x) * 43758.5453), fract(sin(p.y) * 43758.5453));
    return t * t * 4.0;
  }

  float noise(vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(dot(random2(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
          dot(random2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
      mix(dot(random2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
          dot(random2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
  }

  vec2 rippleDisplacement(vec2 uv, vec2 center) {
    vec2 toCenter = uv - center;
    float d = length(toCenter);
    float freq = mix(u_rippleFreqCenter, u_rippleFreqEdge, smoothstep(0.0, 0.5, d));
    float n = noise(vec2(d * freq, 0.0));
    float amp = u_rippleAmp * (1.0 + sin(u_time * u_rippleSinFreq) * u_rippleSinAmp);
    float wave = (n * 2.0 - 1.0) * amp * exp(-d * u_rippleFalloff) * u_ripplePresence;
    return normalize(toCenter + 0.001) * wave;
  }

  vec3 colormap(float x, float scroll) {
    float t = scroll * 0.3;
    vec3 blue = vec3(0.15, 0.39, 0.92);
    vec3 white = vec3(0.98, 0.97, 0.94);
    if (x < 0.2 * scroll) return vec3(0.86, 0.15, 0.12);
    else if (x < 0.35 * scroll) return vec3(0.98, 0.80, 0.15);
    else if (x < 0.5 * scroll) return blue;
    else if (x < t) return mix(blue, white, (x - 0.5 * scroll) / max(t - 0.5 * scroll, 0.001));
    else return white;
  }

  float fbm1(vec2 _st) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100.0);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    v += a * noise(_st); _st = rot * _st * 2.0 + shift; a *= 0.4;
    v += a * noise(_st); _st = rot * _st * 2.0 + shift; a *= 0.4;
    v += a * noise(_st); _st = rot * _st * 2.0 + shift; a *= 0.4;
    v += a * noise(_st);
    return v;
  }

  void main() {
    float aspect = u_resolution.x / u_resolution.y;
    vec2 uv = vUv * vec2(aspect, 1.0);
    vec2 aspectUV = uv;
    for (int i = 0; i < MAX_POSE_POINTS; i++) {
      if (float(i) < u_posePointCount) {
        vec2 center = vec2(u_posePoints[i].x * aspect, u_posePoints[i].y);
        aspectUV += rippleDisplacement(uv, center);
      }
    }
    vec2 screenSpace = (aspectUV - 0.5 * vec2(aspect, 1.0)) / min(aspect, 1.0);
    screenSpace *= 0.5;
    float dMin = 1.0;
    for (int j = 0; j < MAX_POSE_POINTS; j++) {
      if (float(j) < u_posePointCount) {
        vec2 obs = vec2(u_posePoints[j].x * aspect, u_posePoints[j].y);
        dMin = min(dMin, length(aspectUV - obs));
      }
    }
    float flow = u_time * u_flowSpeed;
    flow *= 1.0 - smoothstep(u_obstacleRadius, u_obstacleRadius + u_obstacleSoft, dMin);
    screenSpace.x -= flow;
    float angle = noise(vec2(0.15, 0.5)) * 6.28318;
    mat2 rot = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    screenSpace = rot * screenSpace;
    float scale = 6.0 + 3.2 * noise(vec2(0.2, 3.5));
    screenSpace *= scale;

    float contourVal = texture2D(u_contour, vUv).r;
    float contourInfluence = contourVal * u_contourStrength;
    vec2 st = screenSpace;
    st += contourInfluence * vec2(noise(screenSpace * 2.0), noise(screenSpace * 2.0 + 10.0)) * 0.15;
    vec2 q = vec2(fbm1(st * 0.1 + vec2(0.0, 0.0)), fbm1(st + vec2(5.2, 1.3)));
    vec2 r = vec2(fbm1(st * 0.1 + 4.0 * q + vec2(1.7, 9.2)),
                  fbm1(st + 4.0 * q + vec2(8.3, 2.8)));
    vec2 s = vec2(fbm1(st + 5.0 * r + vec2(21.7, 90.2)),
                  fbm1(st * 0.05 + 5.0 * r + vec2(80.3, 20.8))) * 0.25;
    float _pattern = fbm1(st * 0.05 + 4.0 * s);
    _pattern = mix(_pattern, _pattern * (1.0 + contourInfluence * 0.8), contourInfluence);

    vec3 colour = vec3(_pattern) * 2.0;
    colour.r -= dot(q, r) * 15.0;
    float p2 = fbm1(r * 0.15 + vec2(0.1, 0.2));
    colour = mix(colour, vec3(p2, dot(q, r) * 15.0, -0.1), 0.5);
    colour -= q.y * 1.5;
    colour = mix(colour, vec3(0.2, 0.2, 0.2), (clamp(q.x, -1.0, 0.0)) * 3.0);
    colour = -colour + (abs(colour) * 2.0);
    float lum = dot(colour, vec3(0.333));
    float shade = clamp(lum / 2.0, 0.0, 1.0);
    if (shade != shade) shade = 0.5;
    vec3 col = colormap(shade, u_opacity);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const OPACITY_EASE = 0.06;

const params = {
  rippleFreqCenter: 0.45,
  rippleFreqEdge: 4.2,
  rippleAmp: 0.42,
  rippleFalloff: 0.5,
  rippleSinAmp: 0.2,
  rippleSinFreq: 1.2,
  flowSpeed: 0.28,
  obstacleRadius: 0.06,
  obstacleSoft: 0.22,
  contourStrength: 0.7,
};

const SLIDER_CONFIG = [
  { id: "rippleFreqCenter", min: 0.1, max: 2, step: 0.05 },
  { id: "rippleFreqEdge", min: 1, max: 10, step: 0.1 },
  { id: "rippleAmp", min: 0.05, max: 1.2, step: 0.01 },
  { id: "rippleFalloff", min: 0.1, max: 2, step: 0.05 },
  { id: "rippleSinAmp", min: 0, max: 0.8, step: 0.02 },
  { id: "rippleSinFreq", min: 0, max: 3, step: 0.1 },
  { id: "flowSpeed", min: 0, max: 0.6, step: 0.01 },
  { id: "obstacleRadius", min: 0.02, max: 0.35, step: 0.01 },
  { id: "obstacleSoft", min: 0.05, max: 0.5, step: 0.01 },
  { id: "contourStrength", min: 0, max: 1, step: 0.02 },
];

const STORAGE_KEY = "mondrian-pizza-params";

function randomIn(min, max, step) {
  const n = (max - min) / step;
  return min + Math.round(Math.random() * n) * step;
}

function randomiseParams() {
  SLIDER_CONFIG.forEach(({ id, min, max, step }) => {
    params[id] = parseFloat(randomIn(min, max, step).toFixed(4));
  });
}

function saveParams() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params, null, 2));
  } catch (e) {}
  const blob = new Blob([JSON.stringify(params, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mondrian-pizza-params.json";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

function loadParamsFromObject(obj) {
  SLIDER_CONFIG.forEach(({ id, min, max, step }) => {
    if (obj[id] != null && typeof obj[id] === "number") {
      params[id] = Math.max(min, Math.min(max, obj[id]));
    }
  });
}

function loadParams() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      loadParamsFromObject(JSON.parse(s));
      return true;
    }
  } catch (e) {}
  return false;
}

function loadParamsFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadParamsFromObject(JSON.parse(reader.result));
      syncPanelFromParams();
    } catch (e) {}
  };
  reader.readAsText(file);
}

function syncPanelFromParams() {
  const panel = document.getElementById("param-panel");
  if (!panel) return;
  SLIDER_CONFIG.forEach(({ id, min, max, step }) => {
    const v = params[id];
    const input = panel.querySelector(`input[data-id="${id}"]`);
    const span = panel.querySelector(`.val[data-id="${id}"]`);
    if (input) {
      input.value = v;
      input.min = min;
      input.max = max;
      input.step = step;
    }
    if (span) span.textContent = v;
  });
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("Shader compile error:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function sliderHtml(id, label, min, max, value, step) {
  return `<div class="row"><label>${label} <span class="val" data-id="${id}">${value}</span></label>
    <input type="range" data-id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"></div>`;
}

function buildPanel() {
  const panel = document.createElement("div");
  panel.id = "param-panel";
  panel.innerHTML = `
    <div class="panel-actions">
      <button type="button" id="btn-randomise">Randomise</button>
      <button type="button" id="btn-save">Save</button>
      <button type="button" id="btn-load">Load</button>
      <input type="file" id="input-load-file" accept=".json,application/json" style="display:none">
    </div>
    <div class="title">Ripple & noise</div>
    ${sliderHtml("rippleFreqCenter", "Freq center (wide)", 0.1, 2, params.rippleFreqCenter, 0.05)}
    ${sliderHtml("rippleFreqEdge", "Freq edge (tight)", 1, 10, params.rippleFreqEdge, 0.1)}
    ${sliderHtml("rippleAmp", "Amplitude", 0.05, 1.2, params.rippleAmp, 0.01)}
    ${sliderHtml("rippleFalloff", "Falloff", 0.1, 2, params.rippleFalloff, 0.05)}
    <div class="title">Sin modifiers</div>
    ${sliderHtml("rippleSinAmp", "Sin amp", 0, 0.8, params.rippleSinAmp, 0.02)}
    ${sliderHtml("rippleSinFreq", "Sin freq", 0, 3, params.rippleSinFreq, 0.1)}
    <div class="title">Flow & obstacle</div>
    ${sliderHtml("flowSpeed", "Flow speed", 0, 0.6, params.flowSpeed, 0.01)}
    ${sliderHtml("obstacleRadius", "Obstacle radius", 0.02, 0.35, params.obstacleRadius, 0.01)}
    ${sliderHtml("obstacleSoft", "Obstacle soft", 0.05, 0.5, params.obstacleSoft, 0.01)}
    <div class="title">Contour</div>
    ${sliderHtml("contourStrength", "Contour strength", 0, 1, params.contourStrength, 0.02)}
  `;
  panel.querySelectorAll("input[type=range]").forEach((el) => {
    el.addEventListener("input", () => {
      const id = el.dataset.id;
      const v = parseFloat(el.value);
      params[id] = v;
      const span = panel.querySelector(`.val[data-id="${id}"]`);
      if (span) span.textContent = el.value;
    });
  });
  panel.querySelector("#btn-randomise").addEventListener("click", () => {
    randomiseParams();
    syncPanelFromParams();
  });
  panel.querySelector("#btn-save").addEventListener("click", saveParams);
  panel.querySelector("#btn-load").addEventListener("click", () => {
    if (loadParams()) syncPanelFromParams();
    else document.getElementById("input-load-file").click();
  });
  panel.querySelector("#input-load-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) loadParamsFromFile(f);
    e.target.value = "";
  });
  document.body.appendChild(panel);
}

function init() {
  const canvas = document.getElementById("canvas");
  if (!canvas) return;

  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: false });
  if (!gl) {
    document.getElementById("hint").textContent = "WebGL not supported.";
    return;
  }

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (!vs || !fs) return;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

  gl.useProgram(program);

  const posLoc = gl.getAttribLocation(program, "position");
  const resLoc = gl.getUniformLocation(program, "u_resolution");
  const timeLoc = gl.getUniformLocation(program, "u_time");
  const opacityLoc = gl.getUniformLocation(program, "u_opacity");
  const posePointsLoc = gl.getUniformLocation(program, "u_posePoints[0]");
  const posePointCountLoc = gl.getUniformLocation(program, "u_posePointCount");
  const contourLoc = gl.getUniformLocation(program, "u_contour");
  const contourStrengthLoc = gl.getUniformLocation(program, "u_contourStrength");
  const rippleFreqCenterLoc = gl.getUniformLocation(program, "u_rippleFreqCenter");
  const rippleFreqEdgeLoc = gl.getUniformLocation(program, "u_rippleFreqEdge");
  const rippleAmpLoc = gl.getUniformLocation(program, "u_rippleAmp");
  const rippleFalloffLoc = gl.getUniformLocation(program, "u_rippleFalloff");
  const rippleSinAmpLoc = gl.getUniformLocation(program, "u_rippleSinAmp");
  const rippleSinFreqLoc = gl.getUniformLocation(program, "u_rippleSinFreq");
  const flowSpeedLoc = gl.getUniformLocation(program, "u_flowSpeed");
  const obstacleRadiusLoc = gl.getUniformLocation(program, "u_obstacleRadius");
  const obstacleSoftLoc = gl.getUniformLocation(program, "u_obstacleSoft");
  const ripplePresenceLoc = gl.getUniformLocation(program, "u_ripplePresence");

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  const contourTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, contourTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  const contourCanvas = document.createElement("canvas");
  const captureCanvas = document.createElement("canvas");
  const extractor = createContourExtractor(4 / 3, { gridRes: 100, edgeThresh: 30, isoCount: 7, minLen: 3, temporalBlend: 0.92 });

  buildPanel();

  let video = null;
  let contourReady = false;
  let rafId = 0;
  const t0 = performance.now() / 1000;
  let opacity = 1;
  let opacityTarget = 1;
  const MAX_POSE_POINTS = 33;
  const posePointsData = new Float32Array(MAX_POSE_POINTS * 2);
  const posePointsTarget = new Float32Array(MAX_POSE_POINTS * 2);
  let posePointCount = 0;
  const POSE_POINTS_EASE = 0.12;
  let lastContourCount = 0;
  let lastPoseDetected = false;
  let ripplePresence = 0;
  const PRESENCE_EASE = 0.06;
  const MIN_CONTOUR_PIXELS = 180;

  navigator.mediaDevices
    ?.getUserMedia({ video: { facingMode: "user" } })
    .then((stream) => {
      video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      video.play().then(() => { contourReady = true; });
    })
    .catch(() => {
      document.getElementById("hint").textContent = "Camera denied or unavailable — noise only (no contour effect).";
    });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const cw = Math.max(1, Math.floor(w * dpr));
    const ch = Math.max(1, Math.floor(h * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      gl.viewport(0, 0, cw, ch);
    }
  }

  let poseDetector = null;
  let posePending = false;
  let frameCount = 0;

  const poseDetection = window.poseDetection;
  if (typeof poseDetection !== "undefined") {
    poseDetection
      .createDetector(poseDetection.SupportedModels.BlazePose, {
        runtime: "tfjs",
        modelType: "full",
      })
      .then((detector) => {
        poseDetector = detector;
      })
      .catch(() => {});
  }

  function updatePosePoints() {
    if (!poseDetector || !video || video.readyState < 2 || posePending) return;
    posePending = true;
    poseDetector
      .estimatePoses(video, { flipHorizontal: false })
      .then((poses) => {
        lastPoseDetected = poses.length > 0;
        const vw = video.videoWidth || 1;
        const vh = video.videoHeight || 1;
        if (poses.length > 0 && poses[0].keypoints) {
          const kps = poses[0].keypoints;
          const n = Math.min(kps.length, MAX_POSE_POINTS);
          posePointCount = n;
          for (let i = 0; i < n; i++) {
            const kp = kps[i];
            posePointsTarget[i * 2] = kp.x / vw;
            posePointsTarget[i * 2 + 1] = 1.0 - kp.y / vh;
          }
        } else {
          posePointCount = 0;
        }
      })
      .catch(() => {})
      .finally(() => {
        posePending = false;
      });
  }

  function contourCentroid(edgeMap, width, height) {
    let sumX = 0, sumY = 0, count = 0;
    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        if (edgeMap[j * width + i]) {
          sumX += i;
          sumY += j;
          count++;
        }
      }
    }
    lastContourCount = count;
    if (count === 0) return { x: 0.5, y: 0.5, count: 0 };
    return {
      x: sumX / count / Math.max(width, 1),
      y: 1.0 - sumY / count / Math.max(height, 1),
      count
    };
  }

  function updateContourTexture() {
    if (!video || video.readyState < 2 || video.videoWidth === 0) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const aspect = vw / vh;
    extractor.setVideoAspect(aspect);
    const { w: gw, h: gh } = extractor.getGridSize();
    captureCanvas.width = gw;
    captureCanvas.height = gh;
    const ctx = captureCanvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, gw, gh);
    const imgData = ctx.getImageData(0, 0, gw, gh);
    const { edgeMap, width, height } = extractor.extractContours(imgData.data, gw, gh);
    if (!poseDetector) {
      const c = contourCentroid(edgeMap, width, height);
      posePointCount = c.count > 0 ? 1 : 0;
      if (posePointCount === 1) {
        posePointsTarget[0] = c.x;
        posePointsTarget[1] = c.y;
      }
    }
    drawContourMapToCanvas(contourCanvas, edgeMap, width, height);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, contourTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, contourCanvas);
  }

  function render() {
    resize();
    const fadeEnd = window.innerHeight * 0.8;
    opacityTarget = Math.max(0, 1 - window.scrollY / fadeEnd);
    opacity += (opacityTarget - opacity) * OPACITY_EASE;
    if (contourReady) updateContourTexture();
    frameCount++;
    if (poseDetector && video && video.readyState >= 2 && frameCount % 2 === 0)
      updatePosePoints();
    const presenceTarget = poseDetector
      ? (lastPoseDetected ? 1 : 0)
      : (lastContourCount > MIN_CONTOUR_PIXELS ? 1 : 0);
    ripplePresence += (presenceTarget - ripplePresence) * PRESENCE_EASE;

    for (let i = 0; i < posePointCount; i++) {
      const ix = i * 2;
      const unset = posePointsData[ix] === 0 && posePointsData[ix + 1] === 0;
      if (unset && (posePointsTarget[ix] !== 0 || posePointsTarget[ix + 1] !== 0)) {
        posePointsData[ix] = posePointsTarget[ix];
        posePointsData[ix + 1] = posePointsTarget[ix + 1];
      } else {
        posePointsData[ix] += (posePointsTarget[ix] - posePointsData[ix]) * POSE_POINTS_EASE;
        posePointsData[ix + 1] += (posePointsTarget[ix + 1] - posePointsData[ix + 1]) * POSE_POINTS_EASE;
      }
    }

    gl.clear(gl.COLOR_BUFFER_BIT);
    const t = (performance.now() / 1000 - t0);
    gl.uniform2f(resLoc, canvas.width, canvas.height);
    gl.uniform1f(timeLoc, t);
    gl.uniform1f(opacityLoc, opacity);
    gl.uniform2fv(posePointsLoc, posePointsData);
    gl.uniform1f(posePointCountLoc, posePointCount);
    gl.uniform1i(contourLoc, 1);
    gl.uniform1f(contourStrengthLoc, params.contourStrength);
    gl.uniform1f(rippleFreqCenterLoc, params.rippleFreqCenter);
    gl.uniform1f(rippleFreqEdgeLoc, params.rippleFreqEdge);
    gl.uniform1f(rippleAmpLoc, params.rippleAmp);
    gl.uniform1f(rippleFalloffLoc, params.rippleFalloff);
    gl.uniform1f(rippleSinAmpLoc, params.rippleSinAmp);
    gl.uniform1f(rippleSinFreqLoc, params.rippleSinFreq);
    gl.uniform1f(flowSpeedLoc, params.flowSpeed);
    gl.uniform1f(obstacleRadiusLoc, params.obstacleRadius);
    gl.uniform1f(obstacleSoftLoc, params.obstacleSoft);
    gl.uniform1f(ripplePresenceLoc, ripplePresence);
    gl.enableVertexAttribArray(posLoc);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    rafId = requestAnimationFrame(render);
  }

  render();

  return () => {
    cancelAnimationFrame(rafId);
    if (video && video.srcObject && video.srcObject instanceof MediaStream) {
      video.srcObject.getTracks().forEach((t) => t.stop());
    }
    gl.deleteTexture(contourTex);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  };
}

const cleanup = init();
if (typeof cleanup === "function") {
  window.addEventListener("beforeunload", cleanup);
}
