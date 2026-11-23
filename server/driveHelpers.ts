import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import path from 'path';
import type { PipelineProject } from '../src/types/pipeline.ts';
import { readAssetAsInlineData } from './projectStore.ts';
import { extractImagesFromPdfBuffer } from './pdfAssetExtractor.ts';

export interface DriveFileDescriptor {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  folderUrl?: string;
  folderPath?: string;
  size?: string;
}

export interface ExtractedDriveContent {
  textSummaries: string[];
  inlineParts: Array<{
    fileName: string;
    mimeType: string;
    data: string; // base64
  }>;
  imageFiles: Array<{
    fileId: string;
    fileName: string;
    mimeType: string;
    data: string; // base64
  }>;
  pdfBuffers: Array<{
    fileId: string;
    fileName: string;
    data: string; // base64
  }>;
  analyzedFiles: Array<{ name: string; status: string }>;
  warnings: string[];
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function xmlToPlainText(xml: string): string {
  const withBreaks = xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ');
  const stripped = withBreaks.replace(/<[^>]+>/g, '');
  return decodeXmlEntities(stripped)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractDocxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const parts: string[] = [];
  const docFile = zip.file('word/document.xml');
  if (docFile) {
    parts.push(xmlToPlainText(await docFile.async('string')));
  }
  const extraPaths = Object.keys(zip.files).filter(
    (name) => /^word\/(header|footer)\d*\.xml$/.test(name)
  );
  for (const p of extraPaths) {
    const f = zip.file(p);
    if (f) {
      const txt = xmlToPlainText(await f.async('string'));
      if (txt) parts.push(txt);
    }
  }
  return parts.join('\n\n').trim();
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const na = Number(a.match(/\d+/)?.[0] || 0);
      const nb = Number(b.match(/\d+/)?.[0] || 0);
      return na - nb;
    });
  const slides: string[] = [];
  for (const p of slidePaths) {
    const f = zip.file(p);
    if (f) {
      const txt = xmlToPlainText(await f.async('string'));
      if (txt) slides.push(`[Slide]\n${txt}`);
    }
  }
  return slides.join('\n\n').trim();
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const sharedStrings: string[] = [];
  const ssFile = zip.file('xl/sharedStrings.xml');
  if (ssFile) {
    const ssXml = await ssFile.async('string');
    const siMatches = ssXml.match(/<si[\s\S]*?<\/si>/g) || [];
    for (const si of siMatches) {
      sharedStrings.push(xmlToPlainText(si));
    }
  }

  const sheetPaths = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort();

  const out: string[] = [];
  for (const sp of sheetPaths) {
    const sf = zip.file(sp);
    if (!sf) continue;
    const xml = await sf.async('string');
    const rows: string[] = [];
    const rowMatches = xml.match(/<row[\s\S]*?<\/row>/g) || [];
    for (const rowXml of rowMatches) {
      const cells: string[] = [];
      const cellMatches = rowXml.match(/<c\b[\s\S]*?<\/c>/g) || [];
      for (const cellXml of cellMatches) {
        const isShared = /\bt="s"/.test(cellXml);
        const valMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        const inlineMatch = cellXml.match(/<is>([\s\S]*?)<\/is>/);
        if (inlineMatch) {
          cells.push(xmlToPlainText(inlineMatch[1]));
        } else if (valMatch) {
          const raw = valMatch[1];
          if (isShared && sharedStrings[Number(raw)] !== undefined) {
            cells.push(sharedStrings[Number(raw)]);
          } else {
            cells.push(decodeXmlEntities(raw));
          }
        }
      }
      const line = cells.filter(Boolean).join(' | ');
      if (line) rows.push(line);
    }
    if (rows.length > 0) {
      out.push(`[${sp.split('/').pop()}]\n${rows.join('\n')}`);
    }
  }
  return out.join('\n\n').trim();
}

export class DriveAuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

async function parseGoogleApiError(res: Response): Promise<{ message: string; reason?: string }> {
  let message = `HTTP ${res.status}`;
  let reason: string | undefined;
  try {
    const text = await res.text();
    const parsed = JSON.parse(text);
    if (parsed?.error?.message) {
      message = String(parsed.error.message);
    } else if (text) {
      message = text.slice(0, 200);
    }
    if (Array.isArray(parsed?.error?.errors) && parsed.error.errors[0]?.reason) {
      reason = String(parsed.error.errors[0].reason);
    }
  } catch {
    // ignore parse failures
  }
  return { message, reason };
}

async function driveFetch(url: string, accessToken: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (res.status === 401) {
    throw new DriveAuthError('Google Drive session expired. Please sign in with Google again.', 401);
  }
  if (res.status === 403) {
    const cloned = res.clone();
    const { message, reason } = await parseGoogleApiError(cloned);
    if (
      reason === 'insufficientPermissions' ||
      message.toLowerCase().includes('insufficient authentication scopes') ||
      message.toLowerCase().includes('insufficient permission')
    ) {
      throw new DriveAuthError(
        'Google Drive read permission was not granted. Click "Sign in with Google" and make sure all Google Drive access checkboxes are checked.',
        403
      );
    }
  }
  return res;
}

export async function downloadAndExtractDriveFiles(
  files: DriveFileDescriptor[],
  accessToken: string
): Promise<ExtractedDriveContent> {
  const result: ExtractedDriveContent = {
    textSummaries: [],
    inlineParts: [],
    imageFiles: [],
    pdfBuffers: [],
    analyzedFiles: [],
    warnings: [],
  };

  const attachPdfGraphicsAndBuffer = (
    pdfBuf: Buffer,
    pdfFileId: string,
    pdfFileName: string,
    label: string
  ): number => {
    const normalizedName = pdfFileName.toLowerCase().endsWith('.pdf')
      ? pdfFileName
      : `${pdfFileName}.pdf`;
    result.pdfBuffers.push({
      fileId: pdfFileId,
      fileName: normalizedName,
      data: pdfBuf.toString('base64'),
    });
    try {
      const embedded = extractImagesFromPdfBuffer(pdfBuf, normalizedName, 10);
      for (const g of embedded) {
        const b64 = g.buffer.toString('base64');
        result.imageFiles.push({
          fileId: g.id,
          fileName: g.name,
          mimeType: g.mimeType,
          data: b64,
        });
        result.inlineParts.push({
          fileName: `${label} > ${g.name}`,
          mimeType: g.mimeType,
          data: b64,
        });
      }
      return embedded.length;
    } catch {
      return 0;
    }
  };

  const MAX_TEXT_CHARS = 45000;
  const MAX_BINARY_BYTES = 14 * 1024 * 1024; // 14MB per file

  for (const file of files) {
    if (!file?.id || file.mimeType === 'application/vnd.google-apps.folder') {
      continue;
    }

    let fileId = file.id;
    let mime = (file.mimeType || '').toLowerCase();
    const lowerName = (file.name || '').toLowerCase();
    const fileLabel = file.folderPath ? `${file.folderPath} / ${file.name}` : file.name;

    try {
      // 0. Resolve Google Drive shortcuts if needed
      if (mime === 'application/vnd.google-apps.shortcut') {
        const metaRes = await driveFetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=shortcutDetails(targetId,targetMimeType)&supportsAllDrives=true`,
          accessToken
        );
        if (metaRes.ok) {
          const metaJson = await metaRes.json();
          if (metaJson?.shortcutDetails?.targetId) {
            fileId = metaJson.shortcutDetails.targetId;
          }
          if (metaJson?.shortcutDetails?.targetMimeType) {
            mime = String(metaJson.shortcutDetails.targetMimeType).toLowerCase();
          }
        }
        if (mime === 'application/vnd.google-apps.folder') {
          continue;
        }
      }

      // 1. Google Docs
      if (mime === 'application/vnd.google-apps.document') {
        const res = await driveFetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`,
          accessToken
        );
        let text = '';
        if (res.ok) {
          text = (await res.text()).slice(0, MAX_TEXT_CHARS).trim();
        } else {
          const errInfo = await parseGoogleApiError(res);
          // Fallback to PDF export if text export failed or was restricted
          const pdfRes = await driveFetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=application/pdf`,
            accessToken
          );
          if (!pdfRes.ok) {
            throw new Error(errInfo.message);
          }
          const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
          if (pdfBuf.length <= MAX_BINARY_BYTES) {
            result.inlineParts.push({
              fileName: `${fileLabel}.pdf`,
              mimeType: 'application/pdf',
              data: pdfBuf.toString('base64'),
            });
            const graphicCount = attachPdfGraphicsAndBuffer(pdfBuf, fileId, file.name, fileLabel);
            result.textSummaries.push(`=== ATTACHED GOOGLE DOC (AS PDF): ${fileLabel} ===`);
            result.analyzedFiles.push({
              name: file.name,
              status: graphicCount > 0
                ? `Analyzed Google Doc PDF (${graphicCount} extracted graphic${graphicCount === 1 ? '' : 's'})`
                : 'Analyzed Google Doc PDF',
            });
            continue;
          }
        }

        if (text) {
          result.textSummaries.push(`=== FILE: ${fileLabel} (Google Doc) ===\n${text}`);
          result.analyzedFiles.push({ name: file.name, status: 'Extracted Google Doc text' });
        } else {
          // Visual/image-only Google Doc -> export as PDF so Gemini can read embedded images
          const pdfRes = await driveFetch(
            `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=application/pdf`,
            accessToken
          );
          if (pdfRes.ok) {
            const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
            if (pdfBuf.length > 0 && pdfBuf.length <= MAX_BINARY_BYTES) {
              result.inlineParts.push({
                fileName: `${fileLabel}.pdf`,
                mimeType: 'application/pdf',
                data: pdfBuf.toString('base64'),
              });
              const graphicCount = attachPdfGraphicsAndBuffer(pdfBuf, fileId, file.name, fileLabel);
              result.textSummaries.push(`=== ATTACHED GOOGLE DOC (VISUAL PDF): ${fileLabel} ===`);
              result.analyzedFiles.push({
                name: file.name,
                status: graphicCount > 0
                  ? `Analyzed visual Google Doc (${graphicCount} extracted graphic${graphicCount === 1 ? '' : 's'})`
                  : 'Analyzed visual Google Doc',
              });
              continue;
            }
          }
          result.textSummaries.push(`=== FILE: ${fileLabel} (Empty Google Doc) ===`);
          result.analyzedFiles.push({ name: file.name, status: 'Empty Google Doc' });
        }
        continue;
      }

      // 2. Google Sheets
      if (mime === 'application/vnd.google-apps.spreadsheet') {
        const res = await driveFetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/csv`,
          accessToken
        );
        if (!res.ok) {
          const errInfo = await parseGoogleApiError(res);
          throw new Error(errInfo.message);
        }
        const csv = (await res.text()).slice(0, MAX_TEXT_CHARS).trim();
        if (csv) {
          result.textSummaries.push(`=== FILE: ${fileLabel} (Google Sheet CSV) ===\n${csv}`);
          result.analyzedFiles.push({ name: file.name, status: 'Extracted Google Sheet data' });
        } else {
          result.textSummaries.push(`=== FILE: ${fileLabel} (Empty Google Sheet) ===`);
          result.analyzedFiles.push({ name: file.name, status: 'Empty Google Sheet' });
        }
        continue;
      }

      // 3. Google Slides (extract both text and PDF visual slides if small enough)
      if (mime === 'application/vnd.google-apps.presentation') {
        const res = await driveFetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`,
          accessToken
        );
        let text = '';
        if (res.ok) {
          text = (await res.text()).slice(0, MAX_TEXT_CHARS).trim();
        }
        if (text) {
          result.textSummaries.push(`=== FILE: ${fileLabel} (Google Slides) ===\n${text}`);
        }
        // Also attach PDF export for visual style guides / decks
        const pdfRes = await driveFetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=application/pdf`,
          accessToken
        );
        if (pdfRes.ok) {
          const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
          if (pdfBuf.length > 0 && pdfBuf.length <= MAX_BINARY_BYTES) {
            result.inlineParts.push({
              fileName: `${fileLabel}.pdf`,
              mimeType: 'application/pdf',
              data: pdfBuf.toString('base64'),
            });
            const graphicCount = attachPdfGraphicsAndBuffer(pdfBuf, fileId, file.name, fileLabel);
            if (!text) {
              result.textSummaries.push(`=== ATTACHED GOOGLE SLIDES (PDF): ${fileLabel} ===`);
            }
            result.analyzedFiles.push({
              name: file.name,
              status: graphicCount > 0
                ? `Analyzed Google Slides (text + ${graphicCount} extracted graphic${graphicCount === 1 ? '' : 's'})`
                : 'Analyzed Google Slides (text + visual)',
            });
            continue;
          }
        }
        if (!res.ok && !text) {
          const errInfo = await parseGoogleApiError(res);
          throw new Error(errInfo.message);
        }
        result.analyzedFiles.push({ name: file.name, status: 'Extracted Google Slides text' });
        continue;
      }

      // 4. Google Drawings -> export PNG
      if (mime === 'application/vnd.google-apps.drawing') {
        const res = await driveFetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=image/png`,
          accessToken
        );
        if (!res.ok) {
          const errInfo = await parseGoogleApiError(res);
          throw new Error(errInfo.message);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        const base64 = buf.toString('base64');
        result.inlineParts.push({ fileName: fileLabel, mimeType: 'image/png', data: base64 });
        result.imageFiles.push({ fileId, fileName: `${file.name}.png`, mimeType: 'image/png', data: base64 });
        result.textSummaries.push(`=== ATTACHED GOOGLE DRAWING: ${fileLabel} ===`);
        result.analyzedFiles.push({ name: file.name, status: 'Exported Google Drawing PNG' });
        continue;
      }

      // 5. Other non-exportable Google Workspace native types (Forms, Sites, etc.)
      if (mime.startsWith('application/vnd.google-apps.')) {
        result.textSummaries.push(`=== GOOGLE WORKSPACE FILE: ${fileLabel} (${file.mimeType}) ===`);
        result.analyzedFiles.push({ name: file.name, status: `Cataloged (${file.mimeType})` });
        continue;
      }

      // Skip huge video/audio binaries
      const knownSize = file.size ? Number(file.size) : 0;
      if (mime.startsWith('video/') || mime.startsWith('audio/')) {
        result.textSummaries.push(
          `=== MEDIA ASSET: ${fileLabel} (${file.mimeType}${knownSize ? `, ${(knownSize / (1024 * 1024)).toFixed(1)} MB` : ''}) ===`
        );
        result.analyzedFiles.push({ name: file.name, status: 'Cataloged media asset metadata' });
        continue;
      }

      if (knownSize > MAX_BINARY_BYTES) {
        result.warnings.push(`Skipped downloading "${file.name}" because it exceeds 14 MB.`);
        result.textSummaries.push(
          `=== FILE: ${fileLabel} (${file.mimeType}, ${(knownSize / (1024 * 1024)).toFixed(1)} MB — too large to inline) ===`
        );
        result.analyzedFiles.push({ name: file.name, status: 'Cataloged metadata (>14MB)' });
        continue;
      }

      // 6. Download binary / text file via alt=media
      const res = await driveFetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`,
        accessToken
      );
      if (!res.ok) {
        const errInfo = await parseGoogleApiError(res);
        throw new Error(errInfo.message);
      }
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);

      if (buffer.length > MAX_BINARY_BYTES) {
        result.warnings.push(`"${file.name}" exceeded 14 MB limit and was only cataloged by name.`);
        result.textSummaries.push(`=== FILE: ${fileLabel} (${file.mimeType}, >14MB) ===`);
        result.analyzedFiles.push({ name: file.name, status: 'Cataloged metadata (>14MB)' });
        continue;
      }

      // PDF -> pass directly to Gemini as inlineData + extract embedded graphics
      if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
        result.inlineParts.push({
          fileName: fileLabel,
          mimeType: 'application/pdf',
          data: buffer.toString('base64'),
        });
        const graphicCount = attachPdfGraphicsAndBuffer(buffer, fileId, file.name, fileLabel);
        result.textSummaries.push(
          `=== ATTACHED PDF DOCUMENT: ${fileLabel}${graphicCount > 0 ? ` (${graphicCount} embedded graphic${graphicCount === 1 ? '' : 's'} extracted)` : ''} ===`
        );
        result.analyzedFiles.push({
          name: file.name,
          status: graphicCount > 0
            ? `Analyzed PDF (${graphicCount} extracted graphic${graphicCount === 1 ? '' : 's'})`
            : 'Analyzed PDF document',
        });
        continue;
      }

      // Images -> pass to Gemini visually AND save for product gallery import
      if (
        mime === 'image/png' ||
        mime === 'image/jpeg' ||
        mime === 'image/jpg' ||
        mime === 'image/webp' ||
        /\.(png|jpe?g|webp)$/i.test(lowerName)
      ) {
        const cleanMime =
          mime === 'image/png' || lowerName.endsWith('.png')
            ? 'image/png'
            : mime === 'image/webp' || lowerName.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg';
        const base64 = buffer.toString('base64');
        result.inlineParts.push({
          fileName: fileLabel,
          mimeType: cleanMime,
          data: base64,
        });
        result.imageFiles.push({
          fileId,
          fileName: file.name,
          mimeType: cleanMime,
          data: base64,
        });
        result.textSummaries.push(`=== ATTACHED IMAGE ASSET: ${fileLabel} ===`);
        result.analyzedFiles.push({ name: file.name, status: 'Analyzed image & ready to import' });
        continue;
      }

      // SVG -> read as UTF-8 text
      if (mime === 'image/svg+xml' || lowerName.endsWith('.svg')) {
        const svgText = buffer.toString('utf-8').slice(0, MAX_TEXT_CHARS);
        result.textSummaries.push(`=== VECTOR ASSET (SVG): ${fileLabel} ===\n${svgText}`);
        result.analyzedFiles.push({ name: file.name, status: 'Read SVG vector asset' });
        continue;
      }

      // DOCX
      if (
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        lowerName.endsWith('.docx')
      ) {
        const text = (await extractDocxText(buffer)).slice(0, MAX_TEXT_CHARS);
        if (text) {
          result.textSummaries.push(`=== FILE: ${fileLabel} (DOCX) ===\n${text}`);
          result.analyzedFiles.push({ name: file.name, status: 'Extracted DOCX text' });
        } else {
          result.textSummaries.push(`=== FILE: ${fileLabel} (DOCX — no plain text found) ===`);
          result.analyzedFiles.push({ name: file.name, status: 'No readable text found in DOCX' });
        }
        continue;
      }

      // PPTX
      if (
        mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
        lowerName.endsWith('.pptx')
      ) {
        const text = (await extractPptxText(buffer)).slice(0, MAX_TEXT_CHARS);
        if (text) {
          result.textSummaries.push(`=== FILE: ${fileLabel} (PPTX) ===\n${text}`);
          result.analyzedFiles.push({ name: file.name, status: 'Extracted PPTX slide text' });
        } else {
          result.textSummaries.push(`=== FILE: ${fileLabel} (PPTX) ===`);
          result.analyzedFiles.push({ name: file.name, status: 'Cataloged PPTX' });
        }
        continue;
      }

      // XLSX
      if (
        mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        lowerName.endsWith('.xlsx')
      ) {
        const text = (await extractXlsxText(buffer)).slice(0, MAX_TEXT_CHARS);
        if (text) {
          result.textSummaries.push(`=== FILE: ${fileLabel} (XLSX) ===\n${text}`);
          result.analyzedFiles.push({ name: file.name, status: 'Extracted XLSX spreadsheet text' });
        } else {
          result.textSummaries.push(`=== FILE: ${fileLabel} (XLSX) ===`);
          result.analyzedFiles.push({ name: file.name, status: 'Cataloged XLSX' });
        }
        continue;
      }

      // Plain text / Markdown / CSV / JSON / RTF
      if (
        mime.startsWith('text/') ||
        mime === 'application/json' ||
        /\.(txt|md|csv|json|rtf)$/i.test(lowerName)
      ) {
        const text = buffer.toString('utf-8').slice(0, MAX_TEXT_CHARS).trim();
        if (text) {
          result.textSummaries.push(`=== FILE: ${fileLabel} ===\n${text}`);
          result.analyzedFiles.push({ name: file.name, status: 'Read text file' });
        }
        continue;
      }

      result.textSummaries.push(`=== OTHER FILE: ${fileLabel} (${file.mimeType}) ===`);
      result.analyzedFiles.push({ name: file.name, status: `Cataloged (${file.mimeType})` });
    } catch (err) {
      if (err instanceof DriveAuthError) throw err;
      const msg = err instanceof Error ? err.message : 'Download failed';
      result.warnings.push(`Could not read "${file.name}": ${msg}`);
      result.analyzedFiles.push({ name: file.name, status: `Error: ${msg}` });
    }
  }

  return result;
}

export function extractFolderIdFromUrl(urlOrId?: string): string | null {
  if (!urlOrId) return null;
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;
  if (!trimmed.includes('/') && /^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch && queryMatch[1]) return queryMatch[1];
  return null;
}

function createStyledPdfDoc(title: string, project: PipelineProject) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const margin = 42;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - margin * 2;
  let y = 46;

  const ensureSpace = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - 48) {
      doc.addPage();
      y = 46;
    }
  };

  const addText = (
    text: string,
    fontSize = 10,
    isBold = false,
    color: [number, number, number] = [24, 24, 30]
  ) => {
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(color[0], color[1], color[2]);
    const clean = (text || '—').replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF]/g, ' ');
    const lines = doc.splitTextToSize(clean, maxWidth) as string[];
    const lineHeight = fontSize * 1.38;
    for (const line of lines) {
      ensureSpace(lineHeight);
      doc.text(line, margin, y);
      y += lineHeight;
    }
  };

  const addDivider = () => {
    ensureSpace(14);
    doc.setDrawColor(218, 220, 226);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;
  };

  const addHeader = () => {
    doc.setFillColor(17, 17, 20);
    doc.rect(margin, y - 14, maxWidth, 44, 'F');
    doc.setFillColor(198, 32, 47);
    doc.rect(margin, y + 28, maxWidth, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    doc.setTextColor(255, 255, 255);
    doc.text(`52LAUNCH PRODUCTION STUDIO  |  ${title.toUpperCase()}`, margin + 12, y + 4);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(220, 220, 228);
    doc.text(
      `${project.client || 'Client'} — ${project.product?.name || 'Product'}   ·   ${new Date().toLocaleDateString()}`,
      margin + 12,
      y + 19
    );
    y += 44;
  };

  addHeader();
  return {
    doc,
    addText,
    addDivider,
    ensureSpace,
    addGap: (pt = 6) => {
      y += pt;
    },
    toBuffer: () => Buffer.from(doc.output('arraybuffer')),
  };
}

export function generateShotListPdfBuffer(project: PipelineProject): Buffer {
  const pdf = createStyledPdfDoc('Shot List & Storyboard Summary', project);
  if (project.product?.description) {
    pdf.addText('Product Summary', 11, true, [137, 26, 35]);
    pdf.addText(project.product.description, 9.5);
    pdf.addGap(6);
  }
  pdf.addText(`Master Shot List (${project.shots.length} Shots)`, 11.5, true, [17, 17, 20]);
  pdf.addGap(4);
  if (project.shots.length === 0) {
    pdf.addText('No shots generated yet.', 9.5, false, [110, 110, 120]);
  } else {
    for (const shot of project.shots) {
      pdf.ensureSpace(64);
      pdf.addDivider();
      pdf.addText(
        `${shot.id} · ${shot.durationSec}s · ${shot.route.toUpperCase()} (${shot.model}) · ${shot.deliverable} · ${shot.status}`,
        10,
        true
      );
      pdf.addText(`Scene: ${shot.scene}`, 9.5);
      if (shot.voLine) pdf.addText(`VO: "${shot.voLine}"`, 9, false, [75, 75, 88]);
      if (shot.shootDirection) pdf.addText(`Crew Direction: ${shot.shootDirection}`, 9, false, [75, 75, 88]);
      if (shot.framePrompt) pdf.addText(`Frame Prompt: ${shot.framePrompt}`, 8.5, false, [100, 100, 112]);
      if (shot.videoPrompt) pdf.addText(`Video Prompt: ${shot.videoPrompt}`, 8.5, false, [100, 100, 112]);
      pdf.addGap(4);
    }
  }
  return pdf.toBuffer();
}

export function generateBrandBiblePdfBuffer(project: PipelineProject): Buffer {
  const b = project.brandBible;
  const pdf = createStyledPdfDoc('Brand Bible & Style Guide', project);
  pdf.addText('Positioning', 11, true, [137, 26, 35]);
  pdf.addText(b.positioning || 'Not generated yet.', 9.5);
  pdf.addGap(6);
  pdf.addText('Target Audience', 11, true, [137, 26, 35]);
  pdf.addText(b.audience || 'Not specified.', 9.5);
  pdf.addGap(6);
  pdf.addText('Tone of Voice', 11, true, [137, 26, 35]);
  pdf.addText(`Adjectives: ${(b.toneOfVoice?.adjectives || []).join(', ') || '—'}`, 9.5, true);
  pdf.addText(b.toneOfVoice?.guidance || '', 9.5);
  pdf.addGap(6);
  pdf.addText('Visual Style, Palette & Typography', 11, true, [137, 26, 35]);
  pdf.addText(`Color Palette: ${b.visualStyle?.palette || '—'}`, 9.5);
  if (b.visualStyle?.typography) pdf.addText(`Typography: ${b.visualStyle.typography}`, 9.5);
  pdf.addText(`Lighting: ${b.visualStyle?.lighting || '—'}`, 9.5);
  pdf.addText(`Lens & Framing: ${b.visualStyle?.lensAndFraming || '—'}`, 9.5);
  pdf.addText(`Color Grade: ${b.visualStyle?.grade || '—'}`, 9.5);
  pdf.addGap(6);
  if ((b.characters || []).length > 0) {
    pdf.addText(`Recurring Characters (${b.characters.length})`, 11, true, [137, 26, 35]);
    b.characters.forEach((c) => pdf.addText(`• ${c.name}: ${c.fixedDescriptor}`, 9.5));
    pdf.addGap(6);
  }
  pdf.addText('Product Fidelity Rules', 11, true, [137, 26, 35]);
  pdf.addText(b.productRules || '—', 9.5);
  pdf.addGap(6);
  pdf.addText('Claims Allowed', 11, true, [21, 101, 56]);
  (b.claimsAllowed || []).forEach((c) => pdf.addText(`• ${c}`, 9.5));
  if ((b.claimsToFlag || []).length > 0) {
    pdf.addGap(4);
    pdf.addText('Claims Flagged / Needs Proof', 11, true, [180, 90, 10]);
    b.claimsToFlag.forEach((c) => pdf.addText(`• ${c}`, 9.5));
  }
  if ((b.bannedList || []).length > 0) {
    pdf.addGap(4);
    pdf.addText('Banned List (Never Show or Say)', 11, true, [168, 24, 38]);
    b.bannedList.forEach((c) => pdf.addText(`• ${c}`, 9.5));
  }
  return pdf.toBuffer();
}

export function generateCreativeBriefPdfBuffer(project: PipelineProject): Buffer {
  const br = project.creativeBrief;
  const pdf = createStyledPdfDoc('Creative Brief', project);
  pdf.addText('Campaign Objective', 11, true, [137, 26, 35]);
  pdf.addText(br.objective || '—', 9.5);
  pdf.addGap(6);
  pdf.addText('Core Key Message', 11, true, [137, 26, 35]);
  pdf.addText(br.keyMessage || '—', 9.5, true);
  pdf.addGap(6);
  pdf.addText('Recommended Concept', 11, true, [137, 26, 35]);
  pdf.addText(br.recommendedConcept?.title || '—', 10, true);
  pdf.addText(br.recommendedConcept?.reason || '', 9.5);
  pdf.addGap(6);
  if ((br.concepts || []).length > 0) {
    pdf.addText('Explored Concepts', 11, true, [17, 17, 20]);
    br.concepts.forEach((c, idx) => {
      pdf.addDivider();
      pdf.addText(`${idx + 1}. ${c.title}`, 10, true);
      pdf.addText(`Logline: ${c.logline}`, 9.5);
      pdf.addText(`Why It Works: ${c.whyItWorks}`, 9.5);
      pdf.addText(`Risks: ${c.risks}`, 9.5, false, [120, 40, 45]);
    });
    pdf.addGap(6);
  }
  pdf.addText('Deliverables', 11, true, [137, 26, 35]);
  (br.deliverables || []).forEach((d) => pdf.addText(`• ${d}`, 9.5));
  pdf.addGap(6);
  pdf.addText('VO Direction', 11, true, [137, 26, 35]);
  pdf.addText(
    `Speaker: ${br.voDirection?.speaker || '—'} | Pace: ${br.voDirection?.pace || '—'} | Arc: ${br.voDirection?.emotionalArc || '—'}`,
    9.5
  );
  pdf.addGap(6);
  pdf.addText('Claims Verification', 11, true, [21, 101, 56]);
  pdf.addText(br.claimsCheck || '—', 9.5);
  return pdf.toBuffer();
}

export function generateVoScriptPdfBuffer(project: PipelineProject): Buffer {
  const pdf = createStyledPdfDoc('VO Script & Voice Direction', project);
  if (project.voSettings) {
    pdf.addText(
      `Cast Voice: ${project.voSettings.voiceName} · Tone: ${project.voSettings.emotionalTone} · Speed: ${project.voSettings.speed}x · Language: ${project.voSettings.language}`,
      9.5,
      true,
      [137, 26, 35]
    );
    pdf.addGap(6);
  }
  (project.voScript || []).forEach((line) => {
    pdf.addDivider();
    pdf.addText(
      `${line.shotId} · ${line.speaker} · ${line.durationSec || 4}s (~${line.targetWords || 10} words)`,
      10,
      true
    );
    pdf.addText(`"${line.line}"`, 10);
    if (line.direction) pdf.addText(`Delivery: ${line.direction}`, 9, false, [95, 95, 108]);
  });
  return pdf.toBuffer();
}

export function generateShootPlanPdfBuffer(project: PipelineProject): Buffer {
  const plan = project.shootPlan;
  const pdf = createStyledPdfDoc('Shoot Plan & Call Sheet', project);
  for (const day of plan.shootDays || []) {
    pdf.addDivider();
    pdf.addText(
      `${day.dayLabel} — ${day.location} (Call: ${day.callTime} | Lunch: ${day.lunchTime || '12:30 PM'} | Wrap: ${day.wrapTime})`,
      10.5,
      true,
      [137, 26, 35]
    );
    for (const sb of day.scheduleBreakdown || []) {
      pdf.addText(
        `  [${sb.timeSlot}] ${sb.activity}${sb.shotIds?.length ? ` (${sb.shotIds.join(', ')})` : ''} — ${sb.notes}`,
        9
      );
    }
    for (const setup of day.setups || []) {
      pdf.addText(
        `  • Setup: ${setup.setupName} [${setup.shotIds.join(', ')}] (${setup.estimatedMinutes}m) — ${setup.lightingNotes}`,
        9
      );
    }
    pdf.addGap(4);
  }
  if ((plan.crew || []).length > 0) {
    pdf.addGap(4);
    pdf.addText('Crew Roster', 10.5, true);
    plan.crew.forEach((c) => pdf.addText(`• ${c}`, 9.5));
  }
  if ((plan.equipment || []).length > 0) {
    pdf.addGap(4);
    pdf.addText('Camera, Lens & Grip Equipment', 10.5, true);
    plan.equipment.forEach((e) => pdf.addText(`• ${e}`, 9.5));
  }
  if ((plan.propsAndUnits || []).length > 0) {
    pdf.addGap(4);
    pdf.addText('Props & Product Units', 10.5, true);
    plan.propsAndUnits.forEach((p) =>
      pdf.addText(`• ${p.item} — Qty: ${p.quantity} (${p.suppliedBy})`, 9.5)
    );
  }
  if ((plan.risks || []).length > 0) {
    pdf.addGap(4);
    pdf.addText('Production Risks & Contingencies', 10.5, true, [168, 24, 38]);
    plan.risks.forEach((r) => pdf.addText(`• ${r}`, 9.5));
  }
  return pdf.toBuffer();
}

export function generateMasterProductionPdfBuffer(project: PipelineProject): Buffer {
  const pdf = createStyledPdfDoc('Master Production Packet', project);
  pdf.addText(`Project Summary — ${project.client} (${project.product?.name})`, 11, true, [137, 26, 35]);
  if (project.product?.description) pdf.addText(project.product.description, 9.5);
  pdf.addText(
    `Shots: ${project.shots.length} | VO Lines: ${project.voScript.length} | Shoot Days: ${project.shootPlan?.shootDays?.length || 0} | Locked Refs: ${(project.lockedDriveReferences || []).filter((r) => r.selected).length}`,
    9.5,
    true
  );
  pdf.addDivider();

  if (project.brandBible?.hasGenerated || project.brandBible?.positioning) {
    pdf.addText('1. BRAND BIBLE SUMMARY', 11, true, [137, 26, 35]);
    pdf.addText(`Positioning: ${project.brandBible.positioning}`, 9.5);
    pdf.addText(`Audience: ${project.brandBible.audience}`, 9.5);
    pdf.addText(`Palette: ${project.brandBible.visualStyle?.palette || '—'}`, 9.5);
    pdf.addText(`Typography: ${project.brandBible.visualStyle?.typography || '—'}`, 9.5);
    pdf.addText(`Product Rules: ${project.brandBible.productRules || '—'}`, 9.5);
    pdf.addDivider();
  }

  if (project.creativeBrief?.hasGenerated || project.creativeBrief?.objective) {
    pdf.addText('2. CREATIVE BRIEF SUMMARY', 11, true, [137, 26, 35]);
    pdf.addText(`Objective: ${project.creativeBrief.objective}`, 9.5);
    pdf.addText(`Key Message: ${project.creativeBrief.keyMessage}`, 9.5);
    pdf.addText(
      `Recommended Concept: ${project.creativeBrief.recommendedConcept?.title || '—'} — ${project.creativeBrief.recommendedConcept?.reason || ''}`,
      9.5
    );
    pdf.addDivider();
  }

  if (project.shots.length > 0) {
    pdf.addText(`3. MASTER SHOT LIST (${project.shots.length})`, 11, true, [137, 26, 35]);
    for (const s of project.shots) {
      pdf.addText(`${s.id} (${s.durationSec}s · ${s.route}): ${s.scene}`, 9);
    }
    pdf.addDivider();
  }

  if (project.voScript.length > 0) {
    pdf.addText(`4. VOICEOVER SCRIPT (${project.voScript.length} Lines)`, 11, true, [137, 26, 35]);
    for (const v of project.voScript) {
      pdf.addText(`${v.shotId} [${v.speaker}]: "${v.line}"`, 9);
    }
    pdf.addDivider();
  }

  if (project.shootPlan?.hasGenerated && project.shootPlan.shootDays.length > 0) {
    pdf.addText('5. CALL SHEET & SHOOT DAYS', 11, true, [137, 26, 35]);
    for (const day of project.shootPlan.shootDays) {
      pdf.addText(`${day.dayLabel} — ${day.location} (${day.callTime} to ${day.wrapTime})`, 9.5, true);
    }
  }
  return pdf.toBuffer();
}

async function createDriveFolder(
  accessToken: string,
  name: string,
  parentId?: string
): Promise<{ id: string; webViewLink?: string }> {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }
  const res = await driveFetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true',
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Could not create Drive folder (${res.status}): ${text}`);
  }
  return res.json();
}

async function findDriveItemByName(
  accessToken: string,
  name: string,
  parentId?: string,
  mimeType?: string
): Promise<{ id: string; webViewLink?: string } | null> {
  const escapedName = name.replace(/'/g, "\\'");
  let q = `name = '${escapedName}' and trashed = false`;
  if (parentId) q += ` and '${parentId}' in parents`;
  if (mimeType) q += ` and mimeType = '${mimeType}'`;

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    accessToken
  );
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data.files) && data.files.length > 0 ? data.files[0] : null;
}

async function ensureSubfolder(
  accessToken: string,
  parentId: string,
  subfolderName: string
): Promise<string> {
  const existing = await findDriveItemByName(
    accessToken,
    subfolderName,
    parentId,
    'application/vnd.google-apps.folder'
  );
  if (existing) return existing.id;
  const created = await createDriveFolder(accessToken, subfolderName, parentId);
  return created.id;
}

async function ensureBackupFolder(
  project: PipelineProject,
  accessToken: string,
  preferredFolderUrl?: string
): Promise<{ folderId: string; folderUrl: string }> {
  const isProd = process.env.NODE_ENV === 'production';

  // 0. Prioritize explicitly selected destination folder if set by user — never silently fall back
  const explicitDestId =
    project.googleDriveDestinationFolderId ||
    (project.googleDriveDestinationFolderUrl
      ? extractFolderIdFromUrl(project.googleDriveDestinationFolderUrl)
      : null);

  if (explicitDestId) {
    const check = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(explicitDestId)}?fields=id,name,trashed,webViewLink,capabilities(canAddChildren)&supportsAllDrives=true`,
      accessToken
    );
    if (!check.ok) {
      const errInfo = await parseGoogleApiError(check);
      throw new Error(
        `Selected Google Drive destination folder could not be accessed: ${errInfo.message}`
      );
    }
    const data = await check.json();
    if (data.trashed) {
      throw new Error(
        'Selected Google Drive destination folder is in Trash. Please select an active Save Destination folder.'
      );
    }
    if (data.capabilities && data.capabilities.canAddChildren === false) {
      throw new Error(
        'You do not have write permission on the selected Google Drive destination folder. Choose a Shared Drive or folder where you have Editor/Contributor access.'
      );
    }
    return {
      folderId: data.id,
      folderUrl: data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`,
    };
  }

  // 1. Reuse already-provisioned backup folder if it still exists and is writable
  if (project.googleDriveBackupFolderId) {
    const check = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(project.googleDriveBackupFolderId)}?fields=id,trashed,webViewLink,capabilities(canAddChildren)&supportsAllDrives=true`,
      accessToken
    );
    if (!check.ok) {
      const errInfo = await parseGoogleApiError(check);
      if (isProd) {
        throw new Error(
          `Configured Google Drive backup folder could not be accessed: ${errInfo.message}`
        );
      }
    } else {
      const data = await check.json();
      if (data.trashed) {
        if (isProd) {
          throw new Error(
            'Configured Google Drive backup folder is in Trash. Please select a new Save Destination folder.'
          );
        }
      } else if (data.capabilities && data.capabilities.canAddChildren === false) {
        throw new Error(
          'You do not have write permission on the Google Drive backup folder.'
        );
      } else {
        return {
          folderId: data.id,
          folderUrl: data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`,
        };
      }
    }
  }

  // 2. Try creating/reusing an auto-save subfolder inside the linked Drive folder
  const linkedFolderId = extractFolderIdFromUrl(
    preferredFolderUrl || project.googleDriveFolderUrls?.[0] || project.googleDriveFolderUrl
  );
  if (linkedFolderId) {
    try {
      const existingSub = await findDriveItemByName(
        accessToken,
        '52Launch Auto-Save',
        linkedFolderId,
        'application/vnd.google-apps.folder'
      );
      if (existingSub) {
        return {
          folderId: existingSub.id,
          folderUrl:
            existingSub.webViewLink ||
            `https://drive.google.com/drive/folders/${existingSub.id}`,
        };
      }
      const createdSub = await createDriveFolder(
        accessToken,
        '52Launch Auto-Save',
        linkedFolderId
      );
      return {
        folderId: createdSub.id,
        folderUrl:
          createdSub.webViewLink ||
          `https://drive.google.com/drive/folders/${createdSub.id}`,
      };
    } catch (err) {
      if (isProd || (preferredFolderUrl && preferredFolderUrl === project.googleDriveDestinationFolderUrl)) {
        const msg = err instanceof Error ? err.message : 'Folder could not be accessed or written to.';
        throw new Error(`Could not write to the selected Google Drive folder: ${msg}`);
      }
      // In non-production dev only, allow falling back when a source folder is read-only
    }
  }

  // 3. In production, never silently fall back to someone's personal My Drive
  if (isProd) {
    throw new Error(
      'No Google Drive Save Destination folder is selected. Choose a Shared Drive or project folder in Step 1 before syncing or saving PDFs.'
    );
  }

  // Development/sandbox fallback: create/reuse dedicated app-owned folder in My Drive
  const folderName = `52Launch Studio — ${project.client} (${project.product.name})`;
  const existingRoot = await findDriveItemByName(
    accessToken,
    folderName,
    undefined,
    'application/vnd.google-apps.folder'
  );
  if (existingRoot) {
    return {
      folderId: existingRoot.id,
      folderUrl:
        existingRoot.webViewLink ||
        `https://drive.google.com/drive/folders/${existingRoot.id}`,
    };
  }
  const createdRoot = await createDriveFolder(accessToken, folderName);
  return {
    folderId: createdRoot.id,
    folderUrl:
      createdRoot.webViewLink ||
      `https://drive.google.com/drive/folders/${createdRoot.id}`,
  };
}

export async function upsertDriveFile(
  accessToken: string,
  folderId: string,
  filename: string,
  mimeType: string,
  content: Buffer
): Promise<string> {
  const existing = await findDriveItemByName(accessToken, filename, folderId);
  const boundary = `52launch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const metadata: Record<string, unknown> = existing
    ? { name: filename }
    : { name: filename, parents: [folderId] };

  const metaPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
  );
  const mediaHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
  );
  const ending = Buffer.from(`\r\n--${boundary}--`);
  const body = Buffer.concat([metaPart, mediaHeader, content, ending]);

  const uploadUrl = existing
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existing.id)}?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`
    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`;

  const res = await driveFetch(uploadUrl, accessToken, {
    method: existing ? 'PATCH' : 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Upload failed for ${filename} (${res.status}): ${errText}`);
  }

  return filename;
}

async function copyOrExportLockedRefToFolder(
  accessToken: string,
  targetFolderId: string,
  ref: { fileId: string; name: string; mimeType: string }
): Promise<string | null> {
  const mime = (ref.mimeType || '').toLowerCase();
  const baseName = ref.name || `reference-${ref.fileId}`;

  // Google Workspace native files (Docs, Sheets, Slides, Drawings) -> export PDF / PNG so an immutable copy is archived
  if (
    mime === 'application/vnd.google-apps.document' ||
    mime === 'application/vnd.google-apps.spreadsheet' ||
    mime === 'application/vnd.google-apps.presentation' ||
    mime === 'application/vnd.google-apps.drawing'
  ) {
    const exportMime =
      mime === 'application/vnd.google-apps.drawing' ? 'image/png' : 'application/pdf';
    const ext = exportMime === 'image/png' ? '.png' : '.pdf';
    const outName = baseName.toLowerCase().endsWith(ext) ? baseName : `${baseName}${ext}`;
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref.fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
      accessToken
    );
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    await upsertDriveFile(accessToken, targetFolderId, outName, exportMime, buf);
    return `Reference Files/${outName}`;
  }

  if (mime.startsWith('application/vnd.google-apps.')) {
    return null;
  }

  // Binary file (PDF, image, video, docx, etc.): check if already copied in target folder
  const existing = await findDriveItemByName(accessToken, baseName, targetFolderId);
  if (existing) {
    return `Reference Files/${baseName}`;
  }

  // Try fast Drive server-side copy first
  const copyRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref.fileId)}/copy?supportsAllDrives=true&fields=id,name`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: baseName,
        parents: [targetFolderId],
      }),
    }
  );
  if (copyRes.ok) {
    return `Reference Files/${baseName}`;
  }

  // Fallback: download and upload directly if copy blocked on external shared file
  const dlRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(ref.fileId)}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`,
    accessToken
  );
  if (!dlRes.ok) return null;
  const buf = Buffer.from(await dlRes.arrayBuffer());
  await upsertDriveFile(
    accessToken,
    targetFolderId,
    baseName,
    ref.mimeType || 'application/octet-stream',
    buf
  );
  return `Reference Files/${baseName}`;
}

export async function uploadPdfBufferToProjectDrive(
  project: PipelineProject,
  accessToken: string,
  filename: string,
  pdfBuffer: Buffer,
  preferredFolderUrl?: string
): Promise<{
  backupFolderId: string;
  backupFolderUrl: string;
  filename: string;
}> {
  const { folderId, folderUrl } = await ensureBackupFolder(
    project,
    accessToken,
    preferredFolderUrl
  );
  const safeName = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
  await upsertDriveFile(accessToken, folderId, safeName, 'application/pdf', pdfBuffer);
  return {
    backupFolderId: folderId,
    backupFolderUrl: folderUrl,
    filename: safeName,
  };
}

export async function syncProjectAssetsToDrive(
  project: PipelineProject,
  accessToken: string,
  preferredFolderUrl?: string,
  options?: { skipPdfGeneration?: boolean }
): Promise<{
  backupFolderId: string;
  backupFolderUrl: string;
  uploadedFiles: string[];
}> {
  const { folderId, folderUrl } = await ensureBackupFolder(
    project,
    accessToken,
    preferredFolderUrl
  );

  const slug =
    `${project.client || 'client'}-${project.product?.name || 'project'}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';

  const uploadedFiles: string[] = [];

  // Ensure pipeline folder structure
  const intakeFolderId = await ensureSubfolder(accessToken, folderId, '01-Intake');
  const brandBibleFolderId = await ensureSubfolder(accessToken, folderId, '02-BrandBible');
  const briefFolderId = await ensureSubfolder(accessToken, folderId, '03-CreativeBrief');
  const shotlistFolderId = await ensureSubfolder(accessToken, folderId, '04-ShotList');
  const storyboardFolderId = await ensureSubfolder(accessToken, folderId, '05-Storyboard');
  const continuityFolderId = await ensureSubfolder(accessToken, folderId, '06-Continuity');
  const videoStudioFolderId = await ensureSubfolder(accessToken, folderId, '07-VideoStudio');
  const voiceoverFolderId = await ensureSubfolder(accessToken, folderId, '08-Voiceover');
  const shootPlanFolderId = await ensureSubfolder(accessToken, folderId, '09-ShootPlan');
  const masterPdfsFolderId = await ensureSubfolder(accessToken, folderId, 'MasterPDFs');
  const assetsFolderId = await ensureSubfolder(accessToken, folderId, 'Assets');

  // 1. Project JSON backup in Assets/
  const jsonBuffer = Buffer.from(JSON.stringify(project, null, 2), 'utf-8');
  uploadedFiles.push(
    `Assets/${await upsertDriveFile(accessToken, assetsFolderId, `${slug}-project.json`, 'application/json', jsonBuffer)}`
  );

  // 2. Deliverable PDFs into MasterPDFs/ and respective stage folders
  if (!options?.skipPdfGeneration) {
    if (project.brandBible?.hasGenerated || project.brandBible?.positioning) {
      const biblePdf = generateBrandBiblePdfBuffer(project);
      const name = `${slug}-brand-bible.pdf`;
      await upsertDriveFile(accessToken, brandBibleFolderId, name, 'application/pdf', biblePdf);
      uploadedFiles.push(`02-BrandBible/${name}`);
      await upsertDriveFile(accessToken, masterPdfsFolderId, name, 'application/pdf', biblePdf);
      uploadedFiles.push(`MasterPDFs/${name}`);
    }
    if (project.creativeBrief?.hasGenerated || project.creativeBrief?.objective) {
      const briefPdf = generateCreativeBriefPdfBuffer(project);
      const name = `${slug}-creative-brief.pdf`;
      await upsertDriveFile(accessToken, briefFolderId, name, 'application/pdf', briefPdf);
      uploadedFiles.push(`03-CreativeBrief/${name}`);
      await upsertDriveFile(accessToken, masterPdfsFolderId, name, 'application/pdf', briefPdf);
      uploadedFiles.push(`MasterPDFs/${name}`);
    }
    const shotlistPdf = generateShotListPdfBuffer(project);
    const shotlistName = `${slug}-shotlist-storyboard.pdf`;
    await upsertDriveFile(accessToken, shotlistFolderId, shotlistName, 'application/pdf', shotlistPdf);
    uploadedFiles.push(`04-ShotList/${shotlistName}`);
    await upsertDriveFile(accessToken, masterPdfsFolderId, shotlistName, 'application/pdf', shotlistPdf);
    uploadedFiles.push(`MasterPDFs/${shotlistName}`);

    if ((project.voScript || []).length > 0) {
      const voPdf = generateVoScriptPdfBuffer(project);
      const voName = `${slug}-vo-script.pdf`;
      await upsertDriveFile(accessToken, voiceoverFolderId, voName, 'application/pdf', voPdf);
      uploadedFiles.push(`08-Voiceover/${voName}`);
      await upsertDriveFile(accessToken, masterPdfsFolderId, voName, 'application/pdf', voPdf);
      uploadedFiles.push(`MasterPDFs/${voName}`);
    }
    if (project.shootPlan?.hasGenerated && (project.shootPlan.shootDays || []).length > 0) {
      const callSheetPdf = generateShootPlanPdfBuffer(project);
      const callSheetName = `${slug}-shoot-plan-call-sheet.pdf`;
      await upsertDriveFile(accessToken, shootPlanFolderId, callSheetName, 'application/pdf', callSheetPdf);
      uploadedFiles.push(`09-ShootPlan/${callSheetName}`);
      await upsertDriveFile(accessToken, masterPdfsFolderId, callSheetName, 'application/pdf', callSheetPdf);
      uploadedFiles.push(`MasterPDFs/${callSheetName}`);
    }
    const masterPdf = generateMasterProductionPdfBuffer(project);
    const masterName = `${slug}-master-production-book.pdf`;
    await upsertDriveFile(accessToken, masterPdfsFolderId, masterName, 'application/pdf', masterPdf);
    uploadedFiles.push(`MasterPDFs/${masterName}`);
  }

  // 3. Product Photos into 01-Intake/
  const productPhotos = project.product?.photos || [];
  for (let i = 0; i < productPhotos.length; i++) {
    const photo = productPhotos[i];
    if (!photo.url) continue;
    const inline = await readAssetAsInlineData(project.id, photo.url);
    if (!inline) continue;
    const ext = inline.mimeType.includes('jpeg') ? 'jpg' : inline.mimeType.includes('webp') ? 'webp' : 'png';
    const safeCap = (photo.caption || `angle-${i + 1}`).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const fname = `product-${String(i + 1).padStart(2, '0')}-${safeCap}.${ext}`;
    await upsertDriveFile(accessToken, intakeFolderId, fname, inline.mimeType, Buffer.from(inline.data, 'base64'));
    uploadedFiles.push(`01-Intake/${fname}`);
  }

  // 4. Brand Logo & Brand Graphics into 02-BrandBible/
  const brandLogoUrl = project.brandBible?.brandLogoUrl;
  const brandGraphicsList = [
    ...(project.brandBible?.brandGraphics || []),
    ...(brandLogoUrl && !(project.brandBible?.brandGraphics || []).some((g) => g.url === brandLogoUrl)
      ? [{ id: 'primary-logo', url: brandLogoUrl, caption: project.brandBible?.brandLogoCaption || 'primary-brand-logo' }]
      : []),
  ];

  for (let i = 0; i < brandGraphicsList.length; i++) {
    const graphic = brandGraphicsList[i];
    if (!graphic.url) continue;
    const inline = await readAssetAsInlineData(project.id, graphic.url);
    if (!inline) continue;
    const ext = inline.mimeType.includes('jpeg') ? 'jpg' : inline.mimeType.includes('webp') ? 'webp' : 'png';
    const safeCap = (graphic.caption || `graphic-${i + 1}`).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const fname = `brand-graphic-${String(i + 1).padStart(2, '0')}-${safeCap}.${ext}`;
    await upsertDriveFile(accessToken, brandBibleFolderId, fname, inline.mimeType, Buffer.from(inline.data, 'base64'));
    uploadedFiles.push(`02-BrandBible/${fname}`);
  }

  // 5. Brand Guide PDFs into 02-BrandBible/
  const guideDocs = project.brandGuideDocuments || [];
  for (const doc of guideDocs) {
    if (!doc.url) continue;
    const inline = await readAssetAsInlineData(project.id, doc.url);
    if (!inline) continue;
    const fname = doc.name.toLowerCase().endsWith('.pdf') ? doc.name : `${doc.name}.pdf`;
    await upsertDriveFile(accessToken, brandBibleFolderId, fname, 'application/pdf', Buffer.from(inline.data, 'base64'));
    uploadedFiles.push(`02-BrandBible/${fname}`);
  }

  // 6. Selected Locked References into 06-Continuity/
  const selectedRefs = (project.lockedDriveReferences || []).filter((r) => r.selected);
  for (const ref of selectedRefs) {
    try {
      const savedName = await copyOrExportLockedRefToFolder(accessToken, continuityFolderId, ref);
      if (savedName) uploadedFiles.push(`06-Continuity/${path.basename(savedName)}`);
    } catch {
      // non-fatal
    }
  }

  // 7. Storyboard Assets & Generated Frames into 05-Storyboard/
  const sbAssetsWithImages = (project.storyboardStudio?.assets || []).filter((a) => Boolean(a.imageUrl));
  const shotsWithFrames = (project.shots || []).filter((s) => Boolean(s.frameImageUrl));

  for (const asset of sbAssetsWithImages) {
    if (!asset.imageUrl) continue;
    const inline = await readAssetAsInlineData(project.id, asset.imageUrl);
    if (!inline) continue;
    const ext = inline.mimeType.includes('jpeg') ? 'jpg' : 'png';
    const safeName = (asset.name || asset.id).replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40);
    const fname = `sheet-${asset.category}-${safeName}.${ext}`;
    await upsertDriveFile(accessToken, storyboardFolderId, fname, inline.mimeType, Buffer.from(inline.data, 'base64'));
    uploadedFiles.push(`05-Storyboard/${fname}`);
  }

  for (const shot of shotsWithFrames) {
    if (!shot.frameImageUrl) continue;
    const inline = await readAssetAsInlineData(project.id, shot.frameImageUrl);
    if (!inline) continue;
    const ext = inline.mimeType.includes('jpeg') ? 'jpg' : inline.mimeType.includes('webp') ? 'webp' : 'png';
    const frameBuf = Buffer.from(inline.data, 'base64');
    const fname = `${shot.id}-storyboard-frame.${ext}`;
    await upsertDriveFile(accessToken, storyboardFolderId, fname, inline.mimeType, frameBuf);
    uploadedFiles.push(`05-Storyboard/${fname}`);
  }

  // 8. Video Studio clips into 07-VideoStudio/
  for (const shot of project.shots || []) {
    if (shot.videoUrl && shot.videoUrl.startsWith('data:')) {
      const inline = await readAssetAsInlineData(project.id, shot.videoUrl);
      if (inline) {
        const fname = `${shot.id}-video-clip.mp4`;
        await upsertDriveFile(accessToken, videoStudioFolderId, fname, inline.mimeType || 'video/mp4', Buffer.from(inline.data, 'base64'));
        uploadedFiles.push(`07-VideoStudio/${fname}`);
      }
    }
    if (shot.upscaledVideoUrl && shot.upscaledVideoUrl.startsWith('data:')) {
      const inline = await readAssetAsInlineData(project.id, shot.upscaledVideoUrl);
      if (inline) {
        const fname = `${shot.id}-upscaled-1080p.mp4`;
        await upsertDriveFile(accessToken, videoStudioFolderId, fname, inline.mimeType || 'video/mp4', Buffer.from(inline.data, 'base64'));
        uploadedFiles.push(`07-VideoStudio/${fname}`);
      }
    }
  }

  return {
    backupFolderId: folderId,
    backupFolderUrl: folderUrl,
    uploadedFiles,
  };
}

export async function downloadDriveBinaryAsset(
  file: DriveFileDescriptor,
  accessToken: string
): Promise<{
  fileId: string;
  fileName: string;
  mimeType: string;
  ext: string;
  buffer: Buffer;
}> {
  let fileId = file.id;
  let mime = (file.mimeType || '').toLowerCase();
  let fileName = file.name || `drive-asset-${file.id}`;
  const MAX_ASSET_BYTES = 95 * 1024 * 1024; // 95 MB

  // Resolve Google Drive shortcut if needed
  if (mime === 'application/vnd.google-apps.shortcut') {
    const metaRes = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,mimeType,shortcutDetails(targetId,targetMimeType)&supportsAllDrives=true`,
      accessToken
    );
    if (metaRes.ok) {
      const metaJson = await metaRes.json();
      if (metaJson?.shortcutDetails?.targetId) {
        fileId = metaJson.shortcutDetails.targetId;
      }
      if (metaJson?.shortcutDetails?.targetMimeType) {
        mime = String(metaJson.shortcutDetails.targetMimeType).toLowerCase();
      }
    }
  }

  if (mime === 'application/vnd.google-apps.folder') {
    throw new Error(`"${fileName}" is a folder, not a downloadable file.`);
  }

  // Export Google Drawing as PNG
  if (mime === 'application/vnd.google-apps.drawing') {
    const res = await driveFetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=image/png`,
      accessToken
    );
    if (!res.ok) {
      const errInfo = await parseGoogleApiError(res);
      throw new Error(errInfo.message);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return {
      fileId,
      fileName: fileName.endsWith('.png') ? fileName : `${fileName}.png`,
      mimeType: 'image/png',
      ext: 'png',
      buffer,
    };
  }

  if (mime.startsWith('application/vnd.google-apps.')) {
    throw new Error(`"${fileName}" is a Google Workspace document, not an image, video, or audio file.`);
  }

  const knownSize = file.size ? Number(file.size) : 0;
  if (knownSize > MAX_ASSET_BYTES) {
    throw new Error(`"${fileName}" exceeds the 95 MB import limit (${(knownSize / (1024 * 1024)).toFixed(1)} MB).`);
  }

  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`,
    accessToken
  );
  if (!res.ok) {
    const errInfo = await parseGoogleApiError(res);
    throw new Error(errInfo.message);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_ASSET_BYTES) {
    throw new Error(`"${fileName}" exceeds the 95 MB import limit.`);
  }

  const lower = fileName.toLowerCase();
  let ext = 'bin';
  let resolvedMime = mime || 'application/octet-stream';

  if (mime.includes('png') || lower.endsWith('.png')) {
    ext = 'png';
    resolvedMime = 'image/png';
  } else if (mime.includes('webp') || lower.endsWith('.webp')) {
    ext = 'webp';
    resolvedMime = 'image/webp';
  } else if (mime.includes('gif') || lower.endsWith('.gif')) {
    ext = 'gif';
    resolvedMime = 'image/gif';
  } else if (mime.includes('jpeg') || mime.includes('jpg') || /\.jpe?g$/i.test(lower)) {
    ext = 'jpg';
    resolvedMime = 'image/jpeg';
  } else if (mime.includes('quicktime') || lower.endsWith('.mov')) {
    ext = 'mov';
    resolvedMime = 'video/quicktime';
  } else if (mime.includes('webm') || lower.endsWith('.webm')) {
    ext = 'webm';
    resolvedMime = 'video/webm';
  } else if (mime.includes('mp4') || lower.endsWith('.mp4')) {
    ext = 'mp4';
    resolvedMime = 'video/mp4';
  } else if (mime.includes('wav') || lower.endsWith('.wav')) {
    ext = 'wav';
    resolvedMime = 'audio/wav';
  } else if (mime.includes('mpeg') || mime.includes('mp3') || lower.endsWith('.mp3')) {
    ext = 'mp3';
    resolvedMime = 'audio/mpeg';
  } else if (mime.includes('mp4') && mime.startsWith('audio/')) {
    ext = 'm4a';
    resolvedMime = 'audio/mp4';
  } else if (lower.endsWith('.m4a')) {
    ext = 'm4a';
    resolvedMime = 'audio/mp4';
  } else if (mime.includes('ogg') || lower.endsWith('.ogg')) {
    ext = 'ogg';
    resolvedMime = 'audio/ogg';
  } else if (mime.includes('aac') || lower.endsWith('.aac')) {
    ext = 'aac';
    resolvedMime = 'audio/aac';
  } else if (mime.includes('pdf') || lower.endsWith('.pdf')) {
    ext = 'pdf';
    resolvedMime = 'application/pdf';
  }

  return {
    fileId,
    fileName,
    mimeType: resolvedMime,
    ext,
    buffer,
  };
}

