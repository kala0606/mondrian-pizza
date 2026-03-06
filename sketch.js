let video;
let contourPaths = [];
let frozen = false;
let frozenContourPoints = []; // snapshot of contour points when frozen (for static branches)
let svgBtn;
let panelDiv;

let W, H;
var bri, briPrev, edge, visited;
var videoReady = false;
var videoAspect = 4 / 3; // updated once camera reports real size

// ─── Parametric controls (defaults) ──────────────────────────

var params = {
  gridRes:     120,    // grid width (height = 3/4 of this)
  edgeThresh:  30,     // base Sobel threshold
  minLen:      3,      // min contour length in grid pixels
  maxPts:      40,     // max points per contour for rendering

  // Sin wave displacement
  waveAmp:     4,      // amplitude in pixels (0 = off, sharp lines)
  waveFreq:    0.15,   // frequency along contour
  waveSpeed:   2,      // animation speed (per frame offset)

  // Iso-brightness levels count (more = denser in dark areas)
  isoCount:    7,

  // Stroke
  strokeW:     1.0,
  strokeR:     30,
  strokeG:     30,
  strokeB:     50,
  bgR:         252,
  bgG:         250,
  bgB:         245,
  bgAlpha:     3,     // background alpha (low = trail, 255 = solid)

  // Smoothing
  smooth:      true,
  temporalBlend: 0.92,  // blend with previous frame (0=no smooth, 1=full previous) — reduces webcam flicker
};

var GRID_W, GRID_H;
var frameCounter = 0;

function recalcGrid() {
  GRID_W = params.gridRes;
  GRID_H = Math.round(params.gridRes / videoAspect);
  var total = GRID_W * GRID_H;
  bri = new Float32Array(total);
  briPrev = new Float32Array(total);
  edge = new Uint8Array(total);
  visited = new Uint8Array(total);
}

// ─── Setup ───────────────────────────────────────────────────

function setup() {
  W = windowWidth;
  H = windowHeight;
  createCanvas(W, H);
  frameRate(30);

  video = createCapture(VIDEO, function() {
    var vw = video.elt.videoWidth;
    var vh = video.elt.videoHeight;
    if (vw && vh) {
      videoAspect = vw / vh;
      recalcGrid();
    }
    videoReady = true;
  });
  video.hide();

  recalcGrid();
  buildPanel();

  svgBtn = createButton("Download SVG");
  svgBtn.position(10, 10);
  svgBtn.style("font-size", "15px");
  svgBtn.style("padding", "8px 16px");
  svgBtn.style("cursor", "pointer");
  svgBtn.style("border-radius", "6px");
  svgBtn.style("border", "none");
  svgBtn.style("background", "#e44");
  svgBtn.style("color", "#fff");
  svgBtn.mousePressed(doExportSVG);
  svgBtn.hide();
}

// ─── Parametric panel ────────────────────────────────────────

function buildPanel() {
  panelDiv = createDiv("");
  panelDiv.position(10, 10);
  panelDiv.style("background", "rgba(0,0,0,0.75)");
  panelDiv.style("color", "#fff");
  panelDiv.style("padding", "12px 16px");
  panelDiv.style("border-radius", "10px");
  panelDiv.style("font-family", "monospace");
  panelDiv.style("font-size", "13px");
  panelDiv.style("max-height", (H - 40) + "px");
  panelDiv.style("overflow-y", "auto");
  panelDiv.style("width", "240px");
  panelDiv.style("z-index", "100");

  // Prevent clicks on panel from freezing
  panelDiv.elt.addEventListener("mousedown", function(e) { e.stopPropagation(); });
  panelDiv.elt.addEventListener("click", function(e) { e.stopPropagation(); });

  var html = "<b>Parametric Editor</b><br><br>";

  html += slider("gridRes", "Resolution", 60, 1000, params.gridRes, 10);
  html += slider("edgeThresh", "Edge threshold", 10, 80, params.edgeThresh, 5);
  html += slider("isoCount", "Iso levels (density)", 0, 12, params.isoCount, 1);
  html += slider("minLen", "Min contour len", 1, 15, params.minLen, 1);
  html += slider("temporalBlend", "Cam smooth (anti-flicker)", 0, 0.98, params.temporalBlend, 0.02);
  html += "<hr style='border-color:#555'>";

  html += "<b>Wave Displacement</b><br>";
  html += slider("waveAmp", "Amplitude", 0, 20, params.waveAmp, 0.5);
  html += slider("waveFreq", "Frequency", 0.02, 0.5, params.waveFreq, 0.01);
  html += slider("waveSpeed", "Speed", 0, 8, params.waveSpeed, 0.5);
  html += "<hr style='border-color:#555'>";

  html += "<b>Stroke</b><br>";
  html += slider("strokeW", "Weight", 0.3, 4, params.strokeW, 0.1);
  html += slider("maxPts", "Detail (pts)", 10, 100, params.maxPts, 5);
  html += check("smooth", "Smooth curves", params.smooth);
  html += "<hr style='border-color:#555'>";

  html += "<b>Colors</b><br>";
  html += colorRow("Stroke", "strokeR", "strokeG", "strokeB");
  html += colorRow("Background", "bgR", "bgG", "bgB");
  html += slider("bgAlpha", "Bg alpha (trail)", 1, 255, params.bgAlpha, 1);

  panelDiv.html(html);

  // Attach listeners after html is set
  setTimeout(attachListeners, 50);
}

function slider(id, label, mn, mx, val, step) {
  return '<div style="margin:4px 0"><label>' + label + ' <span id="v_' + id + '">' + val + '</span></label><br>' +
    '<input type="range" id="s_' + id + '" min="' + mn + '" max="' + mx + '" step="' + step + '" value="' + val + '" style="width:100%"></div>';
}

function check(id, label, val) {
  return '<div style="margin:6px 0"><label><input type="checkbox" id="c_' + id + '"' + (val ? " checked" : "") + '> ' + label + '</label></div>';
}

function colorRow(label, rId, gId, bId) {
  return '<div style="margin:4px 0">' + label +
    ' R<input type="number" id="n_' + rId + '" value="' + params[rId] + '" min="0" max="255" style="width:40px;margin:0 2px">' +
    ' G<input type="number" id="n_' + gId + '" value="' + params[gId] + '" min="0" max="255" style="width:40px;margin:0 2px">' +
    ' B<input type="number" id="n_' + bId + '" value="' + params[bId] + '" min="0" max="255" style="width:40px;margin:0 2px">' +
    '</div>';
}

function attachListeners() {
  var sliders = ["gridRes","edgeThresh","isoCount","minLen","temporalBlend","waveAmp","waveFreq","waveSpeed","strokeW","maxPts","bgAlpha"];
  for (var i = 0; i < sliders.length; i++) {
    (function(id) {
      var el = document.getElementById("s_" + id);
      if (!el) return;
      el.addEventListener("input", function() {
        params[id] = parseFloat(this.value);
        document.getElementById("v_" + id).textContent = this.value;
        if (id === "gridRes") recalcGrid();
        if (frozen) renderContours();
      });
    })(sliders[i]);
  }

  var checks = ["smooth"];
  for (var i = 0; i < checks.length; i++) {
    (function(id) {
      var el = document.getElementById("c_" + id);
      if (!el) return;
      el.addEventListener("change", function() {
        params[id] = this.checked;
        if (frozen) renderContours();
      });
    })(checks[i]);
  }

  var nums = ["strokeR","strokeG","strokeB","bgR","bgG","bgB"];
  for (var i = 0; i < nums.length; i++) {
    (function(id) {
      var el = document.getElementById("n_" + id);
      if (!el) return;
      el.addEventListener("input", function() {
        params[id] = parseInt(this.value) || 0;
        if (frozen) renderContours();
      });
    })(nums[i]);
  }
}

// ─── Draw loop ───────────────────────────────────────────────

function windowResized() {
  if (!frozen) {
    W = windowWidth; H = windowHeight;
    resizeCanvas(W, H);
  }
}

function draw() {
  if (frozen) {
    renderFrozenScene();
    return;
  }
  frameCounter++;

  if (!videoReady) {
    background(30);
    fill(255); noStroke(); textSize(18); textAlign(CENTER, CENTER);
    text("Waiting for camera...", width / 2, height / 2);
    return;
  }

  var snap = video.get();
  snap.resize(GRID_W, GRID_H);
  snap.loadPixels();
  if (!snap.pixels || snap.pixels.length < GRID_W * GRID_H * 4) return;

  contourPaths = extractContours(snap);
  renderContours();

  // Hint
  fill(0, 0, 0, 120); noStroke();
  rect(0, height - 32, width, 32);
  fill(255); textSize(13); textAlign(CENTER, CENTER);
  text("Click canvas to freeze & export SVG  |  " + contourPaths.length + " contours", width / 2, height - 16);
}

function mousePressed() {
  if (frozen) {
    frozen = false;
    svgBtn.hide();
    panelDiv.show();
  } else {
    frozen = true;
    svgBtn.show();
    svgBtn.position(270, 10);
    frozenContourPoints = contourPaths.map(function(flat) {
      return getContourPoints(flat);
    });
  }
  return false;
}

// ─── Frozen scene ───────────────────────────────────────────────

function renderFrozenScene() {
  background(params.bgR, params.bgG, params.bgB, 255);
  stroke(params.strokeR, params.strokeG, params.strokeB);
  strokeWeight(params.strokeW);
  noFill();
  for (var ci = 0; ci < frozenContourPoints.length; ci++) {
    var pts = frozenContourPoints[ci];
    if (!pts || pts.length < 4) continue;
    if (params.smooth && pts.length >= 8) {
      beginShape();
      curveVertex(pts[0], pts[1]);
      for (var p = 0; p < pts.length; p += 2) curveVertex(pts[p], pts[p + 1]);
      curveVertex(pts[pts.length - 2], pts[pts.length - 1]);
      endShape();
    } else {
      beginShape();
      for (var p = 0; p < pts.length; p += 2) vertex(pts[p], pts[p + 1]);
      endShape();
    }
  }
  // Hint
  fill(0, 0, 0, 120); noStroke();
  rect(0, height - 32, width, 32);
  fill(255); textSize(13); textAlign(CENTER, CENTER);
  text("Click canvas to unfreeze  |  Download SVG above", width / 2, height - 16);
}

// ─── SVG Export ──────────────────────────────────────────────

function doExportSVG() {
  if (contourPaths.length === 0) return;
  var svgString = buildSVG();
  var blob = new Blob([svgString], {type: "image/svg+xml;charset=utf-8"});
  var link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "selfie-contours.svg";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(function() { document.body.removeChild(link); URL.revokeObjectURL(link.href); }, 200);
}

// ─── Contour extraction ──────────────────────────────────────

function extractContours(img) {
  var w = GRID_W, h = GRID_H;
  var pix = img.pixels;
  var total = w * h;

  for (var k = 0; k < total; k++) {
    var i4 = k << 2;
    bri[k] = (pix[i4] + pix[i4+1] + pix[i4+2]) * 0.3333;
  }
  // Temporal smoothing: blend with previous frame to reduce webcam flicker
  if (briPrev && briPrev.length === total && frameCounter > 1) {
    var tb = params.temporalBlend;
    for (var k = 0; k < total; k++) {
      bri[k] = tb * briPrev[k] + (1 - tb) * bri[k];
    }
  }
  briPrev.set(bri);

  edge.fill(0);
  visited.fill(0);

  var et = params.edgeThresh;
  for (var j = 1; j < h - 1; j++) {
    for (var i = 1; i < w - 1; i++) {
      var k = j * w + i;
      var gx = -bri[k-w-1] + bri[k-w+1] - 2*bri[k-1] + 2*bri[k+1] - bri[k+w-1] + bri[k+w+1];
      var gy = -bri[k-w-1] - 2*bri[k-w] - bri[k-w+1] + bri[k+w-1] + 2*bri[k+w] + bri[k+w+1];
      var mag = gx*gx + gy*gy;
      var darkness = 1 - bri[k] * 0.00392;
      var thresh = et + (1 - darkness) * 30;
      if (mag > thresh * thresh) edge[k] = 1;
    }
  }

  // Iso-brightness crossings
  var isoCount = params.isoCount;
  for (var li = 0; li < isoCount; li++) {
    var lv = 25 + li * (200 / Math.max(isoCount, 1));
    for (var j = 1; j < h - 1; j++) {
      var row = j * w;
      for (var i = 1; i < w - 2; i++) {
        var k = row + i;
        if ((bri[k] < lv) !== (bri[k+1] < lv)) edge[k] = 1;
      }
    }
  }

  var dx8 = [-1,0,1,-1,1,-1,0,1];
  var dy8 = [-1,-1,-1,0,0,1,1,1];
  var result = [];
  var minL = params.minLen * 2;

  for (var j = 1; j < h - 1; j++) {
    for (var i = 1; i < w - 1; i++) {
      var k = j * w + i;
      if (!edge[k] || visited[k]) continue;
      var path = [];
      var cx = i, cy = j, prev = 0;
      for (var it = 0; it < 600; it++) {
        var ck = cy * w + cx;
        if (visited[ck] && it > 0) break;
        visited[ck] = 1;
        path.push(cx, cy);
        var found = false;
        for (var d = 0; d < 8; d++) {
          var nd = (prev + 5 + d) & 7;
          var nx = cx + dx8[nd], ny = cy + dy8[nd];
          if (nx >= 1 && nx < w - 1 && ny >= 1 && ny < h - 1) {
            var nk = ny * w + nx;
            if (edge[nk] && !visited[nk]) { prev = nd; cx = nx; cy = ny; found = true; break; }
          }
        }
        if (!found) break;
      }
      if (path.length >= minL) result.push(path);
    }
  }

  return result;
}

// ─── Render with wave displacement ───────────────────────────

function getDrawMetrics() {
  var scale = Math.min(W / GRID_W, H / GRID_H);
  var drawW = GRID_W * scale;
  var drawH = GRID_H * scale;
  return { sx: scale, sy: scale, ox: (W - drawW) * 0.5, oy: (H - drawH) * 0.5 };
}

function getContourPoints(flat) {
  var m = getDrawMetrics();
  var sx = m.sx, sy = m.sy, ox = m.ox, oy = m.oy;
  var len = flat.length >> 1;
  var maxP = params.maxPts;
  var amp = params.waveAmp;
  var freq = params.waveFreq;
  var phase = frameCounter * params.waveSpeed * 0.01;
  // 3D Perlin noise seed from path origin so each contour varies
  var noiseY = (flat[0] + flat[1]) * 0.02;
  var points = [];

  if (len > maxP) {
    var step = (len - 1) / (maxP - 1);
    for (var p = 0; p < maxP; p++) {
      var idx = Math.round(p * step) << 1;
      var px = flat[idx] * sx;
      var py = flat[idx + 1] * sy;
      if (amp > 0) {
        // 3D Perlin noise: x = position along path, y = path id, z = time
        var n = noise(p * freq * 0.5, noiseY, phase);
        var wave = (n * 2 - 1) * amp;
        var nx2, ny2;
        if (p < maxP - 1) {
          var idx2 = Math.round((p + 1) * step) << 1;
          nx2 = flat[idx2] * sx; ny2 = flat[idx2 + 1] * sy;
        } else {
          var idx2 = Math.round((p - 1) * step) << 1;
          nx2 = flat[idx2] * sx; ny2 = flat[idx2 + 1] * sy;
        }
        var dx = nx2 - px, dy = ny2 - py;
        var dl = Math.sqrt(dx*dx + dy*dy) || 1;
        var normX = -dy / dl;
        var normY = dx / dl;
        px += normX * wave;
        py += normY * wave;
      }
      points.push(px, py);
    }
  } else {
    for (var p = 0; p < len; p++) {
      var idx = p << 1;
      var px = flat[idx] * sx;
      var py = flat[idx + 1] * sy;
      if (amp > 0) {
        var n = noise(p * freq * 0.5, noiseY, phase);
        var wave = (n * 2 - 1) * amp;
        var nx2, ny2;
        if (p < len - 1) {
          nx2 = flat[idx+2] * sx; ny2 = flat[idx+3] * sy;
        } else {
          nx2 = flat[idx-2] * sx; ny2 = flat[idx-1] * sy;
        }
        var dx = nx2 - px, dy = ny2 - py;
        var dl = Math.sqrt(dx*dx + dy*dy) || 1;
        var normX = -dy / dl;
        var normY = dx / dl;
        px += normX * wave;
        py += normY * wave;
      }
      points.push(px, py);
    }
  }
  return points;
}

function renderContours() {
  background(params.bgR, params.bgG, params.bgB, params.bgAlpha);
  stroke(params.strokeR, params.strokeG, params.strokeB);
  strokeWeight(params.strokeW);
  noFill();

  for (var ci = 0; ci < contourPaths.length; ci++) {
    var flat = contourPaths[ci];
    if ((flat.length >> 1) < 2) continue;
    var pts = getContourPoints(flat);

    if (params.smooth && pts.length >= 8) {
      // Draw as curveVertex for smoother lines
      beginShape();
      curveVertex(pts[0], pts[1]); // anchor
      for (var p = 0; p < pts.length; p += 2) {
        curveVertex(pts[p], pts[p+1]);
      }
      curveVertex(pts[pts.length - 2], pts[pts.length - 1]); // anchor
      endShape();
    } else {
      beginShape();
      for (var p = 0; p < pts.length; p += 2) {
        vertex(pts[p], pts[p+1]);
      }
      endShape();
    }
  }
}

// ─── SVG export ──────────────────────────────────────────────

function buildSVG() {
  var pathsStr = "";
  var col = "rgb(" + params.strokeR + "," + params.strokeG + "," + params.strokeB + ")";
  var pointsToUse = frozen && frozenContourPoints.length > 0 ? frozenContourPoints : contourPaths.map(function(flat) { return getContourPoints(flat); });

  for (var ci = 0; ci < pointsToUse.length; ci++) {
    var pts = pointsToUse[ci];
    if (!pts || pts.length < 4) continue;

    var d = "M " + pts[0].toFixed(1) + " " + pts[1].toFixed(1);
    for (var p = 2; p < pts.length; p += 2) {
      d += " L " + pts[p].toFixed(1) + " " + pts[p+1].toFixed(1);
    }
    pathsStr += '  <path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="' + params.strokeW.toFixed(1) + '" stroke-linecap="round"/>\n';
  }

  var bg = "rgb(" + params.bgR + "," + params.bgG + "," + params.bgB + ")";
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">\n' +
    '  <rect width="' + W + '" height="' + H + '" fill="' + bg + '"/>\n' +
    pathsStr + '</svg>';
}
