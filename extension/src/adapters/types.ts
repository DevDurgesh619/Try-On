export interface ProductMeta {
  title: string | null;
  brand: string | null;
  productType: string | null;
}

export interface SiteAdapter {
  name: string;
  hostMatch: RegExp;
  getPrimaryProductImage(doc: Document): string | null;
  getAllProductImages(doc: Document): string[];
  getProductMeta(doc: Document): ProductMeta | null;
}
