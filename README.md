# jungle-theme

A scroll-driven jungle you descend through: twelve painted image layers mounted as flat planes at real depths inside a three.js scene, with a live parameter tuner built into the page.

## What this actually is

This is **2.5D multiplane**, not true 3D geometry. There is no modelled jungle, no meshes with leaves, no baked lighting. The art was generated with an image model, keyed to transparency, and each layer is a single textured quad placed at a real `z` in a perspective camera's frustum.

Everything that makes it feel three-dimensional genuinely is: the camera moves in 3D, the layers are at different depths, so parallax, occlusion order, perspective scaling, fog blending, and depth-of-composition all fall out of the projection rather than being animated by hand. The visual fidelity, meanwhile, comes entirely from the artwork. It is the old animation-stand multiplane trick with a GPU under it — cheap to render, and it looks like painted art because it *is* painted art.

## Quick start

```bash
npm install
npm run dev
```

Then open the printed URL. `npm run build` typechecks and produces `dist/`; `npm run preview` serves the build.

The scene disables itself (and shows the static poster instead) for `prefers-reduced-motion`, for viewports under 768px, and when WebGL can't be created.

## The live tuner

Append `?tune` to the URL.

A panel mounts over the page with a slider for every design parameter in the scene, and edits apply to the running scene on the next frame — no reload, no rebuild.

- **Tree-structured.** Layers are top-level nodes; sprites appear nested under whichever layer they are attached to, with unattached sprites collected in their own group. Nodes are collapsible so you can work on one layer at a time.
- **Reparenting is part of the UI.** Every sprite has an "attach to" dropdown listing all layers plus `— free (x/y/z) —`. The scene graph is data, so moving a mushroom cluster from the roots layer to the canopy — or detaching it into free placement — is a dropdown, not a code edit. The sprite's controls change accordingly (`anchor u`/`anchor v`/`depth off` when parented, `x`/`y`/`y @ scroll`/`depth (z)` when free).
- **Draggable.** Grab the title bar and move the panel anywhere so it stops covering the thing you're tuning.
- **Persistent.** Every change is written to `localStorage` immediately, so a reload keeps your state. **Copy** puts the full parameter snapshot on your clipboard as JSON, ready to paste back into the `LAYERS` / `SPRITES` / `CAM` defaults. **Reset** clears the saved state and reloads to the committed defaults.
- **Orthographic toggle.** Switches the camera to an orthographic twin whose frustum matches the perspective frustum at `contentZ`, so `z` becomes pure draw order. Useful while composing: you can restack layers without perspective shifting them around.

Only design parameters round-trip through the tuner. Structural fields that describe the artwork (`tex`, `aspect`, `parent` for layers, `flip`) are never written by a snapshot, so a stale `localStorage` entry can't stretch a texture.

## The parameter model

This is the interesting engineering idea in the project, and it's worth reading before you touch a number.

### `contentZ` is the only scroll parameter

The page content (headline, paragraphs — whatever you put inside `JungleStage`) conceptually lives at one depth: `contentZ`. The camera's descent is not a tuned magnitude. It is *derived* so that one pixel of page scroll moves the world by exactly one pixel at `contentZ`:

```
camY -= scrolled_px * frustumHeight(contentZ) / innerHeight
```

Every layer's on-screen movement then follows from perspective alone:

```
shift_px = scrolled_px * (contentZ / z)
```

So a layer at `contentZ` is locked to the content, two layers at equal `z` always move identically, and there is no per-layer speed to keep in sync. There is exactly one scroll knob for the whole scene.

### `z` is the single depth control

Because motion is derived from depth, `z` is the only thing you change to alter how a layer travels:

- `z > contentZ` — the layer lags behind the content (distance).
- `z == contentZ` — locked to the content.
- `z < contentZ` — the layer *overtakes* the content, and is also rendered into the **front** canvas, so it draws over the HTML. That is how near foliage sweeps across the copy.

### `at` anchors placement so `z` only changes motion

Naively, changing a layer's depth moves it on screen, so composition and parallax fight each other. Here every layer states an anchor instead: `y` is the layer's **true on-screen position at scroll progress `at`** (`y` in viewport fractions from the top, `at` in 0..1 over the pinned section). The rest position is back-solved from that anchor, so changing `z` alters the layer's *motion* and never its *placement at the moment you composed it*. `x` is the horizontal center as a fraction of viewport width from the center.

### The rest of the per-layer parameters

- `cover` — plane width as a fraction of the viewport width; the aspect ratio is preserved from the artwork, so this is a zoom.
- `feather` — the uv distance over which alpha fades to zero at the quad's borders, so a plane narrower than the viewport blends out instead of ending in a hard rectangular cut.
- `fog` — how far the layer's color is mixed toward the fog color (aerial perspective for depth).
- `sway` / `swayFreq` — a slow drift. The quad stays flat and **rigid**: sway translates the whole plane, no vertex is displaced per-uv, so perspective can never deform the painting.
- `pulse` / `pulseSpeed` — a slow brightness breath, used on the glowing sprites (moon, fungi, ferns).

### Sprites

Sprites are the small objects (moons, ferns, mushrooms). They are the same quads with two placement modes:

- **Parented** to a layer: placed at a `u`/`v` point inside that layer's *art rect* with a `dz` offset in front of the parent. The sprite then inherits the parent's motion exactly, so it stays glued to the branch or root it sits on.
- **Unparented**: placed with its own `x` / `y` / `at` / `z`, exactly like a layer.

`h` sets the sprite's height as a fraction of the first viewport's height; `hangTop` positions it by its top edge instead of its center, for things that hang.

## How it's built

- **Two stacked WebGL canvases.** The back canvas (opaque, with an `EffectComposer`: render pass, `UnrealBloomPass`, a custom vignette pass, output pass) draws everything at or beyond `contentZ`. The front canvas (transparent, no bloom) draws everything nearer. The HTML content sits between them in the z-index stack, so page copy can be genuinely *sandwiched* inside the scene. Each frame flips object visibility by depth and renders both.
- **Custom shader material** per plane: fog mix, brightness pulse, alpha discard for keyed art, and uv-space edge feathering.
- **Particle field** — a few hundred additive points, spores plus a fraction of fireflies with a sharp blink curve, drifting on sine offsets in the vertex shader.
- **Additive mist planes** between depth groups, from a canvas-generated radial-blob texture, sliding slowly sideways.
- **Adaptive quality.** `WEBGL_debug_renderer_info` detects software rasterizers (SwiftShader / llvmpipe) and starts degraded; a frame-time watchdog measures the first 50 frames and, if the average is worse than ~70ms, disables bloom and the vignette and caps the device pixel ratio. Particle count drops on software GL too.
- **Cheap idling.** An `IntersectionObserver` and `visibilitychange` stop the render loop when the scene is off-screen or the tab is hidden.
- **Static fallback.** A pre-composited poster image sits under the canvases and is the only visual on mobile, under reduced-motion, or if WebGL fails.
- **Layout is recomputed**, not animated, on resize: a `ResizeObserver` watches both the canvas host and the scrolling section, because the anchor math depends on the section's scroll length.

`JungleScene` is one self-contained component (plain `useEffect` + `useRef`, no react-three-fiber) and `JungleStage` is the ~70-line wrapper that pins it, hosts the front canvas, and applies the readability scrim over the content.

## Assets

`public/jungle/` holds 12 WebP layers, about 9.4MB total: `sky`, `far-jungle`, `mid-canopy`, `tree-a`, `tree-b`, `fg-leaves`, `roots`, `near-foliage`, plus the `moon`, `fern` and `mushrooms` sprites and the `fallback` poster.

They were generated with an image model, keyed out of a checkerboard background, 4x upscaled with Real-ESRGAN, and exported as tiered-quality WebP (the big bands at up to 4096-6144px wide, sprites at 2048px). They are heavy on purpose: this is the entire visual budget of the project, and the scene has nothing else to look at.

## License

Code is MIT — see [LICENSE](./LICENSE).

The image assets in `public/jungle/` are included in this repository and are the author's; they ship under the same MIT terms as the code, so feel free to reuse them, but attribution is appreciated.
