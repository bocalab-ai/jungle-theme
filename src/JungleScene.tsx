import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const FOV = 55;
const FOG_COLOR = new THREE.Color("#0d1e33");

const ASSET_V = "9";

// contentZ = the depth the HTML (headline, CTAs, demo app) lives at, and the ONLY
// scroll parameter. The camera's descent is derived so world at contentZ tracks
// the page scroll exactly 1:1; every layer's shift is then pure perspective:
//
//     shift_px = scrolled_px * (contentZ / z)
//
// so a layer AT contentZ is locked to the content, nearer layers overtake it,
// farther ones lag, and equal z always moves identically. Layers with z < contentZ
// additionally render into the canvas ABOVE the page content.
// ortho: 1 = orthographic projection (authoring aid — z affects only draw order)
const CAM = { mouseX: 0.02, mouseY: 0, driftX: 0, driftY: 0.06, contentZ: 10, ortho: 0 };

type LayerDef = {
  name: string;
  /** texture file basename in /jungle (defaults to name) */
  tex?: string;
  z: number;
  /** zoom: plane width as a fraction of the viewport width (aspect preserved) */
  cover: number;
  /** texture aspect (w/h) — every layer states its own; there are no kinds */
  aspect: number;
  /** center X, viewport-width fraction from center (+ = right) */
  x?: number;
  /** center Y on screen (0 = viewport top, 1 = bottom) AT scroll moment `at` */
  y?: number;
  /** scroll progress 0..1 at which `y` is the true on-screen position.
   *  Anchoring here is what makes z change ONLY the motion, not the placement. */
  at?: number;
  fog?: number;
  sway?: number;
  swayFreq?: number;
  /** uv distance over which alpha fades to 0 at the quad's borders */
  feather?: number;
  flip?: boolean;
  /** dropped from the render entirely (toggled from the tuner) */
  hidden?: boolean;
};

const TREE_A_ASPECT = 3404 / 6044;
const TREE_B_ASPECT = 3392 / 5936;
const BAND_ASPECT = 1536 / 1024;

// Depth ladder around contentZ = 10. Screen travel over the whole descent is
// scrolled_vh * (10 / z); the pinned hero scrolls ~3 viewports, so:
//   z 400 -> 0.07vh (static)   z 40 -> 0.75vh
//   z 110 -> 0.27vh            z 20 -> 1.5vh
//   z  10 -> 3.0vh (locked to the page content)
//   z   9 -> 3.3vh (just overtakes it, so it frames the content in front)
//   z 6.5 -> 4.6vh (sweeps past)
// y = center position in viewports from the viewport top, so > 1 starts below the
// fold and rises into view as the camera descends.
// `y` is where the layer sits ON SCREEN at scroll moment `at` (0 = top of the
// page, 1 = bottom of the hero). z then only sets how fast it drifts around that
// placement: speed = contentZ / z, total drift = speed * ~2.8 viewports.
//   z 400 -> 0.03x   z 90 -> 0.11x   z 35 -> 0.29x   z 18 -> 0.56x
//   z  10 -> 1.00x (locked to the page content)
//   z 8.5 -> 1.18x   z 7 -> 1.43x    z 6 -> 1.67x  (overtake it, so they pass)
const LAYERS: LayerDef[] = [
  { name: "sky", z: 468, cover: 1.21, aspect: BAND_ASPECT, x: 0.005, y: 0.545, at: 0, feather: 0 },
  { name: "far-jungle", z: 131, cover: 0.95, aspect: BAND_ASPECT, x: 0.03, y: 0.37, at: 0.94, fog: 0.4, sway: 0, swayFreq: 0, feather: 0.11 },
  { name: "mid-canopy", z: 90, cover: 1.08, aspect: BAND_ASPECT, x: 0, y: 0.405, at: 0.65, fog: 0.1, sway: 0, swayFreq: 0.06, feather: 0.1 },
  { name: "tree-right", tex: "tree-b", z: 50, cover: 0.54, aspect: TREE_B_ASPECT, x: 0.47, y: 0.965, at: 0.63, fog: 0.42, sway: 0.002, swayFreq: 0.2 },
  { name: "tree-left", tex: "tree-a", z: 33, cover: 0.73, aspect: TREE_A_ASPECT, x: -0.535, y: 0.96, at: 0.2, fog: 0.23, sway: 0, swayFreq: 0 },
  { name: "near-foliage", z: 12, cover: 1.11, aspect: BAND_ASPECT, x: -0.04, y: 1.175, at: 0.67, fog: 0, sway: 0, swayFreq: 0.08, feather: 0 },
  { name: "roots", z: 10, cover: 1.37, aspect: BAND_ASPECT, x: -0.05, y: 1.175, at: 0.74, fog: 0, sway: 0, feather: 0.14 },
  // the only layer nearer than contentZ, so the only one drawn over the page
  { name: "fg-leaves", z: 5, cover: 1.17, aspect: BAND_ASPECT, x: 0.055, y: 1.235, at: 0.9, fog: 0, sway: 0.01, swayFreq: 0.05, feather: 0 },
];

type SpriteDef = {
  /** stable key for tuner snapshots (index-based matching breaks on reorder) */
  id: string;
  name: string;
  /** anchor on a parent layer: uv point in the parent's plane (v from top) */
  parent?: string;
  u?: number;
  v?: number;
  /** distance in front of the parent */
  dz?: number;
  /** unparented placement: x from center / y from top in viewport fractions */
  x?: number;
  y?: number;
  /** scroll moment at which `y` is the true on-screen position (see LayerDef) */
  at?: number;
  z?: number;
  /** sprite height as a fraction of the first viewport's height */
  h: number;
  /** position so the sprite's TOP edge sits at the anchor (hanging objects) */
  hangTop?: boolean;
  aspect?: number;
  fog?: number;
  sway?: number;
  swayFreq?: number;

  pulse?: number;
  pulseSpeed?: number;
  flip?: boolean;
  /** dropped from the render entirely (toggled from the tuner) */
  hidden?: boolean;
};

const SPRITES: SpriteDef[] = [
  // moons sit deep so they stay nearly static, and behind far-jungle so the
  // distant treeline correctly occludes them
  { id: "moon-big", name: "moon", parent: "", z: 396, x: -0.19, y: -0.02, h: 0.65, fog: 0.64, pulse: 0.06, pulseSpeed: 0.22 },
  { id: "moon-small", name: "moon", parent: "", z: 58, x: 0.26, y: 0.065, h: 0.135, fog: 0.82, flip: true },
  // both detached from their layers in tuning; x/y/at/z are the standalone
  // equivalents of where the parent anchor put them (unparenting leaves those
  // undefined, which would otherwise pin the sprite to screen top at z 30)
  { id: "fern-near", name: "fern", parent: "", z: 14, x: -0.29, y: 0.88, at: 0.6, h: 0.14, sway: 0.04, swayFreq: 0.45, pulse: 0.1, pulseSpeed: 0.7, hidden: true },
  { id: "fern-fg", name: "fern", parent: "", z: 17.7, x: 0.472, y: 0.874, at: 0.9, h: 0.185, fog: 0, sway: 0.03, swayFreq: 0.38, pulse: 0.1, pulseSpeed: 0.55, flip: true, hidden: true },
  { id: "mushrooms-roots", name: "mushrooms", parent: "roots", u: 0.735, v: 0.715, dz: 0.2, h: 0.155, pulse: 0.3, pulseSpeed: 0.45, hidden: true },
];

const LAYER_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uSway;
  uniform float uSwayFreq;
  uniform float uPhase;
  varying vec2 vUv;

  void main() {
    vUv = uv;
    // The quad stays FLAT and RIGID. Sway translates the whole plane; nothing
    // displaces vertices per-UV, so perspective can never deform the artwork.
    vec3 p = position;
    p.x += uSway * sin(uTime * uSwayFreq + uPhase);
    p.y += uSway * 0.3 * cos(uTime * uSwayFreq * 0.8 + uPhase);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const LAYER_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uFogColor;
  uniform float uFog;
  uniform float uOpacity;
  uniform float uTime;
  uniform float uPulse;
  uniform float uPulseSpeed;
  uniform float uPhase;
  uniform float uFeather;
  varying vec2 vUv;

  void main() {
    vec4 c = texture2D(uMap, vUv);
    if (c.a < 0.004) discard;
    c.rgb = mix(c.rgb, uFogColor, uFog);
    c.rgb *= 1.0 + uPulse * (0.5 + 0.5 * sin(uTime * uPulseSpeed + uPhase * 3.7));
    // fade toward the quad's own borders so a plane smaller than the viewport
    // blends out instead of ending in a hard rectangular cut
    float edge = 1.0;
    if (uFeather > 0.0) {
      vec2 d = min(vUv, 1.0 - vUv);
      edge = smoothstep(0.0, uFeather, d.x) * smoothstep(0.0, uFeather, d.y);
    }
    gl_FragColor = vec4(c.rgb, c.a * uOpacity * edge);
  }
`;

const PARTICLE_VERT = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  attribute float aSize;
  attribute float aPhase;
  attribute vec3 aDrift;
  attribute float aKind;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vKind;
  varying float vPhase;

  void main() {
    vec3 p = position;
    p.x += sin(uTime * (0.05 + aDrift.x) + aPhase * 6.283) * aDrift.y * 2.0;
    p.y += sin(uTime * (0.07 + aDrift.z) + aPhase * 4.0) * 0.8;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = min(aSize * uPixelRatio * (140.0 / -mv.z), 15.0 * uPixelRatio);
    gl_Position = projectionMatrix * mv;
    vColor = aColor;
    vKind = aKind;
    vPhase = aPhase;
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vKind;
  varying float vPhase;

  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float glow = smoothstep(0.5, 0.0, length(d));
    glow *= glow;
    float blink = vKind > 0.5
      ? 0.15 + 0.85 * pow(0.5 + 0.5 * sin(uTime * (1.5 + vPhase * 2.0) + vPhase * 40.0), 4.0)
      : 0.55 + 0.45 * sin(uTime * 0.6 + vPhase * 12.0);
    gl_FragColor = vec4(vColor, glow * blink);
  }
`;

const VIGNETTE_SHADER = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5, 0.42));
      c.rgb *= 1.0 - smoothstep(0.5, 1.05, d) * 0.38;
      gl_FragColor = c;
    }
  `,
};

function frustumHeight(dist: number) {
  return 2 * dist * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
}

// ---------------------------------------------------------------------------
// Design tuner (open the page with ?tune): live sliders for every layer,
// sprite, and the camera. Persists to localStorage; "Copy" exports the JSON.
// ---------------------------------------------------------------------------
const TUNE_KEY = "jungle-tune-v7";

type Tunable = Record<string, unknown>;

// Only DESIGN parameters round-trip through the tuner. Structural fields
// (tex, aspect, kind, parent, flip) describe the ARTWORK, so a stale
// snapshot must never be able to override them — that stretches the texture.
const LAYER_TUNABLE = [
  "cover", "x", "y", "at", "z", "fog", "sway", "swayFreq", "feather", "hidden",
] as const;
// `parent` is editable: the scene graph is data, restructured from the panel.
const SPRITE_TUNABLE = [
  "h", "u", "v", "dz", "x", "y", "at", "z", "fog", "sway", "swayFreq", "pulse", "pulseSpeed", "parent", "hidden",
] as const;

function pick(src: Tunable, keys: readonly string[]) {
  const out: Tunable = {};
  for (const k of keys) {
    const v = src[k];
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

function applySavedTune() {
  try {
    const saved = JSON.parse(localStorage.getItem(TUNE_KEY) ?? "null");
    if (!saved) return;
    for (const l of LAYERS) {
      const s = saved.layers?.[l.name];
      if (s) Object.assign(l, pick(s, LAYER_TUNABLE));
    }
    for (const sp of SPRITES) {
      const s = saved.sprites?.[sp.id];
      if (s) Object.assign(sp, pick(s, SPRITE_TUNABLE));
    }
    if (saved.cam) Object.assign(CAM, pick(saved.cam, Object.keys(CAM)));
  } catch {
    /* corrupt saved state is ignored */
  }
}

function tuneSnapshot() {
  return {
    layers: Object.fromEntries(
      LAYERS.map((l) => [l.name, pick(l as unknown as Tunable, LAYER_TUNABLE)]),
    ),
    sprites: Object.fromEntries(
      SPRITES.map((s) => [s.id, pick(s as unknown as Tunable, SPRITE_TUNABLE)]),
    ),
    cam: { ...CAM },
  };
}

function buildTunePanel(onChange: () => void): () => void {
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;top:64px;right:8px;width:330px;max-height:calc(100vh - 80px);" +
    "display:flex;flex-direction:column;z-index:99999;background:rgba(8,12,22,0.95);" +
    "border:1px solid rgba(255,255,255,0.15);border-radius:8px;" +
    "font:11px/1.5 monospace;color:#cfe3ff;pointer-events:auto";

  const persist = () => {
    localStorage.setItem(TUNE_KEY, JSON.stringify(tuneSnapshot()));
    onChange();
  };

  // draggable title bar
  const bar = document.createElement("div");
  bar.style.cssText =
    "display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:move;" +
    "border-bottom:1px solid rgba(255,255,255,0.12);user-select:none";
  const title = document.createElement("span");
  title.textContent = "≡ jungle tuner";
  title.style.cssText = "flex:1;font-weight:bold;color:#ffd9a0";
  bar.appendChild(title);
  const mkBtn = (label: string, fn: () => void) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      "background:#1c2a44;color:#cfe3ff;border:1px solid rgba(255,255,255,0.2);" +
      "border-radius:5px;padding:2px 8px;cursor:pointer;font:inherit";
    b.onclick = fn;
    bar.appendChild(b);
    return b;
  };
  const copyBtn = mkBtn("Copy", async () => {
    await navigator.clipboard.writeText(JSON.stringify(tuneSnapshot(), null, 2));
    copyBtn.textContent = "Copied!";
    setTimeout(() => (copyBtn.textContent = "Copy"), 1200);
  });
  mkBtn("Reset", () => {
    localStorage.removeItem(TUNE_KEY);
    location.reload();
  });
  panel.appendChild(bar);

  bar.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).tagName === "BUTTON") return;
    const rect = panel.getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const offY = e.clientY - rect.top;
    panel.style.right = "auto";
    const move = (ev: PointerEvent) => {
      panel.style.left = `${Math.max(0, ev.clientX - offX)}px`;
      panel.style.top = `${Math.max(0, ev.clientY - offY)}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  const body = document.createElement("div");
  body.style.cssText = "overflow:auto;padding:6px 10px 10px";
  panel.appendChild(body);

  // collapsible tree node; returns the container for children/rows
  const node = (parentEl: HTMLElement, label: string, depth: number, open = false) => {
    const head = document.createElement("div");
    head.style.cssText = `margin:${depth ? 2 : 6}px 0 0 ${depth * 14}px;font-weight:bold;color:${depth ? "#9fd0ff" : "#ffd9a0"};cursor:pointer;user-select:none`;
    const arrow = document.createElement("span");
    arrow.textContent = open ? "▾ " : "▸ ";
    head.append(arrow, document.createTextNode(label));
    const kids = document.createElement("div");
    kids.style.cssText = `display:${open ? "block" : "none"};margin-left:${depth * 14}px`;
    head.onclick = () => {
      const shown = kids.style.display !== "none";
      kids.style.display = shown ? "none" : "block";
      arrow.textContent = shown ? "▸ " : "▾ ";
    };
    parentEl.append(head, kids);
    return kids;
  };

  const toggle = (parentEl: HTMLElement, obj: Tunable, key: string, label: string) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:6px;margin:2px 0 4px 12px";
    const lab = document.createElement("label");
    lab.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;color:#ffd9a0";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!obj[key];
    cb.style.accentColor = "#e8b87c";
    cb.onchange = () => {
      obj[key] = cb.checked;
      persist();
    };
    lab.append(cb, document.createTextNode(label));
    wrap.appendChild(lab);
    parentEl.appendChild(wrap);
  };

  const row = (parentEl: HTMLElement, obj: Tunable, key: string, min: number, max: number, step: number, label = key) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:6px;margin:1px 0 1px 12px";
    const lab = document.createElement("span");
    lab.textContent = label;
    lab.style.cssText = "width:80px;flex:none;color:#8fd4b8";
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String((obj[key] as number) ?? 0);
    input.style.cssText = "flex:1;accent-color:#e8b87c";
    const out = document.createElement("span");
    out.style.cssText = "width:46px;flex:none;text-align:right";
    out.textContent = Number(input.value).toFixed(3);
    input.oninput = () => {
      obj[key] = parseFloat(input.value);
      out.textContent = Number(input.value).toFixed(3);
      persist();
    };
    wrap.append(lab, input, out);
    parentEl.appendChild(wrap);
  };

  // reparent control: the scene graph is data, so any node can be moved to any
  // layer (or detached to free placement) from here
  const parentRow = (parentEl: HTMLElement, def: SpriteDef, rerender: () => void) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:6px;margin:2px 0 2px 12px";
    const lab = document.createElement("span");
    lab.textContent = "attach to";
    lab.style.cssText = "width:80px;flex:none;color:#ffb3d1";
    const sel = document.createElement("select");
    sel.style.cssText =
      "flex:1;background:#16233a;color:#cfe3ff;border:1px solid rgba(255,255,255,0.2);" +
      "border-radius:4px;padding:1px 3px;font:inherit";
    const opts = [{ v: "", t: "— free (x/y/z) —" }, ...LAYERS.map((l) => ({ v: l.name, t: l.name }))];
    for (const o of opts) {
      const el = document.createElement("option");
      el.value = o.v;
      el.textContent = o.t;
      if ((def.parent ?? "") === o.v) el.selected = true;
      sel.appendChild(el);
    }
    sel.onchange = () => {
      def.parent = sel.value;
      persist();
      rerender();
    };
    wrap.append(lab, sel);
    parentEl.appendChild(wrap);
  };

  const renderBody = () => {
    const scrollTop = body.scrollTop;
    body.replaceChildren();

    const camNode = node(body, "camera", 0, true);
    {
      // CAM stores ortho as 0/1, so it can't go through `toggle` (which is boolean)
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;align-items:center;gap:6px;margin:2px 0 4px 12px";
      const lab = document.createElement("label");
      lab.style.cssText = "display:flex;align-items:center;gap:6px;cursor:pointer;color:#ffd9a0";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!CAM.ortho;
      cb.style.accentColor = "#e8b87c";
      cb.onchange = () => {
        CAM.ortho = cb.checked ? 1 : 0;
        persist();
      };
      lab.append(cb, document.createTextNode("orthographic (z = order only)"));
      wrap.appendChild(lab);
      camNode.appendChild(wrap);
    }
    row(camNode, CAM, "mouseX", 0, 2, 0.01);
    row(camNode, CAM, "mouseY", 0, 2, 0.01);
    row(camNode, CAM, "driftX", 0, 0.5, 0.01);
    row(camNode, CAM, "driftY", 0, 0.5, 0.01);
    // how far the camera travels on scroll; z then decides each layer's share
    // layers nearer than this draw OVER the headline / demo app
    row(camNode, CAM, "contentZ", 1, 600, 1, "content depth");

  const spriteNode = (parentEl: HTMLElement, def: SpriteDef, depth: number) => {
    const d = def as unknown as Tunable;
    const el = node(parentEl, `${def.name} · ${def.id}`, depth);
    toggle(el, d, "hidden", "hide");
    parentRow(el, def, renderBody);
    row(el, d, "h", 0.02, 0.8, 0.005, "size");
    if (def.parent) {
      row(el, d, "u", 0, 1, 0.005, "anchor u");
      row(el, d, "v", 0, 1, 0.005, "anchor v");
      row(el, d, "dz", 0, 1.5, 0.01, "depth off");
    } else {
      row(el, d, "x", -0.6, 0.6, 0.005);
      row(el, d, "y", -1, 3, 0.005);
      row(el, d, "at", 0, 1, 0.01, "y @ scroll");
      row(el, d, "z", 1, 600, 1, "depth (z)");
    }
    row(el, d, "fog", 0, 1, 0.01);
    row(el, d, "sway", 0, 0.15, 0.002);
    row(el, d, "pulse", 0, 1, 0.01);
    row(el, d, "pulseSpeed", 0, 2, 0.01);
  };

  const free = SPRITES.filter((s) => !s.parent);
  if (free.length) {
    const el = node(body, `unattached (${free.length})`, 0);
    for (const s of free) spriteNode(el, s, 1);
  }

  for (const def of LAYERS) {
    const d = def as unknown as Tunable;
    const children = SPRITES.filter((s) => s.parent === def.name);
    const el = node(body, `${def.name}${children.length ? ` (${children.length})` : ""}`, 0);
    toggle(el, d, "hidden", "hide");
    row(el, d, "cover", 0.1, 5, 0.01, "zoom");
    row(el, d, "x", -1, 1, 0.005, "x pos");
    row(el, d, "y", -1, 3, 0.005, "y pos");
    row(el, d, "at", 0, 1, 0.01, "y @ scroll");
    row(el, d, "z", 1, 600, 1, "depth (z)");
    row(el, d, "feather", 0, 0.4, 0.005, "edge fade");
    row(el, d, "fog", 0, 1, 0.01);
    row(el, d, "sway", 0, 0.2, 0.002);
    row(el, d, "swayFreq", 0, 1.5, 0.01);
    for (const s of children) spriteNode(el, s, 1);
  }

    body.scrollTop = scrollTop;
  };

  renderBody();
  document.body.appendChild(panel);
  return () => panel.remove();
}

function makeMistTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * 256;
    const y = 40 + Math.random() * 60;
    const r = 45 + Math.random() * 65;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(255,255,255,0.16)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function JungleScene({
  className,
  frontSelector,
}: {
  className?: string;
  /** element to mount the in-front-of-content canvas into */
  frontSelector?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const smallScreen = window.matchMedia("(max-width: 767px)").matches;
    if (reducedMotion || smallScreen) return;

    applySavedTune();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }

    const gl = renderer.getContext();
    const dbgInfo = gl.getExtension("WEBGL_debug_renderer_info");
    const glRenderer = dbgInfo
      ? String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL))
      : "";
    const softwareGL = /swiftshader|llvmpipe|softpipe|software/i.test(glRenderer);

    let dpr = Math.min(window.devicePixelRatio || 1, softwareGL ? 0.75 : 2);
    renderer.setPixelRatio(dpr);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(new THREE.Color("#070d18"), 1);
    const canvas = renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.opacity = "0";
    canvas.style.transition = "opacity 1.2s ease";
    container.appendChild(canvas);

    // second context for layers nearer than contentZ; it draws over the HTML
    const frontHost = frontSelector
      ? document.querySelector<HTMLElement>(frontSelector)
      : null;
    let frontRenderer: THREE.WebGLRenderer | null = null;
    if (frontHost) {
      frontRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      frontRenderer.setPixelRatio(dpr);
      frontRenderer.toneMapping = THREE.NoToneMapping;
      frontRenderer.setClearColor(0x000000, 0);
      const fc = frontRenderer.domElement;
      fc.style.position = "absolute";
      fc.style.inset = "0";
      fc.style.width = "100%";
      fc.style.height = "100%";
      fc.style.opacity = "0";
      fc.style.transition = "opacity 1.2s ease";
      frontHost.appendChild(fc);
    }

    const scene = new THREE.Scene();
    const perspCamera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 4000);
    // Orthographic twin for authoring: no perspective, so z only decides draw
    // order — changing a layer's depth never shifts it up or down.
    const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 4000);
    const activeCamera = () => (CAM.ortho ? orthoCamera : perspCamera);
    // visible world height at a depth: constant under orthographic projection
    const viewH = (z: number) =>
      CAM.ortho ? frustumHeight(CAM.contentZ) : frustumHeight(z);
    let aspectRatio = 1;

    const texLoader = new THREE.TextureLoader();
    const disposables: { dispose(): void }[] = [];
    const meshes: { def: LayerDef; mesh: THREE.Mesh; mat: THREE.ShaderMaterial; aspect: number }[] = [];
    const spriteMeshes: { def: SpriteDef; mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];

    const makeLayerMaterial = (opts: {
      sway?: number;
      swayFreq?: number;
      phase: number;
      fog?: number;
      pulse?: number;
      pulseSpeed?: number;
      feather?: number;
    }) =>
      new THREE.ShaderMaterial({
        vertexShader: LAYER_VERT,
        fragmentShader: LAYER_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: {
          uMap: { value: null },
          uTime: { value: 0 },
          uSway: { value: opts.sway ?? 0 },
          uSwayFreq: { value: opts.swayFreq ?? 0.5 },
          uPhase: { value: opts.phase },
          uFog: { value: opts.fog ?? 0 },
          uFogColor: { value: FOG_COLOR },
          uOpacity: { value: 0 },
          uPulse: { value: opts.pulse ?? 0 },
          uPulseSpeed: { value: opts.pulseSpeed ?? 0.5 },
          uFeather: { value: opts.feather ?? 0 },
        },
      });

    const loadInto = (mat: THREE.ShaderMaterial, name: string) => {
      texLoader.load(`/jungle/${name}.webp?v=${ASSET_V}`, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        mat.uniforms.uMap.value = tex;
        mat.userData.fadeStart = -1;
        disposables.push(tex);
      });
    };

    LAYERS.forEach((def, i) => {
      const aspect = def.aspect;
      const mat = makeLayerMaterial({ ...def, phase: i * 1.7 });
      const geo = new THREE.PlaneGeometry(1, 1);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.z = -def.z;
      mesh.frustumCulled = false;
      scene.add(mesh);
      meshes.push({ def, mesh, mat, aspect });
      disposables.push(geo, mat);
      loadInto(mat, def.tex ?? def.name);
    });

    SPRITES.forEach((def, i) => {
      const mat = makeLayerMaterial({ ...def, phase: 2.3 + i * 1.9 });
      const geo = new THREE.PlaneGeometry(1, 1);
      const mesh = new THREE.Mesh(geo, mat);
      // renderOrder + position are resolved in layout(), where parents exist
      mesh.frustumCulled = false;
      scene.add(mesh);
      spriteMeshes.push({ def, mesh, mat });
      disposables.push(geo, mat);
      loadInto(mat, def.name);
    });

    // mist sheets between layer groups
    const mistTex = makeMistTexture();
    disposables.push(mistTex);
    const mists: THREE.Mesh[] = [];
    [
      { z: 34, y: -0.18, opacity: 0.1, tint: "#3d7f9e" },
      { z: 20, y: -0.24, opacity: 0.07, tint: "#2e6584" },
      { z: 10, y: -0.34, opacity: 0.05, tint: "#245068" },
    ].forEach((m, i) => {
      const mat = new THREE.MeshBasicMaterial({
        map: mistTex,
        transparent: true,
        opacity: m.opacity,
        color: new THREE.Color(m.tint),
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      });
      const geo = new THREE.PlaneGeometry(1, 1);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 100 - m.z + 0.5;
      mesh.position.z = -m.z;
      mesh.userData = { baseY: m.y, phase: i * 2.4, speed: 0.02 + i * 0.011 };
      mesh.frustumCulled = false;
      scene.add(mesh);
      mists.push(mesh);
      disposables.push(geo, mat);
    });

    // spores + fireflies
    const COUNT = softwareGL ? 140 : 340;
    const positions = new Float32Array(COUNT * 3);
    const sizes = new Float32Array(COUNT);
    const phases = new Float32Array(COUNT);
    const drifts = new Float32Array(COUNT * 3);
    const kinds = new Float32Array(COUNT);
    const colors = new Float32Array(COUNT * 3);
    const spore = new THREE.Color("#8fe8ff");
    const sporeAlt = new THREE.Color("#9fffe0");
    const fly = new THREE.Color("#ffd9a0");
    for (let i = 0; i < COUNT; i++) {
      const z = 5 + Math.random() * 30;
      const spanX = frustumHeight(z) * 1.1;
      const spanY = frustumHeight(z) * 0.62;
      positions[i * 3] = (Math.random() - 0.5) * spanX;
      positions[i * 3 + 1] = (Math.random() - 0.5) * spanY - spanY * 0.12;
      positions[i * 3 + 2] = -z;
      const firefly = Math.random() < 0.14;
      kinds[i] = firefly ? 1 : 0;
      sizes[i] = firefly ? 2.2 + Math.random() * 1.8 : 1.0 + Math.random() * 1.8;
      phases[i] = Math.random();
      drifts[i * 3] = Math.random() * 0.1;
      drifts[i * 3 + 1] = 0.3 + Math.random() * 0.9;
      drifts[i * 3 + 2] = Math.random() * 0.12;
      const c = firefly ? fly : Math.random() < 0.5 ? spore : sporeAlt;
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pGeo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    pGeo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    pGeo.setAttribute("aDrift", new THREE.BufferAttribute(drifts, 3));
    pGeo.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));
    pGeo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
    const pMat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: dpr },
      },
    });
    const points = new THREE.Points(pGeo, pMat);
    points.renderOrder = 150;
    points.frustumCulled = false;
    scene.add(points);
    disposables.push(pGeo, pMat);

    const composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, perspCamera);
    composer.addPass(renderPass);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.5, 0.62);
    const vignette = new ShaderPass(VIGNETTE_SHADER);
    composer.addPass(bloom);
    composer.addPass(vignette);
    composer.addPass(new OutputPass());
    bloom.enabled = !softwareGL;
    vignette.enabled = !softwareGL;

    let degraded = softwareGL;
    const degrade = () => {
      degraded = true;
      bloom.enabled = false;
      vignette.enabled = false;
      dpr = Math.min(dpr, 0.75);
      renderer.setPixelRatio(dpr);
      composer.setPixelRatio(dpr);
      pMat.uniforms.uPixelRatio.value = dpr;
      layout();
    };

    function layout() {
      const w = container!.clientWidth;
      const h = container!.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      frontRenderer?.setSize(w, h, false);
      aspectRatio = w / h;
      perspCamera.aspect = aspectRatio;
      perspCamera.updateProjectionMatrix();
      // ortho frustum matches the perspective frustum AT contentZ, so switching
      // projection leaves every layer the same size and place at rest
      const oh = frustumHeight(CAM.contentZ);
      orthoCamera.top = oh / 2;
      orthoCamera.bottom = -oh / 2;
      orthoCamera.left = (-oh * aspectRatio) / 2;
      orthoCamera.right = (oh * aspectRatio) / 2;
      orthoCamera.updateProjectionMatrix();
      renderPass.camera = activeCamera();
      // the composition is designed against the FIRST viewport of the section
      const vhFrac = Math.min(window.innerHeight / h, 1);
      // total scroll of the pinned hero, in viewport heights
      const sectionEl = container!.closest("section");
      const travelVh = sectionEl
        ? Math.max(sectionEl.getBoundingClientRect().height - window.innerHeight, 0) /
          window.innerHeight
        : 0;
      // A layer drifts by `speed * travelVh` over the descent. Anchoring y at
      // scroll moment `at` back-solves the rest position, so z changes motion
      // without moving the layer at the moment you composed it.
      const anchoredY = (yv: number, at: number, z: number) =>
        yv + at * travelVh * (CAM.ortho ? 1 : CAM.contentZ / z);

      const byName = new Map<string, { def: LayerDef; mesh: THREE.Mesh }>();
      for (const { def, mesh, aspect } of meshes) {
        byName.set(def.name, { def, mesh });
        const fH = viewH(def.z);
        const fW = fH * aspectRatio;
        const vh = fH * vhFrac;
        // every layer: a freely-placed plane, no special cases. zoom = width
        // fraction of viewport; x = center X; y = center Y (first-viewport frac)
        const pw = fW * def.cover;
        const ph = pw / aspect;
        const cx = (def.x ?? 0) * fW;
        const cy = fH / 2 - anchoredY(def.y ?? 0.5, def.at ?? 0, def.z) * vh;
        mesh.scale.set(def.flip ? -pw : pw, ph, 1);
        mesh.position.set(cx, cy, -def.z);
        mesh.renderOrder = 100 - def.z;
        mesh.userData.hidden = !!def.hidden;
        mesh.userData.art = { top: cy + ph / 2, h: ph, w: pw };
      }
      for (const mist of mists) {
        const fH = viewH(-mist.position.z);
        const fW = fH * aspectRatio;
        mist.scale.set(fW * 1.7, fH * 0.55, 1);
        mist.position.y = (mist.userData.baseY as number) * fH;
      }
      for (const { def, mesh } of spriteMeshes) {
        let z: number;
        let ax: number;
        let ay: number;
        if (def.parent) {
          const parent = byName.get(def.parent);
          if (!parent) continue;
          z = parent.def.z - (def.dz ?? 0.25);
          const pm = parent.mesh;
          // anchor within the parent's ART rect, not its (possibly extended) plane
          const art = pm.userData.art as { top: number; h: number; w: number };
          ax = pm.position.x + ((def.u ?? 0.5) - 0.5) * art.w;
          ay = art.top - (def.v ?? 0.5) * art.h;
        } else {
          z = def.z ?? 30;
          const fH = viewH(z);
          const fW = fH * aspectRatio;
          ax = (def.x ?? 0) * fW;
          ay = fH / 2 - anchoredY(def.y ?? 0, def.at ?? 0, z) * fH * vhFrac;
        }
        const vh = viewH(z) * vhFrac;
        const sh = def.h * vh;
        const sw = sh * (def.aspect ?? 1);
        mesh.scale.set(def.flip ? -sw : sw, sh, 1);
        mesh.position.set(ax, def.hangTop ? ay - sh / 2 : ay, -z);
        mesh.renderOrder = 100 - z;
        mesh.userData.hidden = !!def.hidden;
      }
    }
    layout();
    const resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(container);
    // the anchor math depends on the SECTION's scroll length, which changes
    // independently of the (always 100vh) canvas — watch it too or anchors go stale
    const sectionForResize = container.closest("section");
    if (sectionForResize) resizeObserver.observe(sectionForResize);

    const syncUniforms = () => {
      for (const { def, mat } of meshes) {
        mat.uniforms.uFog.value = def.fog ?? 0;
        mat.uniforms.uSway.value = def.sway ?? 0;
        mat.uniforms.uSwayFreq.value = def.swayFreq ?? 0.5;
        mat.uniforms.uFeather.value = def.feather ?? 0;
      }
      for (const { def, mat } of spriteMeshes) {
        mat.uniforms.uFog.value = def.fog ?? 0;
        mat.uniforms.uSway.value = def.sway ?? 0;
        mat.uniforms.uSwayFreq.value = def.swayFreq ?? 0.5;
        mat.uniforms.uPulse.value = def.pulse ?? 0;
        mat.uniforms.uPulseSpeed.value = def.pulseSpeed ?? 0.5;
      }
    };
    let removeTuner: (() => void) | undefined;
    if (new URLSearchParams(window.location.search).has("tune")) {
      removeTuner = buildTunePanel(() => {
        syncUniforms();
        layout();
      });
    }

    const mouse = { x: 0, y: 0 };
    const onPointerMove = (e: PointerEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });



    let inView = true;
    const io = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      syncLoop();
    });
    io.observe(container);
    const onVisibility = () => syncLoop();
    document.addEventListener("visibilitychange", onVisibility);

    let raf = 0;
    let running = false;
    let elapsed = 0;
    let last = 0;
    let firstFrame = true;
    let frames = 0;
    let frameAccum = 0;
    let smoothX = 0;
    let smoothY = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const rawDt = (now - last) / 1000;
      const dt = Math.min(rawDt, 0.05);
      last = now;
      elapsed += dt;

      frames++;
      container!.dataset.frames = String(frames);
      if (!degraded && frames <= 50) {
        frameAccum += rawDt;
        if (frames === 50 && frameAccum / 50 > 0.07) degrade();
      }

      const driftX =
        Math.sin(elapsed * 0.035) * CAM.driftX * 0.65 +
        Math.sin(elapsed * 0.011) * CAM.driftX * 0.35;
      const driftY = Math.cos(elapsed * 0.028) * CAM.driftY;
      const k = 1 - Math.exp(-dt * 2.4);
      // mouse + ambient drift are eased (feels organic); the scroll term is
      // applied 1:1 with no smoothing so the parallax is locked to the scroll
      // position rather than chasing it
      smoothX += (mouse.x * CAM.mouseX + driftX - smoothX) * k;
      smoothY += (-mouse.y * CAM.mouseY + driftY - smoothY) * k;
      // Camera descent is DERIVED, not a tuned magnitude: one screen pixel of
      // scroll moves the world by exactly one pixel at contentZ, so the scene at
      // that depth is locked to the page content and perspective does the rest.
      const section = container!.closest("section");
      let scrolledPx = 0;
      if (section) {
        const r = section.getBoundingClientRect();
        const travelPx = Math.max(r.height - window.innerHeight, 0);
        scrolledPx = Math.min(Math.max(-r.top, 0), travelPx);
      }
      const worldPerPx = frustumHeight(CAM.contentZ) / window.innerHeight;
      const camY = smoothY - scrolledPx * worldPerPx;
      const camRoll = Math.sin(elapsed * 0.015) * 0.003;
      for (const c of [perspCamera, orthoCamera]) {
        c.position.set(smoothX, camY, 0);
        c.rotation.z = camRoll;
      }

      for (const { mat } of [...meshes, ...spriteMeshes]) {
        mat.uniforms.uTime.value = elapsed;
        if (mat.uniforms.uMap.value && mat.uniforms.uOpacity.value < 1) {
          if (mat.userData.fadeStart === -1) mat.userData.fadeStart = elapsed;
          mat.uniforms.uOpacity.value = Math.min((elapsed - mat.userData.fadeStart) / 0.9, 1);
        }
      }
      pMat.uniforms.uTime.value = elapsed;
      for (const mist of mists) {
        const { phase, speed } = mist.userData as { phase: number; speed: number };
        mist.position.x = Math.sin(elapsed * speed + phase) * mist.scale.x * 0.06;
      }

      // Split the scene by depth around contentZ: deeper objects render into the
      // canvas behind the HTML, nearer ones into the canvas above it.
      const splittable = [
        ...meshes.map((m) => m.mesh),
        ...spriteMeshes.map((s) => s.mesh),
        ...mists,
      ];
      const shown = (o: THREE.Object3D) => !o.userData.hidden;
      if (frontRenderer) {
        for (const o of splittable) o.visible = shown(o) && -o.position.z >= CAM.contentZ;
        points.visible = true;
        composer.render();
        for (const o of splittable) o.visible = shown(o) && -o.position.z < CAM.contentZ;
        points.visible = false;
        frontRenderer.render(scene, activeCamera());
        for (const o of splittable) o.visible = true;
      } else {
        for (const o of splittable) o.visible = shown(o);
        composer.render();
      }

      if (firstFrame) {
        firstFrame = false;
        canvas.style.opacity = "1";
        if (frontRenderer) frontRenderer.domElement.style.opacity = "1";
      }
    };

    function syncLoop() {
      const shouldRun = inView && !document.hidden;
      if (shouldRun && !running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(raf);
      }
    }
    syncLoop();

    return () => {
      removeTuner?.();
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointermove", onPointerMove);

      composer.passes.forEach((p) => p.dispose?.());
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      canvas.remove();
      if (frontRenderer) {
        const fc = frontRenderer.domElement;
        frontRenderer.dispose();
        fc.remove();
      }
    };
  }, [frontSelector]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={className}
      style={{
        background:
          "linear-gradient(180deg, #0a1526 0%, #0b1a2e 45%, #0c1524 75%, #0f0f14 100%)",
      }}
    >
      {/* poster under the canvas; sole visual on mobile / reduced motion / no WebGL */}
      <img
        src="/jungle/fallback.webp"
        alt=""
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
      />
    
    </div>
  );
}
