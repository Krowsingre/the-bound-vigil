// A QR code as an SVG picture, for the paperback: a phone's camera opens a
// poem's listening link from it.

import qrcode from "qrcode-generator";

/** The link as a QR code, black on white with the standard quiet border. */
export function qrSvg(text: string, label = "QR code"): string {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const margin = 4;
  let path = "";
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) if (qr.isDark(row, col)) path += `M${col + margin},${row + margin}h1v1h-1z`;
  }
  const size = n + margin * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="qr" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label.replace(/[&<>"]/g, "")}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
