import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { myntraAdapter } from './myntra';
import { amazonAdapter } from './amazon';
import { flipkartAdapter } from './flipkart';
import { findAdapter } from './index';

function loadFixture(rel: string): Document {
  const html = readFileSync(resolve(__dirname, '../../tests/fixtures', rel), 'utf-8');
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('myntraAdapter', () => {
  const doc = loadFixture('myntra/pdp.html');
  it('matches myntra.com', () => {
    expect(myntraAdapter.hostMatch.test('www.myntra.com')).toBe(true);
    expect(myntraAdapter.hostMatch.test('myntra.com')).toBe(true);
    expect(myntraAdapter.hostMatch.test('not-myntra.com')).toBe(false);
  });
  it('extracts the first background-image URL as primary', () => {
    expect(myntraAdapter.getPrimaryProductImage(doc)).toBe(
      'https://assets.myntassets.com/h_1080,w_864/v1/foo-1.jpg',
    );
  });
  it('extracts all gallery images', () => {
    expect(myntraAdapter.getAllProductImages(doc)).toHaveLength(3);
  });
  it('extracts product meta with brand/title swap honored', () => {
    const meta = myntraAdapter.getProductMeta(doc);
    expect(meta?.title).toBe('Floral Print Cotton Kurta');
    expect(meta?.brand).toBe('Anouk');
    expect(meta?.productType).toBe('Kurta');
  });
});

describe('amazonAdapter', () => {
  const doc = loadFixture('amazon/pdp.html');
  it('matches amazon.in only', () => {
    expect(amazonAdapter.hostMatch.test('www.amazon.in')).toBe(true);
    expect(amazonAdapter.hostMatch.test('amazon.com')).toBe(false);
  });
  it('prefers data-old-hires for primary image', () => {
    expect(amazonAdapter.getPrimaryProductImage(doc)).toBe(
      'https://m.media-amazon.com/images/I/91abc.jpg',
    );
  });
  it('strips _SS40_ thumbnail size in gallery', () => {
    const all = amazonAdapter.getAllProductImages(doc);
    expect(all).toEqual([
      'https://m.media-amazon.com/images/I/71abc.jpg',
      'https://m.media-amazon.com/images/I/72def.jpg',
    ]);
  });
  it('strips "Visit the " prefix from brand', () => {
    const meta = amazonAdapter.getProductMeta(doc);
    expect(meta?.title).toBe("Men's Slim Fit Cotton Shirt");
    expect(meta?.brand).toBe('FabricBrand Store');
    expect(meta?.productType).toBe('Shirts');
  });
});

describe('flipkartAdapter', () => {
  const doc = loadFixture('flipkart/pdp.html');
  it('matches flipkart.com', () => {
    expect(flipkartAdapter.hostMatch.test('www.flipkart.com')).toBe(true);
  });
  it('extracts primary image via _396cs4 prefix', () => {
    expect(flipkartAdapter.getPrimaryProductImage(doc)).toBe(
      'https://rukminim2.flixcart.com/image/1664/2000/foo.jpeg',
    );
  });
  it('extracts thumbnails from the strip', () => {
    expect(flipkartAdapter.getAllProductImages(doc)).toHaveLength(2);
  });
  it('extracts meta', () => {
    const meta = flipkartAdapter.getProductMeta(doc);
    expect(meta?.title).toBe('Round Neck Solid Cotton T-Shirt');
    expect(meta?.brand).toBe('NicheBrand');
    expect(meta?.productType).toBe('T-Shirts');
  });
});

describe('findAdapter', () => {
  it('routes hosts to the right adapter', () => {
    expect(findAdapter('www.myntra.com')?.name).toBe('myntra');
    expect(findAdapter('www.amazon.in')?.name).toBe('amazon');
    expect(findAdapter('www.flipkart.com')?.name).toBe('flipkart');
    expect(findAdapter('example.com')).toBeNull();
  });
});

describe('graceful degradation', () => {
  it('returns null primary image and no warnings explode', () => {
    const empty = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    expect(myntraAdapter.getPrimaryProductImage(empty)).toBeNull();
    expect(amazonAdapter.getPrimaryProductImage(empty)).toBeNull();
    expect(flipkartAdapter.getPrimaryProductImage(empty)).toBeNull();
  });
});
