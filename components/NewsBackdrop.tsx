"use client";

import { useEffect, useRef, useState } from "react";

// De afbeelding van het bericht vult het presentatorvak, achter een vrijstaande Nova. Ontbreekt
// de afbeelding of laadt die niet, dan een rustige achtergrond. Onderaan wordt het donkerder,
// zodat de ondertiteling leesbaar blijft. De bron staat rechtsboven ("Beeld: NOS").
//
// Met `videoId` (test, lib/video.ts): de NOS-video bij het bericht, zonder geluid, over de
// afbeelding heen zodra die speelt. Lukt dat niet, dan blijft de afbeelding staan.
export function NewsBackdrop({
  image,
  publisher,
  focus,
  videoId = null,
}: {
  image: string | null;
  publisher: string | null;
  focus: string;
  videoId?: string | null;
}) {
  // Per afbeelding: een kapotte afbeelding van het vorige bericht telt niet voor het volgende.
  const [broken, setBroken] = useState<string | null>(null);
  const shown = image && broken !== image ? image : null;
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    const el = video.current;
    if (!videoId || !el) return;
    let stopped = false;
    let destroy = () => {};
    (async () => {
      const res = await fetch(`/api/video?id=${encodeURIComponent(videoId)}`).catch(() => null);
      const data = res?.ok ? ((await res.json().catch(() => null)) as { url?: string } | null) : null;
      if (stopped || !data?.url) return;
      // Safari speelt HLS zelf af; andere browsers met hls.js.
      if (el.canPlayType("application/vnd.apple.mpegurl")) {
        el.src = data.url;
      } else {
        const { default: Hls } = await import("hls.js");
        if (stopped || !Hls.isSupported()) return;
        const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 20 });
        hls.on(Hls.Events.ERROR, (_e, info) => {
          if (info.fatal) {
            console.warn("[video] stream werkt niet:", info.details);
            hls.destroy();
          }
        });
        hls.loadSource(data.url);
        hls.attachMedia(el);
        destroy = () => hls.destroy();
      }
      el.play().catch(() => {});
    })();
    return () => {
      stopped = true;
      destroy();
      el.removeAttribute("src");
      el.load();
      setPlaying(null);
    };
  }, [videoId]);

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
      {videoId && (
        <video
          ref={video}
          className="news-backdrop-video"
          muted
          loop
          playsInline
          disablePictureInPicture
          style={{ objectPosition: focus, opacity: playing === videoId ? 1 : 0 }}
          onPlaying={() => setPlaying(videoId)}
        />
      )}
      {(shown || playing) && publisher && <span className="news-backdrop-credit">Beeld: {publisher}</span>}
    </div>
  );
}
