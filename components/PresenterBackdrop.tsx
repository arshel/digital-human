"use client";

import { useEffect, useRef } from "react";

// Extend only the empty outer edges of the portrait's background. The person
// stays in the original, undistorted video on top. No extra video/audio player.
export function PresenterBackdrop({ poster }: { poster: string | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const context = target.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, target.width, target.height);
    if (!poster) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled) return;
      // Continue each edge at its original vertical position, so the portrait
      // joins the extension without a different shade beside the shoulders.
      // Drawing cross-origin images is allowed; no pixels are read or exported.
      context.drawImage(
        image,
        0,
        0,
        1,
        image.naturalHeight,
        0,
        0,
        target.width / 2,
        target.height,
      );
      context.drawImage(
        image,
        image.naturalWidth - 1,
        0,
        1,
        image.naturalHeight,
        target.width / 2,
        0,
        target.width / 2,
        target.height,
      );
    };
    image.src = poster;
    return () => {
      cancelled = true;
    };
  }, [poster]);

  return (
    <canvas
      ref={canvas}
      width={128}
      height={128}
      className="presenter-background"
      aria-hidden="true"
    />
  );
}
