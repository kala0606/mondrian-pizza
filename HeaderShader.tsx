"use client";

import { useRef, useEffect, useCallback } from "react";
import { useScrollYRef } from "@/contexts/ScrollContext";
import {
  createContourExtractor,
  drawContourMapToCanvas,
} from "./contourExtractor";

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
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_opacity;
  uniform vec2 u_mouse;
  uniform sampler2D u_contour;
  uniform float u_contourStrength;
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

  vec2 rippleDisplacement(vec2 uv, vec2 center, float time) {
    vec2 toCenter = uv - center;
    float d = length(toCenter);
    float n = noise(vec2(d * 3.0, time * 2.5));
    float wave = (n * 2.0 - 1.0) * 0.15 * exp(-d * 1.2);
    return normalize(toCenter + 0.001) * wave;
  }

  vec3 colormap(float x, float scroll) {
    float t = scroll * 0.3;
    vec3 blue = vec3(0.15, 0.39, 0.92);
    vec3 white = vec3(0.98, 0.97, 0.94);
    if (x < 0.2 * scroll) return vec3(0.86, 0.15, 0.12);       // red
    else if (x < 0.35 * scroll) return vec3(0.98, 0.80, 0.15);  // yellow
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
    vec2 center = vec2(u_mouse.x * aspect, u_mouse.y);

    float time = u_time * 2.0;
    vec2 rippleCenter = center;
    vec2 aspectUV = uv + rippleDisplacement(uv, rippleCenter, time);

    vec2 screenSpace = (aspectUV - 0.5 * vec2(aspect, 1.0)) / min(aspect, 1.0);
    float warpTime = u_time / 10.0;
    float noiseY = u_time * 0.4;
    vec2 timeY = vec2(0.0, noiseY);
    float angle = noise(vec2(warpTime * 0.15, noiseY * 0.5)) * 6.28318;
    mat2 rot = mat2(cos(angle), sin(angle), -sin(angle), cos(angle));
    screenSpace = rot * screenSpace;
    float scale = 0.0 + 1.2 * noise(vec2(warpTime * 0.2, 1.5 + noiseY));
    screenSpace *= scale;
    screenSpace.x -= warpTime / 5.0;

    float contourVal = texture2D(u_contour, vUv).r;
    float contourInfluence = contourVal * u_contourStrength;

    vec2 st = screenSpace + timeY;
    st += contourInfluence * vec2(noise(screenSpace * 2.0 + timeY), noise(screenSpace * 2.0 + timeY + 10.0)) * 0.15;
    vec2 q = vec2(fbm1(st * 0.1 + vec2(0.0, 0.0)),
                 fbm1(st + vec2(5.2, 1.3)));
    vec2 r = vec2(fbm1(st * 0.1 + 4.0 * q + vec2(1.7 - warpTime / 2.0, 9.2)),
                  fbm1(st + 4.0 * q + vec2(8.3 - warpTime / 2.0, 2.8)));
    vec2 s = vec2(fbm1(st + 5.0 * r + vec2(21.7 - warpTime / 2.0, 90.2)),
                  fbm1(st * 0.05 + 5.0 * r + vec2(80.3 - warpTime / 2.0, 20.8))) * 0.25;
    float _pattern = fbm1(st * 0.05 + 4.0 * s);
    _pattern = mix(_pattern, _pattern * (1.0 + contourInfluence * 0.8), contourInfluence);

    vec3 colour = vec3(_pattern) * 2.0;
    colour.r -= dot(q, r) * 15.0;
    float p2 = fbm1(r * 0.15 + vec2(warpTime * 0.1, noiseY * 0.2));
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

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
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

const CONTOUR_STRENGTH = 0.7;

export default function HeaderShader() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const opacityRef = useRef(1);
  const opacityTargetRef = useRef(1);
  const mouseTargetRef = useRef({ x: 0.5, y: 0.5 });
  const mouseSmoothedRef = useRef({ x: 0.5, y: 0.5 });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const contourCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const contourExtractorRef = useRef<ReturnType<typeof createContourExtractor> | null>(null);
  const contourTextureRef = useRef<WebGLTexture | null>(null);
  const contourReadyRef = useRef(false);
  const { scrollYRef, isSmoothScroll } = useScrollYRef();
  const MOUSE_EASE_BASE = 0.035;
  const MOUSE_EASE_PULL = 0.018;
  const OPACITY_EASE = 0.06;
  const NOISE_TIME_SCALE = 0.06;

  const init = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return;

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    gl.useProgram(program);

    const posLoc = gl.getAttribLocation(program, "position");
    const timeLoc = gl.getUniformLocation(program, "u_time");
    const resLoc = gl.getUniformLocation(program, "u_resolution");
    const opacityLoc = gl.getUniformLocation(program, "u_opacity");
    const mouseLoc = gl.getUniformLocation(program, "u_mouse");
    const contourLoc = gl.getUniformLocation(program, "u_contour");
    const contourStrengthLoc = gl.getUniformLocation(program, "u_contourStrength");

    const contourTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, contourTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255])
    );
    contourTextureRef.current = contourTex;

    const contourCanvas = document.createElement("canvas");
    const captureCanvas = document.createElement("canvas");
    contourCanvasRef.current = contourCanvas;
    captureCanvasRef.current = captureCanvas;

    const extractor = createContourExtractor(4 / 3, {
      gridRes: 100,
      edgeThresh: 30,
      isoCount: 7,
      minLen: 3,
      temporalBlend: 0.92,
    });
    contourExtractorRef.current = extractor;

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "user" } })
      .then((stream) => {
        const video = document.createElement("video");
        video.autoplay = true;
        video.playsInline = true;
        video.muted = true;
        video.srcObject = stream;
        videoRef.current = video;
        video.play().then(() => {
          contourReadyRef.current = true;
        });
      })
      .catch(() => {});

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const t0 = performance.now() / 1000;

    function onScroll() {
      if (isSmoothScroll) return; // Lenis updates scrollYRef; we read it in render()
      scrollYRef.current = window.scrollY;
      const fadeEnd = window.innerHeight * 0.8;
      opacityTargetRef.current = Math.max(0, 1 - scrollYRef.current / fadeEnd);
    }

    function updateOpacityFromScroll() {
      const scrollY = isSmoothScroll ? scrollYRef.current : window.scrollY;
      const fadeEnd = window.innerHeight * 0.8;
      opacityTargetRef.current = Math.max(0, 1 - scrollY / fadeEnd);
    }

    function onMouseMove(e: MouseEvent) {
      mouseTargetRef.current.x = e.clientX / window.innerWidth;
      mouseTargetRef.current.y = 1.0 - e.clientY / window.innerHeight;
    }

    const RESOLUTION_SCALE = 1.0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
      const w = canvas!.offsetWidth;
      const h = canvas!.offsetHeight;
      const cw = Math.max(1, Math.floor(w * dpr * RESOLUTION_SCALE));
      const ch = Math.max(1, Math.floor(h * dpr * RESOLUTION_SCALE));
      if (canvas!.width !== cw || canvas!.height !== ch) {
        canvas!.width = cw;
        canvas!.height = ch;
        gl!.viewport(0, 0, cw, ch);
      }
    }

    function updateContourTexture() {
      const video = videoRef.current;
      const extractor = contourExtractorRef.current;
      const contourCanvas = contourCanvasRef.current;
      const captureCanvas = captureCanvasRef.current;
      if (
        !video ||
        !extractor ||
        !contourCanvas ||
        !captureCanvas ||
        video.readyState < 2 ||
        video.videoWidth === 0
      )
        return;
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
      const { edgeMap, width, height } = extractor.extractContours(
        imgData.data,
        gw,
        gh
      );
      drawContourMapToCanvas(contourCanvas, edgeMap, width, height);
      gl!.activeTexture(gl!.TEXTURE1);
      gl!.bindTexture(gl!.TEXTURE_2D, contourTextureRef.current);
      gl!.texImage2D(
        gl!.TEXTURE_2D,
        0,
        gl!.RGBA,
        gl!.RGBA,
        gl!.UNSIGNED_BYTE,
        contourCanvas
      );
    }

    function render() {
      resize();
      updateOpacityFromScroll();
      if (contourReadyRef.current) updateContourTexture();
      opacityRef.current += (opacityTargetRef.current - opacityRef.current) * OPACITY_EASE;
      const target = mouseTargetRef.current;
      const smoothed = mouseSmoothedRef.current;
      const dx = target.x - smoothed.x;
      const dy = target.y - smoothed.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const ease = Math.min(1, MOUSE_EASE_BASE + dist * MOUSE_EASE_PULL);
      smoothed.x += dx * ease;
      smoothed.y += dy * ease;
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      const t = performance.now() / 1000 - t0;
      gl!.uniform1f(timeLoc, t * NOISE_TIME_SCALE);
      gl!.uniform2f(resLoc, canvas!.width, canvas!.height);
      gl!.uniform1f(opacityLoc, opacityRef.current);
      gl!.uniform2f(mouseLoc, smoothed.x, smoothed.y);
      if (contourLoc) gl!.uniform1i(contourLoc, 1);
      if (contourStrengthLoc) gl!.uniform1f(contourStrengthLoc, CONTOUR_STRENGTH);
      gl!.enableVertexAttribArray(posLoc);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buf);
      gl!.vertexAttribPointer(posLoc, 2, gl!.FLOAT, false, 0, 0);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
      rafRef.current = requestAnimationFrame(render);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("mousemove", onMouseMove);
    onScroll();
    render();

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("mousemove", onMouseMove);
      cancelAnimationFrame(rafRef.current);
      const v = videoRef.current;
      if (v && v.srcObject && v.srcObject instanceof MediaStream) {
        v.srcObject.getTracks().forEach((t) => t.stop());
      }
      videoRef.current = null;
      if (contourTextureRef.current) {
        gl.deleteTexture(contourTextureRef.current);
        contourTextureRef.current = null;
      }
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  useEffect(() => {
    const cleanup = init();
    return cleanup;
  }, [init]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 h-screen w-screen z-0"
      aria-hidden="true"
    />
  );
}
