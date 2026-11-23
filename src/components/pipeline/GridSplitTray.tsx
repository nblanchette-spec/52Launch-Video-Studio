import React, { useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  Download,
  Grid2x2,
  Loader2,
  Scissors,
  Sliders,
} from 'lucide-react';
import type {
  GridQuadrantKey,
  GridSplitClip,
  PipelineProject,
} from '../../types/pipeline';
import { parseJsonResponse } from '../../utils/safeFetch';
import {
  TOPAZ_UPSCALE_MODES,
  type TopazUpscaleMode,
} from '../../utils/videoStudioCatalog';

interface GridSplitTrayProps {
  projectId: string;
  shotId: string;
  clipId?: string | null;
  sourceVideoUrl: string | null;
  isGridMode?: boolean;
  splitClips?: GridSplitClip[];
  compact?: boolean;
  onProjectUpdated: (updated: PipelineProject) => void;
}

export const GridSplitTray: React.FC<GridSplitTrayProps> = ({
  projectId,
  shotId,
  clipId,
  sourceVideoUrl,
  isGridMode,
  splitClips,
  compact = false,
  onProjectUpdated,
}) => {
  const [isSplitting, setIsSplitting] = useState(false);
  const [isBatchUpscaling, setIsBatchUpscaling] = useState(false);
  const [upscalingQuadrant, setUpscalingQuadrant] =
    useState<GridQuadrantKey | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    label: string;
  } | null>(null);

  const [topazMode, setTopazMode] = useState<TopazUpscaleMode>('precision');
  const [topazSubModel, setTopazSubModel] = useState<string>(
    TOPAZ_UPSCALE_MODES.precision.defaultModel
  );
  const [scaleFactor, setScaleFactor] = useState<2 | 4>(2);
  const [creativity, setCreativity] = useState<number>(0.5);
  const [showTopazSettings, setShowTopazSettings] = useState(false);
  const [previewByQuadrant, setPreviewByQuadrant] = useState<
    Partial<Record<GridQuadrantKey, 'original' | 'upscaled'>>
  >({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasSplitClips = Array.isArray(splitClips) && splitClips.length > 0;
  if (!sourceVideoUrl && !hasSplitClips) return null;

  const activeModeSpec = TOPAZ_UPSCALE_MODES[topazMode];

  const handleModeChange = (nextMode: TopazUpscaleMode) => {
    setTopazMode(nextMode);
    setTopazSubModel(TOPAZ_UPSCALE_MODES[nextMode].defaultModel);
  };

  const handleSplitInto4 = async () => {
    if (!sourceVideoUrl) return;
    setErrorMsg(null);
    setIsSplitting(true);
    try {
      const resp = await fetch('/api/pipeline/studio-split-grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          shotId,
          clipId: clipId || undefined,
          videoUrl: sourceVideoUrl,
        }),
      });
      const data = await parseJsonResponse<{
        project: PipelineProject;
        splitClips: GridSplitClip[];
      }>(resp, 'Could not split 2x2 grid video into 4 clips.');
      onProjectUpdated(data.project);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Could not split 2x2 grid video into 4 clips.'
      );
    } finally {
      setIsSplitting(false);
    }
  };

  const upscaleQuadrantClip = async (clip: GridSplitClip) => {
    const resp = await fetch('/api/pipeline/studio-upscale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        shotId,
        clipId: clipId || undefined,
        quadrant: clip.quadrant,
        videoUrl: clip.videoUrl,
        label: `${shotId} · ${clip.label}`,
        mode: topazMode,
        subModel: topazSubModel,
        scaleFactor,
        creativity,
      }),
    });
    const data = await parseJsonResponse<{ project: PipelineProject }>(
      resp,
      `Topaz upscale failed on ${clip.label}.`
    );
    onProjectUpdated(data.project);
    setPreviewByQuadrant((prev) => ({ ...prev, [clip.quadrant]: 'upscaled' }));
  };

  const handleUpscaleSingle = async (clip: GridSplitClip) => {
    setErrorMsg(null);
    setUpscalingQuadrant(clip.quadrant);
    try {
      await upscaleQuadrantClip(clip);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : `Topaz upscale failed for ${clip.label}.`
      );
    } finally {
      setUpscalingQuadrant(null);
    }
  };

  const handleBatchUpscaleAll4 = async () => {
    if (!splitClips || splitClips.length === 0) return;
    setErrorMsg(null);
    setIsBatchUpscaling(true);
    try {
      for (let i = 0; i < splitClips.length; i++) {
        const clip = splitClips[i];
        setUpscalingQuadrant(clip.quadrant);
        setBatchProgress({
          current: i + 1,
          total: splitClips.length,
          label: clip.label,
        });
        await upscaleQuadrantClip(clip);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Batch Topaz upscale interrupted. Completed clips are saved.'
      );
    } finally {
      setUpscalingQuadrant(null);
      setBatchProgress(null);
      setIsBatchUpscaling(false);
    }
  };

  const upscaledCount = (splitClips || []).filter((c) =>
    Boolean(c.upscaledVideoUrl)
  ).length;
  const busy = isSplitting || isBatchUpscaling || Boolean(upscalingQuadrant);

  return (
    <div className="rounded-xl bg-white border border-[#E2E2E6] overflow-hidden text-xs">
      {/* Header Bar */}
      <div className="px-3.5 py-2.5 bg-[#FBFBFC] border-b border-[#E2E2E6] flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Grid2x2 className="w-4 h-4 text-[#C6202F] shrink-0" />
          <span className="font-semibold text-[#111114]">
            2x2 4-Shot Splitter &amp; Topaz Pipeline
          </span>
          {isGridMode && (
            <span className="px-2 py-0.5 rounded bg-[#FDF2F3] border border-[#EABAC0] text-[#891A23] font-mono text-[10px] font-semibold">
              Grid Clip
            </span>
          )}
          {hasSplitClips && (
            <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-800 font-mono text-[10px] font-semibold tabular-nums">
              4 Shots Ready
              {upscaledCount > 0 ? ` · ${upscaledCount}/4 Upscaled` : ''}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {hasSplitClips && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowTopazSettings((v) => !v)}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                  showTopazSettings
                    ? 'bg-[#111114] text-white border-[#111114]'
                    : 'bg-white text-[#3A3A44] border-[#E2E2E6] hover:border-[#891A23]'
                }`}
              >
                <Sliders className="w-3 h-3" />
                Topaz: {activeModeSpec.shortLabel} ({topazSubModel}) · {scaleFactor}x
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleBatchUpscaleAll4()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#15803D] hover:bg-[#166534] disabled:opacity-45 text-white text-[11px] font-semibold whitespace-nowrap cursor-pointer"
              >
                {isBatchUpscaling ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Upscaling {batchProgress?.current}/{batchProgress?.total} (
                    {batchProgress?.label})...
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    Send All 4 to Topaz ({scaleFactor}x)
                  </>
                )}
              </button>
            </>
          )}

          {sourceVideoUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSplitInto4()}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap cursor-pointer disabled:opacity-45 ${
                hasSplitClips
                  ? 'bg-[#F6F6F7] hover:bg-[#EAEAEF] text-[#24242B] border border-[#D8D8DF]'
                  : 'bg-[#C6202F] hover:bg-[#AD1A27] text-white'
              }`}
            >
              {isSplitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Splitting into 4 MP4s...
                </>
              ) : (
                <>
                  <Scissors className="w-3.5 h-3.5" />
                  {hasSplitClips ? 'Re-split 4 Shots' : 'Split into 4 Shots'}
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Inline Topaz Batch Settings Drawer */}
      {hasSplitClips && showTopazSettings && (
        <div className="p-3 bg-[#F6F6F7] border-b border-[#E2E2E6] grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5A5A66] block">
              Topaz Mode
            </label>
            <select
              value={topazMode}
              disabled={busy}
              onChange={(e) => handleModeChange(e.target.value as TopazUpscaleMode)}
              className="w-full bg-white border border-[#D8D8DF] rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#111114]"
            >
              {(Object.keys(TOPAZ_UPSCALE_MODES) as TopazUpscaleMode[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {TOPAZ_UPSCALE_MODES[key].shortLabel}
                  </option>
                )
              )}
            </select>
          </div>

          {topazMode === 'creative' ? (
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-semibold uppercase tracking-wider text-[#5A5A66]">
                <span>Astra 2 Creativity</span>
                <span className="font-mono text-[#891A23] tabular-nums">
                  {creativity.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={creativity}
                disabled={busy}
                onChange={(e) => setCreativity(Number(e.target.value))}
                className="w-full accent-[#C6202F] mt-1.5 cursor-pointer"
              />
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5A5A66] block">
                Topaz Engine
              </label>
              <select
                value={topazSubModel}
                disabled={busy}
                onChange={(e) => setTopazSubModel(e.target.value)}
                className="w-full bg-white border border-[#D8D8DF] rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#111114]"
              >
                {activeModeSpec.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5A5A66] block">
              Upscale Factor (H.264 · FPS Locked)
            </label>
            <div className="grid grid-cols-2 gap-1 p-0.5 bg-white border border-[#D8D8DF] rounded-lg">
              {([2, 4] as const).map((factor) => (
                <button
                  key={factor}
                  type="button"
                  disabled={busy}
                  onClick={() => setScaleFactor(factor)}
                  className={`py-1 rounded font-mono font-semibold cursor-pointer ${
                    scaleFactor === factor
                      ? 'bg-[#111114] text-white'
                      : 'text-[#5A5A66] hover:text-[#111114]'
                  }`}
                >
                  {factor}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="px-3.5 py-2 bg-rose-50 border-b border-rose-200 text-xs text-[#891A23]">
          {errorMsg}
        </div>
      )}

      {/* 4 Extracted Quadrant Clips Grid */}
      {hasSplitClips ? (
        <div
          className={`p-3 grid grid-cols-1 ${
            compact ? 'md:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-2'
          } gap-3`}
        >
          {splitClips!.map((clip) => {
            const hasUpscaled = Boolean(clip.upscaledVideoUrl);
            const activeView =
              hasUpscaled &&
              (previewByQuadrant[clip.quadrant] ?? 'upscaled') === 'upscaled'
                ? 'upscaled'
                : 'original';
            const displayUrl =
              activeView === 'upscaled' && clip.upscaledVideoUrl
                ? clip.upscaledVideoUrl
                : clip.videoUrl;
            const isUpscalingThis = upscalingQuadrant === clip.quadrant;

            return (
              <div
                key={clip.quadrant}
                className={`rounded-xl border overflow-hidden flex flex-col bg-[#F6F6F7] ${
                  hasUpscaled ? 'border-emerald-300' : 'border-[#E2E2E6]'
                }`}
              >
                <div className="aspect-video bg-black relative">
                  <video
                    key={displayUrl}
                    src={displayUrl}
                    controls
                    playsInline
                    className="w-full h-full object-contain"
                  />
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/80 border border-white/15 text-[10px] font-mono font-semibold text-white">
                    {clip.label}
                  </span>
                  {hasUpscaled && (
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 p-0.5 rounded bg-black/80 border border-white/15 text-[9px]">
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewByQuadrant((prev) => ({
                            ...prev,
                            [clip.quadrant]: 'original',
                          }))
                        }
                        className={`px-1.5 py-0.5 rounded cursor-pointer ${
                          activeView === 'original'
                            ? 'bg-[#C6202F] text-white font-semibold'
                            : 'text-white/75 hover:text-white'
                        }`}
                      >
                        Split
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPreviewByQuadrant((prev) => ({
                            ...prev,
                            [clip.quadrant]: 'upscaled',
                          }))
                        }
                        className={`px-1.5 py-0.5 rounded cursor-pointer ${
                          activeView === 'upscaled'
                            ? 'bg-[#15803D] text-white font-semibold'
                            : 'text-white/75 hover:text-white'
                        }`}
                      >
                        Topaz
                      </button>
                    </div>
                  )}
                  {isUpscalingThis && (
                    <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center text-white text-[11px] gap-1.5">
                      <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
                      <span>Upscaling {clip.label} ({scaleFactor}x)...</span>
                    </div>
                  )}
                </div>

                <div className="p-2.5 flex items-center justify-between gap-2 bg-white border-t border-[#E2E2E6]">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#111114] text-[11px] flex items-center gap-1">
                      {hasUpscaled && (
                        <CheckCircle2 className="w-3 h-3 text-emerald-700 shrink-0" />
                      )}
                      <span className="truncate">{clip.label}</span>
                    </div>
                    <div className="text-[10px] font-mono text-[#5A5A66] truncate">
                      {hasUpscaled
                        ? `${clip.upscaledResolution || 'Topaz'} · ${
                            clip.upscaleDetails?.subModel || 'Topaz'
                          }`
                        : 'Cropped 16:9 H.264'}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleUpscaleSingle(clip)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#FDF4F5] hover:bg-[#891A23] text-[#891A23] hover:text-white border border-[#EABAC0] text-[10px] font-semibold whitespace-nowrap cursor-pointer disabled:opacity-40 transition-colors"
                      title={`Send ${clip.label} to Topaz ${scaleFactor}x`}
                    >
                      <ArrowUpRight className="w-3 h-3" />
                      {hasUpscaled ? 'Re-upscale' : 'Topaz'}
                    </button>

                    <a
                      href={displayUrl}
                      download={`${projectId}-${shotId}-${clip.quadrant}${
                        activeView === 'upscaled' && clip.upscaledVideoUrl
                          ? '-topaz'
                          : ''
                      }.mp4`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#F6F6F7] hover:bg-[#E2E2E6] text-[#111114] border border-[#D8D8DF] text-[10px] font-medium whitespace-nowrap"
                      title={`Download ${clip.label} MP4`}
                    >
                      <Download className="w-3 h-3" />
                      MP4
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-3.5 py-2.5 text-[11px] text-[#5A5A66] bg-[#FBFBFC]">
          Crop this 2x2 grid video into 4 separate 16:9 clips (Top-Left, Top-Right,
          Bottom-Left, Bottom-Right) and batch-send all 4 directly into the Topaz
          upscale pipeline.
        </div>
      )}
    </div>
  );
};
