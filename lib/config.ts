// Schakelaars voor het prototype, alleen server-side gelezen.
//
// AVATAR_MODE=simulated (standaard): Anam wordt niet aangeroepen. De avatar is gesimuleerd,
//   de antwoordtekst staat in beeld en (als de browser een Nederlandse stem heeft) leest de
//   browser voor. Hiermee test je interface, bronnen en antwoordlogica zonder kosten.
// AVATAR_MODE=anam: echte Anam-stream, pas na "Start". Kost Anam-minuten.
export type AvatarMode = 'simulated' | 'anam';
export const AVATAR_MODE: AvatarMode = process.env.AVATAR_MODE === 'anam' ? 'anam' : 'simulated';

// Ontwikkelaarshulpmiddelen (foutsimulatie, versies, verbruik) in beeld: altijd in de
// gesimuleerde modus, en in de echte modus alleen tijdens `npm run dev`. Deelnemers aan een test
// met `npm start` en AVATAR_MODE=anam zien ze niet.
export const DEV_TOOLS = AVATAR_MODE === 'simulated' || process.env.NODE_ENV === 'development';
