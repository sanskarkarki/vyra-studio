/**
 * The slider's entire look lives in this fragment shader. One fullscreen
 * quad, two textures, one progress scalar. The switch the eye reads as
 * "cinematic" is five cheap tricks layered in a fixed order: per-texture
 * cover fitting, mouse parallax, a noise warp that peaks mid-transition,
 * a direction-aware drift with a zoom toward centre, and an RGB split,
 * all resolved by a single smoothstep crossfade.
 */

export const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

export const FRAGMENT = /* glsl */ `
precision highp float;

uniform sampler2D uTex1;
uniform sampler2D uTex2;
uniform float uProgress;
uniform float uDirection;
uniform float uTexReady;
uniform vec2 uResolution;
uniform vec2 uImageResolution;
uniform vec2 uImageResolution2;
uniform vec2 uMouse;

varying vec2 vUv;

/* 2D simplex noise (gradient-lattice construction over a skewed grid). */
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                      -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

/* CSS object-fit: cover, per texture. Each texture carries its own intrinsic
   resolution so two differently-shaped sources never distort each other
   mid-transition. */
vec2 fitCover(vec2 uv, vec2 imgRes) {
  vec2 ratio = vec2(
    min((uResolution.x / uResolution.y) / (imgRes.x / imgRes.y), 1.0),
    min((uResolution.y / uResolution.x) / (imgRes.y / imgRes.x), 1.0)
  );
  return vec2(uv.x * ratio.x + (1.0 - ratio.x) * 0.5,
              uv.y * ratio.y + (1.0 - ratio.y) * 0.5);
}

void main() {
  float p = uProgress;
  vec2 center = vec2(0.5);

  vec2 uvA = fitCover(vUv, uImageResolution);
  vec2 uvB = fitCover(vUv, uImageResolution2);

  /* Idle parallax: zoom 5% to hide the edges the drift would expose, then
     let the smoothed mouse push the frame around. */
  uvA = (uvA - 0.5) * 0.95 + 0.5;
  uvA -= uMouse * 0.015;
  uvB = (uvB - 0.5) * 0.95 + 0.5;
  uvB -= uMouse * 0.015;

  /* The warp exists only DURING the switch: p*(1-p) is zero at both ends
     and peaks in the middle, so rest frames stay perfectly clean. */
  float noiseVal = (p > 0.001 && p < 0.999) ? snoise(vUv * 3.0 + p * 2.0) : 0.0;
  float warp = noiseVal * p * (1.0 - p) * 0.3;

  /* Outgoing drifts vertically with direction and eases toward centre;
     the incoming mirrors it from the other side. */
  vec2 uv1 = mix(uvA, center, p * 0.15) + vec2(0.0, uDirection * p * 0.3) + vec2(warp);
  vec2 uv2 = mix(uvB, center, (1.0 - p) * 0.15) - vec2(0.0, uDirection * (1.0 - p) * 0.3) + vec2(warp);

  /* Chromatic split, also peaking mid-transition, breathing with the noise. */
  float shift = 0.04 * p * (1.0 - p) * (noiseVal + 1.0);
  vec4 t1 = vec4(
    texture2D(uTex1, uv1 + vec2(shift, 0.0)).r,
    texture2D(uTex1, uv1).g,
    texture2D(uTex1, uv1 - vec2(shift, 0.0)).b,
    1.0);
  vec4 t2 = vec4(
    texture2D(uTex2, uv2 + vec2(shift, 0.0)).r,
    texture2D(uTex2, uv2).g,
    texture2D(uTex2, uv2 - vec2(shift, 0.0)).b,
    1.0);

  /* Transparent until the first real frame exists, so the CSS poster behind
     the canvas shows instead of a black flash. */
  if (uTexReady < 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  gl_FragColor = mix(t1, t2, smoothstep(0.0, 1.0, p));
}
`;
