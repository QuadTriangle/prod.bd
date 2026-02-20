import { QRCodeSVG } from 'qrcode.react';

export function QRCode({ url, size = 120 }: { url: string; size?: number }) {
  return <QRCodeSVG value={url} size={size} bgColor="transparent" fgColor="currentColor" />;
}
