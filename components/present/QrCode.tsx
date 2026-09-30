import QRCode from "qrcode";
import type { CSSProperties } from "react";

/**
 * QR code as a plain React SVG (one path, no innerHTML), from the qrcode
 * library's module matrix. Dark modules on a light tile so phones scan it
 * reliably from a screen or a projected video.
 */
export function QrCode({ value, size = 160, dark = "#0e0c0a", light = "#f4ece0", quiet = 2, style }: { value: string; size?: number; dark?: string; light?: string; quiet?: number; style?: CSSProperties }) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const data = qr.modules.data;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (data[y * n + x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  const box = n + quiet * 2;
  return (
    <svg viewBox={`0 0 ${box} ${box}`} width={size} height={size} role="img" aria-label={`QR code: ${value}`} shapeRendering="crispEdges" style={{ display: "block", borderRadius: size * 0.06, ...style }}>
      <rect width={box} height={box} fill={light} />
      <path d={d} fill={dark} />
    </svg>
  );
}
