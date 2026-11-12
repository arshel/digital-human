"use client";

import { useState } from "react";

// De afbeelding van het bericht vult het presentatorvak, achter een vrijstaande Nova. Ontbreekt
// de afbeelding of laadt die niet, dan een rustige achtergrond. Onderaan wordt het donkerder,
// zodat de ondertiteling leesbaar blijft. De bron staat rechtsboven ("Beeld: NOS").
export function NewsBackdrop({
  image,
  publisher,
  focus,
}: {
  image: string | null;
  publisher: string | null;
  focus: string;
}) {
  // Per afbeelding: een kapotte afbeelding van het vorige bericht telt niet voor het volgende.
  const [broken, setBroken] = useState<string | null>(null);
  const shown = image && broken !== image ? image : null;

  return (
    <div className="news-backdrop" aria-hidden="true">
      {shown && (
        <img
          key={shown}
          src={shown}
          alt=""
          referrerPolicy="no-referrer"
          style={{ objectPosition: focus }}
          onError={() => setBroken(shown)}
        />
      )}
      {shown && publisher && <span className="news-backdrop-credit">Beeld: {publisher}</span>}
    </div>
  );
}
