// Types for the parts of foliate-js that TBV uses. Not part of upstream.
export type Draw = (rects: DOMRectList, options?: Record<string, unknown>) => SVGElement;

export class Overlayer {
  add(key: string, range: Range, draw: Draw, options?: Record<string, unknown>): void;
  remove(key: string): void;
  static highlight: Draw;
  static underline: Draw;
  static outline: Draw;
}
