// Nova vrijstaand voor de nieuwsafbeelding: instellingen. Geen afhankelijkheden, zodat de pagina
// de typen kan gebruiken en de tests de regels kunnen controleren.
//
// Hoe het werkt (components/presenter/greenscreen.ts): een versie van Nova voor een egaal groene
// achtergrond. De browser maakt het groen doorzichtig in een WebGL-canvas, naar het voorbeeld van
// Anam (anam.ai/cookbook/transparent-backgrounds-canvas-greenscreen). De nieuwsafbeelding vult
// het vak erachter.
//
// Standaard uit. Aanzetten in .env.local, pas als er greenscreenmateriaal van Nova is:
//   NOVA_GREENSCREEN=aan
//   NOVA_GREENSCREEN_POSTER=/anam/nova-groen.webp       stilstaand beeld, verplicht
//   NOVA_GREENSCREEN_IDLE_VIDEO=/anam/nova-groen.mp4    wachtvideo, optioneel (alleen met Anam)
//   ANAM_GREENSCREEN_AVATAR_ID=...                      de Anam-avatar met groene achtergrond,
//                                                       verplicht met AVATAR_MODE=anam
// Bijstellen (JSON, alleen de velden die je wilt veranderen):
//   NOVA_PRESENTER_LAYOUT={"desktop":{"side":"right","inset":-8,"bottom":0,"height":60}}
//   NOVA_GREENSCREEN_KEY={"minGreen":0.12,"greenBias":0.12,"softness":0.14,"spill":0.9}
//   NOVA_BACKGROUND_FOCUS=50% 40%                       uitsnedepunt van de nieuwsafbeelding

// Groenverwijdering, alle waarden 0 tot 1 (kleurkanalen ook 0 tot 1):
// - minGreen: zo groen moet een pixel minstens zijn om weg te kunnen;
// - greenBias: zoveel moet groen boven rood en blauw uitkomen voordat het doorzichtig wordt;
// - softness: de breedte van de zachte overgang daarna (zachte randen, haar);
// - spill: hoeveel groene glans er van de randen af gaat.
export type KeySettings = { minGreen: number; greenBias: number; softness: number; spill: number };

// Afgestemd op de Anam-stream van Nova (6 november 2026): het groen komt na videocompressie binnen
// als rgb 0,204,8, en langs het haar als donker groen (rgb 0,35,0 of 17,64,8). Die moeten ook weg,
// dus een lage minGreen; de trui (rgb 43,57,51: overschot 0,02) blijft dankzij greenBias.
export const DEFAULT_KEY: KeySettings = { minGreen: 0.12, greenBias: 0.12, softness: 0.14, spill: 0.9 };

// Waar Nova staat, in procenten van het presentatorvak. Het canvas houdt de verhoudingen van de
// bron; de hoogte bepaalt de grootte. `inset` is de afstand tot de gekozen kant (negatief: deels
// buiten beeld, zoals een presentator die aan de rand staat). Bij "center" schuift `inset` vanaf
// het midden.
export type Side = 'left' | 'center' | 'right';
export type Placement = { side: Side; inset: number; bottom: number; height: number };
export type PresenterLayout = { desktop: Placement; mobile: Placement };

// Uitgaand van een bron zoals de Anam-stream: liggend 3:2, Nova in het midden. Op de computer
// rechts en zo groot dat Nova ongeveer een derde van de breedte inneemt: de nieuwsafbeelding
// blijft het beeld. Op de telefoon in het midden, met het hoofd boven de ondertiteling.
// (Eerst 96% en 100% hoog: dan nam Nova bijna het hele beeld over.)
// De Anam-stream toont Nova strakker uitgesneden dan de foto (groter hoofd), dus kleiner dan je
// zou denken. Het stilstaande beeld is een beeld uit die stream, zodat beide even groot zijn.
export const DEFAULT_LAYOUT: PresenterLayout = {
  desktop: { side: 'right', inset: -8, bottom: 0, height: 60 },
  mobile: { side: 'center', inset: 0, bottom: 0, height: 70 },
};

export const DEFAULT_FOCUS = '50% 40%';

export type GreenscreenConfig = {
  poster: string;
  idleVideo: string | null;
  key: KeySettings;
  layout: PresenterLayout;
  backgroundFocus: string;
};

type Env = Record<string, string | undefined>;

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

function json(text: string | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function keySettings(text?: string): KeySettings {
  const v = json(text);
  return {
    minGreen: clamp(v.minGreen, 0, 1, DEFAULT_KEY.minGreen),
    greenBias: clamp(v.greenBias, 0, 1, DEFAULT_KEY.greenBias),
    softness: clamp(v.softness, 0.001, 1, DEFAULT_KEY.softness),
    spill: clamp(v.spill, 0, 1, DEFAULT_KEY.spill),
  };
}

function placement(value: unknown, fallback: Placement): Placement {
  const v = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    side: v.side === 'left' || v.side === 'center' || v.side === 'right' ? v.side : fallback.side,
    inset: clamp(v.inset, -60, 60, fallback.inset),
    bottom: clamp(v.bottom, -40, 40, fallback.bottom),
    height: clamp(v.height, 30, 160, fallback.height),
  };
}

export function presenterLayout(text?: string): PresenterLayout {
  const v = json(text);
  return { desktop: placement(v.desktop, DEFAULT_LAYOUT.desktop), mobile: placement(v.mobile, DEFAULT_LAYOUT.mobile) };
}

export function backgroundFocus(text?: string) {
  return text && /^\d{1,3}% \d{1,3}%$/.test(text.trim()) ? text.trim() : DEFAULT_FOCUS;
}

// Aan als het zo is ingesteld én het materiaal er is. Met Anam ook een greenscreen-avatar:
// anders zou het stilstaande beeld vrijstaand zijn en de stream een groene rechthoek.
export function greenscreenConfig(env: Env, avatarMode: 'simulated' | 'anam'): GreenscreenConfig | null {
  if (env.NOVA_GREENSCREEN !== 'aan') return null;
  const poster = env.NOVA_GREENSCREEN_POSTER?.trim();
  if (!poster) return null;
  if (avatarMode === 'anam' && !env.ANAM_GREENSCREEN_AVATAR_ID?.trim()) return null;
  return {
    poster,
    idleVideo: avatarMode === 'anam' ? env.NOVA_GREENSCREEN_IDLE_VIDEO?.trim() || null : null,
    key: keySettings(env.NOVA_GREENSCREEN_KEY),
    layout: presenterLayout(env.NOVA_PRESENTER_LAYOUT),
    backgroundFocus: backgroundFocus(env.NOVA_BACKGROUND_FOCUS),
  };
}

// Welke Anam-avatar een sessie krijgt. De greenscreenversie alleen als de pagina erom vraagt
// (WebGL werkt) en die is ingesteld; anders de gewone, met de bestaande weergave.
export function sessionAvatarId(wantsGreenscreen: boolean, env: Env): string | undefined {
  const green = env.NOVA_GREENSCREEN === 'aan' ? env.ANAM_GREENSCREEN_AVATAR_ID?.trim() : undefined;
  return (wantsGreenscreen && green) || env.ANAM_AVATAR_ID;
}

// CSS-variabelen voor het presentatorvak. De stylesheet kiest de computer- of telefoonset met een
// container query op het vak (app/globals.css, .nova-layer).
export function layoutVars(layout: PresenterLayout): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [key, p] of [['d', layout.desktop], ['m', layout.mobile]] as const) {
    vars[`--nova-${key}-left`] = p.side === 'left' ? `${p.inset}%` : p.side === 'center' ? `calc(50% + ${p.inset}%)` : 'auto';
    vars[`--nova-${key}-right`] = p.side === 'right' ? `${p.inset}%` : 'auto';
    vars[`--nova-${key}-shift`] = p.side === 'center' ? '-50%' : '0%';
    vars[`--nova-${key}-bottom`] = `${p.bottom}%`;
    vars[`--nova-${key}-height`] = `${p.height}%`;
  }
  return vars;
}
