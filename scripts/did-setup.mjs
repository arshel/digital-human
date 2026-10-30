// Eenmalige D-ID-setup voor Nova. Alleen gratis calls: geen stream, geen video.
//
//   node --env-file=.env.local scripts/did-setup.mjs status   tegoed en bestaande agents
//   node --env-file=.env.local scripts/did-setup.mjs create   agent aanmaken (presentator + stem)
//
// `create` zet DID_AGENT_ID en (als D-ID die teruggeeft) DID_CLIENT_KEY in .env.local. Het
// script print nooit een sleutel. Presentator en stem komen uit DID_PRESENTER_ID en
// DID_VOICE_ID, met de standaard hieronder. Een andere presentator? Zet DID_PRESENTER_ID en
// draai `create` opnieuw: dat maakt een nieuwe agent, de oude blijft in D-ID Studio staan.

import { appendFileSync, readFileSync } from 'node:fs';

const API = 'https://api.d-id.com';
const ENV_FILE = '.env.local';

// Tijdelijke standaard: een kant-en-klare Clips-presentator van D-ID (volwassen, rustig, licht
// kantoor). Clips kan een fluent stream geven, en alleen daarmee werkt interrupt() (echte pauze).
const PRESENTER = process.env.DID_PRESENTER_ID || 'v2_public_Mary_NoHands_PurpleShirt_Office@vA__Ta4xnN';
const VOICE = process.env.DID_VOICE_ID || 'nl-NL-FennaNeural';

const key = process.env.DID_API_KEY;
if (!key) {
  console.error('DID_API_KEY ontbreekt. Draai met: node --env-file=.env.local scripts/did-setup.mjs');
  process.exit(1);
}

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Basic ${key}`, 'content-type': 'application/json', accept: 'application/json' },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function saveEnv(name, value) {
  const current = readFileSync(ENV_FILE, 'utf8');
  if (new RegExp(`^${name}=`, 'm').test(current)) {
    console.log(`${name} staat al in ${ENV_FILE}; niet overschreven. Pas het zelf aan als je de nieuwe wilt.`);
    return;
  }
  appendFileSync(ENV_FILE, `${current.endsWith('\n') ? '' : '\n'}${name}=${value}\n`);
  console.log(`${name} toegevoegd aan ${ENV_FILE}.`);
}

async function status() {
  const credits = await call('GET', '/credits');
  console.log('Tegoed (D-ID /credits):', credits.status, JSON.stringify({ remaining: credits.data.remaining, total: credits.data.total }));
  const agents = await call('GET', '/agents/me?limit=50');
  for (const a of agents.data.agents ?? []) {
    console.log(`Agent ${a.id}: ${a.preview_name ?? '(geen naam)'} · ${a.presenter?.type} · ${a.presenter?.presenter_id ?? a.presenter?.source_url ?? ''} · stem ${a.presenter?.voice?.voice_id ?? '?'}`);
  }
}

async function create() {
  const res = await call('POST', '/agents', {
    preview_name: 'Nova (prototype)',
    preview_description: 'Digitale nieuwsverteller. Spreekt alleen tekst uit die de Nova-server aanlevert (speak), zonder LLM van D-ID.',
    presenter: { type: 'clip', presenter_id: PRESENTER, voice: { type: 'microsoft', voice_id: VOICE } },
    embed: true,
  });
  if (res.status >= 300) {
    console.error(`Agent aanmaken mislukt (${res.status}):`, JSON.stringify(res.data).slice(0, 500));
    process.exit(1);
  }
  console.log(`Agent aangemaakt: ${res.data.id} (presentator ${PRESENTER}, stem ${VOICE}).`);
  if (res.data.error) console.log('D-ID meldt bij de agent:', JSON.stringify(res.data.error));
  saveEnv('DID_AGENT_ID', res.data.id);
  if (typeof res.data.client_key === 'string') saveEnv('DID_CLIENT_KEY', res.data.client_key);
  else console.log('Geen client key in het antwoord. Haal hem uit D-ID Studio: Agents → … → </> Embed → data-client-key, en zet daar ook http://localhost:3000 bij de toegestane domeinen.');
  // Stilstaand beeld voor vóór de start, ook in de ontwikkelmodus (zonder D-ID-API-aanroep).
  const thumbnail = res.data.presenter?.thumbnail ?? res.data.preview_thumbnail;
  if (thumbnail) saveEnv('DID_POSTER_URL', thumbnail);
  if (res.data.presenter?.idle_video) saveEnv('DID_IDLE_VIDEO_URL', res.data.presenter.idle_video);
}

const command = process.argv[2];
if (command === 'status') await status();
else if (command === 'create') await create();
else console.log('Gebruik: status | create');
