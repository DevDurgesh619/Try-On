import { describe, it, expect } from 'vitest';
import { MAX_LONG_EDGE_PX, compressImage } from './image';

// happy-dom does not implement HTMLCanvasElement drawing or HTMLImageElement decoding,
// so we exercise the contract by stubbing both globals.
function stubImage(naturalWidth: number, naturalHeight: number): void {
  class FakeImage {
    public naturalWidth = naturalWidth;
    public naturalHeight = naturalHeight;
    public onload: (() => void) | null = null;
    public onerror: (() => void) | null = null;
    private _src = '';
    public get src(): string {
      return this._src;
    }
    public set src(v: string) {
      this._src = v;
      queueMicrotask(() => this.onload?.());
    }
  }
  (globalThis as unknown as { Image: typeof FakeImage }).Image = FakeImage;
}

function stubCanvas(): void {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (type: string) => CanvasRenderingContext2D | null;
    toDataURL: (type?: string, quality?: number) => string;
  };
  proto.getContext = (): CanvasRenderingContext2D =>
    ({ drawImage: (): void => undefined }) as unknown as CanvasRenderingContext2D;
  proto.toDataURL = (type = 'image/png'): string => `data:${type};base64,FAKE`;
}

describe('compressImage', () => {
  it('scales down when long edge exceeds the cap', async () => {
    stubImage(2048, 1024);
    stubCanvas();
    const out = await compressImage('data:,', MAX_LONG_EDGE_PX);
    expect(out.width).toBe(MAX_LONG_EDGE_PX);
    expect(out.height).toBe(MAX_LONG_EDGE_PX / 2);
    expect(out.data_url.startsWith('data:image/jpeg')).toBe(true);
  });

  it('leaves smaller images at original size', async () => {
    stubImage(800, 600);
    stubCanvas();
    const out = await compressImage('data:,', MAX_LONG_EDGE_PX);
    expect(out.width).toBe(800);
    expect(out.height).toBe(600);
  });
});
