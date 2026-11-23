import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  appendGridBorderLockDirective,
  format2x2GridPrompt,
  GRID_LOCKED_MOTION_DIRECTIVE,
  resolveGridModeConfig,
} from '../src/utils/gridModeUtils.ts';
import {
  probeVideoMetadata,
  splitGridVideoIntoQuadrants,
} from '../server/gridSplitter.ts';

const execFileAsync = promisify(execFile);

console.log('1. Testing format2x2GridPrompt & border-lock directive...');
const formatted = format2x2GridPrompt({
  quadrantPrompts: [
    'Macro dolly on brushed aluminum patch',
    'Runner sprinting past stadium stairs',
    'Sweat droplets on forearm in dawn sunlight',
    'Wide sunrise silhouette on Lane 1',
  ],
  hasStitchedImage: true,
});
assert(formatted.includes('Top-Left: Macro dolly on brushed aluminum patch'));
assert(formatted.includes('Top-Right: Runner sprinting past stadium stairs'));
assert(formatted.includes('Bottom-Left: Sweat droplets on forearm in dawn sunlight'));
assert(formatted.includes('Bottom-Right: Wide sunrise silhouette on Lane 1'));
assert(formatted.includes('2x2 GRID LOCK'));
assert.equal(appendGridBorderLockDirective(formatted), formatted);

console.log('2. Testing resolveGridModeConfig (>=1080p & 4K model rules)...');
const seedanceUpgrade = resolveGridModeConfig({
  modelId: 'seedance-2.0',
  workflowMode: 'image_to_video',
  requestedResolution: '480p',
});
assert.equal(seedanceUpgrade.modelId, 'seedance-2.5');
assert.equal(seedanceUpgrade.upgradedFromModel, 'seedance-2.0');
assert.equal(seedanceUpgrade.resolvedResolution, '1080p');

const flux4k = resolveGridModeConfig({
  modelId: 'flux-3',
  workflowMode: 'image_to_video',
  requestedResolution: '2160p',
});
assert.equal(flux4k.modelId, 'flux-3');
assert.equal(flux4k.resolvedResolution, '2160p');
assert(flux4k.allowedResolutions.includes('1080p'));
assert(flux4k.allowedResolutions.includes('2160p'));

const veo4k = resolveGridModeConfig({
  modelId: 'veo-3.1',
  workflowMode: 'text_to_video',
  requestedResolution: '720p',
});
assert.equal(veo4k.resolvedResolution, '1080p');
assert(veo4k.allowedResolutions.includes('2160p'));

const kling = resolveGridModeConfig({
  modelId: 'kling-4.0',
  workflowMode: 'image_to_video',
  requestedResolution: '720p',
});
assert.equal(kling.resolvedResolution, '1080p');
assert.deepEqual(kling.allowedResolutions, ['1080p']);

console.log('3. Testing FFmpeg 2x2 grid video splitting...');
const tempProjId = `test-grid-split-${Date.now()}`;
const tempVideoPath = path.join(os.tmpdir(), `synthetic-grid-${Date.now()}.mp4`);
const dataProjDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'), tempProjId);

try {
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc=size=640x360:rate=24:duration=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    tempVideoPath,
  ]);

  const rawBuf = await fs.readFile(tempVideoPath);
  const dataUrl = `data:video/mp4;base64,${rawBuf.toString('base64')}`;

  const split = await splitGridVideoIntoQuadrants({
    projectId: tempProjId,
    shotId: 'S01',
    videoUrl: dataUrl,
  });

  assert.equal(split.sourceWidth, 640);
  assert.equal(split.sourceHeight, 360);
  assert.equal(split.quadrantWidth, 320);
  assert.equal(split.quadrantHeight, 180);
  assert.equal(split.splitClips.length, 4);

  const expectedQuadrants = ['top_left', 'top_right', 'bottom_left', 'bottom_right'];
  for (let i = 0; i < 4; i++) {
    const item = split.splitClips[i];
    assert.equal(item.quadrant, expectedQuadrants[i]);
    const filename = path.basename(item.videoUrl);
    const outPath = path.join(dataProjDir, 'assets', filename);
    const meta = await probeVideoMetadata(outPath);
    assert.equal(meta.width, 320);
    assert.equal(meta.height, 180);
  }
  console.log('All 2x2 Grid Mode & FFmpeg 4-shot splitter tests passed!');
} finally {
  await fs.rm(tempVideoPath, { force: true }).catch(() => {});
  await fs.rm(dataProjDir, { recursive: true, force: true }).catch(() => {});
}
