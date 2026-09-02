/**
 * Reads real pixel dimensions straight out of image bytes (PNG/JPEG/GIF
 * headers) so the Formatting Department can scale generated artwork to a
 * target width while preserving its actual aspect ratio, instead of
 * forcing every image into a fixed square box (which silently distorted
 * anything that wasn't already 1:1). No image-processing library needed
 * — these formats put width/height in fixed, well-known byte offsets.
 */
export function getImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (isPng(buffer)) return readPng(buffer);
  if (isGif(buffer)) return readGif(buffer);
  if (isJpeg(buffer)) return readJpeg(buffer);
  return null;
}

function isPng(buf: Buffer): boolean {
  return buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47;
}
function readPng(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function isGif(buf: Buffer): boolean {
  return buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF";
}
function readGif(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function isJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8;
}
function readJpeg(buf: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset < buf.length - 9) {
    if (buf[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buf[offset + 1];
    // SOF0-SOF15 (excluding DHT/JPG/DAC markers) carry the frame's dimensions.
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    offset += 2 + segmentLength;
  }
  return null;
}

/** Scales to a target width, preserving aspect ratio; falls back to a square if dimensions can't be read. */
export function fitToWidth(buffer: Buffer, targetWidthPx: number, fallback = targetWidthPx): { width: number; height: number } {
  const dims = getImageDimensions(buffer);
  if (!dims || dims.width <= 0 || dims.height <= 0) return { width: fallback, height: fallback };
  const height = Math.round((targetWidthPx * dims.height) / dims.width);
  return { width: targetWidthPx, height };
}
