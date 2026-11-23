import type { GridQuadrantKey } from '../types/pipeline.ts';
import {
  getStudioAvailableResolutions,
  type StudioModelId,
  type StudioResolution,
  type StudioWorkflowMode,
} from './videoStudioCatalog.ts';

export interface GridQuadrantMeta {
  key: GridQuadrantKey;
  index: number;
  label: string;
  shortLabel: string;
  col: 0 | 1;
  row: 0 | 1;
}

export const GRID_QUADRANTS: readonly GridQuadrantMeta[] = [
  {
    key: 'top_left',
    index: 0,
    label: 'Top-Left',
    shortLabel: 'TL · Shot 1',
    col: 0,
    row: 0,
  },
  {
    key: 'top_right',
    index: 1,
    label: 'Top-Right',
    shortLabel: 'TR · Shot 2',
    col: 1,
    row: 0,
  },
  {
    key: 'bottom_left',
    index: 2,
    label: 'Bottom-Left',
    shortLabel: 'BL · Shot 3',
    col: 0,
    row: 1,
  },
  {
    key: 'bottom_right',
    index: 3,
    label: 'Bottom-Right',
    shortLabel: 'BR · Shot 4',
    col: 1,
    row: 1,
  },
] as const;

export const GRID_LOCKED_MOTION_DIRECTIVE =
  '2x2 GRID LOCK: Animate all 4 quadrants simultaneously with independent motion inside each panel. Keep the 2x2 grid outer frame borders and vertical/horizontal center divider lines strictly locked, rigid, straight, and pixel-aligned for the entire video—zero crossing, zero drifting borders, and zero bleed between quadrants.';

export function hasGridBorderLockDirective(prompt: string): boolean {
  const normalized = prompt.toLowerCase();
  return (
    normalized.includes('2x2 grid lock') ||
    (normalized.includes('4 quadrants simultaneously') &&
      normalized.includes('divider'))
  );
}

export function appendGridBorderLockDirective(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return GRID_LOCKED_MOTION_DIRECTIVE;
  if (hasGridBorderLockDirective(trimmed)) return trimmed;
  return `${trimmed}\n\n${GRID_LOCKED_MOTION_DIRECTIVE}`;
}

export function format2x2GridPrompt(params: {
  quadrantPrompts: [string, string, string, string];
  sharedDirection?: string;
  hasStitchedImage?: boolean;
}): string {
  const descriptions = GRID_QUADRANTS.map((q, idx) => {
    const raw = (params.quadrantPrompts[idx] || '').trim();
    const fallback = params.hasStitchedImage
      ? `Animate the ${q.label} panel smoothly with subtle realistic motion matching its still frame`
      : `Cinematic shot cleanly framed inside the ${q.label} panel`;
    return `- ${q.label}: ${raw || fallback}`;
  });

  const sections = [
    '2x2 Multi-Shot Split-Screen Storyboard Grid (16:9 widescreen, 4 independent equal 16:9 panels arranged in a 2x2 grid with crisp locked divider borders):',
    descriptions.join('\n'),
  ];

  const extra = (params.sharedDirection || '').trim();
  if (extra) {
    sections.push(`Global Direction & Continuity: ${extra}`);
  }

  sections.push(GRID_LOCKED_MOTION_DIRECTIVE);
  return sections.join('\n\n');
}

/**
 * Resolves valid >=1080p resolutions when 2x2 Grid Multi-Shot Mode is active.
 * Upgrades seedance-2.0 (720p cap) -> seedance-2.5 (1080p) and returns 1080p/4K options.
 */
export function resolveGridModeConfig(params: {
  modelId: StudioModelId;
  workflowMode: StudioWorkflowMode;
  requestedResolution?: StudioResolution;
}): {
  modelId: StudioModelId;
  upgradedFromModel: StudioModelId | null;
  allowedResolutions: StudioResolution[];
  resolvedResolution: StudioResolution;
} {
  let effectiveModelId = params.modelId;
  let upgradedFromModel: StudioModelId | null = null;

  if (effectiveModelId === 'seedance-2.0') {
    effectiveModelId = 'seedance-2.5';
    upgradedFromModel = 'seedance-2.0';
  }

  const modelRes = getStudioAvailableResolutions(effectiveModelId, params.workflowMode);
  const highResOptions = modelRes.filter(
    (r) => r === '1080p' || r === '1440p' || r === '2160p'
  );
  const allowedResolutions: StudioResolution[] =
    highResOptions.length > 0 ? highResOptions : ['1080p'];

  let resolvedResolution: StudioResolution = '1080p';
  if (
    params.requestedResolution &&
    allowedResolutions.includes(params.requestedResolution)
  ) {
    resolvedResolution = params.requestedResolution;
  } else if (allowedResolutions.includes('1080p')) {
    resolvedResolution = '1080p';
  } else {
    resolvedResolution = allowedResolutions[allowedResolutions.length - 1];
  }

  return {
    modelId: effectiveModelId,
    upgradedFromModel,
    allowedResolutions,
    resolvedResolution,
  };
}

function loadImageForCanvas(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const attemptLoad = (url: string, withCors: boolean) => {
      const img = new Image();
      if (withCors && !url.startsWith('data:') && !url.startsWith('blob:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => resolve(img);
      img.onerror = async () => {
        if (withCors && /^https?:\/\//i.test(url)) {
          try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('Image fetch failed');
            const blob = await resp.blob();
            const objUrl = URL.createObjectURL(blob);
            const fallbackImg = new Image();
            fallbackImg.onload = () => {
              URL.revokeObjectURL(objUrl);
              resolve(fallbackImg);
            };
            fallbackImg.onerror = () => {
              URL.revokeObjectURL(objUrl);
              reject(new Error('Could not decode quadrant image.'));
            };
            fallbackImg.src = objUrl;
            return;
          } catch {
            // Fall through
          }
        }
        reject(new Error('Could not load quadrant image.'));
      };
      img.src = url;
    };

    attemptLoad(src, !src.startsWith('data:') && !src.startsWith('blob:'));
  });
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
) {
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  if (!sw || !sh) return;

  const targetRatio = dw / dh;
  const srcRatio = sw / sh;
  let cropW = sw;
  let cropH = sh;
  let sx = 0;
  let sy = 0;

  if (srcRatio > targetRatio) {
    cropW = sh * targetRatio;
    sx = (sw - cropW) / 2;
  } else if (srcRatio < targetRatio) {
    cropH = sw / targetRatio;
    sy = (sh - cropH) / 2;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.drawImage(img, sx, sy, cropW, cropH, dx, dy, dw, dh);
  ctx.restore();
}

/**
 * Stitches up to 4 still frames (Top-Left, Top-Right, Bottom-Left, Bottom-Right)
 * into a crisp 1920x1080 16:9 PNG data URL with locked 2px hairline grid dividers.
 */
export async function stitch2x2GridCanvas(
  frames: [string | null, string | null, string | null, string | null],
  options?: { width?: number; height?: number; dividerPx?: number }
): Promise<string> {
  const width = options?.width ?? 1920;
  const height = options?.height ?? 1080;
  const dividerPx = options?.dividerPx ?? 2;
  const halfDivider = dividerPx / 2;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize 2D canvas context for 2x2 stitching.');
  }

  ctx.fillStyle = '#111114';
  ctx.fillRect(0, 0, width, height);

  const cellW = Math.floor(width / 2 - halfDivider);
  const cellH = Math.floor(height / 2 - halfDivider);
  const rightX = width - cellW;
  const bottomY = height - cellH;

  const coords: Array<{ x: number; y: number; w: number; h: number }> = [
    { x: 0, y: 0, w: cellW, h: cellH },
    { x: rightX, y: 0, w: cellW, h: cellH },
    { x: 0, y: bottomY, w: cellW, h: cellH },
    { x: rightX, y: bottomY, w: cellW, h: cellH },
  ];

  const loaded = await Promise.all(
    frames.map(async (src) => {
      if (!src || !src.trim()) return null;
      try {
        return await loadImageForCanvas(src);
      } catch {
        return null;
      }
    })
  );

  loaded.forEach((img, idx) => {
    const box = coords[idx];
    if (img) {
      drawCoverImage(ctx, img, box.x, box.y, box.w, box.h);
    } else {
      ctx.fillStyle = '#1B1B20';
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeStyle = '#2C2C34';
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x + 8, box.y + 8, box.w - 16, box.h - 16);
      ctx.fillStyle = '#7C7C88';
      ctx.font = '600 24px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `${GRID_QUADRANTS[idx].label.toUpperCase()} EMPTY`,
        box.x + box.w / 2,
        box.y + box.h / 2
      );
    }
  });

  // Draw solid center divider crosshair so quadrants remain visibly separated
  ctx.fillStyle = '#111114';
  ctx.fillRect(cellW, 0, width - cellW * 2, height);
  ctx.fillRect(0, cellH, width, height - cellH * 2);

  return canvas.toDataURL('image/png');
}
