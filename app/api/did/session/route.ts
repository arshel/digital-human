import { AVATAR_MODE } from '@/lib/config';
import { LOCAL_REPLAY, SENTENCE_BREAKS, usage, VOICE } from '@/lib/did';
import { rateLimited, tooMany } from '@/lib/ratelimit';

// Wat de browser nodig heeft om de D-ID-agent te verbinden: agent-id en client key. Pas na
// "Start" opgevraagd. DID_API_KEY blijft hier op de server; de client key is de beperkte sleutel
// die D-ID voor de browser bedoelt (alleen geldig vanaf toegestane domeinen).
export async function POST(req: Request) {
  if (rateLimited(req, 'did-session', 6)) return tooMany();

  if (AVATAR_MODE !== 'did') {
    return Response.json({ error: 'De echte avatar staat uit (AVATAR_MODE is niet "did").' }, { status: 409 });
  }

  const agentId = process.env.DID_AGENT_ID;
  const clientKey = process.env.DID_CLIENT_KEY;
  if (!agentId || !clientKey) {
    console.error('[did] DID_AGENT_ID of DID_CLIENT_KEY ontbreekt in .env.local (zie scripts/did-setup.mjs)');
    return Response.json({ error: 'De avatar is niet ingesteld op de server.' }, { status: 500 });
  }

  // Begrenzing over het hele prototype. Een schatting (zie lib/did.ts), dus met wat marge.
  const used = await usage();
  if (used.counted >= used.budget) {
    console.error(`[did] budget op: ${Math.round(used.counted)} van ${used.budget} seconden`);
    return Response.json({ error: 'Het testtegoed voor de avatar is op.' }, { status: 402 });
  }

  return Response.json({ agentId, clientKey, voice: VOICE, localReplay: LOCAL_REPLAY, sentenceBreaks: SENTENCE_BREAKS });
}
