import type { KeySettings } from '../../lib/greenscreen.ts';

// Groen doorzichtig maken in een WebGL-canvas, naar het voorbeeld van Anam
// (anam.ai/cookbook/transparent-backgrounds-canvas-greenscreen): elke animatieframe gaat het
// huidige beeld van de bron (video of afbeelding) als textuur naar de GPU, en een shader zet
// pixels waar groen duidelijk overheerst op doorzichtig, met een zachte overgang en minder groene
// glans op de randen. De bron zelf blijft in de pagina (voor het geluid van Anam), alleen
// onzichtbaar.
//
// Eén tekenlus per canvas. stop() en destroy() ruimen die op; destroy() ook de textuur, buffer en
// shaders op de GPU.
// Lukt WebGL niet, of gaat het tijdens het tekenen mis (context kwijt, bron niet te lezen), dan
// meldt onError dat één keer en stopt de lus: de pagina valt dan terug op de gewone weergave.

export type Source = HTMLVideoElement | HTMLImageElement;

type CanvasLike = {
  width: number;
  height: number;
  getContext(kind: 'webgl', options: WebGLContextAttributes): WebGLRenderingContext | null;
  addEventListener(type: string, listener: (e: Event) => void): void;
  removeEventListener(type: string, listener: (e: Event) => void): void;
};

export type RendererDeps = {
  requestFrame: (cb: () => void) => number;
  cancelFrame: (id: number) => void;
};

const browserDeps = (): RendererDeps => ({
  requestFrame: (cb) => requestAnimationFrame(cb),
  cancelFrame: (id) => cancelAnimationFrame(id),
});

const VERTEX = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

// Groen overheerst = groen min het grootste van rood en blauw. Boven greenBias begint de pixel te
// verdwijnen, softness verder is hij helemaal weg. Wat blijft en duidelijk te groen is, verliest
// dat overschot (spill): zo krijgen haar en schouders geen groene rand, maar een donkergroene trui
// (Nova, rgb 36,51,43) blijft groen. Uitvoer met voorvermenigvuldigde alfa,
// zoals het canvas verwacht.
const FRAGMENT = `
precision mediump float;
uniform sampler2D u_source;
uniform float u_minGreen;
uniform float u_greenBias;
uniform float u_softness;
uniform float u_spill;
varying vec2 v_texCoord;
void main() {
  vec4 texel = texture2D(u_source, v_texCoord);
  float other = max(texel.r, texel.b);
  float dominance = texel.g - other;
  float keyed = smoothstep(u_greenBias, u_greenBias + u_softness, dominance) * step(u_minGreen, texel.g);
  float alpha = texel.a * (1.0 - keyed);
  vec3 color = texel.rgb;
  // Groene rand weg: pixels met duidelijk groen overschot (haar dat met het scherm is gemengd,
  // ook donker na videocompressie) zakken in groen terug naar rood of blauw.
  // Een donkergroene trui (Nova, rgb 36,51,43: overschot 0,03) blijft groen.
  float fringe = smoothstep(0.035, 0.08, dominance);
  color.g = mix(color.g, min(color.g, other), u_spill * fringe);
  gl_FragColor = vec4(color * alpha, alpha);
}`;

// Twee driehoeken over het hele canvas: positie (x, y) en textuurcoördinaat (u, v).
const QUAD = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1]);

// Klaar om te tekenen: een video met een beeld, of een geladen afbeelding.
export function sourceSize(source: Source | null): { width: number; height: number } | null {
  if (!source) return null;
  if ('videoWidth' in source) {
    return source.readyState >= 2 && source.videoWidth > 0 ? { width: source.videoWidth, height: source.videoHeight } : null;
  }
  return source.complete && source.naturalWidth > 0 ? { width: source.naturalWidth, height: source.naturalHeight } : null;
}

export class GreenScreenRenderer {
  // false als WebGL er niet is of de shader niet werkt: dan niets tekenen, terugvallen.
  readonly ok: boolean;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private shaders: WebGLShader[] = [];
  private buffer: WebGLBuffer | null = null;
  private texture: WebGLTexture | null = null;
  private uniforms: Record<keyof KeySettings, WebGLUniformLocation | null> | null = null;
  private frame: number | null = null;
  private source: () => Source | null = () => null;
  private failed = false;
  private destroyed = false;
  // Wat er het laatst getekend is: hetzelfde beeld met dezelfde instellingen niet opnieuw.
  private last: { source: Source; time: number; settings: string; width: number; height: number } | null = null;
  private readonly lost = (e: Event) => {
    e.preventDefault();
    this.fail('WebGL-context kwijt');
  };

  private readonly canvas: CanvasLike;
  settings: KeySettings;
  private readonly onError: (reason: string) => void;
  private readonly deps: RendererDeps;

  constructor(canvas: CanvasLike, settings: KeySettings, onError: (reason: string) => void = () => {}, deps: RendererDeps = browserDeps()) {
    this.canvas = canvas;
    this.settings = settings;
    this.onError = onError;
    this.deps = deps;
    this.ok = this.setup();
    if (this.ok) canvas.addEventListener('webglcontextlost', this.lost);
  }

  private setup(): boolean {
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
    } catch {
      gl = null;
    }
    if (!gl) return false;
    this.gl = gl;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      this.shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) return this.release();
    this.program = program;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return this.release();
    gl.useProgram(program);

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'a_position');
    const texCoord = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texCoord);
    gl.vertexAttribPointer(texCoord, 2, gl.FLOAT, false, 16, 8);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    // Video- en afbeeldingsmaten zijn zelden een macht van 2: dan geen mipmaps en geen herhaling.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Beelden beginnen bovenaan, WebGL onderaan.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    this.uniforms = {
      minGreen: gl.getUniformLocation(program, 'u_minGreen'),
      greenBias: gl.getUniformLocation(program, 'u_greenBias'),
      softness: gl.getUniformLocation(program, 'u_softness'),
      spill: gl.getUniformLocation(program, 'u_spill'),
    };
    gl.uniform1i(gl.getUniformLocation(program, 'u_source'), 0);
    gl.clearColor(0, 0, 0, 0);
    return true;
  }

  // Tekenen uit deze bron, elke animatieframe. Nog een keer start(): alleen een andere bron, geen
  // tweede lus.
  start(source: () => Source | null) {
    this.source = source;
    if (!this.ok || this.failed || this.destroyed || this.frame !== null) return;
    this.frame = this.deps.requestFrame(this.tick);
  }

  get running() {
    return this.frame !== null;
  }

  stop() {
    if (this.frame !== null) this.deps.cancelFrame(this.frame);
    this.frame = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    this.release();
    // De context zelf niet weggooien (loseContext): React kan hetzelfde canvas meteen opnieuw
    // gebruiken (in ontwikkeling koppelt het elk onderdeel één keer los en weer aan), en dan krijgt
    // het die dode context terug. De browser ruimt de context op met het canvas.
    this.gl = null;
  }

  private readonly tick = () => {
    this.frame = null;
    if (this.failed || this.destroyed) return;
    this.draw();
    if (!this.failed && !this.destroyed) this.frame = this.deps.requestFrame(this.tick);
  };

  // Eén beeld. Is de bron nog niet klaar, dan niets (het canvas blijft doorzichtig).
  draw() {
    const gl = this.gl;
    const source = this.source();
    const size = sourceSize(source);
    if (!gl || !size || !source || !this.uniforms) return;
    const time = 'currentTime' in source ? source.currentTime : 0;
    const settings = JSON.stringify(this.settings);
    const l = this.last;
    if (l && l.source === source && l.time === time && l.settings === settings && l.width === size.width && l.height === size.height) return;
    if (this.canvas.width !== size.width || this.canvas.height !== size.height) {
      this.canvas.width = size.width;
      this.canvas.height = size.height;
    }
    gl.viewport(0, 0, size.width, size.height);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    } catch (err) {
      // Bijvoorbeeld een bron van een andere site zonder CORS: die mag WebGL niet lezen.
      this.fail(err instanceof Error ? err.message : String(err));
      return;
    }
    const { minGreen, greenBias, softness, spill } = this.settings;
    gl.uniform1f(this.uniforms.minGreen, minGreen);
    gl.uniform1f(this.uniforms.greenBias, greenBias);
    gl.uniform1f(this.uniforms.softness, softness);
    gl.uniform1f(this.uniforms.spill, spill);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.last = { source, time, settings, ...size };
  }

  private fail(reason: string) {
    if (this.failed) return;
    this.failed = true;
    this.stop();
    this.onError(reason);
  }

  private release(): false {
    const gl = this.gl;
    if (gl) {
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.program) gl.deleteProgram(this.program);
      for (const shader of this.shaders) gl.deleteShader(shader);
    }
    this.texture = this.buffer = this.program = null;
    this.shaders = [];
    return false;
  }
}

// Werkt WebGL hier? Een los canvas, meteen weer opgeruimd. Voor de keuze van de Anam-avatar,
// vóór er iets in beeld is.
export function webglAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}
