'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

// Paneel als native <dialog>. showModal() houdt de focus binnen het paneel en Escape sluit
// het; daarna gaat de focus terug naar de knop die het paneel opende. Op een smal scherm is
// het een blad vanaf de onderkant (CSS) dat boven het schermtoetsenbord blijft.
export function Panel({
  open,
  onClose,
  title,
  size = 'wide',
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: 'compact' | 'wide';
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
      d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open) {
      if (d.open) d.close();
      opener.current?.focus();
      opener.current = null;
    }
  }, [open]);

  // iOS schuift het toetsenbord over de pagina heen in plaats van die kleiner te maken.
  // Het blad schuift daarom zelf omhoog, zodat het invoerveld zichtbaar blijft.
  useEffect(() => {
    const d = dialog.current;
    const viewport = window.visualViewport;
    if (!open || !d || !viewport) return;
    const update = () =>
      d.style.setProperty('--keyboard', `${Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)}px`);
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      d.style.removeProperty('--keyboard');
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={`panel panel-${size}`}
      aria-labelledby={titleId}
      // Escape: zelf sluiten, zodat de state en het paneel gelijk blijven.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Sluit de browser het paneel toch zelf (twee keer Escape in Chrome), dan de state volgen.
      onClose={() => {
        if (open) onClose();
      }}
      // Klik naast het paneel (op de achtergrond) sluit het ook.
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="panel-body">
        <div className="panel-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            <CloseIcon />
            Sluiten
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
