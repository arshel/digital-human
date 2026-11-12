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
// Meer varianten om te vergelijken (JSON-lijst; avatarId blijft op de server):
//   NOVA_GREENSCREEN_VARIANTS=[{"id":"colbert-frontaal","label":"Colbert, frontaal","avatarId":"...",
//     "poster":"/anam/varianten/colbert-frontaal.png","idleVideo":"/anam/varianten/colbert-frontaal-idle.mp4"}]
//   NOVA_GREENSCREEN_VARIANT=colbert-frontaal        welke standaard is (anders de eerste, "trui")
// Staand in beeld (meer van Nova: tot onder de borst), voor varianten met een "posterStaand":
//   NOVA_GREENSCREEN_ORIENTATION=staand              anders liggend (de standaard)
//   NOVA_PRESENTER_LAYOUT_STAAND={...}               zoals NOVA_PRESENTER_LAYOUT, voor staand
// Kiezen tijdens het testen: ?avatar=colbert-frontaal in de adresbalk, of Testopties. Een andere
// avatar geldt vanaf de volgende verbinding: Anam wisselt niet midden in een sessie.
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

// Staand (768x1152) laat Anam meer van Nova zien: dezelfde schaal, maar ook de borst. Om het hoofd
// even groot te houden als liggend is het canvas anderhalf keer zo hoog. Iets minder ver buiten
// beeld: staand reikt de colbert tot de rand van het beeld.
export const DEFAULT_LAYOUT_STAAND: PresenterLayout = {
  desktop: { side: 'right', inset: 2, bottom: 0, height: 90 },
  mobile: { side: 'center', inset: 0, bottom: 0, height: 100 },
};

export type Orientation = 'liggend' | 'staand';
// De videomaten die Anam voor Cara 4 ondersteunt (anam.ai/docs/personas/session/video).
export const VIDEO_SIZE: Record<Orientation, { width: number; height: number }> = {
  liggend: { width: 1152, height: 768 },
  staand: { width: 768, height: 1152 },
};
// Waar het liggende beeld in het staande valt, gemeten op de drie colbert-avatars (10 november
// 2026): dezelfde schaal, het liggende beeld 192 pixels naar links en 128 naar beneden. Een
// liggende wachtvideo vult staand dus de rijen 128 tot 896; daaronder het stilstaande beeld.
export const LIGGEND_IN_STAAND = { x: -192, y: 128 };

export const DEFAULT_FOCUS = '50% 40%';

// Een greenscreenversie van Nova: wat de pagina ervan ziet (zonder avatar-id).
// posterStaand: het stilstaande beeld van de staande stream; zonder blijft de variant liggend.
export type GreenscreenVariant = { id: string; label: string; poster: string; posterStaand: string | null; idleVideo: string | null };
type ServerVariant = GreenscreenVariant & { avatarId: string | null };

export type GreenscreenConfig = {
  // De standaardvariant (de eerste of NOVA_GREENSCREEN_VARIANT): voor wie niets kiest.
  poster: string;
  idleVideo: string | null;
  variant: string;
  variants: GreenscreenVariant[];
  orientation: Orientation;
  key: KeySettings;
  layout: PresenterLayout;
  layoutStaand: PresenterLayout;
  backgroundFocus: string;
};

const ID = /^[a-z0-9-]{1,40}$/;
const FILE = /^(\/[\w./-]+|https:\/\/[^\s"'<>]+)$/;

// Alle varianten met hun avatar-id: eerst de bestaande ("trui"), dan NOVA_GREENSCREEN_VARIANTS.
// Ongeldige of dubbele items vallen af. Met Anam alleen varianten met een avatar-id.
function serverVariants(env: Env, avatarMode: 'simulated' | 'anam'): ServerVariant[] {
  const list: ServerVariant[] = [];
  const poster = env.NOVA_GREENSCREEN_POSTER?.trim() ?? '';
  // Voor een sessie is alleen de avatar nodig; de pagina krijgt alleen varianten met een beeld.
  if (poster || env.ANAM_GREENSCREEN_AVATAR_ID?.trim()) {
    list.push({
      id: 'trui',
      label: 'Trui',
      poster,
      posterStaand: null,
      idleVideo: env.NOVA_GREENSCREEN_IDLE_VIDEO?.trim() || null,
      avatarId: env.ANAM_GREENSCREEN_AVATAR_ID?.trim() || null,
    });
  }
  let extra: unknown = [];
  try {
    extra = JSON.parse(env.NOVA_GREENSCREEN_VARIANTS || '[]');
  } catch {
    extra = [];
  }
  for (const v of Array.isArray(extra) ? extra : []) {
    if (!v || typeof v !== 'object') continue;
    const { id, label, avatarId, poster: p, posterStaand, idleVideo } = v as Record<string, unknown>;
    if (typeof id !== 'string' || !ID.test(id) || list.some((x) => x.id === id)) continue;
    if (typeof p !== 'string' || !FILE.test(p)) continue;
    list.push({
      id,
      label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 40) : id,
      poster: p,
      posterStaand: typeof posterStaand === 'string' && FILE.test(posterStaand) ? posterStaand : null,
      idleVideo: typeof idleVideo === 'string' && FILE.test(idleVideo) ? idleVideo : null,
      avatarId: typeof avatarId === 'string' && avatarId.trim() ? avatarId.trim() : null,
    });
  }
  return avatarMode === 'anam' ? list.filter((v) => v.avatarId) : list;
}

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

export function presenterLayout(text?: string, base: PresenterLayout = DEFAULT_LAYOUT): PresenterLayout {
  const v = json(text);
  return { desktop: placement(v.desktop, base.desktop), mobile: placement(v.mobile, base.mobile) };
}

const orientation = (env: Env): Orientation => (env.NOVA_GREENSCREEN_ORIENTATION?.trim() === 'staand' ? 'staand' : 'liggend');

// Staand alleen als het zo is ingesteld én de variant een staand beeld heeft.
export function variantOrientation(config: Pick<GreenscreenConfig, 'orientation'>, variant: GreenscreenVariant | null): Orientation {
  return config.orientation === 'staand' && variant?.posterStaand ? 'staand' : 'liggend';
}

export function backgroundFocus(text?: string) {
  return text && /^\d{1,3}% \d{1,3}%$/.test(text.trim()) ? text.trim() : DEFAULT_FOCUS;
}

// Aan als het zo is ingesteld én het materiaal er is. Met Anam ook een greenscreen-avatar:
// anders zou het stilstaande beeld vrijstaand zijn en de stream een groene rechthoek.
export function greenscreenConfig(env: Env, avatarMode: 'simulated' | 'anam'): GreenscreenConfig | null {
  if (env.NOVA_GREENSCREEN !== 'aan') return null;
  // De wachtvideo alleen met Anam: zonder stream zou Nova vóór Start bewegen en daarna stilstaan.
  const variants = serverVariants(env, avatarMode)
    .filter((v) => v.poster)
    .map(({ avatarId: _, ...v }) => ({ ...v, idleVideo: avatarMode === 'anam' ? v.idleVideo : null }));
  if (!variants.length) return null;
  const chosen = variants.find((v) => v.id === env.NOVA_GREENSCREEN_VARIANT?.trim()) ?? variants[0];
  return {
    poster: chosen.poster,
    idleVideo: chosen.idleVideo,
    variant: chosen.id,
    variants,
    orientation: orientation(env),
    key: keySettings(env.NOVA_GREENSCREEN_KEY),
    layout: presenterLayout(env.NOVA_PRESENTER_LAYOUT),
    layoutStaand: presenterLayout(env.NOVA_PRESENTER_LAYOUT_STAAND, DEFAULT_LAYOUT_STAAND),
    backgroundFocus: backgroundFocus(env.NOVA_BACKGROUND_FOCUS),
  };
}

// Welke Anam-avatar een sessie krijgt. De greenscreenversie alleen als de pagina erom vraagt
// (WebGL werkt) en die is ingesteld; anders de gewone, met de bestaande weergave.
// Met `variant` de avatar van die variant; onbekend: de standaardvariant.
function sessionVariant(wantsGreenscreen: boolean, env: Env, variant?: string | null): ServerVariant | null {
  if (!wantsGreenscreen || env.NOVA_GREENSCREEN !== 'aan') return null;
  const list = serverVariants(env, 'anam');
  return list.find((v) => v.id === variant) ?? list.find((v) => v.id === env.NOVA_GREENSCREEN_VARIANT?.trim()) ?? list[0] ?? null;
}

export function sessionAvatarId(wantsGreenscreen: boolean, env: Env, variant?: string | null): string | undefined {
  return sessionVariant(wantsGreenscreen, env, variant)?.avatarId ?? env.ANAM_AVATAR_ID;
}

// De videomaat voor de sessie: staand alleen voor een greenscreenvariant met een staand beeld, net
// als op de pagina (variantOrientation). Anders niets meegeven: dan de standaard van Anam (liggend).
export function sessionVideoSize(wantsGreenscreen: boolean, env: Env, variant?: string | null) {
  const chosen = sessionVariant(wantsGreenscreen, env, variant);
  return chosen?.avatarId && chosen.posterStaand && orientation(env) === 'staand' ? VIDEO_SIZE.staand : null;
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
