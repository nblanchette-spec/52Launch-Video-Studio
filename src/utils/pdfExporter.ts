import { jsPDF } from 'jspdf';
import {
  PipelineProject,
  PipelineShot,
  ShootDayPlan,
  ShootPlan,
  ShootScheduleBlock,
  ShotClipHistoryItem,
} from '../types/pipeline';
import {
  getGoogleDriveAccessToken,
  uploadPdfToDriveServer,
} from './googleDriveSync';

function getAllBrandGraphics(project: PipelineProject): Array<{ url: string; caption: string }> {
  const b = project.brandBible;
  const list: Array<{ url: string; caption: string }> = [];
  const seen = new Set<string>();
  if (b?.brandLogoUrl) {
    seen.add(b.brandLogoUrl);
    list.push({
      url: b.brandLogoUrl,
      caption: b.brandLogoCaption || 'Primary Brand Logo',
    });
  }
  for (const g of b?.brandGraphics || []) {
    if (g.url && !seen.has(g.url)) {
      seen.add(g.url);
      list.push({ url: g.url, caption: g.caption || 'Brand Graphic' });
    }
  }
  return list;
}

export interface DriveSaveResult {
  attempted: boolean;
  success: boolean;
  backupFolderId?: string;
  backupFolderUrl?: string;
  filename?: string;
  error?: string;
}

export interface MasterPdfDriveStatus {
  status: 'saved' | 'failed' | 'skipped';
  message: string;
  folderUrl?: string;
  error?: string;
}

export interface MasterPdfExportResult {
  downloadedFiles: string[];
  driveStatus: MasterPdfDriveStatus;
}

export function summarizeDriveStatus(results: DriveSaveResult[]): MasterPdfDriveStatus {
  if (results.length === 0) {
    return { status: 'skipped', message: '' };
  }

  const attempted = results.filter((r) => r.attempted);
  if (attempted.length === 0) {
    return { status: 'skipped', message: '' };
  }

  const failure = attempted.find((r) => !r.success);
  if (failure) {
    const errorDetails = failure.error?.trim() || 'Upload failed.';
    return {
      status: 'failed',
      message: `PDF downloaded locally, but couldn’t save to Drive: ${errorDetails}`,
      error: errorDetails,
    };
  }

  const firstWithUrl = attempted.find((r) => r.backupFolderUrl);
  return {
    status: 'saved',
    message: 'Saved to Drive',
    folderUrl: firstWithUrl?.backupFolderUrl,
  };
}

export async function maybeAutoSavePdfToDrive(
  project: PipelineProject,
  filename: string,
  pdfBlob: Blob
): Promise<DriveSaveResult> {
  const hasDriveConfig = Boolean(
    project.googleDriveDestinationFolderId ||
    project.googleDriveDestinationFolderUrl ||
    project.googleDriveBackupFolderId ||
    (Array.isArray(project.googleDriveFolderUrls) &&
      project.googleDriveFolderUrls.some((u) => u.trim()))
  );

  let token: string | null = null;
  try {
    token = await getGoogleDriveAccessToken();
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : 'Could not check Google Drive authentication.';
    return {
      attempted: true,
      success: false,
      error: msg,
    };
  }

  if (!token) {
    if (hasDriveConfig) {
      return {
        attempted: true,
        success: false,
        error:
          'Google Drive is not connected or your Drive session expired. Please reconnect Google Drive and try again.',
      };
    }
    return {
      attempted: false,
      success: false,
    };
  }

  try {
    const uploaded = await uploadPdfToDriveServer({
      projectId: project.id,
      filename,
      pdfBlob,
      destinationFolderId:
        project.googleDriveDestinationFolderId || project.googleDriveBackupFolderId,
      destinationFolderUrl:
        project.googleDriveDestinationFolderUrl || project.googleDriveBackupFolderUrl,
      accessToken: token,
    });

    return {
      attempted: true,
      success: true,
      backupFolderId: uploaded.backupFolderId,
      backupFolderUrl: uploaded.backupFolderUrl,
      filename: uploaded.filename,
    };
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : 'Could not save PDF to Google Drive.';
    console.warn(`[pdfExporter] Auto-save PDF "${filename}" to Drive failed:`, errorMsg);
    return {
      attempted: true,
      success: false,
      error: errorMsg,
    };
  }
}

export type MasterPdfSectionId =
  | 'brandBible'
  | 'creativeBrief'
  | 'shotListAndStoryboard'
  | 'frameSuggestions'
  | 'videoPromptsAndVideo'
  | 'voScript'
  | 'shootPlan';

export interface MasterPdfSectionMeta {
  id: MasterPdfSectionId;
  label: string;
  description: string;
  filenameSuffix: string;
  getStatus: (project: PipelineProject) => { ready: boolean; detail: string };
}

export const MASTER_PDF_SECTIONS: MasterPdfSectionMeta[] = [
  {
    id: 'brandBible',
    label: 'Brand Bible',
    description:
      'Positioning, audience, tone, brand colors & swatches, fonts/typography, logo, product photos, characters & guardrails.',
    filenameSuffix: 'brand-bible',
    getStatus: (p) => ({
      ready: Boolean(p.brandBible?.hasGenerated),
      detail: p.brandBible?.hasGenerated
        ? `${p.brandBible.characters?.length ?? 0} character(s) · ${p.brandBible.claimsAllowed?.length ?? 0} claims`
        : 'Not generated yet',
    }),
  },
  {
    id: 'creativeBrief',
    label: 'Creative Brief',
    description:
      'Campaign objective, key message, creative concepts, selected direction & VO pacing.',
    filenameSuffix: 'creative-brief',
    getStatus: (p) => ({
      ready: Boolean(p.creativeBrief?.hasGenerated),
      detail: p.creativeBrief?.hasGenerated
        ? `${p.creativeBrief.concepts?.length ?? 0} concept(s) · ${p.creativeBrief.deliverables?.length ?? 0} deliverables`
        : 'Not generated yet',
    }),
  },
  {
    id: 'shotListAndStoryboard',
    label: 'Shot List & Storyboard',
    description:
      'Shot summary table plus ordered storyboard cards with artwork, routes, timing & VO.',
    filenameSuffix: 'shotlist-storyboard',
    getStatus: (p) => {
      const frames = p.shots.filter((s) => Boolean(s.frameImageUrl)).length;
      return {
        ready: p.shots.length > 0,
        detail:
          p.shots.length > 0
            ? `${p.shots.length} shot(s) · ${frames} frame(s)`
            : 'No shots yet',
      };
    },
  },
  {
    id: 'frameSuggestions',
    label: 'Frame Suggestions & QA',
    description:
      'Thumbnail preview paired with Gemini Vision QA scores, detected issues & fix prompts.',
    filenameSuffix: 'frame-suggestions',
    getStatus: (p) => {
      const checked = p.shots.filter((s) => Boolean(s.frameCheck)).length;
      return {
        ready: checked > 0,
        detail:
          checked > 0
            ? `${checked}/${p.shots.length} shot(s) evaluated`
            : 'No Frame QA runs yet',
      };
    },
  },
  {
    id: 'videoPromptsAndVideo',
    label: 'Video Prompts & Video Links',
    description:
      'Shot thumbnail, motion & negative prompts, seed values, rendered takes & Topaz upscales.',
    filenameSuffix: 'video-prompts-and-clips',
    getStatus: (p) => {
      const aiShots = p.shots.filter((s) => s.route !== 'live');
      const withPrompts = aiShots.filter((s) => s.videoPrompt.trim().length > 0).length;
      const withVideos = aiShots.filter(
        (s) => Boolean(s.videoUrl) || (s.videoHistory?.length ?? 0) > 0
      ).length;
      return {
        ready: withPrompts > 0 || withVideos > 0,
        detail:
          aiShots.length > 0
            ? `${withPrompts} prompts · ${withVideos} rendered clip(s)`
            : 'No AI/Hybrid shots',
      };
    },
  },
  {
    id: 'voScript',
    label: 'VO Script & Voice Direction',
    description:
      'Time-matched voiceover script, speaker casting, delivery direction, audio tags & render status.',
    filenameSuffix: 'vo-script',
    getStatus: (p) => {
      const rendered = p.voScript.filter((v) => Boolean(v.audioUrl)).length;
      return {
        ready: p.voScript.length > 0,
        detail:
          p.voScript.length > 0
            ? `${p.voScript.length} line(s) · ${rendered} synthesized`
            : 'No VO script lines yet',
      };
    },
  },
  {
    id: 'shootPlan',
    label: 'Shoot Plan & Call Sheet',
    description:
      'Shoot days, call/wrap times, setup schedules, equipment, crew, props & client questions.',
    filenameSuffix: 'shoot-plan-call-sheet',
    getStatus: (p) => ({
      ready: Boolean(p.shootPlan?.hasGenerated),
      detail: p.shootPlan?.hasGenerated
        ? `${p.shootPlan.shootDays.length} day(s) · ${p.shootPlan.crew.length} crew`
        : 'Not generated yet',
    }),
  },
];

type RgbTuple = [number, number, number];
type CardTone = 'neutral' | 'amber' | 'emerald' | 'rose' | 'indigo';
type PillTone = 'slate' | 'amber' | 'emerald' | 'rose' | 'indigo';

const PALETTE: {
  ink: RgbTuple;
  charcoal: RgbTuple;
  slate: RgbTuple;
  muted: RgbTuple;
  faint: RgbTuple;
  border: RgbTuple;
  borderSoft: RgbTuple;
  surface: RgbTuple;
  surfaceAlt: RgbTuple;
  white: RgbTuple;
  amber: RgbTuple;
  amberDark: RgbTuple;
  amberSoft: RgbTuple;
  amberTint: RgbTuple;
  amberBorder: RgbTuple;
  crimson: RgbTuple;
  burgundy: RgbTuple;
  emeraldDark: RgbTuple;
  emeraldSoft: RgbTuple;
  emeraldTint: RgbTuple;
  emeraldBorder: RgbTuple;
  roseDark: RgbTuple;
  roseSoft: RgbTuple;
  roseTint: RgbTuple;
  roseBorder: RgbTuple;
  indigoDark: RgbTuple;
  indigoSoft: RgbTuple;
  indigoTint: RgbTuple;
  indigoBorder: RgbTuple;
} = {
  // 52Launch Official Brand Palette (Brand Guide p.5 + Obsidian Gallery Neutrals)
  ink: [17, 17, 20], // #111114 primary ink & obsidian headers
  charcoal: [28, 28, 34], // #1C1C22 dark card fill
  slate: [58, 58, 68], // #3A3A44 secondary headings
  muted: [106, 106, 118], // #6A6A76 labels & captions
  faint: [152, 152, 162], // #9898A2 subtle placeholders
  border: [222, 222, 228], // #DEDEE4 crisp hairline border
  borderSoft: [234, 234, 238], // #EAEAEE light row border
  surface: [248, 248, 250], // #F8F8FA light gallery surface
  surfaceAlt: [241, 241, 245], // #F1F1F5 card header inset
  white: [255, 255, 255],
  // Primary Brand Accent Slots (RED #5 #C6202F + RED #2 #891A23)
  amber: [198, 32, 47], // Red #5 (#C6202F Pantone 1795 C)
  amberDark: [137, 26, 35], // Red #2 (#891A23 Pantone 187 C)
  amberSoft: [251, 228, 231], // soft crimson pill fill
  amberTint: [253, 244, 245], // soft crimson callout fill
  amberBorder: [234, 186, 192], // crimson callout border
  crimson: [198, 32, 47],
  burgundy: [137, 26, 35],
  // Semantic Status Colors harmonized with crisp neutral paper
  emeraldDark: [21, 101, 56],
  emeraldSoft: [220, 245, 230],
  emeraldTint: [241, 251, 245],
  emeraldBorder: [176, 226, 196],
  roseDark: [168, 24, 38],
  roseSoft: [254, 226, 228],
  roseTint: [254, 242, 243],
  roseBorder: [242, 182, 188],
  // Secondary Brand Accent harmonized to Deep Burgundy + Warm Gallery
  indigoDark: [137, 26, 35],
  indigoSoft: [245, 229, 231],
  indigoTint: [250, 246, 247],
  indigoBorder: [226, 194, 198],
};

function slugifyFilePart(input: string): string {
  const cleaned = (input || 'project')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'project';
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 2500);
}

/**
 * Normalizes strings for jsPDF WinAnsi Helvetica/Courier rendering so curly quotes,
 * arrows, ellipses, and stray Unicode never distort text-wrapping widths.
 */
function sanitizePdfText(raw: string | null | undefined, fallback = '—'): string {
  let s = (raw ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u2194/g, '<->')
    .replace(/\u2713|\u2714/g, 'OK')
    .replace(/\u2715|\u2716|\u2717/g, 'X')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');

  s = s.replace(/[\uD800-\uDFFF]/g, '');
  s = s.replace(/[^\x09\x0A\x20-\x7E\xA0-\xFF\u2013\u2014\u2022]/g, '');
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function parseHexSwatches(
  text: string | null | undefined
): Array<{ hex: string; rgb: RgbTuple }> {
  const matches = (text || '').match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const seen = new Set<string>();
  const out: Array<{ hex: string; rgb: RgbTuple }> = [];
  for (const raw of matches) {
    let h = raw.toUpperCase();
    if (/^#[0-9A-F]{3}$/.test(h)) {
      h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
    }
    if (!/^#[0-9A-F]{6}$/.test(h) || seen.has(h)) continue;
    seen.add(h);
    out.push({
      hex: h,
      rgb: [
        parseInt(h.slice(1, 3), 16),
        parseInt(h.slice(3, 5), 16),
        parseInt(h.slice(5, 7), 16),
      ],
    });
    if (out.length >= 6) break;
  }
  return out;
}

interface PdfImageData {
  dataUrl: string;
  width: number;
  height: number;
  format?: 'JPEG' | 'PNG';
}

async function loadImageForPdf(src: string | null | undefined): Promise<PdfImageData | null> {
  if (!src) return null;
  let objectUrlToRevoke: string | null = null;
  try {
    let imgSrc = src;
    if (!src.startsWith('data:')) {
      const resp = await fetch(src);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      objectUrlToRevoke = URL.createObjectURL(blob);
      imgSrc = objectUrlToRevoke;
    }

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image load failed'));
      el.src = imgSrc;
    });

    const natW = img.naturalWidth || 1280;
    const natH = img.naturalHeight || 720;
    const maxDim = 960;
    const scale = Math.min(1, maxDim / Math.max(natW, natH));
    const w = Math.max(1, Math.round(natW * scale));
    const h = Math.max(1, Math.round(natH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    return {
      dataUrl: canvas.toDataURL('image/jpeg', 0.88),
      width: w,
      height: h,
      format: 'JPEG',
    };
  } catch {
    return null;
  } finally {
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
    }
  }
}

async function loadPngLogoForPdf(src: string): Promise<PdfImageData | null> {
  let objectUrlToRevoke: string | null = null;
  try {
    const resp = await fetch(src);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    objectUrlToRevoke = URL.createObjectURL(blob);

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Logo load failed'));
      el.src = objectUrlToRevoke!;
    });

    const natW = img.naturalWidth || 500;
    const natH = img.naturalHeight || 450;
    const maxDim = 640;
    const scale = Math.min(1, maxDim / Math.max(natW, natH));
    const w = Math.max(1, Math.round(natW * scale));
    const h = Math.max(1, Math.round(natH * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: w,
      height: h,
      format: 'PNG',
    };
  } catch {
    return null;
  } finally {
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
    }
  }
}

interface BrandLogoAssets {
  badgeBurgundy: PdfImageData | null;
  logoPrimary: PdfImageData | null;
}

let cachedBrandAssetsPromise: Promise<BrandLogoAssets> | null = null;

function load52LaunchBrandAssets(): Promise<BrandLogoAssets> {
  if (!cachedBrandAssetsPromise) {
    cachedBrandAssetsPromise = Promise.all([
      loadPngLogoForPdf('/brand/logo-badge-burgundy.png'),
      loadPngLogoForPdf('/brand/logo-primary.png'),
    ])
      .then(([badgeBurgundy, logoPrimary]) => ({ badgeBurgundy, logoPrimary }))
      .catch(() => ({ badgeBurgundy: null, logoPrimary: null }));
  }
  return cachedBrandAssetsPromise;
}

function formatModelName(model: PipelineShot['model']): string {
  switch (model) {
    case 'flux3':
      return 'FLUX 3';
    case 'kling':
      return 'Kling 4.0';
    case 'wan':
      return 'Wan 3.0 Prime';
    case 'luma':
      return 'Luma Ray 3.2';
    case 'none':
      return 'Live Camera';
    default:
      return 'Seedance';
  }
}

function getShotThumbnailUrl(shot: PipelineShot): string | null {
  if (shot.frameImageUrl) return shot.frameImageUrl;
  if (shot.videoHistory && shot.videoHistory.length > 0) {
    const withFrame = shot.videoHistory.find((c) => Boolean(c.startFrameUrl));
    if (withFrame?.startFrameUrl) return withFrame.startFrameUrl;
  }
  return null;
}

function resolveAbsoluteUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;
  if (typeof window !== 'undefined' && url.startsWith('/')) {
    return `${window.location.origin}${url}`;
  }
  return url;
}

function isHttpOrLocalAssetUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return !url.startsWith('data:');
}

function formatShortUrlDisplay(absUrl: string): string {
  if (!absUrl) return 'Unavailable';
  if (absUrl.startsWith('data:')) return 'Embedded media asset';
  try {
    const u = new URL(absUrl);
    const tail = u.pathname.split('/').filter(Boolean).slice(-2).join('/');
    return tail ? `${u.host}/.../${tail}` : absUrl;
  } catch {
    return absUrl.length > 68 ? `${absUrl.slice(0, 65)}...` : absUrl;
  }
}

function toneColors(tone: CardTone): {
  bg: RgbTuple;
  bd: RgbTuple;
  titleClr: RgbTuple;
} {
  return {
    bg:
      tone === 'amber'
        ? PALETTE.amberTint
        : tone === 'emerald'
          ? PALETTE.emeraldTint
          : tone === 'rose'
            ? PALETTE.roseTint
            : tone === 'indigo'
              ? PALETTE.indigoTint
              : PALETTE.surface,
  bd:
      tone === 'amber'
        ? PALETTE.amberBorder
        : tone === 'emerald'
          ? PALETTE.emeraldBorder
          : tone === 'rose'
            ? PALETTE.roseBorder
            : tone === 'indigo'
              ? PALETTE.indigoBorder
              : PALETTE.border,
    titleClr:
      tone === 'amber'
        ? PALETTE.amberDark
        : tone === 'emerald'
          ? PALETTE.emeraldDark
          : tone === 'rose'
            ? PALETTE.roseDark
            : tone === 'indigo'
              ? PALETTE.indigoDark
              : PALETTE.slate,
  };
}

function pillColors(tone: PillTone): { bg: RgbTuple; fg: RgbTuple } {
  return {
    bg:
      tone === 'amber'
        ? PALETTE.amberSoft
        : tone === 'emerald'
          ? PALETTE.emeraldSoft
          : tone === 'rose'
            ? PALETTE.roseSoft
            : tone === 'indigo'
              ? PALETTE.indigoSoft
              : PALETTE.surfaceAlt,
    fg:
      tone === 'amber'
        ? PALETTE.amberDark
        : tone === 'emerald'
          ? PALETTE.emeraldDark
          : tone === 'rose'
            ? PALETTE.roseDark
            : tone === 'indigo'
              ? PALETTE.indigoDark
              : PALETTE.slate,
  };
}

function drawImageInBoxRaw(
  doc: jsPDF,
  img: PdfImageData | null,
  x: number,
  y: number,
  w: number,
  h: number,
  emptyLabel = 'No image'
): void {
  doc.setDrawColor(...PALETTE.border);
  doc.setFillColor(...PALETTE.surface);
  doc.setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, 1.2, 1.2, 'FD');

  if (img) {
    const pad = 1.0;
    const availW = w - pad * 2;
    const availH = h - pad * 2;
    const ratio = Math.min(availW / img.width, availH / img.height);
    const drawW = img.width * ratio;
    const drawH = img.height * ratio;
    const drawX = x + pad + (availW - drawW) / 2;
    const drawY = y + pad + (availH - drawH) / 2;
    doc.addImage(img.dataUrl, img.format || 'JPEG', drawX, drawY, drawW, drawH);
  } else {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.4);
    doc.setTextColor(...PALETTE.faint);
    doc.text(sanitizePdfText(emptyLabel), x + w / 2, y + h / 2 + 1, {
      align: 'center',
    });
  }
}

function drawPillRaw(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  tone: PillTone = 'slate',
  fontSize = 6.9
): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  const label = sanitizePdfText(text);
  const w = doc.getTextWidth(label) + 4.2;
  const h = 4.6;
  const { bg, fg } = pillColors(tone);
  doc.setFillColor(...bg);
  doc.roundedRect(x, y, w, h, 1, 1, 'F');
  doc.setTextColor(...fg);
  doc.text(label, x + 2.1, y + 3.25);
  return w;
}

function drawPillFlowRaw(
  doc: jsPDF,
  pills: Array<{ text: string; tone: PillTone }>,
  startX: number,
  startY: number,
  maxRightX: number,
  dryRun = false
): { height: number; rows: number } {
  if (pills.length === 0) return { height: 0, rows: 0 };
  let cx = startX;
  let cy = startY;
  let rows = 1;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.9);

  for (const pill of pills) {
    const label = sanitizePdfText(pill.text);
    const w = doc.getTextWidth(label) + 4.2;
    if (cx > startX && cx + w > maxRightX) {
      cx = startX;
      cy += 5.6;
      rows += 1;
    }
    if (!dryRun) {
      drawPillRaw(doc, label, cx, cy, pill.tone, 6.9);
    }
    cx += w + 1.8;
  }

  return { height: rows * 5.6 - 1.0, rows };
}

/**
 * Wraps text strictly inside maxW, splitting ultra-long unbroken tokens (URLs, paths, IDs)
 * character-by-character so table cells never bleed into adjacent columns.
 */
function wrapPdfTextStrict(
  doc: jsPDF,
  raw: string | null | undefined,
  maxW: number,
  fallback = '—'
): string[] {
  const safeMax = Math.max(4, maxW);
  const initialLines: string[] = doc.splitTextToSize(sanitizePdfText(raw, fallback), safeMax);
  const out: string[] = [];
  for (const line of initialLines) {
    if (doc.getTextWidth(line) <= safeMax + 0.15) {
      out.push(line);
      continue;
    }
    let chunk = '';
    for (const ch of line) {
      if (chunk.length > 0 && doc.getTextWidth(chunk + ch) > safeMax) {
        out.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    if (chunk.length > 0) out.push(chunk);
  }
  return out.length > 0 ? out : [fallback];
}

/**
 * Shared responsive table drawer used by both Portrait PDF Writer and Landscape Slide Deck Writer.
 */
function drawTableGeneric(
  doc: jsPDF,
  state: {
    marginX: number;
    contentW: number;
    bottomLimit: number;
    getY: () => number;
    setY: (y: number) => void;
    onNewPage: () => void;
  },
  headers: Array<{ label: string; width: number; align?: 'left' | 'right' | 'center' }>,
  rows: string[][],
  opts?: { fontSize?: number; lineH?: number; col0Courier?: boolean }
): void {
  const fontSize = opts?.fontSize ?? 7.8;
  const lineH = opts?.lineH ?? 3.6;
  const col0Courier = opts?.col0Courier ?? true;
  const padX = 2.2;

  // Measure header lines cleanly so narrow column headers never overlap neighbors
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize - 0.5);
  const headerWrapped = headers.map((col) =>
    wrapPdfTextStrict(doc, col.label.toUpperCase(), Math.max(4, col.width - padX * 2), '')
  );
  const maxHeaderLines = Math.max(1, ...headerWrapped.map((hl) => hl.length));
  const headerH = Math.max(6.8, maxHeaderLines * 3.4 + 3.4);

  const renderHeader = () => {
    if (state.getY() + headerH + 7 > state.bottomLimit) {
      state.onNewPage();
    }
    const y = state.getY();
    doc.setFillColor(...PALETTE.ink);
    doc.rect(state.marginX, y, state.contentW, headerH, 'F');
    doc.setFillColor(...PALETTE.crimson);
    doc.rect(state.marginX, y + headerH - 0.6, state.contentW, 0.6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize - 0.5);
    doc.setTextColor(255, 255, 255);

    let cx = state.marginX;
    headers.forEach((col, cIdx) => {
      const hLines = headerWrapped[cIdx];
      const tx =
        col.align === 'right'
          ? cx + col.width - padX
          : col.align === 'center'
            ? cx + col.width / 2
            : cx + padX;
      hLines.forEach((hl: string, li: number) => {
        doc.text(hl, tx, y + 4.2 + li * 3.4, {
          align: col.align ?? 'left',
        });
      });
      cx += col.width;
    });
    state.setY(y + headerH);
  };

  renderHeader();

  rows.forEach((row, rIdx) => {
    // Measure each column using the EXACT font it will be drawn in!
    const cellLines = headers.map((col, cIdx) => {
      const isFirst = cIdx === 0 && col0Courier;
      doc.setFont(isFirst ? 'courier' : 'helvetica', isFirst ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      return wrapPdfTextStrict(
        doc,
        row[cIdx] ?? '—',
        Math.max(4, col.width - padX * 2)
      );
    });
    const maxLines = Math.max(1, ...cellLines.map((cl) => cl.length));
    const rowH = Math.max(6.2, maxLines * lineH + 3.0);

    if (state.getY() + rowH > state.bottomLimit) {
      state.onNewPage();
      renderHeader();
    }

    const rowY = state.getY();
    doc.setFillColor(...(rIdx % 2 === 1 ? PALETTE.surface : PALETTE.white));
    doc.setDrawColor(...PALETTE.borderSoft);
    doc.setLineWidth(0.2);
    doc.rect(state.marginX, rowY, state.contentW, rowH, 'FD');

    let cx = state.marginX;
    headers.forEach((col, cIdx) => {
      const lines = cellLines[cIdx];
      const isFirst = cIdx === 0 && col0Courier;
      doc.setFont(isFirst ? 'courier' : 'helvetica', isFirst ? 'bold' : 'normal');
      doc.setFontSize(fontSize);
      doc.setTextColor(...PALETTE.ink);
      lines.forEach((ln: string, li: number) => {
        const tx =
          col.align === 'right'
            ? cx + col.width - padX
            : col.align === 'center'
              ? cx + col.width / 2
              : cx + padX;
        doc.text(ln, tx, rowY + 4.1 + li * lineH, {
          align: col.align ?? 'left',
        });
      });
      cx += col.width;
    });

    state.setY(rowY + rowH);
  });

  state.setY(state.getY() + 3.8);
}

// ============================================================================
// PORTRAIT PDF WRITER (A4: 210 x 297 mm)
// ============================================================================

class PdfWriter {
  doc: jsPDF;
  readonly pageW = 210;
  readonly pageH = 297;
  readonly margin = 14;
  readonly contentW = 210 - 28; // 182mm
  readonly topY = 17;
  readonly bottomLimit = 297 - 16.5;
  y = 14;

  constructor(private docTitle: string, private project: PipelineProject) {
    this.doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
      compress: true,
    });
    this.doc.setProperties({
      title: `${sanitizePdfText(project.client)} - ${sanitizePdfText(project.product.name)} · ${sanitizePdfText(docTitle)}`,
      creator: '52Launch Production Studio',
    });
  }

  newPage(): void {
    this.doc.addPage();
    this.doc.setFillColor(...PALETTE.crimson);
    this.doc.rect(this.margin, 7, 14, 0.9, 'F');
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(7.5);
    this.doc.setTextColor(...PALETTE.ink);
    this.doc.text(
      sanitizePdfText(
        `52LAUNCH  |  ${this.project.client} - ${this.project.product.name}`
      ),
      this.margin + 16.5,
      10
    );
    this.doc.setFont('helvetica', 'bold');
    this.doc.setTextColor(...PALETTE.burgundy);
    this.doc.text(sanitizePdfText(this.docTitle).toUpperCase(), this.pageW - this.margin, 10, {
      align: 'right',
    });
    this.doc.setDrawColor(...PALETTE.borderSoft);
    this.doc.setLineWidth(0.25);
    this.doc.line(this.margin, 12, this.pageW - this.margin, 12);
    this.y = this.topY;
  }

  ensureSpace(neededMm: number): void {
    const usablePageH = this.bottomLimit - this.topY;
    if (this.y + Math.min(neededMm, usablePageH) > this.bottomLimit && this.y > this.topY + 2) {
      this.newPage();
    }
  }

  drawCoverHeader(
    subtitle: string,
    metaRightLines: string[],
    brandLogo?: PdfImageData | null
  ): void {
    const logoReservedW = brandLogo ? 19 : 0;
    this.doc.setFont('courier', 'normal');
    this.doc.setFontSize(8);
    const cleanRight = metaRightLines.slice(0, 3).map((l) => sanitizePdfText(l));
    const maxRightW = Math.max(40, ...cleanRight.map((l) => this.doc.getTextWidth(l) + 4));
    const leftMaxW = Math.max(66, this.contentW - maxRightW - logoReservedW - 14);

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(13.5);
    const titleStr = sanitizePdfText(
      `${this.project.client || 'Client'} - ${this.project.product.name || 'Product'}`
    );
    const titleLines = this.doc.splitTextToSize(titleStr, leftMaxW).slice(0, 2);

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.8);
    const subLines = this.doc.splitTextToSize(sanitizePdfText(subtitle), leftMaxW).slice(0, 2);

    const boxH = Math.max(27, 10 + titleLines.length * 5.6 + subLines.length * 4.2 + 4.5);
    this.doc.setFillColor(...PALETTE.ink);
    this.doc.roundedRect(this.margin, this.y, this.contentW, boxH, 2, 2, 'F');

    // Signature Red #5 bottom accent + Deep Burgundy vertical accent
    this.doc.setFillColor(...PALETTE.crimson);
    this.doc.rect(this.margin, this.y + boxH - 1.5, this.contentW, 1.5, 'F');
    this.doc.setFillColor(...PALETTE.burgundy);
    this.doc.rect(this.margin, this.y, 2.2, boxH - 1.5, 'F');

    if (brandLogo) {
      const targetH = 14.5;
      const ratio = brandLogo.width / brandLogo.height;
      const targetW = Math.min(16.5, targetH * ratio);
      const lx = this.margin + 5;
      const ly = this.y + (boxH - 1.5 - targetH) / 2;
      this.doc.addImage(brandLogo.dataUrl, brandLogo.format || 'PNG', lx, ly, targetW, targetH);
    }

    const textStartX = this.margin + 5 + logoReservedW;
    this.doc.setTextColor(243, 156, 164); // warm crimson light tint on obsidian
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(7.4);
    this.doc.text('52LAUNCH PRODUCTION STUDIO  ·  CONCEPT TO REALITY', textStartX, this.y + 6.4);

    this.doc.setTextColor(255, 255, 255);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(13.5);
    titleLines.forEach((ln: string, li: number) => {
      this.doc.text(ln, textStartX, this.y + 12.8 + li * 5.6);
    });

    const subY = this.y + 12.8 + titleLines.length * 5.6;
    this.doc.setTextColor(214, 214, 222);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.8);
    subLines.forEach((ln: string, li: number) => {
      this.doc.text(ln, textStartX, subY + li * 4.2);
    });

    this.doc.setTextColor(228, 228, 235);
    this.doc.setFont('courier', 'normal');
    this.doc.setFontSize(8);
    cleanRight.forEach((line, idx) => {
      this.doc.text(line, this.pageW - this.margin - 5, this.y + 7.5 + idx * 5.2, {
        align: 'right',
      });
    });

    this.y += boxH + 5.5;
  }

  drawKpiRow(
    items: Array<{ label: string; value: string; accent?: 'amber' | 'emerald' | 'indigo' | 'slate' }>
  ): void {
    const gap = 3;
    const n = items.length;
    const cardW = (this.contentW - gap * (n - 1)) / n;
    const cardH = 15;
    this.ensureSpace(cardH + 4);

    items.forEach((item, i) => {
      const x = this.margin + i * (cardW + gap);
      this.doc.setFillColor(...PALETTE.surface);
      this.doc.setDrawColor(...PALETTE.border);
      this.doc.setLineWidth(0.25);
      this.doc.roundedRect(x, this.y, cardW, cardH, 1.5, 1.5, 'FD');

      const topBarColor =
        item.accent === 'amber'
          ? PALETTE.crimson
          : item.accent === 'emerald'
            ? PALETTE.emeraldDark
            : item.accent === 'indigo'
              ? PALETTE.burgundy
              : PALETTE.ink;
      this.doc.setFillColor(...topBarColor);
      this.doc.rect(x, this.y, cardW, 1.1, 'F');

      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(6.7);
      this.doc.setTextColor(...PALETTE.muted);
      const lblLine = this.doc.splitTextToSize(sanitizePdfText(item.label).toUpperCase(), cardW - 6)[0] || '';
      this.doc.text(lblLine, x + 3, this.y + 5.4);

      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(9.8);
      this.doc.setTextColor(...PALETTE.ink);
      const valLine = this.doc.splitTextToSize(sanitizePdfText(item.value), cardW - 6)[0] || '';
      this.doc.text(valLine, x + 3, this.y + 11.4);
    });

    this.y += cardH + 5;
  }

  addSectionBanner(tag: string, title: string, subtitle?: string): void {
    const tagStr = sanitizePdfText(tag).toUpperCase();
    this.doc.setFont('courier', 'bold');
    this.doc.setFontSize(7.4);
    const tagBoxW = this.doc.getTextWidth(tagStr) + 5;
    const titleX = this.margin + 5.5 + tagBoxW + 3.5;
    const availTitleW = Math.max(60, this.margin + this.contentW - titleX - 4);

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(11);
    const titleLines = this.doc.splitTextToSize(sanitizePdfText(title), availTitleW);

    const hasSub = Boolean(subtitle && subtitle.trim().length > 0);
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(7.8);
    const subLines = hasSub
      ? this.doc.splitTextToSize(sanitizePdfText(subtitle), this.contentW - 10)
      : [];

    const h = 4 + Math.max(5.5, titleLines.length * 4.8) + (hasSub ? subLines.length * 3.8 + 1.5 : 1.5);
    this.ensureSpace(h + 8);

    this.doc.setFillColor(...PALETTE.surfaceAlt);
    this.doc.setDrawColor(...PALETTE.border);
    this.doc.setLineWidth(0.3);
    this.doc.roundedRect(this.margin, this.y, this.contentW, h, 1.5, 1.5, 'FD');

    this.doc.setFillColor(...PALETTE.burgundy);
    this.doc.rect(this.margin, this.y, 2.6, h, 'F');

    // Measured crimson pill around tag so tag NEVER overlaps title
    this.doc.setFillColor(...PALETTE.crimson);
    this.doc.roundedRect(this.margin + 5.2, this.y + 2.6, tagBoxW, 5.2, 1, 1, 'F');
    this.doc.setFont('courier', 'bold');
    this.doc.setFontSize(7.4);
    this.doc.setTextColor(...PALETTE.white);
    this.doc.text(tagStr, this.margin + 5.2 + tagBoxW / 2, this.y + 6.2, { align: 'center' });

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(11);
    this.doc.setTextColor(...PALETTE.ink);
    titleLines.forEach((ln: string, li: number) => {
      this.doc.text(ln, titleX, this.y + 6.5 + li * 4.8);
    });

    if (hasSub) {
      const subStartY = this.y + 6.5 + titleLines.length * 4.8;
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(7.8);
      this.doc.setTextColor(...PALETTE.muted);
      subLines.forEach((ln: string, li: number) => {
        this.doc.text(ln, this.margin + 5.2, subStartY + li * 3.8);
      });
    }

    this.y += h + 5;
  }

  drawCalloutCard(params: {
    title: string;
    bodyLines: Array<{ label?: string; text: string; bold?: boolean }>;
    swatches?: Array<{ hex: string; rgb: RgbTuple }>;
    tone?: CardTone;
    x?: number;
    width?: number;
    minHeight?: number;
    dryRun?: boolean;
  }): number {
    const x = params.x ?? this.margin;
    const width = params.width ?? this.contentW;
    const padX = 3.8;
    const padTop = 3.8;
    const innerW = Math.max(20, width - padX * 2);
    const lineH = 3.9;

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8);
    const titleLines = this.doc.splitTextToSize(
      sanitizePdfText(params.title).toUpperCase(),
      innerW
    );

    const swatches = params.swatches ?? [];
    const swatchRowH = swatches.length > 0 ? 7.2 : 0;

    const measuredBlocks: Array<{
      labelLines: string[];
      lines: string[];
      blockH: number;
      bold?: boolean;
    }> = [];
    let bodyH = 0;

    for (const blk of params.bodyLines) {
      let labelLines: string[] = [];
      let singleBlockH = 0;
      if (blk.label) {
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(7.7);
        labelLines = this.doc.splitTextToSize(sanitizePdfText(blk.label), innerW);
        singleBlockH += labelLines.length * 3.6 + 0.5;
      }
      this.doc.setFont('helvetica', blk.bold ? 'bold' : 'normal');
      this.doc.setFontSize(8.3);
      const wrapped = wrapPdfTextStrict(this.doc, blk.text, innerW);
      singleBlockH += wrapped.length * lineH + 1.5;
      measuredBlocks.push({ labelLines, lines: wrapped, blockH: singleBlockH, bold: blk.bold });
      bodyH += singleBlockH;
    }

    const headerTitleH = titleLines.length * 4.0 + 1.2;
    const overheadH = padTop + 1.5 + headerTitleH + swatchRowH + 2.5;
    const totalH = Math.max(params.minHeight ?? 0, overheadH + bodyH);
    if (params.dryRun) return totalH;

    // If full-width card exceeds remaining page space, iteratively slice blocks across pages so zero overlap occurs!
    if (params.x === undefined && this.y + totalH > this.bottomLimit) {
      if (params.bodyLines.length > 1) {
        if (this.bottomLimit - this.y < 26) {
          this.newPage();
        }
        let cursor = 0;
        let part = 0;
        while (cursor < measuredBlocks.length) {
          const availBodyH = this.bottomLimit - this.y - overheadH - 2;
          if (availBodyH < 14 && this.y > this.topY + 2) {
            this.newPage();
            continue;
          }
          let end = cursor;
          let accH = 0;
          const maxBodyOnPage = Math.max(18, this.bottomLimit - this.y - overheadH - 2);
          while (end < measuredBlocks.length) {
            const nextH = measuredBlocks[end].blockH;
            if (end > cursor && accH + nextH > maxBodyOnPage) break;
            accH += nextH;
            end++;
          }
          if (end === cursor) end = cursor + 1;
          this.drawCalloutCard({
            title: part === 0 ? params.title : `${params.title} (Cont.)`,
            bodyLines: params.bodyLines.slice(cursor, end),
            swatches: part === 0 ? params.swatches : undefined,
            tone: params.tone,
            x: this.margin,
            width: this.contentW,
          });
          cursor = end;
          part++;
          if (cursor < measuredBlocks.length) {
            this.newPage();
          }
        }
        return totalH;
      }
      this.newPage();
    }

    const tone = params.tone ?? 'neutral';
    const { bg, bd, titleClr } = toneColors(tone);

    const topY = this.y;
    this.doc.setFillColor(...bg);
    this.doc.setDrawColor(...bd);
    this.doc.setLineWidth(0.25);
    this.doc.roundedRect(x, topY, width, totalH, 1.5, 1.5, 'FD');

    let cy = topY + padTop + 1.5;
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8);
    this.doc.setTextColor(...titleClr);
    for (const tl of titleLines) {
      this.doc.text(tl, x + padX, cy);
      cy += 4.0;
    }
    cy += 1.0;

    if (swatches.length > 0) {
      let sx = x + padX;
      for (const sw of swatches) {
        this.doc.setFont('courier', 'bold');
        this.doc.setFontSize(6.8);
        const hexW = this.doc.getTextWidth(sw.hex);
        const chipW = 4.5 + hexW + 3.2;
        if (sx + chipW > x + width - padX) break;
        this.doc.setFillColor(...PALETTE.white);
        this.doc.setDrawColor(...PALETTE.border);
        this.doc.setLineWidth(0.2);
        this.doc.roundedRect(sx, cy - 3.3, chipW, 5.2, 1, 1, 'FD');
        this.doc.setFillColor(...sw.rgb);
        this.doc.rect(sx + 1.2, cy - 2.3, 3.2, 3.2, 'FD');
        this.doc.setTextColor(...PALETTE.ink);
        this.doc.text(sw.hex, sx + 5.2, cy + 0.3);
        sx += chipW + 2;
      }
      cy += swatchRowH;
    }

    for (const blk of measuredBlocks) {
      if (blk.labelLines.length > 0) {
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(7.7);
        this.doc.setTextColor(...PALETTE.muted);
        for (const ll of blk.labelLines) {
          this.doc.text(ll, x + padX, cy);
          cy += 3.6;
        }
        cy += 0.4;
      }
      this.doc.setFont('helvetica', blk.bold ? 'bold' : 'normal');
      this.doc.setFontSize(8.3);
      this.doc.setTextColor(...PALETTE.ink);
      for (const ln of blk.lines) {
        this.doc.text(ln, x + padX, cy);
        cy += lineH;
      }
      cy += 1.5;
    }

    if (params.x === undefined || params.width === this.contentW) {
      this.y = topY + totalH + 3.5;
    }
    return totalH;
  }

  drawTwoColumnCards(
    left: {
      title: string;
      bodyLines: Array<{ label?: string; text: string; bold?: boolean }>;
      swatches?: Array<{ hex: string; rgb: RgbTuple }>;
      tone?: CardTone;
    },
    right: {
      title: string;
      bodyLines: Array<{ label?: string; text: string; bold?: boolean }>;
      swatches?: Array<{ hex: string; rgb: RgbTuple }>;
      tone?: CardTone;
    }
  ): void {
    const gap = 4;
    const colW = (this.contentW - gap) / 2;
    const hLeft = this.drawCalloutCard({ ...left, width: colW, dryRun: true });
    const hRight = this.drawCalloutCard({ ...right, width: colW, dryRun: true });
    const rowH = Math.max(hLeft, hRight);

    if (rowH > this.bottomLimit - this.topY) {
      this.drawCalloutCard(left);
      this.drawCalloutCard(right);
      return;
    }

    this.ensureSpace(rowH + 3);
    const rowY = this.y;
    this.drawCalloutCard({
      ...left,
      x: this.margin,
      width: colW,
      minHeight: rowH,
    });
    this.y = rowY;
    this.drawCalloutCard({
      ...right,
      x: this.margin + colW + gap,
      width: colW,
      minHeight: rowH,
    });
    this.y = rowY + rowH + 3.5;
  }

  drawImageInBox(
    img: PdfImageData | null,
    x: number,
    y: number,
    w: number,
    h: number,
    emptyLabel = 'No frame uploaded'
  ): void {
    drawImageInBoxRaw(this.doc, img, x, y, w, h, emptyLabel);
  }

  drawPill(text: string, x: number, y: number, tone: PillTone = 'slate'): number {
    return drawPillRaw(this.doc, text, x, y, tone, 6.9);
  }

  drawTable(
    headers: Array<{ label: string; width: number; align?: 'left' | 'right' | 'center' }>,
    rows: string[][]
  ): void {
    drawTableGeneric(
      this.doc,
      {
        marginX: this.margin,
        contentW: this.contentW,
        bottomLimit: this.bottomLimit,
        getY: () => this.y,
        setY: (nextY) => {
          this.y = nextY;
        },
        onNewPage: () => this.newPage(),
      },
      headers,
      rows
    );
  }

  addSubHeading(text: string): void {
    this.ensureSpace(8);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(9.4);
    this.doc.setTextColor(...PALETTE.ink);
    const lines = this.doc.splitTextToSize(sanitizePdfText(text), this.contentW);
    lines.forEach((ln: string) => {
      this.ensureSpace(5);
      this.doc.text(ln, this.margin, this.y);
      this.y += 4.6;
    });
  }

  addParagraph(text: string, opts?: { italic?: boolean; muted?: boolean; indent?: number }): void {
    const indent = opts?.indent ?? 0;
    const x = this.margin + indent;
    const availW = this.contentW - indent;
    this.doc.setFont('helvetica', opts?.italic ? 'italic' : 'normal');
    this.doc.setFontSize(8.5);
    this.doc.setTextColor(...(opts?.muted ? PALETTE.muted : PALETTE.ink));
    const lines = this.doc.splitTextToSize(sanitizePdfText(text), availW);
    for (const line of lines) {
      this.ensureSpace(4.5);
      this.doc.text(line, x, this.y);
      this.y += 4.1;
    }
    this.y += 1.8;
  }

  finalizeFooters(): void {
    const pageCount = this.doc.getNumberOfPages();
    const dateLabel = new Date().toLocaleDateString();
    for (let i = 1; i <= pageCount; i++) {
      this.doc.setPage(i);
      this.doc.setDrawColor(...PALETTE.borderSoft);
      this.doc.setLineWidth(0.25);
      this.doc.line(this.margin, this.pageH - 12, this.pageW - this.margin, this.pageH - 12);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(7.5);
      this.doc.setTextColor(...PALETTE.muted);
      this.doc.text(
        sanitizePdfText(
          `52Launch · Design · Manufacture · Market   |   ${this.project.client} - ${this.project.product.name}   |   ${this.docTitle}`
        ),
        this.margin,
        this.pageH - 7.5
      );
      this.doc.text(
        `${dateLabel}   |   Page ${i} of ${pageCount}`,
        this.pageW - this.margin,
        this.pageH - 7.5,
        { align: 'right' }
      );
    }
  }

  toBlob(): Blob {
    this.finalizeFooters();
    return this.doc.output('blob');
  }
}

// ============================================================================
// PORTRAIT SECTION RENDERERS
// ============================================================================

async function writeBrandBibleSection(
  writer: PdfWriter,
  project: PipelineProject
): Promise<void> {
  const b = project.brandBible;
  writer.addSectionBanner(
    'Brand Bible',
    'Brand Identity, Style Guide & Guardrails',
    'Positioning, brand colors & fonts, logo, product photos, characters & claims'
  );
  if (!b?.hasGenerated && !b?.positioning) {
    writer.addParagraph('Brand Bible has not been generated yet for this project.', {
      italic: true,
      muted: true,
    });
    return;
  }

  // Preload brand logos/graphics (up to 4) + up to 4 product reference photos in parallel
  const brandGraphicsList = getAllBrandGraphics(project).slice(0, 4);
  const [logoImgs, productImgs] = await Promise.all([
    Promise.all(brandGraphicsList.map((g) => loadImageForPdf(g.url))),
    Promise.all(project.product.photos.slice(0, 4).map((p) => loadImageForPdf(p.url))),
  ]);

  if (brandGraphicsList.length > 0 || project.product.photos.length > 0) {
    const panelH = 44;
    writer.ensureSpace(panelH + 4);
    const startY = writer.y;

    writer.doc.setFillColor(...PALETTE.surface);
    writer.doc.setDrawColor(...PALETTE.border);
    writer.doc.setLineWidth(0.28);
    writer.doc.roundedRect(writer.margin, startY, writer.contentW, panelH, 1.5, 1.5, 'FD');

    // Left: Brand Logos & Graphics slot(s)
    const logoBoxX = writer.margin + 3.5;
    const logoBoxW = brandGraphicsList.length > 1 ? 68 : 46;
    const imgY = startY + 7.2;
    const imgH = 29;

    writer.doc.setFont('helvetica', 'bold');
    writer.doc.setFontSize(7.5);
    writer.doc.setTextColor(...PALETTE.slate);
    writer.doc.text(
      brandGraphicsList.length > 1
        ? `BRAND LOGOS (${brandGraphicsList.length})`
        : 'BRAND LOGO',
      logoBoxX,
      startY + 5
    );

    if (brandGraphicsList.length > 0) {
      const lGap = 2.5;
      const shownLogos = brandGraphicsList.slice(0, 2);
      const lSlotW =
        shownLogos.length === 1 ? logoBoxW : (logoBoxW - lGap * (shownLogos.length - 1)) / shownLogos.length;
      shownLogos.forEach((g, idx) => {
        const lx = logoBoxX + idx * (lSlotW + lGap);
        writer.drawImageInBox(logoImgs[idx] || null, lx, imgY, lSlotW, imgH, 'Logo');
        writer.doc.setFont('helvetica', 'normal');
        writer.doc.setFontSize(6.2);
        writer.doc.setTextColor(...PALETTE.muted);
        const cap =
          writer.doc.splitTextToSize(sanitizePdfText(g.caption || `Logo ${idx + 1}`), lSlotW)[0] || '';
        writer.doc.text(cap, lx, imgY + imgH + 3.5);
      });
    } else {
      writer.drawImageInBox(null, logoBoxX, imgY, logoBoxW, imgH, 'No Logo Attached');
    }

    // Divider line
    const prodStartX = logoBoxX + logoBoxW + 5;
    writer.doc.setDrawColor(...PALETTE.borderSoft);
    writer.doc.line(prodStartX - 2.5, startY + 3, prodStartX - 2.5, startY + panelH - 3);

    // Right: Reference Product Photos strip
    const shownPhotos = project.product.photos.slice(0, 4);
    writer.doc.setFont('helvetica', 'bold');
    writer.doc.setFontSize(7.5);
    writer.doc.setTextColor(...PALETTE.slate);
    writer.doc.text(
      `PRODUCT REFERENCE PHOTOS (${project.product.photos.length})`,
      prodStartX,
      startY + 5
    );

    if (shownPhotos.length > 0) {
      const availW = writer.margin + writer.contentW - 3.5 - prodStartX;
      const gap = 3;
      const slotW = Math.min(36, (availW - gap * 3) / Math.max(shownPhotos.length, 1));
      shownPhotos.forEach((photo, idx) => {
        const px = prodStartX + idx * (slotW + gap);
        writer.drawImageInBox(productImgs[idx], px, imgY, slotW, imgH, 'Image');
        writer.doc.setFont('helvetica', 'normal');
        writer.doc.setFontSize(6.4);
        writer.doc.setTextColor(...PALETTE.muted);
        const cap =
          writer.doc.splitTextToSize(sanitizePdfText(photo.caption || `Photo ${idx + 1}`), slotW)[0] || '';
        writer.doc.text(cap, px, imgY + imgH + 3.5);
      });
    } else {
      writer.drawImageInBox(
        null,
        prodStartX,
        imgY,
        64,
        imgH,
        'No Product Photos Attached'
      );
    }

    writer.y = startY + panelH + 4;
  }

  writer.drawTwoColumnCards(
    {
      title: 'Brand Positioning',
      tone: 'neutral',
      bodyLines: [{ text: b.positioning }],
    },
    {
      title: 'Target Audience',
      tone: 'neutral',
      bodyLines: [{ text: b.audience }],
    }
  );

  writer.drawCalloutCard({
    title: 'Tone of Voice',
    tone: 'indigo',
    bodyLines: [
      {
        label: 'Voice Adjectives',
        text:
          b.toneOfVoice.adjectives.length > 0
            ? b.toneOfVoice.adjectives.join('  |  ')
            : 'Not specified',
        bold: true,
      },
      { label: 'Delivery Guidance', text: b.toneOfVoice.guidance },
    ],
  });

  const swatches = parseHexSwatches(b.visualStyle.palette);

  writer.drawTwoColumnCards(
    {
      title: 'Brand Colors, Fonts & Color Grade',
      tone: 'neutral',
      swatches,
      bodyLines: [
        { label: 'Color Palette', text: b.visualStyle.palette },
        {
          label: 'Brand Fonts / Typography',
          text: b.visualStyle.typography || 'Not specified — set font families in Step 2 Style Guide.',
        },
        { label: 'Color Grade', text: b.visualStyle.grade },
      ],
    },
    {
      title: 'Lighting, Lens & Framing',
      tone: 'neutral',
      bodyLines: [
        { label: 'Lighting Style', text: b.visualStyle.lighting },
        { label: 'Lens & Framing', text: b.visualStyle.lensAndFraming },
      ],
    }
  );

  if (b.characters.length > 0) {
    writer.addSubHeading(`Recurring Characters (${b.characters.length})`);
    writer.drawTable(
      [
        { label: 'Character', width: 44 },
        { label: 'Fixed Visual Descriptor', width: 138 },
      ],
      b.characters.map((ch) => [ch.name || 'Character', ch.fixedDescriptor])
    );
  }

  writer.drawCalloutCard({
    title: 'Product Fidelity Rules',
    tone: 'amber',
    bodyLines: [{ text: b.productRules }],
  });

  writer.drawTwoColumnCards(
    {
      title: `Verified Claims Allowed (${b.claimsAllowed.length})`,
      tone: 'emerald',
      bodyLines:
        b.claimsAllowed.length > 0
          ? b.claimsAllowed.map((c) => ({ text: `• ${c}` }))
          : [{ text: 'None listed.' }],
    },
    {
      title: `Flagged Claims / Needs Proof (${b.claimsToFlag.length})`,
      tone: 'amber',
      bodyLines:
        b.claimsToFlag.length > 0
          ? b.claimsToFlag.map((c) => ({ text: `• ${c}` }))
          : [{ text: 'None flagged.' }],
    }
  );

  writer.drawCalloutCard({
    title: `Banned List — Never Show or Say (${b.bannedList.length})`,
    tone: 'rose',
    bodyLines:
      b.bannedList.length > 0
        ? b.bannedList.map((item) => ({ text: `• ${item}` }))
        : [{ text: 'None specified.' }],
  });
}

function writeCreativeBriefSection(writer: PdfWriter, project: PipelineProject): void {
  const br = project.creativeBrief;
  writer.addSectionBanner(
    'Creative Brief',
    'Campaign Objective, Concepts & VO Direction',
    'Strategic direction, approved concept rationale & deliverables'
  );
  if (!br?.hasGenerated && !br?.objective) {
    writer.addParagraph('Creative Brief has not been generated yet.', {
      italic: true,
      muted: true,
    });
    return;
  }

  writer.drawTwoColumnCards(
    {
      title: 'Campaign Objective',
      tone: 'neutral',
      bodyLines: [{ text: br.objective }],
    },
    {
      title: 'Core Key Message',
      tone: 'neutral',
      bodyLines: [{ text: br.keyMessage, bold: true }],
    }
  );

  writer.drawCalloutCard({
    title: 'Recommended Creative Concept',
    tone: 'amber',
    bodyLines: [
      { label: 'Selected Concept', text: br.recommendedConcept.title || '—', bold: true },
      { label: 'Strategic Rationale', text: br.recommendedConcept.reason },
    ],
  });

  if (br.concepts.length > 0) {
    writer.addSubHeading(`Explored Concepts Comparison (${br.concepts.length})`);
    writer.drawTable(
      [
        { label: 'Concept', width: 38 },
        { label: 'Logline', width: 64 },
        { label: 'Why It Works', width: 44 },
        { label: 'Risks', width: 36 },
      ],
      br.concepts.map((c) => [c.title, c.logline, c.whyItWorks, c.risks])
    );
  }

  writer.drawTwoColumnCards(
    {
      title: `Planned Deliverables (${br.deliverables.length})`,
      tone: 'neutral',
      bodyLines:
        br.deliverables.length > 0
          ? br.deliverables.map((d) => ({ text: `• ${d}` }))
          : [{ text: 'None specified.' }],
    },
    {
      title: 'Voiceover Direction',
      tone: 'indigo',
      bodyLines: [
        { label: 'Speaker / Persona', text: br.voDirection.speaker, bold: true },
        { label: 'Pacing', text: br.voDirection.pace },
        { label: 'Emotional Arc', text: br.voDirection.emotionalArc },
      ],
    }
  );

  writer.drawCalloutCard({
    title: 'Claims & Compliance Review',
    tone: 'emerald',
    bodyLines: [{ text: br.claimsCheck }],
  });
}

async function writeStoryboardSection(
  writer: PdfWriter,
  project: PipelineProject
): Promise<void> {
  writer.addSectionBanner(
    'Storyboard',
    'Shot List Overview & Storyboard Panels',
    'Sequence timing, production routing, visual frames, shoot direction & VO cues'
  );
  if (project.shots.length === 0) {
    writer.addParagraph('No shots defined in the Shot Board yet.', {
      italic: true,
      muted: true,
    });
    return;
  }

  const totalSec = project.shots.reduce((s, x) => s + (Number(x.durationSec) || 0), 0);
  const aiCount = project.shots.filter((s) => s.route === 'ai_video').length;
  const hybridCount = project.shots.filter((s) => s.route === 'hybrid').length;
  const liveCount = project.shots.filter((s) => s.route === 'live').length;
  const framesReady = project.shots.filter((s) => Boolean(s.frameImageUrl)).length;

  writer.drawKpiRow([
    { label: 'Total Shots / Runtime', value: `${project.shots.length} Shots · ${totalSec}s`, accent: 'amber' },
    { label: 'AI / Hybrid / Live', value: `${aiCount} AI · ${hybridCount} Hyb · ${liveCount} Live`, accent: 'indigo' },
    { label: 'Frames Attached', value: `${framesReady} / ${project.shots.length} Ready`, accent: 'emerald' },
    {
      label: 'Product Shots',
      value: `${project.shots.filter((s) => s.productInFrame).length} Shots`,
      accent: 'slate',
    },
  ]);

  writer.addSubHeading('At-a-Glance Shot Summary');
  writer.drawTable(
    [
      { label: 'Shot', width: 15 },
      { label: 'Route', width: 20 },
      { label: 'Engine', width: 26 },
      { label: 'Dur', width: 12, align: 'center' },
      { label: 'Prod', width: 13, align: 'center' },
      { label: 'Scene Action & VO Cue', width: 96 },
    ],
    project.shots.map((s) => [
      s.id,
      s.route === 'live' ? 'LIVE' : s.route === 'hybrid' ? 'HYBRID' : 'AI',
      s.route === 'live' ? 'Live Camera' : formatModelName(s.model),
      `${s.durationSec}s`,
      s.productInFrame ? 'Yes' : 'No',
      s.voLine ? `${s.scene}  [VO: "${s.voLine}"]` : s.scene,
    ])
  );

  const loadedFrames = await Promise.all(
    project.shots.map((shot) => loadImageForPdf(getShotThumbnailUrl(shot)))
  );

  writer.addSubHeading('Detailed Storyboard Panels');

  for (let i = 0; i < project.shots.length; i++) {
    const shot = project.shots[i];
    const frameImg = loadedFrames[i];

    const boxW = 66;
    const boxH = 37.2;
    const textX = writer.margin + boxW + 6.5;
    const textW = writer.contentW - boxW - 10;

    // Header layout measurement so pills NEVER collide with shot ID or deliverable text
    writer.doc.setFont('courier', 'bold');
    writer.doc.setFontSize(9.5);
    const idW = writer.doc.getTextWidth(sanitizePdfText(shot.id)) + 3.5;

    writer.doc.setFont('courier', 'bold');
    writer.doc.setFontSize(8.0);
    const rawDeliv = sanitizePdfText(`${shot.deliverable || 'Spot'} | ${shot.durationSec}s`);
    const delivLine = writer.doc.splitTextToSize(rawDeliv, 50)[0] || '';
    const delivW = writer.doc.getTextWidth(delivLine) + 5;

    const headerPills: Array<{ text: string; tone: PillTone }> = [
      {
        text: shot.route === 'live' ? 'LIVE SHOOT' : shot.route === 'hybrid' ? 'HYBRID' : 'AI VIDEO',
        tone: shot.route === 'live' ? 'emerald' : shot.route === 'hybrid' ? 'amber' : 'indigo',
      },
    ];
    if (shot.route !== 'live') {
      headerPills.push({ text: formatModelName(shot.model), tone: 'slate' });
    }
    if (shot.productInFrame) {
      headerPills.push({ text: 'PRODUCT IN FRAME', tone: 'amber' });
    }
    if (shot.chainFrom && shot.chainFrom !== 'none') {
      headerPills.push({ text: `CHAIN: ${shot.chainFrom}`, tone: 'slate' });
    }

    const pillsStartX = writer.margin + 3.5 + idW;
    const pillsMaxRightX = writer.pageW - writer.margin - delivW - 3.5;
    const pillFlow = drawPillFlowRaw(writer.doc, headerPills, pillsStartX, 0, pillsMaxRightX, true);
    const headerH = Math.max(8.2, 3.6 + pillFlow.height);

    // Measure text blocks cleanly
    const fields: Array<{ label: string; value: string; italic?: boolean; color?: RgbTuple }> = [
      { label: 'SCENE DESCRIPTION', value: shot.scene || 'No scene description entered.' },
    ];
    if (shot.route === 'live' || shot.route === 'hybrid' || shot.shootDirection) {
      fields.push({
        label: 'SHOOT DIRECTION',
        value: shot.shootDirection || 'No shoot direction entered.',
        color: PALETTE.emeraldDark,
      });
    }
    if (shot.voLine) {
      fields.push({
        label: 'VOICEOVER LINE',
        value: `"${shot.voLine}"`,
        italic: true,
        color: PALETTE.indigoDark,
      });
    }
    if (shot.continuityNotes) {
      fields.push({
        label: 'CONTINUITY NOTES',
        value: shot.continuityNotes,
        color: PALETTE.muted,
      });
    }

    const wrappedFields = fields.map((f) => {
      writer.doc.setFont('helvetica', f.italic ? 'italic' : 'normal');
      writer.doc.setFontSize(8.3);
      return {
        ...f,
        lines: writer.doc.splitTextToSize(sanitizePdfText(f.value), textW),
      };
    });

    const textBlockH = wrappedFields.reduce(
      (sum, f) => sum + 3.8 + f.lines.length * 3.85 + 1.8,
      0
    );
    const bodyPad = 4;
    const bodyH = Math.max(boxH, textBlockH) + bodyPad * 2;
    const cardH = headerH + bodyH;

    writer.ensureSpace(cardH + 4);
    const startY = writer.y;

    writer.doc.setFillColor(...PALETTE.white);
    writer.doc.setDrawColor(...PALETTE.border);
    writer.doc.setLineWidth(0.3);
    writer.doc.roundedRect(writer.margin, startY, writer.contentW, cardH, 1.5, 1.5, 'FD');

    writer.doc.setFillColor(...PALETTE.surfaceAlt);
    writer.doc.rect(writer.margin, startY, writer.contentW, headerH, 'F');
    writer.doc.line(writer.margin, startY + headerH, writer.margin + writer.contentW, startY + headerH);

    writer.doc.setFont('courier', 'bold');
    writer.doc.setFontSize(9.5);
    writer.doc.setTextColor(...PALETTE.ink);
    writer.doc.text(sanitizePdfText(shot.id), writer.margin + 3.5, startY + 5.2);

    drawPillFlowRaw(writer.doc, headerPills, pillsStartX, startY + 1.8, pillsMaxRightX, false);

    writer.doc.setFont('courier', 'bold');
    writer.doc.setFontSize(8.0);
    writer.doc.setTextColor(...PALETTE.ink);
    writer.doc.text(delivLine, writer.pageW - writer.margin - 3.5, startY + 5.2, {
      align: 'right',
    });

    const bodyY = startY + headerH + bodyPad;
    writer.drawImageInBox(frameImg, writer.margin + 3.5, bodyY, boxW, boxH, 'Frame Pending');

    let ty = bodyY + 2.8;
    for (const f of wrappedFields) {
      writer.doc.setFont('helvetica', 'bold');
      writer.doc.setFontSize(7.1);
      writer.doc.setTextColor(...(f.color ?? PALETTE.muted));
      writer.doc.text(f.label, textX, ty);
      ty += 3.6;

      writer.doc.setFont('helvetica', f.italic ? 'italic' : 'normal');
      writer.doc.setFontSize(8.3);
      writer.doc.setTextColor(...PALETTE.ink);
      for (const ln of f.lines) {
        writer.doc.text(ln, textX, ty);
        ty += 3.85;
      }
      ty += 1.6;
    }

    writer.y = startY + cardH + 4;
  }
}

async function writeFrameSuggestionsSection(
  writer: PdfWriter,
  project: PipelineProject
): Promise<void> {
  writer.addSectionBanner(
    'Frame QA',
    'Frame Suggestions & Vision Consistency Audit',
    'Side-by-side storyboard frame inspection, scoring breakdown & improved prompts'
  );

  const relevantShots = project.shots.filter((s) => Boolean(s.frameCheck) || Boolean(s.framePrompt));
  if (relevantShots.length === 0) {
    writer.addParagraph(
      'No Frame Check QA evaluations or frame prompts recorded yet. Run Frame Suggestions in Step 6 to include scores and fix prompts.',
      { italic: true, muted: true }
    );
    return;
  }

  const checked = project.shots.filter((s) => Boolean(s.frameCheck));
  const passedCount = checked.filter((s) => s.frameCheck?.passed).length;

  writer.drawKpiRow([
    { label: 'Shots Evaluated', value: `${checked.length} / ${project.shots.length}`, accent: 'indigo' },
    { label: 'Passed Vision QA', value: `${passedCount} Passed`, accent: 'emerald' },
    {
      label: 'Flagged for Fix',
      value: `${checked.length - passedCount} Shots`,
      accent: checked.length - passedCount > 0 ? 'amber' : 'slate',
    },
  ]);

  const loadedFrames = await Promise.all(
    relevantShots.map((s) => loadImageForPdf(getShotThumbnailUrl(s)))
  );

  for (let i = 0; i < relevantShots.length; i++) {
    const shot = relevantShots[i];
    const img = loadedFrames[i];
    const fc = shot.frameCheck;

    const thumbW = 48;
    const thumbH = 27;
    const rightX = writer.margin + thumbW + 6;
    const rightW = writer.contentW - thumbW - 9.5;
    const maxPillRightX = rightX + rightW;

    // Wrap score pills cleanly across rows inside rightW!
    const scorePills: Array<{ text: string; tone: PillTone }> = [];
    if (fc) {
      const sc = fc.scores;
      const rawScores: Array<{ label: string; score: number | null }> = [
        { label: 'Char', score: sc.characterMatch },
        { label: 'Style', score: sc.styleMatch },
        { label: 'Comp', score: sc.compositionMatch },
        { label: 'Clean', score: sc.artifacts },
        { label: 'Product', score: sc.productFidelity },
      ];
      for (const sp of rawScores) {
        scorePills.push({
          text: `${sp.label}: ${sp.score !== null ? `${sp.score}/10` : 'N/A'}`,
          tone:
            sp.score === null
              ? 'slate'
              : sp.score >= 8
                ? 'emerald'
                : sp.score >= 6
                  ? 'amber'
                  : 'rose',
        });
      }
    }

    const scoreFlow = drawPillFlowRaw(writer.doc, scorePills, rightX, 0, maxPillRightX, true);
    const scoreRowH = scorePills.length > 0 ? scoreFlow.height + 3.8 : 0;

    // Always set exact body font before wrapping text!
    writer.doc.setFont('helvetica', 'normal');
    writer.doc.setFontSize(8.1);

    const infoBlocks: Array<{ label: string; lines: string[]; tone?: 'rose' | 'amber' | 'neutral' }> = [];
    if (fc && fc.problems.length > 0) {
      infoBlocks.push({
        label: 'ISSUES FOUND',
        tone: 'rose',
        lines: fc.problems.flatMap((p) =>
          writer.doc.splitTextToSize(`• ${sanitizePdfText(p)}`, rightW)
        ),
      });
    }
    if (fc && fc.productDifferences.length > 0) {
      infoBlocks.push({
        label: 'PRODUCT FIDELITY DIFFERENCES',
        tone: 'amber',
        lines: fc.productDifferences.flatMap((p) =>
          writer.doc.splitTextToSize(`• ${sanitizePdfText(p)}`, rightW)
        ),
      });
    }
    const promptText = fc?.improvedFramePrompt || shot.framePrompt;
    if (promptText) {
      infoBlocks.push({
        label: fc?.improvedFramePrompt ? 'IMPROVED FRAME PROMPT' : 'FRAME PROMPT',
        tone: 'neutral',
        lines: writer.doc.splitTextToSize(sanitizePdfText(promptText), rightW),
      });
    }

    const rightTextH = infoBlocks.reduce(
      (sum, b) => sum + 3.8 + b.lines.length * 3.7 + 1.8,
      scoreRowH
    );
    const cardH = 8 + Math.max(thumbH, rightTextH) + 7;

    writer.ensureSpace(cardH + 3);
    const startY = writer.y;

    writer.doc.setFillColor(...PALETTE.white);
    writer.doc.setDrawColor(...PALETTE.border);
    writer.doc.setLineWidth(0.28);
    writer.doc.roundedRect(writer.margin, startY, writer.contentW, cardH, 1.5, 1.5, 'FD');

    writer.doc.setFillColor(...PALETTE.surfaceAlt);
    writer.doc.rect(writer.margin, startY, writer.contentW, 7.8, 'F');
    writer.doc.line(writer.margin, startY + 7.8, writer.margin + writer.contentW, startY + 7.8);

    writer.doc.setFont('courier', 'bold');
    writer.doc.setFontSize(9.5);
    writer.doc.setTextColor(...PALETTE.ink);
    writer.doc.text(sanitizePdfText(shot.id), writer.margin + 3.5, startY + 5.3);
    const idW = writer.doc.getTextWidth(sanitizePdfText(shot.id)) + 3.5;

    const statusTone: PillTone = fc ? (fc.passed ? 'emerald' : 'rose') : 'slate';
    const statusLabel = fc ? (fc.passed ? 'PASSED' : 'NEEDS FIX') : 'PENDING QA';
    writer.drawPill(statusLabel, writer.margin + 3.5 + idW, startY + 1.6, statusTone);

    writer.doc.setFont('helvetica', 'normal');
    writer.doc.setFontSize(8);
    writer.doc.setTextColor(...PALETTE.muted);
    const rightMeta =
      writer.doc.splitTextToSize(
        sanitizePdfText(`${shot.deliverable || 'Shot'} · ${shot.durationSec}s`),
        72
      )[0] || '';
    writer.doc.text(rightMeta, writer.pageW - writer.margin - 3.5, startY + 5.1, {
      align: 'right',
    });

    const bodyY = startY + 11;
    writer.drawImageInBox(img, writer.margin + 3.5, bodyY, thumbW, thumbH, 'No Frame');

    let ty = bodyY;
    if (scorePills.length > 0) {
      drawPillFlowRaw(writer.doc, scorePills, rightX, ty, maxPillRightX, false);
      ty += scoreRowH;
    }

    for (const blk of infoBlocks) {
      writer.doc.setFont('helvetica', 'bold');
      writer.doc.setFontSize(7.1);
      const lblClr =
        blk.tone === 'rose'
          ? PALETTE.roseDark
          : blk.tone === 'amber'
            ? PALETTE.amberDark
            : PALETTE.slate;
      writer.doc.setTextColor(...lblClr);
      writer.doc.text(blk.label, rightX, ty + 2);
      ty += 5.4;

      writer.doc.setFont('helvetica', 'normal');
      writer.doc.setFontSize(8.1);
      writer.doc.setTextColor(...PALETTE.ink);
      for (const ln of blk.lines) {
        writer.doc.text(ln, rightX, ty);
        ty += 3.7;
      }
      ty += 1.6;
    }

    writer.y = startY + cardH + 4;
  }
}

async function writeVideoPromptsSection(
  writer: PdfWriter,
  project: PipelineProject
): Promise<void> {
  writer.addSectionBanner(
    'Video Studio',
    'Video Prompts, Frame Thumbnails & Clip Links',
    'Matched start-frame artwork alongside motion prompts, negative prompts & take history'
  );
  const aiHybridShots = project.shots.filter((s) => s.route !== 'live');
  if (aiHybridShots.length === 0) {
    writer.addParagraph('All project shots are Live Shoot only (no AI video prompts).', {
      italic: true,
      muted: true,
    });
    return;
  }

  const withPrompts = aiHybridShots.filter((s) => s.videoPrompt.trim().length > 0).length;
  const renderedCount = aiHybridShots.filter(
    (s) => Boolean(s.videoUrl) || (s.videoHistory?.length ?? 0) > 0
  ).length;
  const upscaledCount = aiHybridShots.filter((s) => Boolean(s.upscaledVideoUrl)).length;

  writer.drawKpiRow([
    { label: 'AI / Hybrid Shots', value: `${aiHybridShots.length} Shots`, accent: 'indigo' },
    { label: 'Prompts Written', value: `${withPrompts} / ${aiHybridShots.length}`, accent: 'amber' },
    { label: 'Clips Rendered', value: `${renderedCount} Clips`, accent: 'emerald' },
    { label: 'Topaz Upscaled', value: `${upscaledCount} Clips`, accent: 'slate' },
  ]);

  const loadedThumbs = await Promise.all(
    aiHybridShots.map((shot) => loadImageForPdf(getShotThumbnailUrl(shot)))
  );

  for (let i = 0; i < aiHybridShots.length; i++) {
    const shot = aiHybridShots[i];
    const thumbImg = loadedThumbs[i];

    const history: ShotClipHistoryItem[] =
      shot.videoHistory && shot.videoHistory.length > 0
        ? shot.videoHistory
        : shot.videoUrl
          ? [
              {
                id: `clip-${shot.id}`,
                videoUrl: shot.videoUrl,
                createdAt: project.updatedAt,
                modelId: formatModelName(shot.model),
                workflowMode: shot.frameImageUrl ? 'image_to_video' : 'text_to_video',
                prompt: shot.videoPrompt,
                negativePrompt: shot.negativePrompt,
                aspectRatio: '16:9',
                duration: shot.durationSec,
                qualityTier: 'draft',
                resolution: shot.videoResolution || '480p',
                nativeAudio: true,
                seed: shot.videoSeed,
                upscaledVideoUrl: shot.upscaledVideoUrl,
                upscaledResolution: shot.upscaledResolution,
              },
            ]
          : [];

    // Header measurement with non-overlapping deliverable text
    writer.doc.setFont('courier', 'bold');
    writer.doc.setFontSize(9.5);
    const idW = writer.doc.getTextWidth(sanitizePdfText(shot.id)) + 3.5;

    writer.doc.setFont('helvetica', 'normal');
    writer.doc.setFontSize(7.5);
    const delivLine =
      writer.doc.splitTextToSize(sanitizePdfText(shot.deliverable || ''), 48)[0] || '';
    const delivW = delivLine ? writer.doc.getTextWidth(delivLine) + 5 : 0;

    const headerPills: Array<{ text: string; tone: PillTone }> = [
      {
        text: shot.route === 'hybrid' ? 'HYBRID' : 'AI VIDEO',
        tone: shot.route === 'hybrid' ? 'amber' : 'indigo',
      },
      { text: formatModelName(shot.model), tone: 'slate' },
      { text: `${shot.durationSec}s · ${shot.videoResolution || 'Draft'}`, tone: 'slate' },
    ];
    if (shot.upscaledVideoUrl) {
      headerPills.push({
        text: `TOPAZ ${shot.upscaledResolution || 'UPSCALED'}`,
        tone: 'emerald',
      });
    }

    const pillsStartX = writer.margin + 3.5 + idW;
    const pillsMaxRightX = writer.pageW - writer.margin - delivW - 3.5;
    const pillFlow = drawPillFlowRaw(writer.doc, headerPills, pillsStartX, 0, pillsMaxRightX, true);
    const headerH = Math.max(8.2, 3.6 + pillFlow.height);

    const thumbW = 58;
    const thumbH = 32.6; // true 16:9
    const rightX = writer.margin + thumbW + 6;
    const rightW = writer.contentW - thumbW - 9.5;
    const promptInnerW = rightW - 5;

    writer.doc.setFont('helvetica', 'normal');
    writer.doc.setFontSize(8.2);
    const motionLines = writer.doc.splitTextToSize(
      sanitizePdfText(shot.videoPrompt, 'No motion video prompt generated yet.'),
      promptInnerW
    );
    const motionBoxH = Math.max(15, 7.6 + motionLines.length * 3.7 + 2.2);

    const hasNeg = Boolean(shot.negativePrompt && shot.negativePrompt.trim().length > 0);
    writer.doc.setFont('helvetica', 'normal');
    writer.doc.setFontSize(8.0);
    const negLines = hasNeg
      ? writer.doc.splitTextToSize(sanitizePdfText(shot.negativePrompt), promptInnerW)
      : [];
    const negBoxH = hasNeg ? Math.max(12, 7.2 + negLines.length * 3.6 + 2.2) : 0;

    const leftMetaLinesCount =
      (shot.videoSeed !== null && shot.videoSeed !== undefined ? 1 : 0) +
      (shot.videoUrl ? 1 : 0) +
      (shot.upscaledVideoUrl ? 1 : 0);
    const leftColH = thumbH + (leftMetaLinesCount > 0 ? 4 + leftMetaLinesCount * 4.4 : 0);
    const rightColH = motionBoxH + (hasNeg ? 3 + negBoxH : 0);

    // Measure rendered takes strip cleanly so text never collides with Download MP4 link
    const shownTakes = history.slice(0, 5);
    const takeRowsMeasured = shownTakes.map((clip, idx) => {
      const takeNum = history.length - idx;
      const absUrl = resolveAbsoluteUrl(clip.upscaledVideoUrl || clip.videoUrl);
      const takeSummary = sanitizePdfText(
        `Take #${takeNum} | ${clip.modelId} | ${clip.resolution} (${clip.qualityTier}) | ${clip.duration}s${
          clip.seed ? ` | Seed ${clip.seed}` : ''
        }`
      );
      writer.doc.setFont('courier', 'normal');
      writer.doc.setFontSize(7.3);
      const maxTakeTextW = writer.contentW - 36;
      const wrapped = writer.doc.splitTextToSize(takeSummary, maxTakeTextW);
      return { absUrl, lines: wrapped.slice(0, 2) };
    });

    const takesH =
      takeRowsMeasured.length > 0
        ? 7.5 + takeRowsMeasured.reduce((s, t) => s + t.lines.length * 3.8 + 1.2, 0) + 2
        : 0;

    const totalCardH = headerH + 4 + Math.max(leftColH, rightColH) + 3.5 + takesH;

    writer.ensureSpace(totalCardH + 4);
    const startY = writer.y;

    writer.doc.setFillColor(...PALETTE.white);
    writer.doc.setDrawColor(...PALETTE.border);
    writer.doc.setLineWidth(0.3);
    writer.doc.roundedRect(writer.margin, startY, writer.contentW, totalCardH, 1.5, 1.5, 'FD');

    writer.doc.setFillColor(...PALETTE.surfaceAlt);
    writer.doc.rect(writer.margin, startY, writer.contentW, headerH, 'F');
    writer.doc.line(writer.margin, startY + headerH, writer.margin + writer.contentW, startY + headerH);

    writer.doc.setFont('courier', 'bold');
    writer.doc.setFontSize(9.5);
    writer.doc.setTextColor(...PALETTE.ink);
    writer.doc.text(sanitizePdfText(shot.id), writer.margin + 3.5, startY + 5.2);

    drawPillFlowRaw(writer.doc, headerPills, pillsStartX, startY + 1.8, pillsMaxRightX, false);

    if (delivLine) {
      writer.doc.setFont('helvetica', 'normal');
      writer.doc.setFontSize(7.5);
      writer.doc.setTextColor(...PALETTE.muted);
      writer.doc.text(delivLine, writer.pageW - writer.margin - 3.5, startY + 5.1, {
        align: 'right',
      });
    }

    const bodyY = startY + headerH + 4;

    // Left column: Start-frame thumbnail + clickable clip links
    const thumbX = writer.margin + 3.5;
    writer.drawImageInBox(thumbImg, thumbX, bodyY, thumbW, thumbH, 'No Start Frame');

    let ly = bodyY + thumbH + 4.2;
    if (shot.videoSeed !== null && shot.videoSeed !== undefined) {
      writer.doc.setFont('courier', 'bold');
      writer.doc.setFontSize(7.3);
      writer.doc.setTextColor(...PALETTE.slate);
      writer.doc.text(`Seed: ${shot.videoSeed}`, thumbX, ly);
      ly += 4.2;
    }

    if (shot.videoUrl) {
      const abs = resolveAbsoluteUrl(shot.videoUrl);
      writer.doc.setFont('helvetica', 'bold');
      writer.doc.setFontSize(7.3);
      writer.doc.setTextColor(...PALETTE.indigoDark);
      if (isHttpOrLocalAssetUrl(abs)) {
        writer.doc.textWithLink('Open Primary MP4 ->', thumbX, ly, { url: abs });
      } else {
        writer.doc.text(`Clip: ${formatShortUrlDisplay(abs)}`, thumbX, ly);
      }
      ly += 4.2;
    }

    if (shot.upscaledVideoUrl) {
      const absUp = resolveAbsoluteUrl(shot.upscaledVideoUrl);
      writer.doc.setFont('helvetica', 'bold');
      writer.doc.setFontSize(7.3);
      writer.doc.setTextColor(...PALETTE.emeraldDark);
      if (isHttpOrLocalAssetUrl(absUp)) {
        writer.doc.textWithLink(
          `Open Topaz ${shot.upscaledResolution || '4K'} MP4 ->`,
          thumbX,
          ly,
          { url: absUp }
        );
      } else {
        writer.doc.text(`Upscaled: ${formatShortUrlDisplay(absUp)}`, thumbX, ly);
      }
    }

    // Right column: Motion Video Prompt box + Negative Prompt box
    let ry = bodyY;
    writer.doc.setFillColor(...PALETTE.indigoTint);
    writer.doc.setDrawColor(...PALETTE.indigoBorder);
    writer.doc.setLineWidth(0.22);
    writer.doc.roundedRect(rightX, ry, rightW, motionBoxH, 1.2, 1.2, 'FD');

    writer.doc.setFont('helvetica', 'bold');
    writer.doc.setFontSize(7);
    writer.doc.setTextColor(...PALETTE.indigoDark);
    writer.doc.text('MOTION VIDEO PROMPT', rightX + 2.5, ry + 4.2);

    writer.doc.setFont('helvetica', 'normal');
    writer.doc.setFontSize(8.2);
    writer.doc.setTextColor(...PALETTE.ink);
    motionLines.forEach((ln: string, li: number) => {
      writer.doc.text(ln, rightX + 2.5, ry + 8.2 + li * 3.7);
    });
    ry += motionBoxH + 3;

    if (hasNeg) {
      writer.doc.setFillColor(...PALETTE.roseTint);
      writer.doc.setDrawColor(...PALETTE.roseBorder);
      writer.doc.roundedRect(rightX, ry, rightW, negBoxH, 1.2, 1.2, 'FD');

      writer.doc.setFont('helvetica', 'bold');
      writer.doc.setFontSize(7);
      writer.doc.setTextColor(...PALETTE.roseDark);
      writer.doc.text('NEGATIVE PROMPT (AVOID)', rightX + 2.5, ry + 4.0);

      writer.doc.setFont('helvetica', 'normal');
      writer.doc.setFontSize(8.0);
      writer.doc.setTextColor(...PALETTE.ink);
      negLines.forEach((ln: string, li: number) => {
        writer.doc.text(ln, rightX + 2.5, ry + 7.8 + li * 3.6);
      });
    }

    // Rendered Clip Takes strip inside bottom of card
    if (takeRowsMeasured.length > 0) {
      const stripY = startY + totalCardH - takesH;
      writer.doc.setDrawColor(...PALETTE.borderSoft);
      writer.doc.line(
        writer.margin + 3.5,
        stripY,
        writer.margin + writer.contentW - 3.5,
        stripY
      );

      writer.doc.setFont('helvetica', 'bold');
      writer.doc.setFontSize(7.1);
      writer.doc.setTextColor(...PALETTE.muted);
      writer.doc.text(
        `RENDERED TAKES (${history.length})`,
        writer.margin + 3.5,
        stripY + 4.3
      );

      let ty = stripY + 8.3;
      takeRowsMeasured.forEach((t) => {
        writer.doc.setFont('courier', 'normal');
        writer.doc.setFontSize(7.3);
        writer.doc.setTextColor(...PALETTE.slate);
        t.lines.forEach((ln: string, li: number) => {
          writer.doc.text(ln, writer.margin + 4.5, ty + li * 3.8);
        });

        if (isHttpOrLocalAssetUrl(t.absUrl)) {
          writer.doc.setFont('helvetica', 'bold');
          writer.doc.setFontSize(7.3);
          writer.doc.setTextColor(...PALETTE.indigoDark);
          writer.doc.textWithLink('Download MP4 ->', writer.pageW - writer.margin - 3.5, ty, {
            url: t.absUrl,
            align: 'right',
          });
        }
        ty += t.lines.length * 3.8 + 1.2;
      });
    }

    writer.y = startY + totalCardH + 4.5;
  }

  if (project.externalUpscales && project.externalUpscales.length > 0) {
    writer.addSubHeading(`Standalone Topaz Upscaled Clips (${project.externalUpscales.length})`);
    writer.drawTable(
      [
        { label: 'Clip Label', width: 64 },
        { label: 'Resolution', width: 28 },
        { label: 'Topaz Model', width: 40 },
        { label: 'File Path', width: 50 },
      ],
      project.externalUpscales.map((u) => [
        u.label,
        u.upscaledResolution || 'Upscaled',
        `${u.details.mode} / ${u.details.subModel}`,
        formatShortUrlDisplay(resolveAbsoluteUrl(u.upscaledVideoUrl)),
      ])
    );
  }
}

function writeVoScriptSection(writer: PdfWriter, project: PipelineProject): void {
  writer.addSectionBanner(
    'VO Script',
    'Voiceover Script, Timing & Delivery Cues',
    'Time-aligned spoken copy, voice casting, performance tags & audio render status'
  );
  if (project.voScript.length === 0) {
    writer.addParagraph('No VO script lines created yet.', { italic: true, muted: true });
    return;
  }

  const s = project.voSettings;
  const renderedCount = project.voScript.filter((v) => Boolean(v.audioUrl)).length;
  const totalSec = project.voScript.reduce((acc, v) => acc + (Number(v.durationSec) || 0), 0);

  writer.drawKpiRow([
    { label: 'Primary Voice', value: s?.voiceName || 'Default', accent: 'indigo' },
    {
      label: 'Tone & Speed',
      value: s ? `${s.emotionalTone} (${s.speed}x)` : 'Standard',
      accent: 'amber',
    },
    { label: 'VO Lines / Duration', value: `${project.voScript.length} Lines · ~${totalSec}s`, accent: 'slate' },
    { label: 'Synthesized Audio', value: `${renderedCount} / ${project.voScript.length} Ready`, accent: 'emerald' },
  ]);

  for (const line of project.voScript) {
    const innerW = writer.contentW - 8;
    writer.doc.setFont('helvetica', 'normal');
    writer.doc.setFontSize(9.1);
    const spokenLines = writer.doc.splitTextToSize(
      `"${sanitizePdfText(line.line, '(No spoken text)')}"`,
      innerW
    );
    const notesText = `Direction: ${sanitizePdfText(line.direction)}   |   Tags: ${sanitizePdfText(
      line.audioTags
    )}${line.durationSec ? `   |   Est: ${line.durationSec}s` : ''}`;
    writer.doc.setFont('helvetica', 'normal');
    writer.doc.setFontSize(7.8);
    const noteLines = writer.doc.splitTextToSize(notesText, innerW);

    const headerH = 7.6;
    const cardH = headerH + 4.5 + spokenLines.length * 4.3 + noteLines.length * 3.7 + 4.5;

    writer.ensureSpace(cardH + 3);
    const startY = writer.y;

    writer.doc.setFillColor(...PALETTE.white);
    writer.doc.setDrawColor(...PALETTE.border);
    writer.doc.setLineWidth(0.25);
    writer.doc.roundedRect(writer.margin, startY, writer.contentW, cardH, 1.5, 1.5, 'FD');

    writer.doc.setFillColor(...PALETTE.surfaceAlt);
    writer.doc.rect(writer.margin, startY, writer.contentW, headerH, 'F');
    writer.doc.line(writer.margin, startY + headerH, writer.margin + writer.contentW, startY + headerH);

    writer.doc.setFont('courier', 'bold');
    writer.doc.setFontSize(9);
    writer.doc.setTextColor(...PALETTE.ink);
    writer.doc.text(sanitizePdfText(line.shotId), writer.margin + 3.5, startY + 5);
    const idW = writer.doc.getTextWidth(sanitizePdfText(line.shotId)) + 4;

    writer.doc.setFont('helvetica', 'bold');
    writer.doc.setFontSize(6.9);
    const voStatusText = line.audioUrl ? 'AUDIO READY' : 'SCRIPT ONLY';
    const badgeW = writer.doc.getTextWidth(voStatusText) + 4.4;

    const voice = line.voiceName || s?.voiceName || 'Narrator';
    writer.doc.setFont('helvetica', 'bold');
    writer.doc.setFontSize(8.1);
    writer.doc.setTextColor(...PALETTE.slate);
    const speakerStr =
      writer.doc.splitTextToSize(
        sanitizePdfText(`${line.speaker || 'Narrator'} (${voice})`),
        writer.contentW - idW - badgeW - 14
      )[0] || '';
    writer.doc.text(speakerStr, writer.margin + 3.5 + idW, startY + 5);

    writer.drawPill(
      voStatusText,
      writer.pageW - writer.margin - badgeW - 3.5,
      startY + 1.5,
      line.audioUrl ? 'emerald' : 'slate'
    );

    let ty = startY + headerH + 5;
    writer.doc.setFont('helvetica', 'normal');
    writer.doc.setFontSize(9.1);
    writer.doc.setTextColor(...PALETTE.ink);
    for (const ln of spokenLines) {
      writer.doc.text(ln, writer.margin + 4, ty);
      ty += 4.3;
    }
    ty += 1.5;

    writer.doc.setFont('helvetica', 'normal');
    writer.doc.setFontSize(7.8);
    writer.doc.setTextColor(...PALETTE.muted);
    for (const ln of noteLines) {
      writer.doc.text(ln, writer.margin + 4, ty);
      ty += 3.7;
    }

    writer.y = startY + cardH + 3.5;
  }
}

function getShootDayScheduleBlocks(day: ShootDayPlan): ShootScheduleBlock[] {
  if (day.scheduleBreakdown && day.scheduleBreakdown.length > 0) {
    return day.scheduleBreakdown;
  }
  const blocks: ShootScheduleBlock[] = [
    {
      id: 'call',
      timeSlot: day.callTime && day.callTime !== 'TBD' ? `${day.callTime} - 07:45` : '07:00 - 07:45',
      activity: 'Crew Call, Safety Briefing & Equipment Load-In',
      category: 'call',
      notes: 'Check-in, staging area setup, lighting prep',
    },
    {
      id: 'breakfast',
      timeSlot: day.breakfastTime || '07:45 - 08:15',
      activity: 'Crew Breakfast & Craft Services',
      category: 'meal',
      notes: 'Coffee, light breakfast, morning briefing',
    },
  ];

  const setups = day.setups || [];
  const half = Math.max(1, Math.ceil(setups.length / 2));
  const morning = setups.slice(0, half);
  const afternoon = setups.slice(half);

  morning.forEach((st, idx) => {
    blocks.push({
      id: `setup-m-${idx}`,
      timeSlot: st.timeSlot || (idx === 0 ? '08:15 - 10:30' : '10:30 - 12:30'),
      activity: `${st.setupName} — Shooting`,
      category: 'setup',
      shotIds: st.shotIds,
      notes: st.lightingNotes || `${st.estimatedMinutes} mins est.`,
      estimatedMinutes: st.estimatedMinutes,
    });
  });

  blocks.push({
    id: 'lunch',
    timeSlot: day.lunchTime || '12:30 - 01:30',
    activity: 'Mandatory Crew Lunch Break (Hot Catering Provided)',
    category: 'meal',
    notes: 'Hot catering served; 60m off-the-clock break; equipment & media recharge',
  });

  afternoon.forEach((st, idx) => {
    blocks.push({
      id: `setup-a-${idx}`,
      timeSlot: st.timeSlot || (idx === 0 ? '01:30 - 03:45' : '03:45 - 05:30'),
      activity: `${st.setupName} — Shooting`,
      category: 'setup',
      shotIds: st.shotIds,
      notes: st.lightingNotes || `${st.estimatedMinutes} mins est.`,
      estimatedMinutes: st.estimatedMinutes,
    });
  });

  blocks.push({
    id: 'wrap',
    timeSlot: day.wrapTime && day.wrapTime !== 'TBD' ? `05:30 - ${day.wrapTime}` : '05:30 - 06:00',
    activity: 'Wrap, DIT Media Dump & Equipment Load-Out',
    category: 'wrap',
    notes: 'Verify dual media backups, strike lights, pack gear',
  });

  return blocks;
}

function writeShootPlanSection(
  writer: PdfWriter,
  project: PipelineProject,
  overridePlan?: ShootPlan
): void {
  const plan = overridePlan || project.shootPlan;
  writer.addSectionBanner(
    'Call Sheet',
    'Line Producer Call Sheet & Shoot Schedule',
    'On-set shoot days, setups, lighting approach, gear, crew & client confirmations'
  );

  if (!plan?.hasGenerated && plan.shootDays.length === 0) {
    writer.addParagraph('Live & Hybrid Shoot Plan has not been generated yet.', {
      italic: true,
      muted: true,
    });
    return;
  }

  const liveHybrid = project.shots.filter((s) => s.route !== 'ai_video').length;
  writer.drawKpiRow([
    { label: 'Live & Hybrid Shots', value: `${liveHybrid} Shots`, accent: 'emerald' },
    { label: 'Shoot Days', value: `${plan.shootDays.length} Day(s)`, accent: 'amber' },
    { label: 'Crew Roles', value: `${plan.crew.length} Roles`, accent: 'indigo' },
    { label: 'Gear & Props', value: `${plan.equipment.length} Gear · ${plan.propsAndUnits.length} Props`, accent: 'slate' },
  ]);

  if (plan.clientQuestions.length > 0) {
    writer.drawCalloutCard({
      title: `Open Client Questions (${plan.clientQuestions.length})`,
      tone: 'amber',
      bodyLines: plan.clientQuestions.map((q) => ({ text: `• ${q}` })),
    });
  }

  if (plan.shootDays.length > 0) {
    writer.addSubHeading('Shoot Days & Detailed Schedule Breakdown');
    for (const day of plan.shootDays) {
      const callMilestones = [
        `CALL ${day.callTime}`,
        day.breakfastTime ? `BFAST ${day.breakfastTime}` : null,
        `LUNCH ${day.lunchTime || '12:30 - 01:30'}`,
        `WRAP ${day.wrapTime}`,
      ].filter(Boolean).join('  |  ');
      const callStr = sanitizePdfText(callMilestones);
      writer.doc.setFont('courier', 'bold');
      writer.doc.setFontSize(7.2);
      const callW = writer.doc.getTextWidth(callStr) + 6;
      const locAvailW = Math.max(50, writer.contentW - callW - 10);

      writer.doc.setFont('helvetica', 'bold');
      writer.doc.setFontSize(8.8);
      const dayTitleLines = writer.doc.splitTextToSize(
        sanitizePdfText(`${day.dayLabel}  |  ${day.location}`),
        locAvailW
      );
      const barH = Math.max(9, 4.5 + dayTitleLines.length * 4.2);

      writer.ensureSpace(barH + 16);
      writer.doc.setFillColor(...PALETTE.ink);
      writer.doc.roundedRect(writer.margin, writer.y, writer.contentW, barH, 1.2, 1.2, 'F');
      writer.doc.setFillColor(...PALETTE.crimson);
      writer.doc.rect(writer.margin, writer.y + barH - 0.8, writer.contentW, 0.8, 'F');
      writer.doc.setFont('helvetica', 'bold');
      writer.doc.setFontSize(8.8);
      writer.doc.setTextColor(255, 255, 255);
      dayTitleLines.forEach((ln: string, li: number) => {
        writer.doc.text(ln, writer.margin + 3.5, writer.y + 5.6 + li * 4.2);
      });

      writer.doc.setFont('courier', 'bold');
      writer.doc.setFontSize(7.2);
      writer.doc.setTextColor(243, 156, 164);
      writer.doc.text(callStr, writer.pageW - writer.margin - 3.5, writer.y + 5.6, {
        align: 'right',
      });
      writer.y += barH + 2.0;

      // Chronological Schedule Timeline Table (including breakfast, setups, lunch, wrap)
      const scheduleBlocks = getShootDayScheduleBlocks(day);
      writer.drawTable(
        [
          { label: 'Time Slot', width: 26 },
          { label: 'Activity / Milestone', width: 66 },
          { label: 'Type', width: 18, align: 'center' },
          { label: 'Shots', width: 22 },
          { label: 'Notes & Details', width: 50 },
        ],
        scheduleBlocks.map((b) => [
          b.timeSlot,
          b.activity,
          b.category.toUpperCase(),
          (b.shotIds || []).join(', ') || '—',
          b.notes || '—',
        ])
      );

      writer.y += 1.5;

      if (day.setups.length === 0) {
        writer.addParagraph('No setups added to this shoot day yet.', { italic: true, muted: true });
      } else {
        writer.drawTable(
          [
            { label: 'Setup', width: 34 },
            { label: 'Shots', width: 28 },
            { label: 'Est.', width: 16, align: 'center' },
            { label: 'Lighting & Camera Approach', width: 104 },
          ],
          day.setups.map((st) => [
            st.setupName,
            st.shotIds.join(', ') || 'TBD',
            `${st.estimatedMinutes}m`,
            st.lightingNotes || 'Standard setup',
          ])
        );
      }
    }
  }

  writer.drawTwoColumnCards(
    {
      title: `Camera, Grip & Lighting (${plan.equipment.length})`,
      tone: 'neutral',
      bodyLines:
        plan.equipment.length > 0
          ? plan.equipment.map((eq) => ({ text: `• ${eq}` }))
          : [{ text: 'No equipment listed.' }],
    },
    {
      title: `Crew & Roles (${plan.crew.length})`,
      tone: 'neutral',
      bodyLines:
        plan.crew.length > 0
          ? plan.crew.map((c) => ({ text: `• ${c}` }))
          : [{ text: 'No crew listed.' }],
    }
  );

  if (plan.propsAndUnits.length > 0) {
    writer.addSubHeading(`Props & Product Units (${plan.propsAndUnits.length})`);
    writer.drawTable(
      [
        { label: 'Item / Unit', width: 80 },
        { label: 'Quantity & Backups', width: 52 },
        { label: 'Supplied By', width: 50 },
      ],
      plan.propsAndUnits.map((p) => [p.item, p.quantity, p.suppliedBy])
    );
  }

  if (plan.risks.length > 0) {
    writer.drawCalloutCard({
      title: `Production Risks & Contingencies (${plan.risks.length})`,
      tone: 'rose',
      bodyLines: plan.risks.map((r) => ({ text: `• ${r}` })),
    });
  }
}

// ============================================================================
// 16:9 WIDESCREEN LANDSCAPE SLIDESHOW WRITER (338.67 x 190.5 mm)
// ============================================================================

class SlideDeckWriter {
  doc: jsPDF;
  readonly pageW: number;
  readonly pageH: number;
  readonly marginX = 12;
  readonly contentW: number;
  readonly contentTopY = 18;
  readonly bottomLimit: number;

  constructor(private project: PipelineProject) {
    this.doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: [338.67, 190.5],
      compress: true,
    });
    this.pageW = this.doc.internal.pageSize.getWidth();
    this.pageH = this.doc.internal.pageSize.getHeight();
    this.contentW = this.pageW - this.marginX * 2;
    this.bottomLimit = this.pageH - 12;

    this.doc.setProperties({
      title: `${sanitizePdfText(project.client)} - ${sanitizePdfText(project.product.name)} · Presentation Slideshow`,
      creator: '52Launch Production Studio',
    });
  }

  startSlide(sectionTag: string, slideTitle: string, skipAddPage = false): number {
    if (!skipAddPage) {
      this.doc.addPage();
    }

    // Crisp off-white slide canvas
    this.doc.setFillColor(...PALETTE.surface);
    this.doc.rect(0, 0, this.pageW, this.pageH, 'F');

    // Top persistent obsidian header bar with 52Launch Red #5 bottom stripe
    const barH = 13.5;
    this.doc.setFillColor(...PALETTE.ink);
    this.doc.rect(0, 0, this.pageW, barH, 'F');
    this.doc.setFillColor(...PALETTE.crimson);
    this.doc.rect(0, barH - 1.0, this.pageW, 1.0, 'F');

    // Crimson Red #5 Tag badge on top bar
    const tagStr = sanitizePdfText(sectionTag).toUpperCase();
    this.doc.setFont('courier', 'bold');
    this.doc.setFontSize(7.6);
    const tagW = this.doc.getTextWidth(tagStr) + 6;
    this.doc.setFillColor(...PALETTE.crimson);
    this.doc.roundedRect(this.marginX, 3.2, tagW, 6.2, 1, 1, 'F');
    this.doc.setTextColor(...PALETTE.white);
    this.doc.text(tagStr, this.marginX + tagW / 2, 7.5, { align: 'center' });

    // Client - Product right label
    const rightStr = sanitizePdfText(
      `52LAUNCH  |  ${this.project.client} - ${this.project.product.name}`
    );
    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.0);
    this.doc.setTextColor(214, 214, 222);
    const rightW = Math.min(108, this.doc.getTextWidth(rightStr) + 6);
    const rightClamped = this.doc.splitTextToSize(rightStr, rightW)[0] || '';
    this.doc.text(rightClamped, this.pageW - this.marginX, 8, { align: 'right' });

    // Slide title cleanly fitted between tag badge and right label
    const titleX = this.marginX + tagW + 5;
    const availTitleW = Math.max(80, this.pageW - this.marginX - rightW - titleX - 4);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(12);
    this.doc.setTextColor(255, 255, 255);
    const titleClamped =
      this.doc.splitTextToSize(sanitizePdfText(slideTitle), availTitleW)[0] || '';
    this.doc.text(titleClamped, titleX, 8.2);

    return this.contentTopY;
  }

  drawHeroTitleSlide(
    sections: MasterPdfSectionId[],
    logoImg: PdfImageData | null,
    heroProductImg: PdfImageData | null,
    brandBadge?: PdfImageData | null
  ): void {
    // Full-bleed dark obsidian hero cover
    this.doc.setFillColor(...PALETTE.ink);
    this.doc.rect(0, 0, this.pageW, this.pageH, 'F');

    // Top Red #5 + left Deep Burgundy structural bars
    this.doc.setFillColor(...PALETTE.crimson);
    this.doc.rect(0, 0, this.pageW, 2.4, 'F');
    this.doc.setFillColor(...PALETTE.burgundy);
    this.doc.rect(this.marginX, 20, 2.6, 86, 'F');

    const textX = this.marginX + 9.5;
    const hasVisualColumn = Boolean(logoImg || heroProductImg);
    const leftW = hasVisualColumn ? 176 : this.contentW - 14;

    let kickerX = textX;
    let headerTopOffset = 0;
    if (brandBadge) {
      const targetH = 15;
      const ratio = brandBadge.width / brandBadge.height;
      const targetW = Math.min(18, targetH * ratio);
      this.doc.addImage(brandBadge.dataUrl, brandBadge.format || 'PNG', textX, 19, targetW, targetH);
      kickerX = textX + targetW + 5;
      headerTopOffset = 4;
    }

    this.doc.setFont('courier', 'bold');
    this.doc.setFontSize(9.2);
    this.doc.setTextColor(243, 156, 164);
    this.doc.text('52LAUNCH PRODUCTION STUDIO  ·  FROM CONCEPT TO REALITY', kickerX, 25);

    this.doc.setFont('helvetica', 'normal');
    this.doc.setFontSize(8.2);
    this.doc.setTextColor(176, 176, 188);
    this.doc.text('DESIGN   ·   MANUFACTURE   ·   MARKET', kickerX, 30.8);

    const titleStartY = 44 + headerTopOffset;
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(23.5);
    this.doc.setTextColor(255, 255, 255);
    const heroTitle = sanitizePdfText(
      `${this.project.client || 'Client'} — ${this.project.product.name || 'Product'}`
    );
    const titleLines = this.doc.splitTextToSize(heroTitle, leftW).slice(0, 2);
    titleLines.forEach((ln: string, li: number) => {
      this.doc.text(ln, textX, titleStartY + li * 10.5);
    });

    let curY = titleStartY + titleLines.length * 10.5 + 3.5;
    if (this.project.product.description) {
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(9.8);
      this.doc.setTextColor(210, 210, 220);
      const descLines = this.doc.splitTextToSize(
        sanitizePdfText(this.project.product.description),
        leftW
      ).slice(0, 3);
      descLines.forEach((ln: string) => {
        this.doc.text(ln, textX, curY);
        curY += 5.0;
      });
    }

    // Included deck agenda chips
    curY = Math.max(curY + 6, 102);
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(7.8);
    this.doc.setTextColor(243, 156, 164);
    this.doc.text('INCLUDED DELIVERABLES', textX, curY);
    curY += 4.5;

    let px = textX;
    let py = curY;
    for (const id of sections) {
      const meta = MASTER_PDF_SECTIONS.find((m) => m.id === id);
      const lbl = sanitizePdfText(meta?.label || id);
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(7.6);
      const w = this.doc.getTextWidth(lbl) + 6;
      if (px > textX && px + w > textX + leftW) {
        px = textX;
        py += 7;
      }
      this.doc.setFillColor(...PALETTE.charcoal);
      this.doc.setDrawColor(...PALETTE.burgundy);
      this.doc.setLineWidth(0.35);
      this.doc.roundedRect(px, py, w, 5.6, 1.2, 1.2, 'FD');
      this.doc.setTextColor(245, 245, 248);
      this.doc.text(lbl, px + 3, py + 3.9);
      px += w + 2.5;
    }

    // Right Visual Showcase (Client Brand Logo + Hero Product Photo)
    if (hasVisualColumn) {
      const rx = 205;
      const rw = this.pageW - this.marginX - rx;
      let ry = 20;

      if (logoImg) {
        this.doc.setFillColor(255, 255, 255);
        this.doc.roundedRect(rx, ry, rw, 34, 2, 2, 'F');
        drawImageInBoxRaw(this.doc, logoImg, rx + 2, ry + 2, rw - 4, 30, 'Logo');
        ry += 39;
      }

      if (heroProductImg) {
        const photoH = logoImg ? 78 : 114;
        this.doc.setFillColor(...PALETTE.charcoal);
        this.doc.setDrawColor(72, 72, 84);
        this.doc.roundedRect(rx, ry, rw, photoH, 2, 2, 'FD');
        drawImageInBoxRaw(
          this.doc,
          heroProductImg,
          rx + 2,
          ry + 2,
          rw - 4,
          photoH - 4,
          'Product'
        );
      }
    }

    // Bottom KPI Strip across hero cover
    const totalSec = this.project.shots.reduce((s, x) => s + (Number(x.durationSec) || 0), 0);
    const kpis = [
      { label: 'SHOTS & RUNTIME', value: `${this.project.shots.length} Shots · ${totalSec}s` },
      { label: 'VOICEOVER SCRIPT', value: `${this.project.voScript.length} Cues` },
      { label: 'SHOOT SCHEDULE', value: `${this.project.shootPlan?.shootDays.length ?? 0} Day(s)` },
      { label: 'EXPORT DATE', value: new Date().toLocaleDateString() },
    ];
    const kGap = 5;
    const kW = (this.contentW - kGap * 3) / 4;
    const kY = this.pageH - 36;
    kpis.forEach((k, i) => {
      const kx = this.marginX + i * (kW + kGap);
      this.doc.setFillColor(...PALETTE.charcoal);
      this.doc.setDrawColor(64, 64, 76);
      this.doc.roundedRect(kx, kY, kW, 18, 1.5, 1.5, 'FD');
      this.doc.setFillColor(...PALETTE.crimson);
      this.doc.rect(kx, kY, kW, 1.2, 'F');
      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(7.2);
      this.doc.setTextColor(186, 186, 198);
      this.doc.text(k.label, kx + 4, kY + 6.8);
      this.doc.setFontSize(11);
      this.doc.setTextColor(255, 255, 255);
      this.doc.text(sanitizePdfText(k.value), kx + 4, kY + 13.6);
    });
  }

  drawCardAt(params: {
    x: number;
    y: number;
    w: number;
    minH?: number;
    title: string;
    bodyLines: Array<{ label?: string; text: string; bold?: boolean }>;
    swatches?: Array<{ hex: string; rgb: RgbTuple }>;
    tone?: CardTone;
    dryRun?: boolean;
  }): number {
    const padX = 4;
    const padTop = 4;
    const innerW = Math.max(20, params.w - padX * 2);
    const lineH = 3.9;

    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8.2);
    const titleLines = this.doc.splitTextToSize(
      sanitizePdfText(params.title).toUpperCase(),
      innerW
    );

    const swatches = params.swatches ?? [];
    const swatchRowH = swatches.length > 0 ? 7.4 : 0;

    const blocks: Array<{ labelLines: string[]; lines: string[]; bold?: boolean }> = [];
    let bodyH = 0;
    for (const blk of params.bodyLines) {
      let labelLines: string[] = [];
      if (blk.label) {
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(7.6);
        labelLines = this.doc.splitTextToSize(sanitizePdfText(blk.label), innerW);
        bodyH += labelLines.length * 3.6 + 0.4;
      }
      this.doc.setFont('helvetica', blk.bold ? 'bold' : 'normal');
      this.doc.setFontSize(8.3);
      const wrapped = wrapPdfTextStrict(this.doc, blk.text, innerW);
      blocks.push({ labelLines, lines: wrapped, bold: blk.bold });
      bodyH += wrapped.length * lineH + 1.4;
    }

    const totalH = Math.max(
      params.minH ?? 0,
      padTop + 1.5 + titleLines.length * 4.0 + 1.0 + swatchRowH + bodyH + 2.5
    );
    if (params.dryRun) return totalH;

    const { bg, bd, titleClr } = toneColors(params.tone ?? 'neutral');
    this.doc.setFillColor(...bg);
    this.doc.setDrawColor(...bd);
    this.doc.setLineWidth(0.28);
    this.doc.roundedRect(params.x, params.y, params.w, totalH, 1.6, 1.6, 'FD');

    let cy = params.y + padTop + 1.5;
    this.doc.setFont('helvetica', 'bold');
    this.doc.setFontSize(8.2);
    this.doc.setTextColor(...titleClr);
    for (const tl of titleLines) {
      this.doc.text(tl, params.x + padX, cy);
      cy += 4.0;
    }
    cy += 1.0;

    if (swatches.length > 0) {
      let sx = params.x + padX;
      for (const sw of swatches) {
        this.doc.setFont('courier', 'bold');
        this.doc.setFontSize(6.9);
        const hexW = this.doc.getTextWidth(sw.hex);
        const chipW = 4.6 + hexW + 3.2;
        if (sx + chipW > params.x + params.w - padX) break;
        this.doc.setFillColor(...PALETTE.white);
        this.doc.setDrawColor(...PALETTE.border);
        this.doc.roundedRect(sx, cy - 3.3, chipW, 5.2, 1, 1, 'FD');
        this.doc.setFillColor(...sw.rgb);
        this.doc.rect(sx + 1.2, cy - 2.3, 3.2, 3.2, 'FD');
        this.doc.setTextColor(...PALETTE.ink);
        this.doc.text(sw.hex, sx + 5.2, cy + 0.3);
        sx += chipW + 2;
      }
      cy += swatchRowH;
    }

    for (const blk of blocks) {
      if (blk.labelLines.length > 0) {
        this.doc.setFont('helvetica', 'bold');
        this.doc.setFontSize(7.6);
        this.doc.setTextColor(...PALETTE.muted);
        for (const ll of blk.labelLines) {
          this.doc.text(ll, params.x + padX, cy);
          cy += 3.6;
        }
        cy += 0.4;
      }
      this.doc.setFont('helvetica', blk.bold ? 'bold' : 'normal');
      this.doc.setFontSize(8.3);
      this.doc.setTextColor(...PALETTE.ink);
      for (const ln of blk.lines) {
        this.doc.text(ln, params.x + padX, cy);
        cy += lineH;
      }
      cy += 1.4;
    }

    return totalH;
  }

  /**
   * Renders a full-width card across one or more slides automatically so dense Call Sheet
   * lists (Client Questions, Production Risks) NEVER overflow slide footers or overlap tables.
   */
  drawCardPaginated(params: {
    startY: number;
    sectionTag: string;
    contTitle: string;
    title: string;
    bodyLines: Array<{ label?: string; text: string; bold?: boolean }>;
    tone?: CardTone;
  }): number {
    let curY = params.startY;
    if (params.bodyLines.length === 0) return curY;

    const fullH = this.drawCardAt({
      x: this.marginX,
      y: curY,
      w: this.contentW,
      title: params.title,
      tone: params.tone,
      bodyLines: params.bodyLines,
      dryRun: true,
    });

    if (curY + fullH <= this.bottomLimit) {
      this.drawCardAt({
        x: this.marginX,
        y: curY,
        w: this.contentW,
        title: params.title,
        tone: params.tone,
        bodyLines: params.bodyLines,
      });
      return curY + fullH + 4;
    }

    if (this.bottomLimit - curY < 28 && curY > this.contentTopY + 2) {
      curY = this.startSlide(params.sectionTag, params.contTitle);
    }

    let cursor = 0;
    let part = 0;
    while (cursor < params.bodyLines.length) {
      const availH = this.bottomLimit - curY - 2;
      if (availH < 24 && curY > this.contentTopY + 2) {
        curY = this.startSlide(params.sectionTag, params.contTitle);
        continue;
      }

      const sliceTitle = part === 0 ? params.title : `${params.title} (Cont.)`;
      let end = cursor + 1;
      while (end < params.bodyLines.length) {
        const testH = this.drawCardAt({
          x: this.marginX,
          y: curY,
          w: this.contentW,
          title: sliceTitle,
          tone: params.tone,
          bodyLines: params.bodyLines.slice(cursor, end + 1),
          dryRun: true,
        });
        if (testH > availH) break;
        end++;
      }

      const drawnH = this.drawCardAt({
        x: this.marginX,
        y: curY,
        w: this.contentW,
        title: sliceTitle,
        tone: params.tone,
        bodyLines: params.bodyLines.slice(cursor, end),
      });
      curY += drawnH + 4;
      cursor = end;
      part++;

      if (cursor < params.bodyLines.length) {
        curY = this.startSlide(params.sectionTag, params.contTitle);
      }
    }

    return curY;
  }

  drawKpiRowAt(
    y: number,
    items: Array<{ label: string; value: string; accent?: 'amber' | 'emerald' | 'indigo' | 'slate' }>
  ): number {
    const gap = 4;
    const n = items.length;
    const cardW = (this.contentW - gap * (n - 1)) / n;
    const cardH = 14.5;
    items.forEach((item, i) => {
      const x = this.marginX + i * (cardW + gap);
      this.doc.setFillColor(...PALETTE.white);
      this.doc.setDrawColor(...PALETTE.border);
      this.doc.setLineWidth(0.25);
      this.doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');

      const barClr =
        item.accent === 'amber'
          ? PALETTE.crimson
          : item.accent === 'emerald'
            ? PALETTE.emeraldDark
            : item.accent === 'indigo'
              ? PALETTE.burgundy
              : PALETTE.ink;
      this.doc.setFillColor(...barClr);
      this.doc.rect(x, y, cardW, 1.1, 'F');

      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(6.8);
      this.doc.setTextColor(...PALETTE.muted);
      this.doc.text(sanitizePdfText(item.label).toUpperCase(), x + 3.5, y + 5.3);

      this.doc.setFont('helvetica', 'bold');
      this.doc.setFontSize(10.2);
      this.doc.setTextColor(...PALETTE.ink);
      const val = this.doc.splitTextToSize(sanitizePdfText(item.value), cardW - 7)[0] || '';
      this.doc.text(val, x + 3.5, y + 11.3);
    });
    return y + cardH + 4.5;
  }

  finalizeSlideFooters(): void {
    const total = this.doc.getNumberOfPages();
    const dateLabel = new Date().toLocaleDateString();
    for (let i = 1; i <= total; i++) {
      this.doc.setPage(i);
      if (i === 1) {
        // Dark hero cover footer
        this.doc.setFont('courier', 'normal');
        this.doc.setFontSize(7.6);
        this.doc.setTextColor(176, 176, 188);
        this.doc.text(
          '52LAUNCH PRODUCTION STUDIO  |  DESIGN · MANUFACTURE · MARKET',
          this.marginX,
          this.pageH - 7
        );
        this.doc.text(`Slide 1 / ${total}`, this.pageW - this.marginX, this.pageH - 7, {
          align: 'right',
        });
      } else {
        this.doc.setDrawColor(...PALETTE.borderSoft);
        this.doc.setLineWidth(0.25);
        this.doc.line(
          this.marginX,
          this.pageH - 10,
          this.pageW - this.marginX,
          this.pageH - 10
        );
        this.doc.setFont('helvetica', 'normal');
        this.doc.setFontSize(7.4);
        this.doc.setTextColor(...PALETTE.muted);
        this.doc.text(
          sanitizePdfText(
            `52Launch · Design · Manufacture · Market   |   ${this.project.client} - ${this.project.product.name}`
          ),
          this.marginX,
          this.pageH - 5.5
        );
        this.doc.text(
          `${dateLabel}   |   Slide ${i} / ${total}`,
          this.pageW - this.marginX,
          this.pageH - 5.5,
          { align: 'right' }
        );
      }
    }
  }

  toBlob(): Blob {
    this.finalizeSlideFooters();
    return this.doc.output('blob');
  }
}

function writeBrandBibleSlides(
  deck: SlideDeckWriter,
  project: PipelineProject,
  logoImg: PdfImageData | null,
  productImgs: Array<PdfImageData | null>
): void {
  const b = project.brandBible;
  // Slide 1: Brand Identity, Colors, Fonts, Logo & Product Photos
  let y = deck.startSlide('Brand Bible', 'Brand Strategy, Colors, Fonts & Visual Identity');

  if (!b?.hasGenerated && !b?.positioning) {
    deck.drawCardAt({
      x: deck.marginX,
      y,
      w: deck.contentW,
      title: 'Brand Bible',
      bodyLines: [{ text: 'Brand Bible has not been generated yet for this project.' }],
    });
    return;
  }

  const colGap = 6;
  const halfW = (deck.contentW - colGap) / 2;
  const leftX = deck.marginX;
  const rightX = deck.marginX + halfW + colGap;

  // Left Column: Positioning, Audience, Tone of Voice
  let ly = y;
  ly +=
    deck.drawCardAt({
      x: leftX,
      y: ly,
      w: halfW,
      title: 'Brand Positioning',
      bodyLines: [{ text: b.positioning }],
    }) + 4;
  ly +=
    deck.drawCardAt({
      x: leftX,
      y: ly,
      w: halfW,
      title: 'Target Audience',
      bodyLines: [{ text: b.audience }],
    }) + 4;
  deck.drawCardAt({
    x: leftX,
    y: ly,
    w: halfW,
    title: 'Tone of Voice',
    tone: 'indigo',
    bodyLines: [
      {
        label: 'Voice Adjectives',
        text: b.toneOfVoice.adjectives.join('  |  ') || 'Not specified',
        bold: true,
      },
      { label: 'Delivery Guidance', text: b.toneOfVoice.guidance },
    ],
  });

  // Right Column: Brand Style Guide (Colors + Swatches + Fonts + Lighting/Grade) & Brand Logo + Product Photos
  let ry = y;
  const swatches = parseHexSwatches(b.visualStyle.palette);
  const styleCardH = deck.drawCardAt({
    x: rightX,
    y: ry,
    w: halfW,
    title: 'Style Guide — Colors, Fonts & Visual Spec',
    swatches,
    bodyLines: [
      { label: 'Color Palette', text: b.visualStyle.palette },
      {
        label: 'Brand Fonts / Typography',
        text: b.visualStyle.typography || 'Not specified',
      },
      { label: 'Color Grade', text: b.visualStyle.grade },
      { label: 'Lighting & Lens', text: `${b.visualStyle.lighting}  |  ${b.visualStyle.lensAndFraming}` },
    ],
  });
  ry += styleCardH + 4;

  // Brand Logo + Product Photos Card
  const mediaBoxH = Math.max(42, Math.min(58, deck.bottomLimit - ry - 2));
  deck.doc.setFillColor(...PALETTE.white);
  deck.doc.setDrawColor(...PALETTE.border);
  deck.doc.setLineWidth(0.28);
  deck.doc.roundedRect(rightX, ry, halfW, mediaBoxH, 1.6, 1.6, 'FD');

  deck.doc.setFont('helvetica', 'bold');
  deck.doc.setFontSize(8);
  deck.doc.setTextColor(...PALETTE.slate);
  deck.doc.text('BRAND LOGO & PRODUCT REFERENCE PHOTOS', rightX + 4, ry + 5.5);

  const innerImgY = ry + 8.5;
  const innerImgH = mediaBoxH - 15;
  const logoSlotW = 46;
  drawImageInBoxRaw(
    deck.doc,
    logoImg,
    rightX + 4,
    innerImgY,
    logoSlotW,
    innerImgH,
    'No Brand Logo'
  );
  deck.doc.setFont('helvetica', 'normal');
  deck.doc.setFontSize(6.6);
  deck.doc.setTextColor(...PALETTE.muted);
  deck.doc.text('Brand Logo', rightX + 4 + logoSlotW / 2, innerImgY + innerImgH + 3.6, {
    align: 'center',
  });

  const prodX = rightX + 4 + logoSlotW + 4;
  const availProdW = rightX + halfW - 4 - prodX;
  const shownPhotos = project.product.photos.slice(0, 3);
  if (shownPhotos.length > 0) {
    const pGap = 3;
    const pSlotW = (availProdW - pGap * 2) / 3;
    shownPhotos.forEach((photo, idx) => {
      const px = prodX + idx * (pSlotW + pGap);
      drawImageInBoxRaw(deck.doc, productImgs[idx] || null, px, innerImgY, pSlotW, innerImgH, 'Photo');
      const cap =
        deck.doc.splitTextToSize(sanitizePdfText(photo.caption || `Product ${idx + 1}`), pSlotW)[0] || '';
      deck.doc.text(cap, px, innerImgY + innerImgH + 3.6);
    });
  } else {
    drawImageInBoxRaw(
      deck.doc,
      null,
      prodX,
      innerImgY,
      availProdW,
      innerImgH,
      'No Product Photos'
    );
  }

  // Slide 2: Characters, Product Rules & Claims Guardrails
  let y2 = deck.startSlide('Brand Bible', 'Characters, Product Rules & Compliance Guardrails');

  let leftY2 = y2;
  if (b.characters.length > 0) {
    deck.doc.setFont('helvetica', 'bold');
    deck.doc.setFontSize(9);
    deck.doc.setTextColor(...PALETTE.ink);
    deck.doc.text(`Recurring Characters (${b.characters.length})`, leftX, leftY2 + 3.5);
    leftY2 += 6;
    drawTableGeneric(
      deck.doc,
      {
        marginX: leftX,
        contentW: halfW,
        bottomLimit: deck.bottomLimit,
        getY: () => leftY2,
        setY: (ny) => {
          leftY2 = ny;
        },
        onNewPage: () => {
          leftY2 = deck.startSlide('Brand Bible', 'Recurring Characters (Cont.)');
        },
      },
      [
        { label: 'Character', width: 38 },
        { label: 'Fixed Visual Descriptor', width: halfW - 38 },
      ],
      b.characters.map((c) => [c.name, c.fixedDescriptor])
    );
  }

  deck.drawCardAt({
    x: leftX,
    y: leftY2,
    w: halfW,
    title: 'Product Fidelity Rules',
    tone: 'amber',
    bodyLines: [{ text: b.productRules }],
  });

  let rightY2 = y2;
  rightY2 +=
    deck.drawCardAt({
      x: rightX,
      y: rightY2,
      w: halfW,
      title: `Verified Claims Allowed (${b.claimsAllowed.length})`,
      tone: 'emerald',
      bodyLines:
        b.claimsAllowed.length > 0
          ? b.claimsAllowed.map((c) => ({ text: `• ${c}` }))
          : [{ text: 'None listed.' }],
    }) + 4;

  const flaggedH = deck.drawCardAt({
    x: rightX,
    y: rightY2,
    w: halfW,
    title: `Flagged Claims (${b.claimsToFlag.length})`,
    tone: 'amber',
    dryRun: true,
    bodyLines:
      b.claimsToFlag.length > 0
        ? b.claimsToFlag.map((c) => ({ text: `• ${c}` }))
        : [{ text: 'None flagged.' }],
  });
  const bannedH = deck.drawCardAt({
    x: rightX,
    y: rightY2,
    w: halfW,
    title: `Banned List (${b.bannedList.length})`,
    tone: 'rose',
    dryRun: true,
    bodyLines:
      b.bannedList.length > 0
        ? b.bannedList.map((i) => ({ text: `• ${i}` }))
        : [{ text: 'None specified.' }],
  });

  if (rightY2 + flaggedH + 4 + bannedH > deck.bottomLimit) {
    deck.drawCardAt({
      x: rightX,
      y: rightY2,
      w: halfW,
      title: `Flagged Claims (${b.claimsToFlag.length})`,
      tone: 'amber',
      bodyLines:
        b.claimsToFlag.length > 0
          ? b.claimsToFlag.map((c) => ({ text: `• ${c}` }))
          : [{ text: 'None flagged.' }],
    });
    const y3 = deck.startSlide('Brand Bible', 'Banned Elements & Exclusions');
    deck.drawCardAt({
      x: deck.marginX,
      y: y3,
      w: deck.contentW,
      title: `Banned List — Never Show or Say (${b.bannedList.length})`,
      tone: 'rose',
      bodyLines:
        b.bannedList.length > 0
          ? b.bannedList.map((i) => ({ text: `• ${i}` }))
          : [{ text: 'None specified.' }],
    });
  } else {
    rightY2 +=
      deck.drawCardAt({
        x: rightX,
        y: rightY2,
        w: halfW,
        title: `Flagged Claims (${b.claimsToFlag.length})`,
        tone: 'amber',
        bodyLines:
          b.claimsToFlag.length > 0
            ? b.claimsToFlag.map((c) => ({ text: `• ${c}` }))
            : [{ text: 'None flagged.' }],
      }) + 4;
    deck.drawCardAt({
      x: rightX,
      y: rightY2,
      w: halfW,
      title: `Banned List — Never Show or Say (${b.bannedList.length})`,
      tone: 'rose',
      bodyLines:
        b.bannedList.length > 0
          ? b.bannedList.map((i) => ({ text: `• ${i}` }))
          : [{ text: 'None specified.' }],
    });
  }
}

function writeCreativeBriefSlides(
  deck: SlideDeckWriter,
  project: PipelineProject
): void {
  const br = project.creativeBrief;
  let y = deck.startSlide('Creative Brief', 'Campaign Objective, Selected Direction & Deliverables');

  if (!br?.hasGenerated && !br?.objective) {
    deck.drawCardAt({
      x: deck.marginX,
      y,
      w: deck.contentW,
      title: 'Creative Brief',
      bodyLines: [{ text: 'Creative Brief has not been generated yet.' }],
    });
    return;
  }

  const gap = 5;
  const halfW = (deck.contentW - gap) / 2;
  const hObj = deck.drawCardAt({
    x: deck.marginX,
    y,
    w: halfW,
    title: 'Campaign Objective',
    dryRun: true,
    bodyLines: [{ text: br.objective }],
  });
  const hMsg = deck.drawCardAt({
    x: deck.marginX + halfW + gap,
    y,
    w: halfW,
    title: 'Core Key Message',
    dryRun: true,
    bodyLines: [{ text: br.keyMessage, bold: true }],
  });
  const topRowH = Math.max(hObj, hMsg);
  deck.drawCardAt({
    x: deck.marginX,
    y,
    w: halfW,
    minH: topRowH,
    title: 'Campaign Objective',
    bodyLines: [{ text: br.objective }],
  });
  deck.drawCardAt({
    x: deck.marginX + halfW + gap,
    y,
    w: halfW,
    minH: topRowH,
    title: 'Core Key Message',
    bodyLines: [{ text: br.keyMessage, bold: true }],
  });
  y += topRowH + 4.5;

  y +=
    deck.drawCardAt({
      x: deck.marginX,
      y,
      w: deck.contentW,
      title: 'Recommended Creative Concept',
      tone: 'amber',
      bodyLines: [
        { label: 'Selected Concept', text: br.recommendedConcept.title || '—', bold: true },
        { label: 'Strategic Rationale', text: br.recommendedConcept.reason },
      ],
    }) + 4.5;

  const col3W = (deck.contentW - gap * 2) / 3;
  const c1 = deck.drawCardAt({
    x: deck.marginX,
    y,
    w: col3W,
    title: `Deliverables (${br.deliverables.length})`,
    dryRun: true,
    bodyLines:
      br.deliverables.length > 0
        ? br.deliverables.map((d) => ({ text: `• ${d}` }))
        : [{ text: 'None specified.' }],
  });
  const c2 = deck.drawCardAt({
    x: deck.marginX + col3W + gap,
    y,
    w: col3W,
    title: 'Voiceover Direction',
    tone: 'indigo',
    dryRun: true,
    bodyLines: [
      { label: 'Speaker', text: br.voDirection.speaker, bold: true },
      { label: 'Pacing', text: br.voDirection.pace },
      { label: 'Arc', text: br.voDirection.emotionalArc },
    ],
  });
  const c3 = deck.drawCardAt({
    x: deck.marginX + (col3W + gap) * 2,
    y,
    w: col3W,
    title: 'Claims & Compliance',
    tone: 'emerald',
    dryRun: true,
    bodyLines: [{ text: br.claimsCheck }],
  });
  const botH = Math.max(c1, c2, c3);

  if (y + botH > deck.bottomLimit) {
    y = deck.startSlide('Creative Brief', 'Deliverables, VO Direction & Compliance');
  }
  deck.drawCardAt({
    x: deck.marginX,
    y,
    w: col3W,
    minH: botH,
    title: `Deliverables (${br.deliverables.length})`,
    bodyLines:
      br.deliverables.length > 0
        ? br.deliverables.map((d) => ({ text: `• ${d}` }))
        : [{ text: 'None specified.' }],
  });
  deck.drawCardAt({
    x: deck.marginX + col3W + gap,
    y,
    w: col3W,
    minH: botH,
    title: 'Voiceover Direction',
    tone: 'indigo',
    bodyLines: [
      { label: 'Speaker', text: br.voDirection.speaker, bold: true },
      { label: 'Pacing', text: br.voDirection.pace },
      { label: 'Arc', text: br.voDirection.emotionalArc },
    ],
  });
  deck.drawCardAt({
    x: deck.marginX + (col3W + gap) * 2,
    y,
    w: col3W,
    minH: botH,
    title: 'Claims & Compliance',
    tone: 'emerald',
    bodyLines: [{ text: br.claimsCheck }],
  });

  if (br.concepts.length > 0) {
    let cy = deck.startSlide(
      'Creative Brief',
      `Explored Creative Concepts Comparison (${br.concepts.length})`
    );
    drawTableGeneric(
      deck.doc,
      {
        marginX: deck.marginX,
        contentW: deck.contentW,
        bottomLimit: deck.bottomLimit,
        getY: () => cy,
        setY: (ny) => {
          cy = ny;
        },
        onNewPage: () => {
          cy = deck.startSlide('Creative Brief', 'Explored Creative Concepts (Cont.)');
        },
      },
      [
        { label: 'Concept', width: 52 },
        { label: 'Logline', width: 112 },
        { label: 'Why It Works', width: 82 },
        { label: 'Risks / Mitigations', width: 68.67 },
      ],
      br.concepts.map((c) => [c.title, c.logline, c.whyItWorks, c.risks])
    );
  }
}

async function writeStoryboardSlides(
  deck: SlideDeckWriter,
  project: PipelineProject,
  thumbMap: Map<string, PdfImageData | null>
): Promise<void> {
  let y = deck.startSlide('Storyboard', 'Shot List Summary & Sequence Matrix');
  if (project.shots.length === 0) {
    deck.drawCardAt({
      x: deck.marginX,
      y,
      w: deck.contentW,
      title: 'Storyboard',
      bodyLines: [{ text: 'No shots defined in the Shot Board yet.' }],
    });
    return;
  }

  const totalSec = project.shots.reduce((s, x) => s + (Number(x.durationSec) || 0), 0);
  const aiCount = project.shots.filter((s) => s.route === 'ai_video').length;
  const hybridCount = project.shots.filter((s) => s.route === 'hybrid').length;
  const liveCount = project.shots.filter((s) => s.route === 'live').length;
  const framesReady = project.shots.filter((s) => Boolean(s.frameImageUrl)).length;

  y = deck.drawKpiRowAt(y, [
    { label: 'Total Shots & Runtime', value: `${project.shots.length} Shots · ${totalSec}s`, accent: 'amber' },
    { label: 'Route Mix', value: `${aiCount} AI · ${hybridCount} Hyb · ${liveCount} Live`, accent: 'indigo' },
    { label: 'Frames Attached', value: `${framesReady} / ${project.shots.length}`, accent: 'emerald' },
    { label: 'Product Shots', value: `${project.shots.filter((s) => s.productInFrame).length} Shots`, accent: 'slate' },
  ]);

  drawTableGeneric(
    deck.doc,
    {
      marginX: deck.marginX,
      contentW: deck.contentW,
      bottomLimit: deck.bottomLimit,
      getY: () => y,
      setY: (ny) => {
        y = ny;
      },
      onNewPage: () => {
        y = deck.startSlide('Storyboard', 'Shot List Summary (Cont.)');
      },
    },
    [
      { label: 'Shot', width: 18 },
      { label: 'Route', width: 22 },
      { label: 'Engine / Gear', width: 34 },
      { label: 'Dur', width: 16, align: 'center' },
      { label: 'Prod', width: 16, align: 'center' },
      { label: 'Deliverable', width: 42 },
      { label: 'Scene Action & Voiceover Cue', width: 166.67 },
    ],
    project.shots.map((s) => [
      s.id,
      s.route === 'live' ? 'LIVE' : s.route === 'hybrid' ? 'HYBRID' : 'AI',
      s.route === 'live' ? 'Live Camera' : formatModelName(s.model),
      `${s.durationSec}s`,
      s.productInFrame ? 'Yes' : 'No',
      s.deliverable || 'Spot',
      s.voLine ? `${s.scene}  [VO: "${s.voLine}"]` : s.scene,
    ])
  );

  // Storyboard Visual Panels: clean 2-panel-per-slide wide layout OR 2x2 if compact — let's use crisp full-width stacked cards (2 per slide) or adaptive vertical flow so zero text EVER clips!
  let sy = deck.startSlide('Storyboard', 'Visual Storyboard Panels');
  for (let i = 0; i < project.shots.length; i++) {
    const shot = project.shots[i];
    const img = thumbMap.get(shot.id) || null;

    const thumbW = 92;
    const thumbH = 51.75; // true 16:9 widescreen thumbnail!
    const rightX = deck.marginX + thumbW + 7;
    const rightW = deck.contentW - thumbW - 11;

    const fields: Array<{ label: string; value: string; italic?: boolean; color?: RgbTuple }> = [
      { label: 'SCENE DESCRIPTION', value: shot.scene || 'No scene description.' },
    ];
    if (shot.route === 'live' || shot.route === 'hybrid' || shot.shootDirection) {
      fields.push({
        label: 'SHOOT DIRECTION',
        value: shot.shootDirection || '—',
        color: PALETTE.emeraldDark,
      });
    }
    if (shot.voLine) {
      fields.push({
        label: 'VOICEOVER LINE',
        value: `"${shot.voLine}"`,
        italic: true,
        color: PALETTE.indigoDark,
      });
    }
    if (shot.continuityNotes) {
      fields.push({
        label: 'CONTINUITY NOTES',
        value: shot.continuityNotes,
        color: PALETTE.muted,
      });
    }

    const wrappedFields = fields.map((f) => {
      deck.doc.setFont('helvetica', f.italic ? 'italic' : 'normal');
      deck.doc.setFontSize(8.5);
      return { ...f, lines: deck.doc.splitTextToSize(sanitizePdfText(f.value), rightW) };
    });

    deck.doc.setFont('courier', 'bold');
    deck.doc.setFontSize(10);
    const idStr = sanitizePdfText(shot.id);
    const idW = deck.doc.getTextWidth(idStr) + 4.5;

    deck.doc.setFont('courier', 'bold');
    deck.doc.setFontSize(8.4);
    const delivStr =
      deck.doc.splitTextToSize(
        sanitizePdfText(`${shot.deliverable || 'Spot'}  |  ${shot.durationSec}s`),
        62
      )[0] || '';
    const delivW = deck.doc.getTextWidth(delivStr) + 6;

    const pills: Array<{ text: string; tone: PillTone }> = [
      {
        text: shot.route === 'live' ? 'LIVE SHOOT' : shot.route === 'hybrid' ? 'HYBRID' : 'AI VIDEO',
        tone: shot.route === 'live' ? 'emerald' : shot.route === 'hybrid' ? 'amber' : 'indigo',
      },
    ];
    if (shot.route !== 'live') {
      pills.push({ text: formatModelName(shot.model), tone: 'slate' });
    }
    if (shot.productInFrame) {
      pills.push({ text: 'PRODUCT IN FRAME', tone: 'amber' });
    }
    if (shot.chainFrom && shot.chainFrom !== 'none') {
      pills.push({ text: `CHAIN: ${shot.chainFrom}`, tone: 'slate' });
    }

    const pillsStartX = deck.marginX + 4 + idW;
    const pillsMaxRightX = deck.pageW - deck.marginX - delivW - 4;
    const pillFlow = drawPillFlowRaw(deck.doc, pills, pillsStartX, 0, pillsMaxRightX, true);

    const textH = wrappedFields.reduce((s, f) => s + 3.8 + f.lines.length * 3.9 + 1.8, 0);
    const headerH = Math.max(8.4, 3.6 + pillFlow.height);
    const cardH = headerH + 5 + Math.max(thumbH, textH) + 5;

    if (sy + cardH > deck.bottomLimit && sy > deck.contentTopY + 2) {
      sy = deck.startSlide('Storyboard', `Visual Storyboard Panels (Cont. · ${shot.id})`);
    }

    deck.doc.setFillColor(...PALETTE.white);
    deck.doc.setDrawColor(...PALETTE.border);
    deck.doc.setLineWidth(0.3);
    deck.doc.roundedRect(deck.marginX, sy, deck.contentW, cardH, 1.6, 1.6, 'FD');

    deck.doc.setFillColor(...PALETTE.surfaceAlt);
    deck.doc.rect(deck.marginX, sy, deck.contentW, headerH, 'F');
    deck.doc.line(deck.marginX, sy + headerH, deck.marginX + deck.contentW, sy + headerH);

    deck.doc.setFont('courier', 'bold');
    deck.doc.setFontSize(10);
    deck.doc.setTextColor(...PALETTE.ink);
    deck.doc.text(idStr, deck.marginX + 4, sy + 5.6);

    drawPillFlowRaw(deck.doc, pills, pillsStartX, sy + 1.9, pillsMaxRightX, false);

    deck.doc.setFont('courier', 'bold');
    deck.doc.setFontSize(8.4);
    deck.doc.setTextColor(...PALETTE.ink);
    deck.doc.text(delivStr, deck.pageW - deck.marginX - 4, sy + 5.5, { align: 'right' });

    const bodyY = sy + headerH + 4.5;
    drawImageInBoxRaw(deck.doc, img, deck.marginX + 4, bodyY, thumbW, thumbH, 'Frame Pending');

    let ty = bodyY + 3;
    for (const f of wrappedFields) {
      deck.doc.setFont('helvetica', 'bold');
      deck.doc.setFontSize(7.2);
      deck.doc.setTextColor(...(f.color ?? PALETTE.muted));
      deck.doc.text(f.label, rightX, ty);
      ty += 3.7;
      deck.doc.setFont('helvetica', f.italic ? 'italic' : 'normal');
      deck.doc.setFontSize(8.5);
      deck.doc.setTextColor(...PALETTE.ink);
      for (const ln of f.lines) {
        deck.doc.text(ln, rightX, ty);
        ty += 3.9;
      }
      ty += 1.6;
    }

    sy += cardH + 5;
  }
}

async function writeFrameSuggestionsSlides(
  deck: SlideDeckWriter,
  project: PipelineProject,
  thumbMap: Map<string, PdfImageData | null>
): Promise<void> {
  const relevantShots = project.shots.filter((s) => Boolean(s.frameCheck) || Boolean(s.framePrompt));
  let y = deck.startSlide('Frame QA', 'Frame Suggestions & Vision Consistency Audit');

  if (relevantShots.length === 0) {
    deck.drawCardAt({
      x: deck.marginX,
      y,
      w: deck.contentW,
      title: 'Frame QA',
      bodyLines: [{ text: 'No Frame Check QA evaluations or frame prompts recorded yet.' }],
    });
    return;
  }

  const checked = project.shots.filter((s) => Boolean(s.frameCheck));
  const passedCount = checked.filter((s) => s.frameCheck?.passed).length;
  y = deck.drawKpiRowAt(y, [
    { label: 'Shots Evaluated', value: `${checked.length} / ${project.shots.length}`, accent: 'indigo' },
    { label: 'Passed Vision QA', value: `${passedCount} Passed`, accent: 'emerald' },
    {
      label: 'Flagged for Fix',
      value: `${checked.length - passedCount} Shots`,
      accent: checked.length - passedCount > 0 ? 'amber' : 'slate',
    },
  ]);

  for (const shot of relevantShots) {
    const img = thumbMap.get(shot.id) || null;
    const fc = shot.frameCheck;

    const thumbW = 76;
    const thumbH = 42.75;
    const rightX = deck.marginX + thumbW + 7;
    const rightW = deck.contentW - thumbW - 11;

    const scorePills: Array<{ text: string; tone: PillTone }> = [];
    if (fc) {
      const sc = fc.scores;
      [
        { label: 'Char', score: sc.characterMatch },
        { label: 'Style', score: sc.styleMatch },
        { label: 'Comp', score: sc.compositionMatch },
        { label: 'Clean', score: sc.artifacts },
        { label: 'Product', score: sc.productFidelity },
      ].forEach((sp) => {
        scorePills.push({
          text: `${sp.label}: ${sp.score !== null ? `${sp.score}/10` : 'N/A'}`,
          tone:
            sp.score === null
              ? 'slate'
              : sp.score >= 8
                ? 'emerald'
                : sp.score >= 6
                  ? 'amber'
                  : 'rose',
        });
      });
    }
    const scoreFlow = drawPillFlowRaw(deck.doc, scorePills, rightX, 0, rightX + rightW, true);
    const scoreRowH = scorePills.length > 0 ? scoreFlow.height + 4 : 0;

    deck.doc.setFont('helvetica', 'normal');
    deck.doc.setFontSize(8.2);
    const infoBlocks: Array<{ label: string; lines: string[]; tone: 'rose' | 'amber' | 'neutral' }> = [];
    if (fc && fc.problems.length > 0) {
      infoBlocks.push({
        label: 'ISSUES FOUND',
        tone: 'rose',
        lines: fc.problems.flatMap((p) =>
          deck.doc.splitTextToSize(`• ${sanitizePdfText(p)}`, rightW)
        ),
      });
    }
    if (fc && fc.productDifferences.length > 0) {
      infoBlocks.push({
        label: 'PRODUCT FIDELITY DIFFERENCES',
        tone: 'amber',
        lines: fc.productDifferences.flatMap((p) =>
          deck.doc.splitTextToSize(`• ${sanitizePdfText(p)}`, rightW)
        ),
      });
    }
    const promptText = fc?.improvedFramePrompt || shot.framePrompt;
    if (promptText) {
      infoBlocks.push({
        label: fc?.improvedFramePrompt ? 'IMPROVED FRAME PROMPT' : 'FRAME PROMPT',
        tone: 'neutral',
        lines: deck.doc.splitTextToSize(sanitizePdfText(promptText), rightW),
      });
    }

    const rightTextH = infoBlocks.reduce(
      (s, b) => s + 4 + b.lines.length * 3.8 + 1.6,
      scoreRowH
    );
    const cardH = 8.4 + 5 + Math.max(thumbH, rightTextH) + 5;

    if (y + cardH > deck.bottomLimit && y > deck.contentTopY + 2) {
      y = deck.startSlide('Frame QA', `Frame Suggestions (Cont. · ${shot.id})`);
    }

    deck.doc.setFillColor(...PALETTE.white);
    deck.doc.setDrawColor(...PALETTE.border);
    deck.doc.setLineWidth(0.28);
    deck.doc.roundedRect(deck.marginX, y, deck.contentW, cardH, 1.6, 1.6, 'FD');

    deck.doc.setFillColor(...PALETTE.surfaceAlt);
    deck.doc.rect(deck.marginX, y, deck.contentW, 8.2, 'F');
    deck.doc.line(deck.marginX, y + 8.2, deck.marginX + deck.contentW, y + 8.2);

    deck.doc.setFont('courier', 'bold');
    deck.doc.setFontSize(9.8);
    deck.doc.setTextColor(...PALETTE.ink);
    deck.doc.text(sanitizePdfText(shot.id), deck.marginX + 4, y + 5.5);
    const idW = deck.doc.getTextWidth(sanitizePdfText(shot.id)) + 4.5;

    drawPillRaw(
      deck.doc,
      fc ? (fc.passed ? 'PASSED' : 'NEEDS FIX') : 'PENDING QA',
      deck.marginX + 4 + idW,
      y + 1.8,
      fc ? (fc.passed ? 'emerald' : 'rose') : 'slate',
      7
    );

    deck.doc.setFont('helvetica', 'normal');
    deck.doc.setFontSize(8.2);
    deck.doc.setTextColor(...PALETTE.muted);
    const frameMetaClamped =
      deck.doc.splitTextToSize(
        sanitizePdfText(`${shot.deliverable || 'Shot'} · ${shot.durationSec}s`),
        68
      )[0] || '';
    deck.doc.text(frameMetaClamped, deck.pageW - deck.marginX - 4, y + 5.4, {
      align: 'right',
    });

    const bodyY = y + 12;
    drawImageInBoxRaw(deck.doc, img, deck.marginX + 4, bodyY, thumbW, thumbH, 'No Frame');

    let ty = bodyY;
    if (scorePills.length > 0) {
      drawPillFlowRaw(deck.doc, scorePills, rightX, ty, rightX + rightW, false);
      ty += scoreRowH;
    }

    for (const blk of infoBlocks) {
      deck.doc.setFont('helvetica', 'bold');
      deck.doc.setFontSize(7.2);
      deck.doc.setTextColor(
        ...(blk.tone === 'rose'
          ? PALETTE.roseDark
          : blk.tone === 'amber'
            ? PALETTE.amberDark
            : PALETTE.slate)
      );
      deck.doc.text(blk.label, rightX, ty + 2);
      ty += 5.4;

      deck.doc.setFont('helvetica', 'normal');
      deck.doc.setFontSize(8.2);
      deck.doc.setTextColor(...PALETTE.ink);
      for (const ln of blk.lines) {
        deck.doc.text(ln, rightX, ty);
        ty += 3.8;
      }
      ty += 1.6;
    }

    y += cardH + 5;
  }
}

async function writeVideoPromptsSlides(
  deck: SlideDeckWriter,
  project: PipelineProject,
  thumbMap: Map<string, PdfImageData | null>
): Promise<void> {
  const aiHybridShots = project.shots.filter((s) => s.route !== 'live');
  let y = deck.startSlide('Video Studio', 'Video Prompts, Matching Start Frames & Clip Links');

  if (aiHybridShots.length === 0) {
    deck.drawCardAt({
      x: deck.marginX,
      y,
      w: deck.contentW,
      title: 'Video Studio',
      bodyLines: [{ text: 'All project shots are Live Shoot only (no AI video prompts).' }],
    });
    return;
  }

  const withPrompts = aiHybridShots.filter((s) => s.videoPrompt.trim().length > 0).length;
  const renderedCount = aiHybridShots.filter(
    (s) => Boolean(s.videoUrl) || (s.videoHistory?.length ?? 0) > 0
  ).length;
  const upscaledCount = aiHybridShots.filter((s) => Boolean(s.upscaledVideoUrl)).length;

  y = deck.drawKpiRowAt(y, [
    { label: 'AI / Hybrid Shots', value: `${aiHybridShots.length} Shots`, accent: 'indigo' },
    { label: 'Prompts Written', value: `${withPrompts} / ${aiHybridShots.length}`, accent: 'amber' },
    { label: 'Clips Rendered', value: `${renderedCount} Clips`, accent: 'emerald' },
    { label: 'Topaz Upscaled', value: `${upscaledCount} Clips`, accent: 'slate' },
  ]);

  for (const shot of aiHybridShots) {
    const thumbImg = thumbMap.get(shot.id) || null;
    const history: ShotClipHistoryItem[] =
      shot.videoHistory && shot.videoHistory.length > 0
        ? shot.videoHistory
        : shot.videoUrl
          ? [
              {
                id: `clip-${shot.id}`,
                videoUrl: shot.videoUrl,
                createdAt: project.updatedAt,
                modelId: formatModelName(shot.model),
                workflowMode: shot.frameImageUrl ? 'image_to_video' : 'text_to_video',
                prompt: shot.videoPrompt,
                negativePrompt: shot.negativePrompt,
                aspectRatio: '16:9',
                duration: shot.durationSec,
                qualityTier: 'draft',
                resolution: shot.videoResolution || '480p',
                nativeAudio: true,
                seed: shot.videoSeed,
                upscaledVideoUrl: shot.upscaledVideoUrl,
                upscaledResolution: shot.upscaledResolution,
              },
            ]
          : [];

    const thumbW = 84;
    const thumbH = 47.25; // true 16:9 widescreen thumbnail
    const rightX = deck.marginX + thumbW + 7;
    const rightW = deck.contentW - thumbW - 11;
    const promptInnerW = rightW - 5;

    deck.doc.setFont('helvetica', 'normal');
    deck.doc.setFontSize(8.3);
    const motionLines = deck.doc.splitTextToSize(
      sanitizePdfText(shot.videoPrompt, 'No motion video prompt generated yet.'),
      promptInnerW
    );
    const motionBoxH = Math.max(16, 7.8 + motionLines.length * 3.8 + 2.4);

    const hasNeg = Boolean(shot.negativePrompt && shot.negativePrompt.trim().length > 0);
    deck.doc.setFont('helvetica', 'normal');
    deck.doc.setFontSize(8.1);
    const negLines = hasNeg
      ? deck.doc.splitTextToSize(sanitizePdfText(shot.negativePrompt), promptInnerW)
      : [];
    const negBoxH = hasNeg ? Math.max(13, 7.4 + negLines.length * 3.7 + 2.2) : 0;

    deck.doc.setFont('courier', 'bold');
    deck.doc.setFontSize(9.8);
    const idStr = sanitizePdfText(shot.id);
    const idW = deck.doc.getTextWidth(idStr) + 4.5;

    deck.doc.setFont('helvetica', 'normal');
    deck.doc.setFontSize(8);
    const delivStr =
      deck.doc.splitTextToSize(sanitizePdfText(shot.deliverable || ''), 58)[0] || '';
    const delivW = delivStr ? deck.doc.getTextWidth(delivStr) + 6 : 0;

    const pills: Array<{ text: string; tone: PillTone }> = [
      {
        text: shot.route === 'hybrid' ? 'HYBRID' : 'AI VIDEO',
        tone: shot.route === 'hybrid' ? 'amber' : 'indigo',
      },
      { text: formatModelName(shot.model), tone: 'slate' },
      { text: `${shot.durationSec}s · ${shot.videoResolution || 'Draft'}`, tone: 'slate' },
    ];
    if (shot.upscaledVideoUrl) {
      pills.push({
        text: `TOPAZ ${shot.upscaledResolution || 'UPSCALED'}`,
        tone: 'emerald',
      });
    }
    const pillsStartX = deck.marginX + 4 + idW;
    const pillsMaxRightX = deck.pageW - deck.marginX - delivW - 4;
    const pillFlow = drawPillFlowRaw(deck.doc, pills, pillsStartX, 0, pillsMaxRightX, true);

    const shownTakes = history.slice(0, 4);
    const takeRowsMeasured = shownTakes.map((clip, idx) => {
      const takeNum = history.length - idx;
      const absUrl = resolveAbsoluteUrl(clip.upscaledVideoUrl || clip.videoUrl);
      const takeSummary = sanitizePdfText(
        `Take #${takeNum}  |  ${clip.modelId}  |  ${clip.resolution} (${clip.qualityTier})  |  ${clip.duration}s${
          clip.seed ? `  |  Seed ${clip.seed}` : ''
        }`
      );
      deck.doc.setFont('courier', 'normal');
      deck.doc.setFontSize(7.4);
      const wrapped = deck.doc.splitTextToSize(takeSummary, deck.contentW - 44);
      return { absUrl, lines: wrapped.slice(0, 2) };
    });

    const leftMetaLines =
      (shot.videoSeed !== null && shot.videoSeed !== undefined ? 1 : 0) +
      (shot.videoUrl ? 1 : 0) +
      (shot.upscaledVideoUrl ? 1 : 0);
    const leftH = thumbH + (leftMetaLines > 0 ? 4 + leftMetaLines * 4.4 : 0);
    const rightH = motionBoxH + (hasNeg ? 3 + negBoxH : 0);
    const takesH =
      takeRowsMeasured.length > 0
        ? 7.2 + takeRowsMeasured.reduce((s, t) => s + t.lines.length * 4.0 + 1.2, 0) + 2
        : 0;
    const headerH = Math.max(8.2, 3.6 + pillFlow.height);
    const cardH = headerH + 4.5 + Math.max(leftH, rightH) + 3.5 + takesH;

    if (y + cardH > deck.bottomLimit && y > deck.contentTopY + 2) {
      y = deck.startSlide('Video Studio', `Video Prompts & Frame Thumbnails (Cont. · ${shot.id})`);
    }

    deck.doc.setFillColor(...PALETTE.white);
    deck.doc.setDrawColor(...PALETTE.border);
    deck.doc.setLineWidth(0.3);
    deck.doc.roundedRect(deck.marginX, y, deck.contentW, cardH, 1.6, 1.6, 'FD');

    deck.doc.setFillColor(...PALETTE.surfaceAlt);
    deck.doc.rect(deck.marginX, y, deck.contentW, headerH, 'F');
    deck.doc.line(deck.marginX, y + headerH, deck.marginX + deck.contentW, y + headerH);

    deck.doc.setFont('courier', 'bold');
    deck.doc.setFontSize(9.8);
    deck.doc.setTextColor(...PALETTE.ink);
    deck.doc.text(idStr, deck.marginX + 4, y + 5.4);

    drawPillFlowRaw(deck.doc, pills, pillsStartX, y + 1.8, pillsMaxRightX, false);

    if (delivStr) {
      deck.doc.setFont('helvetica', 'normal');
      deck.doc.setFontSize(8);
      deck.doc.setTextColor(...PALETTE.muted);
      deck.doc.text(delivStr, deck.pageW - deck.marginX - 4, y + 5.3, {
        align: 'right',
      });
    }

    const bodyY = y + headerH + 4.2;
    drawImageInBoxRaw(deck.doc, thumbImg, deck.marginX + 4, bodyY, thumbW, thumbH, 'No Start Frame');

    let ly = bodyY + thumbH + 4.2;
    if (shot.videoSeed !== null && shot.videoSeed !== undefined) {
      deck.doc.setFont('courier', 'bold');
      deck.doc.setFontSize(7.5);
      deck.doc.setTextColor(...PALETTE.slate);
      deck.doc.text(`Seed: ${shot.videoSeed}`, deck.marginX + 4, ly);
      ly += 4.3;
    }
    if (shot.videoUrl) {
      const abs = resolveAbsoluteUrl(shot.videoUrl);
      deck.doc.setFont('helvetica', 'bold');
      deck.doc.setFontSize(7.5);
      deck.doc.setTextColor(...PALETTE.indigoDark);
      if (isHttpOrLocalAssetUrl(abs)) {
        deck.doc.textWithLink('Open Primary MP4 ->', deck.marginX + 4, ly, { url: abs });
      } else {
        deck.doc.text(`Clip: ${formatShortUrlDisplay(abs)}`, deck.marginX + 4, ly);
      }
      ly += 4.3;
    }
    if (shot.upscaledVideoUrl) {
      const absUp = resolveAbsoluteUrl(shot.upscaledVideoUrl);
      deck.doc.setFont('helvetica', 'bold');
      deck.doc.setFontSize(7.5);
      deck.doc.setTextColor(...PALETTE.emeraldDark);
      if (isHttpOrLocalAssetUrl(absUp)) {
        deck.doc.textWithLink(
          `Open Topaz ${shot.upscaledResolution || '4K'} MP4 ->`,
          deck.marginX + 4,
          ly,
          { url: absUp }
        );
      } else {
        deck.doc.text(`Upscaled: ${formatShortUrlDisplay(absUp)}`, deck.marginX + 4, ly);
      }
    }

    let ry = bodyY;
    deck.doc.setFillColor(...PALETTE.indigoTint);
    deck.doc.setDrawColor(...PALETTE.indigoBorder);
    deck.doc.roundedRect(rightX, ry, rightW, motionBoxH, 1.2, 1.2, 'FD');
    deck.doc.setFont('helvetica', 'bold');
    deck.doc.setFontSize(7.1);
    deck.doc.setTextColor(...PALETTE.indigoDark);
    deck.doc.text('MOTION VIDEO PROMPT', rightX + 2.5, ry + 4.2);
    deck.doc.setFont('helvetica', 'normal');
    deck.doc.setFontSize(8.3);
    deck.doc.setTextColor(...PALETTE.ink);
    motionLines.forEach((ln: string, li: number) => {
      deck.doc.text(ln, rightX + 2.5, ry + 8.3 + li * 3.8);
    });
    ry += motionBoxH + 3;

    if (hasNeg) {
      deck.doc.setFillColor(...PALETTE.roseTint);
      deck.doc.setDrawColor(...PALETTE.roseBorder);
      deck.doc.roundedRect(rightX, ry, rightW, negBoxH, 1.2, 1.2, 'FD');
      deck.doc.setFont('helvetica', 'bold');
      deck.doc.setFontSize(7.1);
      deck.doc.setTextColor(...PALETTE.roseDark);
      deck.doc.text('NEGATIVE PROMPT (AVOID)', rightX + 2.5, ry + 4.0);
      deck.doc.setFont('helvetica', 'normal');
      deck.doc.setFontSize(8.1);
      deck.doc.setTextColor(...PALETTE.ink);
      negLines.forEach((ln: string, li: number) => {
        deck.doc.text(ln, rightX + 2.5, ry + 7.9 + li * 3.7);
      });
    }

    if (takeRowsMeasured.length > 0) {
      const stripY = y + cardH - takesH;
      deck.doc.setDrawColor(...PALETTE.borderSoft);
      deck.doc.line(deck.marginX + 4, stripY, deck.marginX + deck.contentW - 4, stripY);
      deck.doc.setFont('helvetica', 'bold');
      deck.doc.setFontSize(7.1);
      deck.doc.setTextColor(...PALETTE.muted);
      deck.doc.text(`RENDERED TAKES (${history.length})`, deck.marginX + 4, stripY + 4.2);

      let ty = stripY + 8.1;
      takeRowsMeasured.forEach((t) => {
        deck.doc.setFont('courier', 'normal');
        deck.doc.setFontSize(7.4);
        deck.doc.setTextColor(...PALETTE.slate);
        t.lines.forEach((ln: string, li: number) => {
          deck.doc.text(ln, deck.marginX + 5, ty + li * 4.0);
        });
        if (isHttpOrLocalAssetUrl(t.absUrl)) {
          deck.doc.setFont('helvetica', 'bold');
          deck.doc.setTextColor(...PALETTE.indigoDark);
          deck.doc.textWithLink('Download MP4 ->', deck.pageW - deck.marginX - 4, ty, {
            url: t.absUrl,
            align: 'right',
          });
        }
        ty += t.lines.length * 4.0 + 1.2;
      });
    }

    y += cardH + 5;
  }
}

function writeVoScriptSlides(deck: SlideDeckWriter, project: PipelineProject): void {
  let y = deck.startSlide('VO Script', 'Voiceover Script, Casting & Audio Direction');
  if (project.voScript.length === 0) {
    deck.drawCardAt({
      x: deck.marginX,
      y,
      w: deck.contentW,
      title: 'VO Script',
      bodyLines: [{ text: 'No VO script lines created yet.' }],
    });
    return;
  }

  const s = project.voSettings;
  const renderedCount = project.voScript.filter((v) => Boolean(v.audioUrl)).length;
  const totalSec = project.voScript.reduce((acc, v) => acc + (Number(v.durationSec) || 0), 0);

  y = deck.drawKpiRowAt(y, [
    { label: 'Primary Voice', value: s?.voiceName || 'Default', accent: 'indigo' },
    { label: 'Tone & Speed', value: s ? `${s.emotionalTone} (${s.speed}x)` : 'Standard', accent: 'amber' },
    { label: 'Lines / Duration', value: `${project.voScript.length} Lines · ~${totalSec}s`, accent: 'slate' },
    { label: 'Synthesized Audio', value: `${renderedCount} / ${project.voScript.length} Ready`, accent: 'emerald' },
  ]);

  drawTableGeneric(
    deck.doc,
    {
      marginX: deck.marginX,
      contentW: deck.contentW,
      bottomLimit: deck.bottomLimit,
      getY: () => y,
      setY: (ny) => {
        y = ny;
      },
      onNewPage: () => {
        y = deck.startSlide('VO Script', 'Voiceover Script (Cont.)');
      },
    },
    [
      { label: 'Shot', width: 18 },
      { label: 'Speaker / Voice', width: 42 },
      { label: 'Spoken Copy', width: 144.67 },
      { label: 'Direction & Audio Tags', width: 82 },
      { label: 'Status', width: 28, align: 'center' },
    ],
    project.voScript.map((line) => [
      line.shotId,
      `${line.speaker || 'Narrator'} (${line.voiceName || s?.voiceName || 'Default'})`,
      `"${line.line}"`,
      `${line.direction || '—'} | Tags: ${line.audioTags || '—'}`,
      line.audioUrl ? 'AUDIO READY' : 'SCRIPT',
    ])
  );
}

function writeShootPlanSlides(deck: SlideDeckWriter, project: PipelineProject): void {
  const plan = project.shootPlan;
  let y = deck.startSlide('Call Sheet', 'Line Producer Call Sheet & Shoot Schedule');

  if (!plan?.hasGenerated && plan.shootDays.length === 0) {
    deck.drawCardAt({
      x: deck.marginX,
      y,
      w: deck.contentW,
      title: 'Call Sheet & Shoot Plan',
      bodyLines: [{ text: 'Live & Hybrid Shoot Plan has not been generated yet.' }],
    });
    return;
  }

  const liveHybrid = project.shots.filter((s) => s.route !== 'ai_video').length;
  y = deck.drawKpiRowAt(y, [
    { label: 'Live & Hybrid Shots', value: `${liveHybrid} Shots`, accent: 'emerald' },
    { label: 'Shoot Days', value: `${plan.shootDays.length} Day(s)`, accent: 'amber' },
    { label: 'Crew Roles', value: `${plan.crew.length} Roles`, accent: 'indigo' },
    { label: 'Gear & Props', value: `${plan.equipment.length} Gear · ${plan.propsAndUnits.length} Props`, accent: 'slate' },
  ]);

  if (plan.clientQuestions.length > 0) {
    y = deck.drawCardPaginated({
      startY: y,
      sectionTag: 'Call Sheet',
      contTitle: 'Open Client Questions (Cont.)',
      title: `Open Client Questions (${plan.clientQuestions.length})`,
      tone: 'amber',
      bodyLines: plan.clientQuestions.map((q) => ({ text: `• ${q}` })),
    });
  }

  for (const day of plan.shootDays) {
    const callMilestones = [
      `CALL ${day.callTime}`,
      day.breakfastTime ? `BFAST ${day.breakfastTime}` : null,
      `LUNCH ${day.lunchTime || '12:30 - 01:30'}`,
      `WRAP ${day.wrapTime}`,
    ].filter(Boolean).join('  |  ');
    const callStr = sanitizePdfText(callMilestones);
    deck.doc.setFont('courier', 'bold');
    deck.doc.setFontSize(7.6);
    const callW = deck.doc.getTextWidth(callStr) + 8;
    const locAvailW = Math.max(90, deck.contentW - callW - 12);

    deck.doc.setFont('helvetica', 'bold');
    deck.doc.setFontSize(9.2);
    const dayTitleLines = deck.doc.splitTextToSize(
      sanitizePdfText(`${day.dayLabel}  |  ${day.location}`),
      locAvailW
    );
    const barH = Math.max(9.2, 4.6 + dayTitleLines.length * 4.3);

    if (y + barH + 16 > deck.bottomLimit) {
      y = deck.startSlide('Call Sheet', 'Shoot Day Schedule (Cont.)');
    }
    deck.doc.setFillColor(...PALETTE.ink);
    deck.doc.roundedRect(deck.marginX, y, deck.contentW, barH, 1.2, 1.2, 'F');
    deck.doc.setFillColor(...PALETTE.crimson);
    deck.doc.rect(deck.marginX, y + barH - 0.8, deck.contentW, 0.8, 'F');
    deck.doc.setFont('helvetica', 'bold');
    deck.doc.setFontSize(9.2);
    deck.doc.setTextColor(255, 255, 255);
    dayTitleLines.forEach((ln: string, li: number) => {
      deck.doc.text(ln, deck.marginX + 4, y + 5.8 + li * 4.3);
    });
    deck.doc.setFont('courier', 'bold');
    deck.doc.setFontSize(7.6);
    deck.doc.setTextColor(243, 156, 164);
    deck.doc.text(callStr, deck.pageW - deck.marginX - 4, y + 5.8, {
      align: 'right',
    });
    y += barH + 2.0;

    // Timeline Table in Slideshow
    const scheduleBlocks = getShootDayScheduleBlocks(day);
    drawTableGeneric(
      deck.doc,
      {
        marginX: deck.marginX,
        contentW: deck.contentW,
        bottomLimit: deck.bottomLimit,
        getY: () => y,
        setY: (ny) => {
          y = ny;
        },
        onNewPage: () => {
          y = deck.startSlide('Call Sheet', `${day.dayLabel} Timeline (Cont.)`);
        },
      },
      [
        { label: 'Time Slot', width: 38 },
        { label: 'Activity / Milestone', width: 95 },
        { label: 'Type', width: 28, align: 'center' },
        { label: 'Shots', width: 36 },
        { label: 'Notes & Crew Instructions', width: 72 },
      ],
      scheduleBlocks.map((b) => [
        b.timeSlot,
        b.activity,
        b.category.toUpperCase(),
        (b.shotIds || []).join(', ') || '—',
        b.notes || '—',
      ])
    );

    y += 2.5;

    if (day.setups.length > 0) {
      drawTableGeneric(
        deck.doc,
        {
          marginX: deck.marginX,
          contentW: deck.contentW,
          bottomLimit: deck.bottomLimit,
          getY: () => y,
          setY: (ny) => {
            y = ny;
          },
          onNewPage: () => {
            y = deck.startSlide('Call Sheet', `${day.dayLabel} Setups (Cont.)`);
          },
        },
        [
          { label: 'Setup', width: 44 },
          { label: 'Shots', width: 38 },
          { label: 'Est.', width: 20, align: 'center' },
          { label: 'Lighting & Camera Approach', width: 167 },
        ],
        day.setups.map((st) => [
          st.setupName,
          st.shotIds.join(', ') || 'TBD',
          `${st.estimatedMinutes}m`,
          st.lightingNotes || 'Standard setup',
        ])
      );
    }
  }

  // Logistics Slide(s) A: Camera, Grip & Lighting alongside Crew & Roles with automatic chunk pagination
  const gap = 5;
  const halfW = (deck.contentW - gap) / 2;
  const eqItems =
    plan.equipment.length > 0
      ? plan.equipment.map((eq) => ({ text: `• ${eq}` }))
      : [{ text: 'No equipment listed.' }];
  const crewItems =
    plan.crew.length > 0
      ? plan.crew.map((c) => ({ text: `• ${c}` }))
      : [{ text: 'No crew listed.' }];

  let eqIdx = 0;
  let crewIdx = 0;
  let logPart = 0;
  while (eqIdx < eqItems.length || crewIdx < crewItems.length) {
    const ly = deck.startSlide(
      'Call Sheet',
      logPart === 0 ? 'Camera, Grip, Lighting & Crew Roster' : 'Equipment & Crew Roster (Cont.)'
    );
    const availH = deck.bottomLimit - ly - 2;

    const eqRem = eqItems.slice(eqIdx);
    const crewRem = crewItems.slice(crewIdx);
    const eqTitle =
      eqIdx === 0
        ? `Camera, Grip & Lighting (${plan.equipment.length})`
        : `Camera, Grip & Lighting (Cont.)`;
    const crewTitle =
      crewIdx === 0 ? `Crew & Roles (${plan.crew.length})` : `Crew & Roles (Cont.)`;

    let eqEnd = 0;
    while (eqEnd < eqRem.length) {
      const h = deck.drawCardAt({
        x: deck.marginX,
        y: ly,
        w: halfW,
        title: eqTitle,
        dryRun: true,
        bodyLines: eqRem.slice(0, eqEnd + 1),
      });
      if (eqEnd > 0 && h > availH) break;
      eqEnd++;
    }

    let crewEnd = 0;
    while (crewEnd < crewRem.length) {
      const h = deck.drawCardAt({
        x: deck.marginX + halfW + gap,
        y: ly,
        w: halfW,
        title: crewTitle,
        dryRun: true,
        bodyLines: crewRem.slice(0, crewEnd + 1),
      });
      if (crewEnd > 0 && h > availH) break;
      crewEnd++;
    }

    const eqSlice = eqRem.slice(0, eqEnd);
    const crewSlice = crewRem.slice(0, crewEnd);
    const eqSliceH =
      eqSlice.length > 0
        ? deck.drawCardAt({
            x: deck.marginX,
            y: ly,
            w: halfW,
            title: eqTitle,
            dryRun: true,
            bodyLines: eqSlice,
          })
        : 0;
    const crewSliceH =
      crewSlice.length > 0
        ? deck.drawCardAt({
            x: deck.marginX + halfW + gap,
            y: ly,
            w: halfW,
            title: crewTitle,
            dryRun: true,
            bodyLines: crewSlice,
          })
        : 0;
    const pairH = Math.min(availH, Math.max(eqSliceH, crewSliceH));

    if (eqSlice.length > 0) {
      deck.drawCardAt({
        x: deck.marginX,
        y: ly,
        w: halfW,
        minH: pairH,
        title: eqTitle,
        bodyLines: eqSlice,
      });
    }
    if (crewSlice.length > 0) {
      deck.drawCardAt({
        x: eqSlice.length > 0 ? deck.marginX + halfW + gap : deck.marginX,
        y: ly,
        w: eqSlice.length > 0 ? halfW : deck.contentW,
        minH: pairH,
        title: crewTitle,
        bodyLines: crewSlice,
      });
    }

    eqIdx += eqEnd;
    crewIdx += crewEnd;
    logPart++;
  }

  // Logistics Slide B: Props & Product Units Table + Production Risks & Contingencies
  if (plan.propsAndUnits.length > 0 || plan.risks.length > 0) {
    let py = deck.startSlide('Call Sheet', 'Props, Product Units & Risk Contingencies');

    if (plan.propsAndUnits.length > 0) {
      deck.doc.setFont('helvetica', 'bold');
      deck.doc.setFontSize(9.5);
      deck.doc.setTextColor(...PALETTE.ink);
      deck.doc.text(
        `Props & Product Units (${plan.propsAndUnits.length})`,
        deck.marginX,
        py + 3.5
      );
      py += 6;

      drawTableGeneric(
        deck.doc,
        {
          marginX: deck.marginX,
          contentW: deck.contentW,
          bottomLimit: deck.bottomLimit,
          getY: () => py,
          setY: (ny) => {
            py = ny;
          },
          onNewPage: () => {
            py = deck.startSlide('Call Sheet', 'Props, Units & Risk Contingencies (Cont.)');
          },
        },
        [
          { label: 'Item / Unit', width: 138 },
          { label: 'Quantity & Backups', width: 88 },
          { label: 'Supplied By', width: 88.67 },
        ],
        plan.propsAndUnits.map((p) => [p.item, p.quantity, p.suppliedBy])
      );
    }

    if (plan.risks.length > 0) {
      deck.drawCardPaginated({
        startY: py + 1.5,
        sectionTag: 'Call Sheet',
        contTitle: 'Production Risks & Contingencies (Cont.)',
        title: `Production Risks & Contingencies (${plan.risks.length})`,
        tone: 'rose',
        bodyLines: plan.risks.map((r) => ({ text: `• ${r}` })),
      });
    }
  }
}

// ============================================================================
// PUBLIC EXPORT & DRIVE SYNC FUNCTIONS
// ============================================================================

async function writeSectionById(
  writer: PdfWriter,
  project: PipelineProject,
  sectionId: MasterPdfSectionId
): Promise<void> {
  switch (sectionId) {
    case 'brandBible':
      await writeBrandBibleSection(writer, project);
      break;
    case 'creativeBrief':
      writeCreativeBriefSection(writer, project);
      break;
    case 'shotListAndStoryboard':
      await writeStoryboardSection(writer, project);
      break;
    case 'frameSuggestions':
      await writeFrameSuggestionsSection(writer, project);
      break;
    case 'videoPromptsAndVideo':
      await writeVideoPromptsSection(writer, project);
      break;
    case 'voScript':
      writeVoScriptSection(writer, project);
      break;
    case 'shootPlan':
      writeShootPlanSection(writer, project);
      break;
  }
}

export async function buildStoryboardPdfBlob(
  project: PipelineProject,
  preloadedBrand?: BrandLogoAssets
): Promise<{ filename: string; blob: Blob }> {
  const brand = preloadedBrand || (await load52LaunchBrandAssets());
  const writer = new PdfWriter('Storyboard & Shot List', project);
  const totalSec = project.shots.reduce((s, x) => s + (Number(x.durationSec) || 0), 0);
  writer.drawCoverHeader(
    'Printable Storyboard & Shot Order',
    [
      `${project.shots.length} Shots`,
      `${totalSec}s Runtime`,
      new Date().toLocaleDateString(),
    ],
    brand.badgeBurgundy
  );
  await writeStoryboardSection(writer, project);
  const slug = slugifyFilePart(`${project.client}-${project.product.name}`);
  return {
    filename: `${slug}-storyboard.pdf`,
    blob: writer.toBlob(),
  };
}

export async function downloadStoryboardPdf(
  project: PipelineProject
): Promise<DriveSaveResult> {
  const { filename, blob } = await buildStoryboardPdfBlob(project);
  triggerBlobDownload(blob, filename);
  return await maybeAutoSavePdfToDrive(project, filename, blob);
}

export async function buildCallSheetPdfBlob(
  project: PipelineProject,
  plan?: ShootPlan,
  preloadedBrand?: BrandLogoAssets
): Promise<{ filename: string; blob: Blob }> {
  const brand = preloadedBrand || (await load52LaunchBrandAssets());
  const activePlan = plan || project.shootPlan;
  const liveHybrid = project.shots.filter((s) => s.route !== 'ai_video').length;
  const writer = new PdfWriter('Call Sheet & Shoot Plan', project);
  writer.drawCoverHeader(
    'Line Producer Call Sheet & Schedule',
    [
      `${liveHybrid} Live/Hybrid Shots`,
      `${activePlan.shootDays.length} Shoot Day(s)`,
      new Date().toLocaleDateString(),
    ],
    brand.badgeBurgundy
  );
  writeShootPlanSection(writer, project, activePlan);
  const slug = slugifyFilePart(`${project.client}-${project.product.name}`);
  return {
    filename: `${slug}-call-sheet.pdf`,
    blob: writer.toBlob(),
  };
}

export async function downloadCallSheetPdf(
  project: PipelineProject,
  plan?: ShootPlan
): Promise<DriveSaveResult> {
  const { filename, blob } = await buildCallSheetPdfBlob(project, plan);
  triggerBlobDownload(blob, filename);
  return await maybeAutoSavePdfToDrive(project, filename, blob);
}

export async function buildMasterSlideshowPdfBlob(
  project: PipelineProject,
  sections: MasterPdfSectionId[],
  preloadedBrand?: BrandLogoAssets
): Promise<{ filename: string; blob: Blob }> {
  const slug = slugifyFilePart(`${project.client}-${project.product.name}`);
  const deck = new SlideDeckWriter(project);

  // Preload official 52Launch badge + client brand & shot visual assets in parallel
  const brandGraphicsList = getAllBrandGraphics(project);
  const primaryLogoUrl = brandGraphicsList[0]?.url || project.brandBible?.brandLogoUrl;
  const [brand, logoImg, ...prodImgs] = await Promise.all([
    preloadedBrand ? Promise.resolve(preloadedBrand) : load52LaunchBrandAssets(),
    loadImageForPdf(primaryLogoUrl),
    ...project.product.photos.slice(0, 4).map((p) => loadImageForPdf(p.url)),
  ]);

  const thumbEntries = await Promise.all(
    project.shots.map(async (shot) => [shot.id, await loadImageForPdf(getShotThumbnailUrl(shot))] as const)
  );
  const thumbMap = new Map<string, PdfImageData | null>(thumbEntries);

  deck.drawHeroTitleSlide(sections, logoImg, prodImgs[0] || null, brand.badgeBurgundy);

  for (const sectionId of sections) {
    switch (sectionId) {
      case 'brandBible':
        writeBrandBibleSlides(deck, project, logoImg, prodImgs);
        break;
      case 'creativeBrief':
        writeCreativeBriefSlides(deck, project);
        break;
      case 'shotListAndStoryboard':
        await writeStoryboardSlides(deck, project, thumbMap);
        break;
      case 'frameSuggestions':
        await writeFrameSuggestionsSlides(deck, project, thumbMap);
        break;
      case 'videoPromptsAndVideo':
        await writeVideoPromptsSlides(deck, project, thumbMap);
        break;
      case 'voScript':
        writeVoScriptSlides(deck, project);
        break;
      case 'shootPlan':
        writeShootPlanSlides(deck, project);
        break;
    }
  }

  return {
    filename: `${slug}-presentation-slideshow-16x9.pdf`,
    blob: deck.toBlob(),
  };
}

export async function downloadMasterSlideshowPdf(
  project: PipelineProject,
  sections: MasterPdfSectionId[]
): Promise<DriveSaveResult> {
  if (sections.length === 0) {
    return { attempted: false, success: false };
  }
  const { filename, blob } = await buildMasterSlideshowPdfBlob(project, sections);
  triggerBlobDownload(blob, filename);
  return await maybeAutoSavePdfToDrive(project, filename, blob);
}

export async function buildMasterCombinedPdfBlob(
  project: PipelineProject,
  sections: MasterPdfSectionId[],
  preloadedBrand?: BrandLogoAssets
): Promise<{ filename: string; blob: Blob }> {
  const slug = slugifyFilePart(`${project.client}-${project.product.name}`);
  const brand = preloadedBrand || (await load52LaunchBrandAssets());
  const writer = new PdfWriter('Master Production Book', project);
  const totalSec = project.shots.reduce((s, x) => s + (Number(x.durationSec) || 0), 0);
  writer.drawCoverHeader(
    `Master Production Book (${sections.length} deliverables)`,
    [
      `${project.shots.length} Shots · ${totalSec}s`,
      `${project.voScript.length} VO Lines`,
      new Date().toLocaleDateString(),
    ],
    brand.badgeBurgundy
  );

  writer.drawKpiRow([
    { label: 'Shots & Runtime', value: `${project.shots.length} Shots · ${totalSec}s`, accent: 'amber' },
    { label: 'VO Lines', value: `${project.voScript.length} Lines`, accent: 'indigo' },
    { label: 'Shoot Days', value: `${project.shootPlan?.shootDays.length ?? 0} Day(s)`, accent: 'emerald' },
    { label: 'Included Sections', value: `${sections.length} Deliverables`, accent: 'slate' },
  ]);

  if (project.product.description) {
    writer.drawCalloutCard({
      title: 'Product Overview',
      tone: 'neutral',
      bodyLines: [{ text: project.product.description }],
    });
  }

  writer.addSubHeading('Included Production Packet Contents');
  writer.drawTable(
    [
      { label: '#', width: 12, align: 'center' },
      { label: 'Deliverable Section', width: 64 },
      { label: 'Summary Status', width: 106 },
    ],
    sections.map((id, idx) => {
      const meta = MASTER_PDF_SECTIONS.find((m) => m.id === id);
      return [
        String(idx + 1).padStart(2, '0'),
        meta?.label || id,
        meta ? meta.getStatus(project).detail : '',
      ];
    })
  );

  for (let i = 0; i < sections.length; i++) {
    writer.newPage();
    await writeSectionById(writer, project, sections[i]);
  }

  return {
    filename: `${slug}-master-production-book.pdf`,
    blob: writer.toBlob(),
  };
}

export async function buildSingleSectionPdfBlob(
  project: PipelineProject,
  sectionId: MasterPdfSectionId,
  preloadedBrand?: BrandLogoAssets
): Promise<{ filename: string; blob: Blob }> {
  const slug = slugifyFilePart(`${project.client}-${project.product.name}`);
  const brand = preloadedBrand || (await load52LaunchBrandAssets());
  const meta = MASTER_PDF_SECTIONS.find((m) => m.id === sectionId);
  const writer = new PdfWriter(meta?.label || sectionId, project);
  writer.drawCoverHeader(
    meta?.label || sectionId,
    [
      new Date().toLocaleDateString(),
      `${project.shots.length} Shots`,
    ],
    brand.badgeBurgundy
  );
  await writeSectionById(writer, project, sectionId);
  return {
    filename: `${slug}-${meta?.filenameSuffix || sectionId}.pdf`,
    blob: writer.toBlob(),
  };
}

export async function downloadMasterPdf(
  project: PipelineProject,
  sections: MasterPdfSectionId[],
  mode: 'combined' | 'individual' | 'slideshow'
): Promise<MasterPdfExportResult> {
  if (sections.length === 0) {
    return {
      downloadedFiles: [],
      driveStatus: { status: 'skipped', message: '' },
    };
  }

  if (mode === 'slideshow') {
    const filename = `${slugifyFilePart(`${project.client}-${project.product.name}`)}-presentation-slideshow-16x9.pdf`;
    const driveSave = await downloadMasterSlideshowPdf(project, sections);
    return {
      downloadedFiles: [filename],
      driveStatus: summarizeDriveStatus([driveSave]),
    };
  }

  const brand = await load52LaunchBrandAssets();

  if (mode === 'combined') {
    const { filename, blob } = await buildMasterCombinedPdfBlob(project, sections, brand);
    triggerBlobDownload(blob, filename);
    const driveSave = await maybeAutoSavePdfToDrive(project, filename, blob);
    return {
      downloadedFiles: [filename],
      driveStatus: summarizeDriveStatus([driveSave]),
    };
  }

  const driveResults: DriveSaveResult[] = [];
  const downloadedFiles: string[] = [];

  for (let i = 0; i < sections.length; i++) {
    const sectionId = sections[i];
    const { filename, blob } = await buildSingleSectionPdfBlob(project, sectionId, brand);
    triggerBlobDownload(blob, filename);
    const driveSave = await maybeAutoSavePdfToDrive(project, filename, blob);
    driveResults.push(driveSave);
    downloadedFiles.push(filename);
    if (i < sections.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 260));
    }
  }

  return {
    downloadedFiles,
    driveStatus: summarizeDriveStatus(driveResults),
  };
}

/**
 * Generates and uploads the exact same richly formatted client PDF deliverables
 * (individual sections + Master Book + 16:9 Slideshow) directly to Google Drive,
 * ensuring Google Drive files match local computer PDFs identically.
 */
export async function syncAllFormattedPdfsToDrive(
  project: PipelineProject,
  options?: {
    accessToken?: string;
    onProgress?: (label: string) => void;
  }
): Promise<{
  uploadedFiles: string[];
  backupFolderId?: string;
  backupFolderUrl?: string;
  errors: string[];
}> {
  const token = options?.accessToken || (await getGoogleDriveAccessToken());
  if (!token) {
    throw new Error('Google Drive is not connected or your Drive session expired.');
  }

  const brand = await load52LaunchBrandAssets();
  const readySections: MasterPdfSectionId[] = [];
  if (project.brandBible?.hasGenerated || project.brandBible?.positioning) {
    readySections.push('brandBible');
  }
  if (project.creativeBrief?.hasGenerated || project.creativeBrief?.objective) {
    readySections.push('creativeBrief');
  }
  if ((project.shots || []).length > 0) {
    readySections.push('shotListAndStoryboard');
  }
  if ((project.shots || []).some((s) => Boolean(s.frameCheck))) {
    readySections.push('frameSuggestions');
  }
  if ((project.shots || []).some((s) => s.route !== 'live')) {
    readySections.push('videoPromptsAndVideo');
  }
  if ((project.voScript || []).length > 0) {
    readySections.push('voScript');
  }
  if (project.shootPlan?.hasGenerated && (project.shootPlan.shootDays || []).length > 0) {
    readySections.push('shootPlan');
  }

  const tasks: Array<{
    label: string;
    build: () => Promise<{ filename: string; blob: Blob }>;
  }> = [];

  for (const secId of readySections) {
    const meta = MASTER_PDF_SECTIONS.find((m) => m.id === secId);
    tasks.push({
      label: meta?.label || secId,
      build: () => buildSingleSectionPdfBlob(project, secId, brand),
    });
  }

  if ((project.shots || []).length > 0) {
    tasks.push({
      label: 'Printable Storyboard',
      build: () => buildStoryboardPdfBlob(project, brand),
    });
  }

  if (project.shootPlan?.hasGenerated && (project.shootPlan.shootDays || []).length > 0) {
    tasks.push({
      label: 'Call Sheet',
      build: () => buildCallSheetPdfBlob(project, project.shootPlan, brand),
    });
  }

  const bookSections =
    readySections.length > 0 ? readySections : MASTER_PDF_SECTIONS.map((s) => s.id);
  tasks.push({
    label: 'Master Production Book',
    build: () => buildMasterCombinedPdfBlob(project, bookSections, brand),
  });
  tasks.push({
    label: '16:9 Presentation Slideshow',
    build: () => buildMasterSlideshowPdfBlob(project, bookSections, brand),
  });

  const uploadedFiles: string[] = [];
  const errors: string[] = [];
  let backupFolderId: string | undefined;
  let backupFolderUrl: string | undefined;

  for (const task of tasks) {
    try {
      options?.onProgress?.(`Formatting & uploading ${task.label} PDF...`);
      const { filename, blob } = await task.build();
      const uploaded = await uploadPdfToDriveServer({
        projectId: project.id,
        filename,
        pdfBlob: blob,
        destinationFolderId:
          project.googleDriveDestinationFolderId || project.googleDriveBackupFolderId,
        destinationFolderUrl:
          project.googleDriveDestinationFolderUrl || project.googleDriveBackupFolderUrl,
        accessToken: token,
      });
      uploadedFiles.push(uploaded.filename || filename);
      if (uploaded.backupFolderId) backupFolderId = uploaded.backupFolderId;
      if (uploaded.backupFolderUrl) backupFolderUrl = uploaded.backupFolderUrl;
    } catch (err) {
      errors.push(
        `${task.label}: ${err instanceof Error ? err.message : 'Upload failed'}`
      );
    }
  }

  return { uploadedFiles, backupFolderId, backupFolderUrl, errors };
}
