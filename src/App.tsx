import type { CSSProperties } from "react";
import { JungleStage } from "./JungleStage";

const wrap: CSSProperties = {
  maxWidth: "48rem",
  margin: "0 auto",
  padding: "0 1.5rem",
};

const block: CSSProperties = {
  ...wrap,
  minHeight: "80vh",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: "1rem",
};

const heading: CSSProperties = {
  margin: 0,
  fontSize: "clamp(1.5rem, 3.4vw, 2.25rem)",
  fontWeight: 600,
  letterSpacing: "-0.02em",
};

const body: CSSProperties = {
  margin: 0,
  fontSize: "1.0625rem",
  lineHeight: 1.7,
  color: "rgba(232,238,248,0.78)",
};

export function App() {
  return (
    <main>
      <JungleStage>
        <section
          style={{
            ...wrap,
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: "1.25rem",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(2.75rem, 9vw, 6rem)",
              fontWeight: 700,
              letterSpacing: "-0.04em",
              lineHeight: 1,
              textShadow: "0 2px 40px rgba(0,0,0,0.55)",
            }}
          >
            Jungle Theme
          </h1>
          <p style={{ ...body, maxWidth: "34rem" }}>
            A layered 2.5D three.js scene: twelve painted image layers mounted as flat
            planes at real depths, so scrolling descends a camera through them and
            perspective does all the parallax for free.
          </p>
          <p style={{ ...body, fontSize: "0.9375rem", color: "rgba(232,238,248,0.6)" }}>
            Scroll down. Append{" "}
            <a
              href="?tune"
              style={{
                color: "#ffd9a0",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              ?tune
            </a>{" "}
            to the URL to open the live parameter panel.
          </p>
        </section>

        <section style={block}>
          <h2 style={heading}>The content lives at a depth</h2>
          <p style={body}>
            This text sits at <code>contentZ</code>. The camera&apos;s descent is derived so
            that the world at that depth tracks page scroll exactly one-to-one, which makes
            every other layer&apos;s motion pure perspective:{" "}
            <code>shift_px = scrolled_px * (contentZ / z)</code>. Nothing about the scroll is
            hand-tuned per layer.
          </p>
        </section>

        <section style={block}>
          <h2 style={heading}>Nearer layers cross over the copy</h2>
          <p style={body}>
            Anything with <code>z</code> smaller than <code>contentZ</code> overtakes this
            paragraph as you scroll, and renders into a second transparent canvas stacked
            above the HTML. That is the whole trick behind foliage sweeping in front of the
            text while the treeline behind it lags.
          </p>
        </section>

        <section style={block}>
          <h2 style={heading}>Composition and motion are decoupled</h2>
          <p style={body}>
            Each layer states where it should be on screen at one scroll moment, and the rest
            of its path is solved from that anchor. So dragging a layer&apos;s depth changes
            how fast it moves without ever moving it out of the frame you composed. Open the
            tuner and try it: drag <code>depth (z)</code> on any layer and watch only the
            motion change.
          </p>
        </section>

        <section style={{ ...block, minHeight: "60vh" }}>
          <h2 style={heading}>Made of art, not geometry</h2>
          <p style={body}>
            There is no modelled jungle here. The fidelity comes from the painted layers; the
            depth, fog, sway, bloom, and camera come from three.js. It is an old matte-painting
            idea running on a GPU.
          </p>
        </section>
      </JungleStage>
    </main>
  );
}
