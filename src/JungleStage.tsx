import type { ReactNode } from "react";
import { JungleScene } from "./JungleScene";

/**
 * Pins the jungle to the viewport while everything passed as `children` scrolls
 * over it, so the camera descends for the whole length of that content. The
 * scene renders into two stacked canvases with the page content sandwiched
 * between them, so layers nearer than `contentZ` draw in front of the copy.
 */
export function JungleStage({ children }: { children: ReactNode }) {
  return (
    // no overflow:hidden on the section: it would break the sticky pin
    <section style={{ position: "relative" }}>
      <div
        style={{
          pointerEvents: "none",
          position: "sticky",
          top: 0,
          zIndex: 0,
          height: "100vh",
          overflow: "hidden",
        }}
      >
        {/* the scene only takes a className, so the fill rule lives in index.css */}
        <JungleScene className="jungle-scene-fill" frontSelector="#jungle-front" />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse 54% 40% at 50% 28%, rgba(5,10,20,0.52), transparent 72%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "16rem",
            background:
              "linear-gradient(to bottom, transparent, rgba(15,15,20,0.45), rgba(15,15,20,0.8))",
          }}
        />
      </div>

      {/* layers nearer than `content depth` render here, on top of the copy */}
      <div
        id="jungle-front"
        style={{
          pointerEvents: "none",
          position: "sticky",
          top: 0,
          zIndex: 20,
          marginTop: "-100vh",
          height: "100vh",
          overflow: "hidden",
        }}
      />

      <div
        style={{
          position: "relative",
          zIndex: 10,
          marginTop: "-100vh",
        }}
      >
        {children}
      </div>
    </section>
  );
}
