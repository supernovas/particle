/**
 * Fragment shaders for slide backgrounds — GLSL ES 1.0, one fullscreen
 * triangle, uniforms u_time / u_res. Tuned to the workspace palette:
 * near-black ground, violet accent, restrained brightness so the type wins.
 */

export type ShaderName = 'orbits' | 'flow' | 'julia' | 'waves';

const PRELUDE = `
precision highp float;
uniform float u_time;
uniform vec2 u_res;
`;

/** Orbiting particles — the namesake. Additive glow, slow lissajous paths. */
const ORBITS = `${PRELUDE}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time * 0.18;
  vec3 col = vec3(0.045, 0.045, 0.055);
  for (int i = 0; i < 42; i++) {
    float fi = float(i);
    float a = fi * 2.399963;             // golden angle
    float r = 0.12 + 0.42 * fract(fi * 0.618);
    float sp = 0.35 + 0.65 * fract(fi * 0.382);
    vec2 p = vec2(cos(t * sp + a), sin(t * sp * 0.83 + a * 1.7)) * r;
    float d = length(uv - p);
    float glow = 0.0008 / (d * d + 0.0006) + 0.00003 / (d * d + 0.000012);
    vec3 tint = mix(vec3(0.42, 0.38, 0.95), vec3(0.30, 0.62, 0.95), fract(fi * 0.27));
    col += glow * tint * 0.55;
  }
  float v = 1.0 - 0.55 * length(uv);
  gl_FragColor = vec4(col * v, 1.0);
}
`;

/** Domain-warped flow field — contour bands drifting like a current. */
const FLOW = `${PRELUDE}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.55; }
  return v;
}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time * 0.05;
  vec2 q = vec2(fbm(uv * 1.6 + t), fbm(uv * 1.6 - t * 0.7));
  vec2 r = vec2(fbm(uv * 1.6 + 2.4 * q + vec2(1.7, 9.2)), fbm(uv * 1.6 + 2.4 * q + vec2(8.3, 2.8)));
  float f = fbm(uv * 1.6 + 2.6 * r);
  float bands = smoothstep(0.42, 0.5, abs(fract(f * 7.0 + t * 2.0) - 0.5));
  vec3 base = mix(vec3(0.05, 0.05, 0.07), vec3(0.16, 0.13, 0.34), f * f * 1.4);
  vec3 line = vec3(0.36, 0.32, 0.8) * (1.0 - bands) * 0.5;
  float v = 1.0 - 0.5 * length(uv);
  gl_FragColor = vec4((base + line) * v, 1.0);
}
`;

/** A slow julia-set breathing loop with smooth escape coloring. */
const JULIA = `${PRELUDE}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y * 2.6;
  float t = u_time * 0.06 + 2.2;
  vec2 c = 0.7885 * vec2(cos(t), sin(t * 0.83));
  vec2 z = uv;
  float m = 0.0;
  for (int i = 0; i < 64; i++) {
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    if (dot(z, z) > 16.0) break;
    m += 1.0;
  }
  float s = m - log2(max(log2(dot(z, z)), 1.0));
  float g = clamp(s / 64.0, 0.0, 1.0);
  vec3 col = mix(vec3(0.05, 0.05, 0.08), vec3(0.42, 0.36, 0.95), pow(g, 1.15));
  col += vec3(0.7, 0.66, 1.0) * pow(g, 7.0) * 0.7;
  float v = 1.0 - 0.45 * length(uv / 2.6);
  gl_FragColor = vec4(col * v, 1.0);
}
`;

/** Interference of rotating plane waves, drawn as fine contours. */
const WAVES = `${PRELUDE}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float t = u_time * 0.12;
  float h = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float a = fi * 1.047 + t * (0.12 + 0.05 * fi);
    h += sin(dot(uv, vec2(cos(a), sin(a))) * (9.0 + fi * 2.0) - t * 1.7);
  }
  h /= 6.0;
  float line = smoothstep(0.06, 0.0, abs(fract(h * 3.0) - 0.5) * 0.33);
  vec3 base = mix(vec3(0.045, 0.045, 0.06), vec3(0.1, 0.12, 0.24), h * 0.5 + 0.5);
  vec3 col = base + vec3(0.3, 0.42, 0.85) * line * 0.35;
  float v = 1.0 - 0.5 * length(uv);
  gl_FragColor = vec4(col * v, 1.0);
}
`;

export const SHADERS: Record<ShaderName, string> = {
  orbits: ORBITS,
  flow: FLOW,
  julia: JULIA,
  waves: WAVES,
};
