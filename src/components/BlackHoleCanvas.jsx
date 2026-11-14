import React, { useEffect, useRef } from 'react';

const VERTEX_SHADER = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

// Relativistic Schwarzschild Black Hole Geodesic Raymarcher (inspired by MASHCLIENT Singularity 4.1)
const FRAGMENT_SHADER = `
precision highp float;

uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_offset;
uniform int u_steps;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

mat2 rot2(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / min(u_res.x, u_res.y);
  uv -= u_offset;

  // Roll the camera slightly like MASHCLIENT (-14 deg)
  uv = rot2(0.24) * uv;

  // Camera setup in Schwarzschild coordinates (rs = 1.0)
  vec3 ro = vec3(0.0, 1.52, -10.4);
  vec3 target = vec3(0.0, -0.08, 0.0);
  vec3 fwd = normalize(target - ro);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  vec3 up = cross(fwd, right);
  vec3 rd = normalize(fwd * 1.48 + uv.x * right + uv.y * up);

  // Subtle deep space starfield streaks
  vec2 starUv = uv * 18.0;
  float starCell = hash(floor(starUv));
  vec2 starLocal = fract(starUv) - 0.5;
  float starDist = length(starLocal * vec2(1.0, 2.4));
  float starGlow = smoothstep(0.9965, 1.0, starCell) * smoothstep(0.18, 0.0, starDist);
  vec3 bgStars = vec3(1.0, 0.91, 0.78) * starGlow * 0.45;

  vec3 pos = ro;
  vec3 vel = rd;
  vec3 accum = vec3(0.0);
  float transmittance = 1.0;
  bool swallowed = false;

  // Specific angular momentum h^2 = |pos x vel|^2 (conserved along geodesic)
  vec3 hVec = cross(pos, vel);
  float h2 = dot(hVec, hVec);
  float minR = 100.0;

  for (int i = 0; i < 84; i++) {
    if (i >= u_steps) break;

    float r = length(pos);
    minR = min(minR, r);

    if (r < 1.02) {
      swallowed = true;
      break;
    }
    if (r > 18.0 && i > 12) {
      break;
    }

    // Adaptive step size near photon sphere
    float dt = clamp(0.075 * (r - 0.82), 0.032, 0.36);

    // Relativistic Schwarzschild photon geodesic acceleration: -1.5 * rs * h^2 * pos / r^5
    float r2 = r * r;
    vec3 accel = -1.5 * h2 * pos / (r2 * r2 * r);

    vec3 nextVel = normalize(vel + accel * dt);
    vec3 nextPos = pos + 0.5 * (vel + nextVel) * dt;

    // Equatorial accretion disk crossing check (plane y = 0)
    if (pos.y * nextPos.y <= 0.0) {
      float tCross = abs(pos.y) / (abs(pos.y) + abs(nextPos.y) + 1e-5);
      vec3 hit = mix(pos, nextPos, tCross);
      float diskR = length(hit.xz);

      if (diskR > 1.62 && diskR < 6.9) {
        float radialNorm = (diskR - 1.62) / (6.9 - 1.62);
        float innerFade = smoothstep(1.62, 2.02, diskR);
        float outerFade = 1.0 - smoothstep(4.2, 6.9, diskR);
        float density = innerFade * outerFade;

        float angle = atan(hit.z, hit.x);
        float keplerSpeed = 2.6 / pow(diskR, 1.15);
        float swirl = angle + u_time * keplerSpeed + 4.8 / (diskR + 0.35);

        // Multi-band filamentous plasma rings
        float rings = fbm(vec2(diskR * 3.6, swirl * 1.8));
        float fineStreaks = fbm(vec2(diskR * 9.5 - u_time * 0.15, swirl * 3.4));
        float filaments = mix(rings, fineStreaks, 0.55);
        filaments = pow(clamp(filaments * 1.42, 0.0, 1.3), 1.35);

        // Relativistic Doppler beaming (approaching right side glows white-gold)
        vec3 orbitalDir = normalize(vec3(-hit.z, 0.0, hit.x));
        float doppler = clamp(1.0 + 0.62 * dot(orbitalDir, -nextVel), 0.42, 1.82);
        float heat = clamp((1.0 - radialNorm * 0.72) * doppler, 0.0, 1.6);

        vec3 deepAmber = vec3(0.42, 0.14, 0.03);
        vec3 warmGold = vec3(0.92, 0.58, 0.21);
        vec3 hotIvory = vec3(1.0, 0.95, 0.84);

        vec3 diskCol = mix(deepAmber, warmGold, smoothstep(0.15, 0.78, heat));
        diskCol = mix(diskCol, hotIvory, smoothstep(0.82, 1.48, heat));

        float emitStrength = density * (0.38 + 1.25 * filaments) * pow(doppler, 1.45);
        accum += transmittance * diskCol * emitStrength * 1.32;
        transmittance *= clamp(1.0 - density * 0.76, 0.08, 1.0);
      }
    }

    // Subtle volumetric corona near inner disk
    float planeDist = abs(nextPos.y);
    float cylR = length(nextPos.xz);
    if (cylR > 1.45 && cylR < 5.6 && planeDist < 0.55) {
      float halo = exp(-planeDist * 6.5) * exp(-abs(cylR - 2.35) * 0.95);
      accum += transmittance * vec3(0.95, 0.56, 0.19) * halo * 0.032;
    }

    pos = nextPos;
    vel = nextVel;
  }

  // Razor-sharp relativistic photon ring right outside the shadow (minR ~ 1.5)
  float photonRing = exp(-abs(minR - 1.48) * 16.0) * (swallowed ? 0.45 : 1.0);
  accum += vec3(1.0, 0.86, 0.58) * photonRing * 0.62;

  if (!swallowed) {
    accum += transmittance * bgStars;
  }

  // Smooth filmic ACES-like tone mapping
  vec3 mapped = (accum * (2.51 * accum + 0.03)) / (accum * (2.43 * accum + 0.59) + 0.14);
  mapped = pow(clamp(mapped, 0.0, 1.0), vec3(0.92));

  gl_FragColor = vec4(mapped, 1.0);
}
`;

function compileShader(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export default function BlackHoleCanvas({
  quality = 'balanced', // 'turbo' | 'balanced' | 'quality'
  paused = false,
  offsetX = 0.11,
  offsetY = 0.0,
  opacity = 1,
  className = '',
}) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const gl =
      canvas.getContext('webgl', {
        antialias: false,
        alpha: false,
        powerPreference: quality === 'turbo' ? 'low-power' : 'high-performance',
      }) || canvas.getContext('experimental-webgl');

    // Graceful 2D fallback if WebGL is disabled (e.g. CPU Software mode!)
    if (!gl) {
      const ctx = canvas.getContext('2d');
      if (!ctx) return undefined;
      const drawFallback = () => {
        const w = (canvas.width = canvas.clientWidth || 1280);
        const h = (canvas.height = canvas.clientHeight || 720);
        ctx.fillStyle = '#030305';
        ctx.fillRect(0, 0, w, h);
        const cx = w * (0.5 + offsetX * 0.7);
        const cy = h * 0.5;
        const r = Math.min(w, h) * 0.36;
        const g = ctx.createRadialGradient(cx, cy, r * 0.42, cx, cy, r * 1.15);
        g.addColorStop(0, '#000000');
        g.addColorStop(0.45, '#000000');
        g.addColorStop(0.52, '#fff1d0');
        g.addColorStop(0.68, '#e8a849');
        g.addColorStop(0.88, 'rgba(125, 55, 14, 0.32)');
        g.addColorStop(1, 'rgba(3, 3, 5, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.15, 0, Math.PI * 2);
        ctx.fill();
      };
      drawFallback();
      window.addEventListener('resize', drawFallback);
      return () => window.removeEventListener('resize', drawFallback);
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vs || !fs) return undefined;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return undefined;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW
    );

    const aPos = gl.getAttribLocation(prog, 'a_pos');
    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uOffset = gl.getUniformLocation(prog, 'u_offset');
    const uSteps = gl.getUniformLocation(prog, 'u_steps');

    const scaleMap = { turbo: 0.55, balanced: 0.8, quality: 1.0 };
    const stepsMap = { turbo: 36, balanced: 56, quality: 78 };
    const renderScale = scaleMap[quality] || 0.8;
    const stepCount = stepsMap[quality] || 56;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75) * renderScale;
      const w = Math.max(320, Math.floor((canvas.clientWidth || window.innerWidth) * dpr));
      const h = Math.max(240, Math.floor((canvas.clientHeight || window.innerHeight) * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    let rafId = null;
    const startTs = performance.now();

    const renderFrame = (now) => {
      const elapsed = (now - startTs) * 0.001;
      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, elapsed);
      gl.uniform2f(uOffset, offsetX, offsetY);
      gl.uniform1i(uSteps, stepCount);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // If paused (e.g. Turbo FPS Gaming Mode active), stop RAF after rendering 1 crisp frame -> 0.0% GPU!
      if (!paused) {
        rafId = requestAnimationFrame(renderFrame);
      }
    };

    rafId = requestAnimationFrame(renderFrame);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, [quality, paused, offsetX, offsetY]);

  return (
    <canvas
      ref={canvasRef}
      className={`mash-blackhole-canvas ${className}`}
      style={{ opacity }}
      aria-hidden="true"
    />
  );
}
