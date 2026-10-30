import { AVATAR_MODE } from '@/lib/config';
import { rateLimited, tooMany } from '@/lib/ratelimit';

// Sessie-token voor de Anam-avatar, pas na "Start" opgevraagd. ANAM_API_KEY blijft hier op de
// server; de browser krijgt alleen een kortlevend token (docs: anam.ai/docs/javascript-sdk/authentication).
//
// De persona wordt per sessie samengesteld, niet uit Anam Lab: ons gezicht, een Nederlandse stem,
// en het taalmodel van Anam uit (CUSTOMER_CLIENT_V1, "Disable LLM"). Nova zegt dus alleen de tekst
// die onze server maakt, via talk-streams vanuit de browser.

const SESSION = 'https://api.anam.ai/v1/auth/session-token';

export async function POST(req: Request) {
  if (rateLimited(req, 'anam-session', 6)) return tooMany();
  if (AVATAR_MODE !== 'anam') {
    return Response.json({ error: 'De Anam-avatar staat uit (AVATAR_MODE is niet "anam").' }, { status: 409 });
  }
  const key = process.env.ANAM_API_KEY;
  const avatarId = process.env.ANAM_AVATAR_ID;
  const voiceId = process.env.ANAM_VOICE_ID;
  if (!key || !avatarId || !voiceId) {
    console.error('[anam] ANAM_API_KEY, ANAM_AVATAR_ID of ANAM_VOICE_ID ontbreekt in .env.local');
    return Response.json({ error: 'De avatar is niet ingesteld op de server.' }, { status: 500 });
  }

  const res = await fetch(SESSION, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(10000),
    body: JSON.stringify({
      personaConfig: {
        name: 'Nova',
        avatarId,
        voiceId,
        llmId: 'CUSTOMER_CLIENT_V1',
        languageCode: 'nl',
        // Vangnet tegen een vergeten tabblad: een sessie stopt na 15 minuten.
        maxSessionLengthSeconds: 900,
      },
    }),
  }).catch((err) => {
    console.error('[anam] sessie-token mislukt:', err instanceof Error ? err.message : err);
    return null;
  });
  if (!res?.ok) {
    if (res) console.error('[anam] sessie-token mislukt:', res.status, (await res.text()).slice(0, 300));
    const status = res?.status === 402 || res?.status === 429 ? res.status : 502;
    return Response.json({ error: 'De avatar kan nu niet starten.' }, { status });
  }
  const { sessionToken } = await res.json();
  return Response.json({ sessionToken });
}
