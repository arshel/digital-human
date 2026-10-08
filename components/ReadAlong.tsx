'use client';

import { useId, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { LessIcon, MoreIcon } from './icons';

// Splitsen na . ! ? of … gevolgd door een hoofdletter, cijfer of aanhalingsteken.
// "o.a. de" en "1.000" blijven daardoor heel.
export function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?…]["”’)]?)\s+(?=["“‘(]?[A-ZÀ-ÖØ-Þ0-9])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Het meeleesvak: de hele tekst van Nova in één wit vak, zonder bladzijden. Het vak is zo hoog als
// de tekst, tot een paar regels (--reading-lines in de CSS). Is er meer, dan scrolt het vak en
// toont "Toon meer" alles. Klinkt er een zin, dan heeft die de class is-spoken (de pagina zet die
// op het start-event van de stem) en blijft die zin in beeld.
export function ReadAlong({
  textRef,
  version,
  spoken,
  footer,
  children,
}: {
  textRef: RefObject<HTMLDivElement | null>;
  // Verandert zodra er andere tekst staat: dan weer compact en vanaf het begin.
  version: string;
  spoken: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const id = useId();

  useLayoutEffect(() => {
    setExpanded(false);
    textRef.current?.scrollTo({ top: 0 });
  }, [version, textRef]);

  // Past de tekst niet in het compacte vak? Opnieuw meten bij een andere breedte of tekstgrootte.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || expanded) return;
    const update = () => setOverflow(el.scrollHeight > el.clientHeight + 1);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [version, expanded, textRef]);

  // De zin die klinkt in beeld houden. Alleen scrollen als die buiten het vak valt, en dan
  // bovenaan zetten, zodat de zinnen erna eronder staan.
  useLayoutEffect(() => {
    const box = textRef.current;
    const line = box?.querySelector<HTMLElement>('.is-spoken');
    if (!box || !line || expanded) return;
    if (line.offsetTop >= box.scrollTop && line.offsetTop + line.offsetHeight <= box.scrollTop + box.clientHeight) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.scrollTo({ top: line.offsetTop, behavior: still ? 'auto' : 'smooth' });
  }, [spoken, expanded, textRef]);

  return (
    <section className="readalong" aria-label="Tekst van Nova">
      <div
        ref={textRef}
        id={id}
        className="readalong-text"
        data-expanded={expanded || undefined}
        // Scrolt het vak, dan kan dat ook met het toetsenbord.
        tabIndex={overflow && !expanded ? 0 : -1}
        aria-live="polite"
      >
        {children}
      </div>
      {(footer || overflow) && (
        <div className="readalong-foot">
          {footer}
          {overflow && (
            <button
              type="button"
              className="readalong-more"
              aria-expanded={expanded}
              aria-controls={id}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? 'Toon minder' : 'Toon meer'}
              {expanded ? <LessIcon /> : <MoreIcon />}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
