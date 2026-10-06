'use client';

import { useLayoutEffect, useMemo, useState, type RefObject } from 'react';

export type Sentence = { text: string; index: number };

// Hooguit zoveel regels ondertiteling tegelijk.
const MAX_LINES = 2;

// Splitsen na . ! ? of … gevolgd door een hoofdletter, cijfer of aanhalingsteken.
// "o.a. de" en "1.000" blijven daardoor heel.
export function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?…]["”’)]?)\s+(?=["“‘(]?[A-ZÀ-ÖØ-Þ0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

let canvas: HTMLCanvasElement | null = null;

function textWidth(text: string, font: string) {
  canvas ??= document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return 0;
  context.font = font;
  return context.measureText(text).width;
}

// Meelezen zonder timing. Nova spreekt nog niet, dus er is geen echte koppeling tussen tekst
// en geluid. De tekst gaat daarom in stukjes van hooguit twee regels, met elke zin op een
// eigen regel, en de lezer bladert zelf. Hoeveel zinnen er in een stukje passen, hangt af van
// de breedte en de letter; dat wordt gemeten, ook opnieuw bij draaien of grotere tekst.
export function useReadAlong(sentences: string[], box: RefObject<HTMLElement | null>): Sentence[][] {
  const [measure, setMeasure] = useState({ width: 0, font: '' });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => {
      const style = getComputedStyle(el);
      // Vet meten: de belangrijkste zin staat vet en is dus breder.
      const font = `700 ${style.fontSize} ${style.fontFamily}`;
      const width = el.clientWidth;
      setMeasure((m) => (m.width === width && m.font === font ? m : { width, font }));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [box]);

  return useMemo(() => {
    const items = sentences.map((text, index) => ({ text, index }));
    if (!measure.width) return items.map((s) => [s]);

    const chunks: Sentence[][] = [];
    let chunk: Sentence[] = [];
    let lines = 0;
    for (const item of items) {
      // Afbreken op woorden kost wat ruimte; daarom niet de volle breedte rekenen.
      const needed = Math.max(1, Math.ceil(textWidth(item.text, measure.font) / (measure.width * 0.92)));
      if (chunk.length && lines + needed > MAX_LINES) {
        chunks.push(chunk);
        chunk = [];
        lines = 0;
      }
      chunk.push(item);
      lines += needed;
    }
    if (chunk.length) chunks.push(chunk);
    return chunks;
  }, [sentences, measure]);
}
