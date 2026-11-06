// Maakt een Anam-avatar van een foto, naar het voorbeeld van Anam
// (anam-cookbook, examples/transparent-background-nextjs/scripts/create-avatar.mjs).
// Gebruikt voor de greenscreenversie van Nova (lib/greenscreen.ts):
//
//   node scripts/create-anam-avatar.mjs public/anam/nova-groen.png "Nova greenscreen"
//
// Leest ANAM_API_KEY uit de omgeving of uit .env.local, en toont die nergens. Geeft het id van de
// nieuwe avatar; zet dat in .env.local als ANAM_GREENSCREEN_AVATAR_ID. Maakt alleen een avatar
// aan: geen sessie, geen stream.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

async function apiKey() {
  if (process.env.ANAM_API_KEY) return process.env.ANAM_API_KEY;
  const env = await readFile(new URL('../.env.local', import.meta.url), 'utf8').catch(() => '');
  return env.match(/^ANAM_API_KEY=(.*)$/m)?.[1]?.trim();
}

const [file = 'public/anam/nova-groen.png', name = 'Nova greenscreen', model = process.env.ANAM_AVATAR_MODEL || 'cara-4-latest'] =
  process.argv.slice(2);
const key = await apiKey();
if (!key) {
  console.error('ANAM_API_KEY ontbreekt (omgeving of .env.local).');
  process.exit(1);
}

const ext = path.extname(file).toLowerCase();
const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
const form = new FormData();
form.append('displayName', name);
form.append('avatarModel', model);
form.append('imageFile', new Blob([await readFile(file)], { type }), path.basename(file));

const res = await fetch('https://api.anam.ai/v1/avatars', {
  method: 'POST',
  headers: { authorization: `Bearer ${key}` },
  body: form,
  signal: AbortSignal.timeout(120000),
});
const text = await res.text();
let data = null;
try {
  data = JSON.parse(text);
} catch {}
if (!res.ok) {
  console.error(`Anam weigerde: ${res.status} ${text.slice(0, 500)}`);
  process.exit(1);
}
const id = data?.id ?? data?.avatarId ?? data?.data?.id;
if (!id) {
  console.error('Geen id in het antwoord:', text.slice(0, 500));
  process.exit(1);
}
console.log(`Avatar aangemaakt: ${data?.displayName ?? name}`);
console.log(`ANAM_GREENSCREEN_AVATAR_ID=${id}`);
