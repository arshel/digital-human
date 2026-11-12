"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { GreenScreenRenderer, type Source } from "@/components/presenter/greenscreen";
import type { KeySettings } from "@/lib/greenscreen";

// Nova vrijstaand: tekent de bron (de Anam-video, de wachtvideo of het stilstaande beeld) met het
// groen doorzichtig. De bron zelf staat onzichtbaar in de pagina; het geluid van Anam blijft
// daar. Lukt WebGL niet, dan meldt onFail dat, één keer, en valt de pagina terug.
export function GreenScreenCanvas({
  source,
  keySettings,
  className,
  style,
  label,
  onFail,
  width = 1152,
  height = 768,
}: {
  source: () => Source | null;
  keySettings: KeySettings;
  className?: string;
  style?: CSSProperties;
  label?: string;
  onFail: (reason: string) => void;
  // Beginmaat: die van de bron die komt (liggend of staand).
  width?: number;
  height?: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<GreenScreenRenderer | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const failRef = useRef(onFail);
  failRef.current = onFail;

  // Eén renderer en één tekenlus zolang het canvas bestaat; opgeruimd bij weghalen.
  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const r = new GreenScreenRenderer(target, keySettings, (reason) => failRef.current(reason));
    if (!r.ok) {
      failRef.current("WebGL werkt niet");
      return;
    }
    renderer.current = r;
    r.start(() => sourceRef.current());
    return () => {
      r.destroy();
      renderer.current = null;
    };
    // De instellingen gaan hieronder mee zonder nieuwe renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (renderer.current) renderer.current.settings = keySettings;
  }, [keySettings]);

  return (
    <canvas
      ref={canvas}
      // Beginmaat als de Anam-stream (3:2), zodat de opmaak niet verspringt bij het eerste beeld.
      // Daarna neemt de renderer de maat van de bron over.
      width={width}
      height={height}
      className={className}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
