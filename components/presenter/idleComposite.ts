import { LIGGEND_IN_STAAND, VIDEO_SIZE } from '../../lib/greenscreen.ts';

// Het staande wachtbeeld: Anam heeft alleen een liggende wachtvideo, de staande stream laat ook de
// borst zien. Dus: het staande stilstaande beeld als basis, de bewegende video daaroverheen op de
// gemeten plek (LIGGEND_IN_STAAND), met een zachte overgang naar het stilstaande beeld eronder.
// Het groen van beide gaat daarna weg in de greenscreen-renderer, die dit canvas als bron krijgt.
// Bij elk nieuw beeld hoogt dataset.frame op; zo weet de renderer dat er iets te tekenen is.

const FADE = 80; // pixels waarin de video overloopt in het stilstaande beeld

export class IdleComposite {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private band: HTMLCanvasElement;
  private bandCtx: CanvasRenderingContext2D | null;
  private last = '';
  private frame = 0;

  constructor(doc: Document = document) {
    const { width, height } = VIDEO_SIZE.staand;
    this.canvas = doc.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    // De strook van de video die in het staande beeld valt: zo breed als staand, zo hoog als liggend.
    this.band = doc.createElement('canvas');
    this.band.width = width;
    this.band.height = VIDEO_SIZE.liggend.height;
    this.bandCtx = this.band.getContext('2d');
  }

  // Het beeld bijwerken en het canvas teruggeven; null als er nog niets te tonen is.
  draw(still: HTMLImageElement | null, video: HTMLVideoElement | null): HTMLCanvasElement | null {
    const ctx = this.ctx;
    const band = this.bandCtx;
    if (!ctx || !band) return null;
    const stillReady = !!still && still.complete && still.naturalWidth > 0;
    const videoReady = !!video && video.readyState >= 2 && video.videoWidth > 0;
    if (!stillReady && !videoReady) return null;
    const key = `${stillReady}|${videoReady ? video!.currentTime : -1}`;
    if (key === this.last) return this.canvas;
    this.last = key;

    const { width, height } = this.canvas;
    ctx.clearRect(0, 0, width, height);
    if (stillReady) ctx.drawImage(still!, 0, 0, width, height);
    if (videoReady) {
      const bh = this.band.height;
      band.globalCompositeOperation = 'source-over';
      band.clearRect(0, 0, width, bh);
      band.drawImage(video!, -LIGGEND_IN_STAAND.x, 0, width, bh, 0, 0, width, bh);
      // Onderrand doorzichtig laten verlopen: daar neemt het stilstaande beeld het over.
      if (stillReady) {
        const fade = band.createLinearGradient(0, bh - FADE, 0, bh);
        fade.addColorStop(0, 'rgba(0,0,0,1)');
        fade.addColorStop(1, 'rgba(0,0,0,0)');
        band.globalCompositeOperation = 'destination-in';
        band.fillStyle = fade;
        band.fillRect(0, bh - FADE, width, FADE);
        band.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(this.band, 0, LIGGEND_IN_STAAND.y);
    }
    this.canvas.dataset.frame = String(++this.frame);
    return this.canvas;
  }
}
