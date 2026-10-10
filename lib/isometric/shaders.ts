/**
 * GLSL for the isometric drawing renderer. Three passes, all cheap:
 *
 * 1. **Tone** — flat isometric shading from the view-space normal:
 *    up-facing surfaces take the top tone, side-facing ones blend from
 *    the left tone to the right by which way they face. No lights.
 * 2. **Normal + depth** — the same mesh again, writing its normal and
 *    depth into a half-float target for the edge pass to read.
 * 3. **Edges** — a full-screen pass marks every pixel where depth
 *    steps (silhouettes, occlusion) or the normal turns sharper than
 *    the crease angle (folds); a second dilates that mask to the line
 *    width and composites ink over the tone.
 *
 * Edge cost is per pixel, not per triangle: a 500k-triangle upload
 * draws its lines in the same time as a cube, and nothing about the
 * mesh is precomputed on the CPU.
 */

export const TONE_VERT = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const TONE_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uLeft;
uniform vec3 uRight;
varying vec3 vNormal;
void main() {
  // Back faces (inside of a bore, a bell, an open tube) shade as the
  // surface you're looking at, not the one facing away.
  vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
  vec3 side = mix(uLeft, uRight, smoothstep(-0.75, 0.75, n.x));
  gl_FragColor = vec4(n.y > 0.45 ? uTop : side, 1.0);
}
`;

export const NORMAL_DEPTH_FRAG = /* glsl */ `
varying vec3 vNormal;
void main() {
  vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
  gl_FragColor = vec4(n * 0.5 + 0.5, gl_FragCoord.z);
}
`;

export const EDGE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Edge detection at one-pixel scale. Depth uses a second difference
 * (Laplacian), so a surface sloping steeply away from the camera — whose
 * depth changes a lot per pixel but *linearly* — doesn't read as an
 * edge; only a kink or a step does. Normals use the crease angle.
 */
export const EDGE_DETECT_FRAG = /* glsl */ `
uniform sampler2D tNormalDepth;
uniform vec2 uTexel;
uniform float uCreaseCos;
uniform float uDepthEps;
varying vec2 vUv;

vec4 nd(vec2 o) { return texture2D(tNormalDepth, vUv + o * uTexel); }

float crease(vec4 a, vec4 b) {
  if (a.a > 0.9999 || b.a > 0.9999) return 0.0;
  return dot(normalize(a.rgb * 2.0 - 1.0), normalize(b.rgb * 2.0 - 1.0)) < uCreaseCos ? 1.0 : 0.0;
}

void main() {
  vec4 c = nd(vec2(0.0));
  vec4 l = nd(vec2(-1.0, 0.0));
  vec4 r = nd(vec2(1.0, 0.0));
  vec4 d = nd(vec2(0.0, -1.0));
  vec4 u = nd(vec2(0.0, 1.0));
  bool empty = c.a > 0.9999;
  // Silhouette: covered next to empty, on the covered side only, so the
  // line is centred on the outline after dilation.
  float sil = empty ? 0.0 : max(max(step(0.9999, l.a), step(0.9999, r.a)),
                                max(step(0.9999, d.a), step(0.9999, u.a)));
  float lap = empty ? 0.0 : max(abs(l.a + r.a - 2.0 * c.a), abs(d.a + u.a - 2.0 * c.a));
  // Occlusion step: only the nearer side draws, which keeps lines
  // one-sided and stops a thin part from inking solid.
  float step_ = (!empty && lap > uDepthEps && c.a <= min(min(l.a, r.a), min(d.a, u.a)) + 1e-5) ? 1.0 : 0.0;
  float fold = max(max(crease(c, l), crease(c, r)), max(crease(c, d), crease(c, u)));
  gl_FragColor = vec4(max(max(sil, step_), fold), 0.0, 0.0, 1.0);
}
`;

/**
 * Composite: dilate the one-pixel edge mask to the line width with a
 * soft falloff (that's the antialiasing), ink it over the tone.
 */
export const EDGE_FRAG = /* glsl */ `
uniform sampler2D tTone;
uniform sampler2D tEdges;
uniform vec2 uTexel;
uniform float uRadius;
uniform vec3 uInk;
varying vec2 vUv;

void main() {
  vec4 tone = texture2D(tTone, vUv);
  float e = 0.0;
  // Disk of taps out to the line's half-width; nearer taps count more.
  for (int i = 0; i < 3; i++) {
    float rr = uRadius * (float(i) + 1.0) / 3.0;
    float w = 1.0 - float(i) * 0.18;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.7853982 + float(i) * 0.3927;
      e = max(e, w * texture2D(tEdges, vUv + vec2(cos(a), sin(a)) * rr * uTexel).r);
    }
  }
  e = max(e, texture2D(tEdges, vUv).r);
  vec3 col = mix(tone.rgb, uInk, e);
  gl_FragColor = vec4(tone.a > 0.0 ? col : uInk, max(tone.a, e));
}
`;
