import { readLines } from './testlog';

// Server-side kant van D-ID. DID_API_KEY verlaat de server nooit: de browser krijgt alleen de
// agent-id en de client key. Die client key is door D-ID bedoeld voor de browser en werkt alleen
// vanaf de domeinen die bij de agent zijn toegestaan (D-ID Studio → Agents → Embed).

const API = 'https://api.d-id.com';

// Ongeveer 20 minuten voor het hele prototype (niet per persoon). Daarboven start de server
// geen nieuwe sessie meer. Aanpassen met DID_BUDGET_SECONDS.
export const BUDGET_SECONDS = Number(process.env.DID_BUDGET_SECONDS ?? 1200);

// Stem en tempo voor speak(). Fenna is een Nederlandse Microsoft-stem die D-ID ondersteunt
// (gecontroleerd met GET /tts/voices). Tempo 1 is normaal; lager klinkt al snel schools.
export const VOICE = {
  id: process.env.DID_VOICE_ID || 'nl-NL-FennaNeural',
  rate: process.env.DID_VOICE_RATE || '1',
};

// Herhalen ("Nog een keer") uit een opname in het geheugen van de browser, zodat D-ID niet
// opnieuw een video maakt. Uitzetten met DID_LOCAL_REPLAY=0: dan vraagt herhalen een nieuwe speak().
export const LOCAL_REPLAY = process.env.DID_LOCAL_REPLAY !== '0';

// Korte SSML-pauze na elke zin. Standaard UIT: bij onze Talks-agent las D-ID de <break>-code
// hardop voor ("break time is gelijk aan..."), ondanks ssml: true. Pas aanzetten
// (DID_SENTENCE_BREAKS=1) als een korte test laat zien dat D-ID de pauzes wel uitvoert.
export const SENTENCE_BREAKS = process.env.DID_SENTENCE_BREAKS === '1';

function auth() {
  const key = process.env.DID_API_KEY;
  return key ? { authorization: `Basic ${key}`, accept: 'application/json' } : null;
}

let agentCache: { at: number; thumbnail: string | null } | null = null;

// Stilstaand beeld van de presentator voor vóór de start. Een gratis GET, een uur bewaard.
export async function agentThumbnail() {
  const headers = auth();
  const id = process.env.DID_AGENT_ID;
  if (!headers || !id) return null;
  if (agentCache && Date.now() - agentCache.at < 3_600_000) return agentCache.thumbnail;
  try {
    const res = await fetch(`${API}/agents/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(5000) });
    const data = res.ok ? await res.json() : null;
    agentCache = { at: Date.now(), thumbnail: data?.presenter?.thumbnail ?? data?.preview_thumbnail ?? null };
  } catch (err) {
    console.error('[did] agent niet opgehaald:', err instanceof Error ? err.message : err);
    agentCache = { at: Date.now(), thumbnail: null };
  }
  return agentCache.thumbnail;
}

// Tegoed volgens D-ID zelf (GET /credits): gemeten, niet geschat.
export async function credits() {
  const headers = auth();
  if (!headers) return null;
  try {
    const res = await fetch(`${API}/credits`, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return { remaining: Number(data.remaining), total: Number(data.total) };
  } catch {
    return null;
  }
}

// Verbruik uit logs/did-usage.jsonl. Twee soorten:
// - spoken: videoduur per speak(), zoals de D-ID-API die teruggeeft (providergegevens);
// - connected: hoe lang de verbinding openstond, met de klok van de browser gemeten (schatting).
// Of D-ID de verbindingstijd of alleen de gesproken tijd factureert, staat niet in de
// documentatie. De begrenzing gebruikt daarom de grootste van de twee.
export async function usage() {
  const lines = await readLines('did-usage');
  const sum = (kind: string) =>
    lines.filter((l) => l.kind === kind).reduce((total, l) => total + (Number(l.seconds) || 0), 0);
  const spoken = sum('spoken');
  const connected = sum('connected');
  return { spoken, connected, counted: Math.max(spoken, connected), budget: BUDGET_SECONDS };
}
