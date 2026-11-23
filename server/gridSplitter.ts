import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { GridQuadrantKey, GridSplitClip } from '../src/types/pipeline.ts';
import { getProjectAssetsDir } from './projectStore.ts';

const execFileAsync = promisify(execFile);

interface QuadrantCropSpec {
  quadrant: GridQuadrantKey;
  label: string;
  xExpr: (w: number, halfW: number) => number;
  yExpr: (h: number, halfH: number) => number;
}

const QUADRANT_SPECS: QuadrantCropSpec[] = [
  {
    quadrant: 'top_left',
    label: 'Top-Left',
    xExpr: () => 0,
    yExpr: () => 0,
  },
  {
    quadrant: 'top_right',
    label: 'Top-Right',
    xExpr: (w, halfW) => Math.max(0, w - halfW),
    yExpr: () => 0,
  },
  {
    quadrant: 'bottom_left',
    label: 'Bottom-Left',
    xExpr: () => 0,
    yExpr: (h, halfH) => Math.max(0, h - halfH),
  },
  {
    quadrant: 'bottom_right',
    label: 'Bottom-Right',
    xExpr: (w, halfW) => Math.max(0, w - halfW),
    yExpr: (h, halfH) => Math.max(0, h - halfH),
  },
];

function sanitizeIdForPath(raw: string): string {
  return (
    raw
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || `proj-${Date.now()}`
  );
}

export async function probeVideoMetadata(inputPath: string): Promise<{
  width: number;
  height: number;
  hasAudio: boolean;
}> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,width,height',
    '-of',
    'json',
    inputPath,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
    }>;
  };
  const streams = parsed.streams || [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  if (!videoStream || !videoStream.width || !videoStream.height) {
    throw new Error('Could not read video dimensions for 2x2 grid splitting.');
  }
  const hasAudio = streams.some((s) => s.codec_type === 'audio');
  return {
    width: Number(videoStream.width),
    height: Number(videoStream.height),
    hasAudio,
  };
}

async function resolveInputVideoToDisk(
  projectId: string,
  videoUrl: string
): Promise<{ inputPath: string; cleanupTempPath: string | null }> {
  const safeProjectId = sanitizeIdForPath(projectId);
  const expectedPrefix = `/api/projects/${safeProjectId}/assets/`;

  if (videoUrl.startsWith(expectedPrefix)) {
    const filename = path.basename(videoUrl);
    const localPath = path.join(getProjectAssetsDir(projectId), filename);
    await fs.access(localPath);
    return { inputPath: localPath, cleanupTempPath: null };
  }

  // Fallback for any /api/projects/:otherId/assets/:filename local path
  if (videoUrl.startsWith('/api/projects/') && videoUrl.includes('/assets/')) {
    const match = videoUrl.match(/^\/api\/projects\/([^/]+)\/assets\/([^/?#]+)/);
    if (match) {
      const localPath = path.join(
        getProjectAssetsDir(match[1]),
        path.basename(match[2])
      );
      await fs.access(localPath);
      return { inputPath: localPath, cleanupTempPath: null };
    }
  }

  if (videoUrl.startsWith('data:')) {
    const match = videoUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error('Invalid video data URL.');
    }
    const tmpPath = path.join(
      os.tmpdir(),
      `grid-split-src-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.mp4`
    );
    await fs.writeFile(tmpPath, Buffer.from(match[2], 'base64'));
    return { inputPath: tmpPath, cleanupTempPath: tmpPath };
  }

  if (/^https?:\/\//i.test(videoUrl)) {
    const resp = await fetch(videoUrl);
    if (!resp.ok) {
      throw new Error(`Could not download source video for splitting (${resp.status}).`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const tmpPath = path.join(
      os.tmpdir(),
      `grid-split-src-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.mp4`
    );
    await fs.writeFile(tmpPath, buf);
    return { inputPath: tmpPath, cleanupTempPath: tmpPath };
  }

  throw new Error('Unsupported source video path for 2x2 grid splitting.');
}

export async function splitGridVideoIntoQuadrants(params: {
  projectId: string;
  shotId: string;
  videoUrl: string;
}): Promise<{
  splitClips: GridSplitClip[];
  sourceWidth: number;
  sourceHeight: number;
  quadrantWidth: number;
  quadrantHeight: number;
}> {
  const safeProjectId = sanitizeIdForPath(params.projectId);
  const assetsDir = getProjectAssetsDir(params.projectId);
  await fs.mkdir(assetsDir, { recursive: true });

  const { inputPath, cleanupTempPath } = await resolveInputVideoToDisk(
    params.projectId,
    params.videoUrl
  );

  try {
    const meta = await probeVideoMetadata(inputPath);
    // Guarantee even pixel dimensions per quadrant for strict libx264 yuv420p encoding
    const halfW = Math.max(2, Math.floor(meta.width / 4) * 2);
    const halfH = Math.max(2, Math.floor(meta.height / 4) * 2);
    const safeShot = params.shotId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'shot';
    const stamp = Date.now();
    const rand = Math.random().toString(36).slice(2, 6);
    const createdAt = new Date().toISOString();

    const splitClips: GridSplitClip[] = [];

    for (const spec of QUADRANT_SPECS) {
      const x = spec.xExpr(meta.width, halfW);
      const y = spec.yExpr(meta.height, halfH);
      const filename = `grid-${safeShot}-${spec.quadrant}-${stamp}-${rand}.mp4`;
      const outputPath = path.join(assetsDir, filename);

      const args = [
        '-y',
        '-i',
        inputPath,
        '-vf',
        `crop=${halfW}:${halfH}:${x}:${y},setsar=1`,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '18',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        ...(meta.hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
        outputPath,
      ];

      await execFileAsync('ffmpeg', args, { maxBuffer: 16 * 1024 * 1024 });

      splitClips.push({
        quadrant: spec.quadrant,
        label: spec.label,
        videoUrl: `/api/projects/${safeProjectId}/assets/${filename}`,
        upscaledVideoUrl: null,
        upscaledResolution: null,
        upscaleDetails: null,
        createdAt,
      });
    }

    return {
      splitClips,
      sourceWidth: meta.width,
      sourceHeight: meta.height,
      quadrantWidth: halfW,
      quadrantHeight: halfH,
    };
  } finally {
    if (cleanupTempPath) {
      await fs.rm(cleanupTempPath, { force: true }).catch(() => {});
    }
  }
}
