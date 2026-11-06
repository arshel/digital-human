import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GreenScreenRenderer, sourceSize, type Source } from '../components/presenter/greenscreen.ts';
import {
  DEFAULT_FOCUS,
  DEFAULT_KEY,
  DEFAULT_LAYOUT,
  backgroundFocus,
  greenscreenConfig,
  keySettings,
  layoutVars,
  presenterLayout,
  sessionAvatarId,
} from '../lib/greenscreen.ts';

// Nova vrijstaand: de instellingen, en de tekenlus met een nep-WebGL (in Node is er geen GPU).
// Of het groen er in een echte browser goed uitgaat, controleer je op /greenscreen-test.

describe('instellingen', () => {
  const base = { NOVA_GREENSCREEN: 'aan', NOVA_GREENSCREEN_POSTER: '/anam/nova-groen.webp' };

  it('standaard uit; aan alleen met het materiaal', () => {
    assert.equal(greenscreenConfig({}, 'simulated'), null);
    assert.equal(greenscreenConfig({ NOVA_GREENSCREEN: 'aan' }, 'simulated'), null, 'zonder stilstaand beeld');
    assert.equal(greenscreenConfig(base, 'anam'), null, 'met Anam ook een greenscreen-avatar nodig');
    const sim = greenscreenConfig(base, 'simulated');
    assert.equal(sim?.poster, '/anam/nova-groen.webp');
    assert.equal(sim?.idleVideo, null, 'wachtvideo alleen met Anam');
    const anam = greenscreenConfig({ ...base, ANAM_GREENSCREEN_AVATAR_ID: 'groen', NOVA_GREENSCREEN_IDLE_VIDEO: '/anam/nova-groen.mp4' }, 'anam');
    assert.equal(anam?.idleVideo, '/anam/nova-groen.mp4');
    assert.deepEqual(anam?.key, DEFAULT_KEY);
    assert.deepEqual(anam?.layout, DEFAULT_LAYOUT);
    assert.equal(anam?.backgroundFocus, DEFAULT_FOCUS);
  });

  it('de greenscreen-avatar alleen als de pagina erom vraagt en die is ingesteld', () => {
    const env = { ANAM_AVATAR_ID: 'gewoon', ANAM_GREENSCREEN_AVATAR_ID: 'groen', NOVA_GREENSCREEN: 'aan' };
    assert.equal(sessionAvatarId(true, env), 'groen');
    assert.equal(sessionAvatarId(false, env), 'gewoon', 'geen WebGL: de gewone avatar');
    assert.equal(sessionAvatarId(true, { ...env, NOVA_GREENSCREEN: undefined }), 'gewoon', 'greenscreen uit');
    assert.equal(sessionAvatarId(true, { ANAM_AVATAR_ID: 'gewoon' }), 'gewoon', 'geen greenscreen-avatar');
  });

  it('bijstellen met JSON: alleen geldige velden, binnen grenzen', () => {
    assert.deepEqual(keySettings('{"minGreen":0.5,"spill":7,"softness":"zacht"}'), { ...DEFAULT_KEY, minGreen: 0.5, spill: 1 });
    assert.deepEqual(keySettings('kapot'), DEFAULT_KEY);
    const layout = presenterLayout('{"desktop":{"side":"left","inset":4,"height":500},"mobile":{"side":"boven"}}');
    assert.deepEqual(layout.desktop, { side: 'left', inset: 4, bottom: 0, height: 160 });
    assert.deepEqual(layout.mobile, DEFAULT_LAYOUT.mobile);
    assert.equal(backgroundFocus('30% 20%'), '30% 20%');
    assert.equal(backgroundFocus('links; color: red'), DEFAULT_FOCUS);
  });

  it('positie als CSS-variabelen, voor computer en telefoon', () => {
    const vars = layoutVars({
      desktop: { side: 'right', inset: -18, bottom: 0, height: 96 },
      mobile: { side: 'center', inset: 5, bottom: -2, height: 100 },
    });
    assert.equal(vars['--nova-d-right'], '-18%');
    assert.equal(vars['--nova-d-left'], 'auto');
    assert.equal(vars['--nova-d-shift'], '0%');
    assert.equal(vars['--nova-d-height'], '96%');
    assert.equal(vars['--nova-m-left'], 'calc(50% + 5%)');
    assert.equal(vars['--nova-m-shift'], '-50%');
    assert.equal(vars['--nova-m-bottom'], '-2%');
  });
});

// Een nep-WebGL: elke functie bestaat en wordt bijgehouden; constanten zijn getallen.
function fakeGl(opts: { compiles?: boolean; throwOnTexture?: boolean } = {}) {
  const calls: string[] = [];
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_, name: string) {
      if (/^[A-Z_0-9]+$/.test(name)) return name.length;
      return (...args: unknown[]) => {
        calls.push(name);
        if (name === 'getShaderParameter') return opts.compiles !== false;
        if (name === 'getProgramParameter') return true;
        if (name === 'getExtension') return args[0] === 'WEBGL_lose_context' ? { loseContext: () => calls.push('loseContext') } : null;
        if (name === 'texImage2D' && opts.throwOnTexture) throw new Error('SecurityError');
        if (name.startsWith('create')) return { name };
        if (name.startsWith('get')) return 0;
        return undefined;
      };
    },
  });
  return { gl: gl as unknown as WebGLRenderingContext, calls };
}

function fakeCanvas(gl: WebGLRenderingContext | null) {
  const listeners = new Map<string, (e: Event) => void>();
  return {
    width: 300,
    height: 150,
    getContext: () => gl,
    addEventListener: (type: string, l: (e: Event) => void) => listeners.set(type, l),
    removeEventListener: (type: string) => listeners.delete(type),
    listeners,
  };
}

function frames() {
  let next = 1;
  const pending = new Map<number, () => void>();
  return {
    deps: {
      requestFrame: (cb: () => void) => (pending.set(next, cb), next++),
      cancelFrame: (id: number) => pending.delete(id),
    },
    pending,
    // Eén animatieframe: alle wachtende callbacks.
    run() {
      const due = [...pending.values()];
      pending.clear();
      for (const cb of due) cb();
    },
  };
}

const video = (ready = true, time = 0) =>
  ({ videoWidth: ready ? 1152 : 0, videoHeight: ready ? 768 : 0, readyState: ready ? 4 : 0, currentTime: time }) as unknown as Source;

describe('tekenen', () => {
  it('geen WebGL: niet ok, en niets te doen', () => {
    const r = new GreenScreenRenderer(fakeCanvas(null), DEFAULT_KEY, undefined, frames().deps);
    assert.equal(r.ok, false);
  });

  it('shader werkt niet: niet ok, en alles op de GPU weer opgeruimd', () => {
    const { gl, calls } = fakeGl({ compiles: false });
    const r = new GreenScreenRenderer(fakeCanvas(gl), DEFAULT_KEY, undefined, frames().deps);
    assert.equal(r.ok, false);
    assert.ok(calls.includes('deleteShader'));
  });

  it('opnieuw aankoppelen op hetzelfde canvas (React in ontwikkeling) werkt', () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    new GreenScreenRenderer(canvas, DEFAULT_KEY, undefined, frames().deps).destroy();
    assert.equal(new GreenScreenRenderer(canvas, DEFAULT_KEY, undefined, frames().deps).ok, true);
  });

  it('één tekenlus, ook als start() vaker wordt aangeroepen', () => {
    const { gl } = fakeGl();
    const f = frames();
    const r = new GreenScreenRenderer(fakeCanvas(gl), DEFAULT_KEY, undefined, f.deps);
    r.start(() => null);
    r.start(() => null);
    assert.equal(f.pending.size, 1);
    f.run();
    assert.equal(f.pending.size, 1, 'na een frame weer precies één');
  });

  it('bron nog niet klaar: niets tekenen; klaar: tekenen op de maat van de bron', () => {
    const { gl, calls } = fakeGl();
    const f = frames();
    const canvas = fakeCanvas(gl);
    let source = video(false);
    const r = new GreenScreenRenderer(canvas, DEFAULT_KEY, undefined, f.deps);
    r.start(() => source);
    f.run();
    assert.ok(!calls.includes('drawArrays'));
    source = video(true, 0.5);
    f.run();
    assert.equal(calls.filter((c) => c === 'drawArrays').length, 1);
    assert.deepEqual([canvas.width, canvas.height], [1152, 768]);
    f.run();
    assert.equal(calls.filter((c) => c === 'drawArrays').length, 1, 'zelfde videoframe niet opnieuw');
    source = video(true, 0.54);
    f.run();
    assert.equal(calls.filter((c) => c === 'drawArrays').length, 2);
  });

  it('andere instellingen: opnieuw tekenen, ook bij hetzelfde beeld', () => {
    const { gl, calls } = fakeGl();
    const f = frames();
    const source = video(true, 1);
    const r = new GreenScreenRenderer(fakeCanvas(gl), DEFAULT_KEY, undefined, f.deps);
    r.start(() => source);
    f.run();
    r.settings = { ...DEFAULT_KEY, spill: 0.2 };
    f.run();
    assert.equal(calls.filter((c) => c === 'drawArrays').length, 2);
  });

  it('bron niet te lezen (andere site zonder CORS): één melding, lus gestopt', () => {
    const { gl } = fakeGl({ throwOnTexture: true });
    const f = frames();
    const errors: string[] = [];
    const r = new GreenScreenRenderer(fakeCanvas(gl), DEFAULT_KEY, (e) => errors.push(e), f.deps);
    r.start(() => video());
    f.run();
    f.run();
    assert.deepEqual(errors, ['SecurityError']);
    assert.equal(r.running, false);
    assert.equal(f.pending.size, 0);
  });

  it('context kwijt: melding, lus gestopt', () => {
    const { gl } = fakeGl();
    const f = frames();
    const canvas = fakeCanvas(gl);
    const errors: string[] = [];
    const r = new GreenScreenRenderer(canvas, DEFAULT_KEY, (e) => errors.push(e), f.deps);
    r.start(() => video());
    canvas.listeners.get('webglcontextlost')!({ preventDefault() {} } as Event);
    assert.deepEqual(errors, ['WebGL-context kwijt']);
    assert.equal(f.pending.size, 0);
  });

  it('opruimen: lus weg, GPU leeg; daarna start() doet niets', () => {
    const { gl, calls } = fakeGl();
    const f = frames();
    const canvas = fakeCanvas(gl);
    const r = new GreenScreenRenderer(canvas, DEFAULT_KEY, undefined, f.deps);
    r.start(() => video());
    r.destroy();
    assert.equal(f.pending.size, 0);
    for (const call of ['deleteTexture', 'deleteBuffer', 'deleteProgram', 'deleteShader']) assert.ok(calls.includes(call), call);
    assert.ok(!calls.includes('loseContext'), 'context niet weggooien: React kan het canvas opnieuw gebruiken');
    assert.equal(canvas.listeners.has('webglcontextlost'), false);
    r.start(() => video());
    assert.equal(f.pending.size, 0);
    r.destroy();
  });

  it('wanneer een bron klaar is', () => {
    assert.equal(sourceSize(null), null);
    assert.equal(sourceSize(video(false)), null);
    assert.deepEqual(sourceSize(video(true)), { width: 1152, height: 768 });
    assert.deepEqual(sourceSize({ complete: true, naturalWidth: 720, naturalHeight: 480 } as Source), { width: 720, height: 480 });
    assert.equal(sourceSize({ complete: false, naturalWidth: 0, naturalHeight: 0 } as Source), null);
  });
});
