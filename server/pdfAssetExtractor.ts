import zlib from 'node:zlib';
import crypto from 'node:crypto';

export interface ExtractedPdfGraphic {
  id: string;
  name: string;
  mimeType: string;
  ext: 'jpg' | 'png';
  width?: number;
  height?: number;
  buffer: Buffer;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// Precompute CRC32 table for PNG chunk encoding
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRawPixelsToPng(
  pixels: Buffer,
  width: number,
  height: number,
  channels: 1 | 3 | 4
): Buffer | null {
  if (width <= 0 || height <= 0 || width > 8000 || height > 8000) return null;
  const expectedRowBytes = width * channels;
  const expectedTotal = expectedRowBytes * height;
  if (pixels.length < expectedTotal) return null;

  // Build scanlines with filter type 0 (None) at start of each row
  const rawScanlines = Buffer.alloc((expectedRowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const destOffset = y * (expectedRowBytes + 1);
    rawScanlines[destOffset] = 0;
    pixels.copy(
      rawScanlines,
      destOffset + 1,
      y * expectedRowBytes,
      (y + 1) * expectedRowBytes
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth 8
  // Color type: 0 = grayscale, 2 = RGB, 6 = RGBA
  ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = zlib.deflateSync(rawScanlines, { level: 6 });

  return Buffer.concat([
    PNG_SIGNATURE,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function parseAscii85(input: Buffer): Buffer | null {
  try {
    const str = input.toString('latin1').replace(/\s+/g, '');
    const endIdx = str.indexOf('~>');
    const clean = endIdx >= 0 ? str.slice(0, endIdx) : str;
    const out: number[] = [];
    let i = 0;
    while (i < clean.length) {
      if (clean[i] === 'z') {
        out.push(0, 0, 0, 0);
        i++;
        continue;
      }
      const chunk = clean.slice(i, i + 5);
      if (chunk.length < 2) break;
      const padCount = 5 - chunk.length;
      const padded = chunk + 'u'.repeat(padCount);
      let val = 0;
      for (let j = 0; j < 5; j++) {
        val = val * 85 + (padded.charCodeAt(j) - 33);
      }
      const bytes = [
        (val >>> 24) & 0xff,
        (val >>> 16) & 0xff,
        (val >>> 8) & 0xff,
        val & 0xff,
      ];
      for (let b = 0; b < 4 - padCount; b++) {
        out.push(bytes[b]);
      }
      i += chunk.length;
    }
    return Buffer.from(out);
  } catch {
    return null;
  }
}

function convertCmykToRgb(cmyk: Buffer, pixelCount: number): Buffer {
  const rgb = Buffer.alloc(pixelCount * 3);
  for (let i = 0; i < pixelCount; i++) {
    const c = cmyk[i * 4];
    const m = cmyk[i * 4 + 1];
    const y = cmyk[i * 4 + 2];
    const k = cmyk[i * 4 + 3];
    const invK = 255 - k;
    rgb[i * 3] = Math.round(((255 - c) * invK) / 255);
    rgb[i * 3 + 1] = Math.round(((255 - m) * invK) / 255);
    rgb[i * 3 + 2] = Math.round(((255 - y) * invK) / 255);
  }
  return rgb;
}

function extractPrecedingPdfDict(windowBefore: string): string {
  const endRel = windowBefore.lastIndexOf('>>');
  if (endRel === -1) return windowBefore;
  let depth = 0;
  for (let i = endRel; i >= 1; i--) {
    if (windowBefore[i] === '>' && windowBefore[i - 1] === '>') {
      depth++;
      i--;
    } else if (windowBefore[i] === '<' && windowBefore[i - 1] === '<') {
      depth--;
      if (depth === 0) {
        return windowBefore.slice(i - 1, endRel + 2);
      }
      i--;
    }
  }
  const fallbackStart = windowBefore.lastIndexOf('<<');
  return fallbackStart >= 0 ? windowBefore.slice(fallbackStart) : windowBefore;
}

function decodePdfImagePixels(
  dictStr: string,
  streamData: Buffer
): { ext: 'jpg' | 'png'; mimeType: string; buffer: Buffer; width?: number; height?: number } | null {
  // Skip soft masks & image masks so we extract clean color/displayable graphics
  if (/\/ImageMask\s+true/i.test(dictStr)) return null;

  const widthMatch = dictStr.match(/\/Width\s+(\d+)/);
  const heightMatch = dictStr.match(/\/Height\s+(\d+)/);
  const width = widthMatch ? Number(widthMatch[1]) : 0;
  const height = heightMatch ? Number(heightMatch[1]) : 0;

  // Filter tiny spacer/bullet/1px masks
  if ((width && width < 48) || (height && height < 48)) {
    return null;
  }

  const filterSectionMatch = dictStr.match(/\/Filter\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/);
  const filterText = filterSectionMatch ? filterSectionMatch[1] : '';
  const filters = (filterText.match(/\/[A-Za-z0-9]+/g) || []).map((f) => f.slice(1));

  let data = streamData;

  for (const filter of filters) {
    if (filter === 'ASCII85Decode') {
      const decoded = parseAscii85(data);
      if (!decoded) return null;
      data = decoded;
    } else if (filter === 'FlateDecode') {
      try {
        data = zlib.inflateSync(data);
      } catch {
        return null;
      }
    } else if (filter === 'DCTDecode') {
      // Valid JPEG starts with FF D8
      const soi = data.indexOf(Buffer.from([0xff, 0xd8]));
      if (soi < 0) return null;
      const jpegBuf = soi > 0 ? data.subarray(soi) : data;
      if (jpegBuf.length < 600) return null;
      return {
        ext: 'jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from(jpegBuf),
        width: width || undefined,
        height: height || undefined,
      };
    } else if (filter === 'JPXDecode' || filter === 'CCITTFaxDecode' || filter === 'JBIG2Decode') {
      // Skip unsupported exotic raw codec streams
      return null;
    }
  }

  // If raw pixel stream (after FlateDecode or unfiltered), convert DeviceRGB/DeviceGray/DeviceCMYK to PNG
  if (width >= 48 && height >= 48) {
    const bpcMatch = dictStr.match(/\/BitsPerComponent\s+(\d+)/);
    const bpc = bpcMatch ? Number(bpcMatch[1]) : 8;
    if (bpc !== 8) return null;

    const hasPredictor = /\/Predictor\s+(\d+)/.test(dictStr);
    const csMatch = dictStr.match(/\/ColorSpace\s*(\[[^\]]*\]|\/[A-Za-z0-9]+)/);
    const cs = csMatch ? csMatch[1] : '';

    let sourceChannels: 1 | 3 | 4 | null = null;
    if (cs.includes('DeviceRGB')) {
      sourceChannels = 3;
    } else if (cs.includes('DeviceCMYK')) {
      sourceChannels = 4;
    } else if (cs.includes('DeviceGray')) {
      sourceChannels = 1;
    } else if (data.length === width * height * 3) {
      sourceChannels = 3;
    } else if (data.length === width * height * 4) {
      sourceChannels = 4;
    } else if (data.length === width * height) {
      sourceChannels = 1;
    }

    if (!sourceChannels) return null;
    if (hasPredictor) {
      const predMatch = dictStr.match(/\/Predictor\s+(\d+)/);
      const pred = predMatch ? Number(predMatch[1]) : 1;
      if (pred >= 10) {
        // Unfilter PNG predictor scanlines
        const rowBytes = width * sourceChannels + 1;
        if (data.length < rowBytes * height) return null;
        const unfiltered = Buffer.alloc(width * sourceChannels * height);
        const prevRow = Buffer.alloc(width * sourceChannels);
        for (let y = 0; y < height; y++) {
          const srcStart = y * rowBytes;
          const filterType = data[srcStart];
          const curRow = Buffer.alloc(width * sourceChannels);
          for (let x = 0; x < width * sourceChannels; x++) {
            const rawByte = data[srcStart + 1 + x];
            const left = x >= sourceChannels ? curRow[x - sourceChannels] : 0;
            const up = prevRow[x];
            const upLeft = x >= sourceChannels ? prevRow[x - sourceChannels] : 0;
            if (filterType === 0) curRow[x] = rawByte;
            else if (filterType === 1) curRow[x] = (rawByte + left) & 0xff;
            else if (filterType === 2) curRow[x] = (rawByte + up) & 0xff;
            else if (filterType === 3) curRow[x] = (rawByte + ((left + up) >> 1)) & 0xff;
            else if (filterType === 4) {
              const p = left + up - upLeft;
              const pa = Math.abs(p - left);
              const pb = Math.abs(p - up);
              const pc = Math.abs(p - upLeft);
              const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
              curRow[x] = (rawByte + paeth) & 0xff;
            } else {
              curRow[x] = rawByte;
            }
          }
          curRow.copy(unfiltered, y * width * sourceChannels);
          curRow.copy(prevRow);
        }
        data = unfiltered;
      }
    }

    let pngChannels: 1 | 3 = 1;
    if (sourceChannels === 4) {
      if (data.length < width * height * 4) return null;
      data = convertCmykToRgb(data, width * height);
      pngChannels = 3;
    } else {
      pngChannels = sourceChannels;
    }

    const pngBuf = encodeRawPixelsToPng(data, width, height, pngChannels);
    if (!pngBuf || pngBuf.length < 400) return null;
    return {
      ext: 'png',
      mimeType: 'image/png',
      buffer: pngBuf,
      width,
      height,
    };
  }

  return null;
}

/**
 * Extracts embedded raster graphics (JPEG / Flate RGB / CMYK / Grayscale images) directly
 * from a PDF buffer using pure Node built-in modules.
 */
export function extractImagesFromPdfBuffer(
  pdfBuffer: Buffer,
  sourceName: string,
  maxImages = 12
): ExtractedPdfGraphic[] {
  const results: ExtractedPdfGraphic[] = [];
  const seenHashes = new Set<string>();
  const latin1 = pdfBuffer.toString('latin1');
  const baseLabel = sourceName.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 32) || 'guide';

  const streamMarker = 'stream';
  const endStreamMarker = 'endstream';
  let pos = 0;

  while (pos < latin1.length && results.length < maxImages) {
    const streamIdx = latin1.indexOf(streamMarker, pos);
    if (streamIdx === -1) break;

    // Make sure this is the keyword `stream` followed by LF or CRLF (not `endstream` or dictionary name)
    const prevChar = streamIdx > 0 ? latin1[streamIdx - 1] : '\n';
    const isWordStart = /\s|>/.test(prevChar);
    const afterKeyword = latin1.slice(streamIdx + streamMarker.length, streamIdx + streamMarker.length + 2);
    const isCrlf = afterKeyword === '\r\n';
    const isLf = afterKeyword[0] === '\n' || afterKeyword[0] === '\r';

    if (!isWordStart || (!isCrlf && !isLf)) {
      pos = streamIdx + streamMarker.length;
      continue;
    }

    const dataStart = streamIdx + streamMarker.length + (isCrlf ? 2 : 1);
    const endStreamIdx = latin1.indexOf(endStreamMarker, dataStart);
    if (endStreamIdx === -1) break;

    // Inspect preceding dictionary (up to 2000 chars before `stream`, respecting nested << >>)
    const dictWindowStart = Math.max(0, streamIdx - 2000);
    const windowBefore = latin1.slice(dictWindowStart, streamIdx);
    const dictStr = extractPrecedingPdfDict(windowBefore);

    if (/\/Subtype\s*\/Image\b/.test(dictStr)) {
      // Trim trailing single CR/LF right before endstream
      let dataEnd = endStreamIdx;
      if (dataEnd > dataStart && latin1[dataEnd - 1] === '\n') dataEnd--;
      if (dataEnd > dataStart && latin1[dataEnd - 1] === '\r') dataEnd--;

      const rawStream = pdfBuffer.subarray(dataStart, dataEnd);
      const decoded = decodePdfImagePixels(dictStr, rawStream);
      if (decoded) {
        const hash = crypto.createHash('sha256').update(decoded.buffer).digest('hex');
        if (!seenHashes.has(hash)) {
          seenHashes.add(hash);
          const idx = results.length + 1;
          results.push({
            id: `pdf-gfx-${hash.slice(0, 10)}`,
            name: `${baseLabel}-graphic-${idx}.${decoded.ext}`,
            mimeType: decoded.mimeType,
            ext: decoded.ext,
            width: decoded.width,
            height: decoded.height,
            buffer: decoded.buffer,
          });
        }
      }
    }

    pos = endStreamIdx + endStreamMarker.length;
  }

  return results;
}
