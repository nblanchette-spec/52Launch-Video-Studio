import React, { useState, useRef } from 'react';
import {
  Sparkles,
  Loader2,
  Play,
  Copy,
  Check,
  Download,
  Film,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  UploadCloud,
  Eye,
  Grid2x2,
  Scissors,
  Plus,
  Trash2,
} from 'lucide-react';
import { PipelineProject, PipelineShot } from '../../types/pipeline';
import { VideoStudioModal } from './VideoStudioModal';
import { TopazUpscaleModal } from './TopazUpscaleModal';
import { GridSplitTray } from './GridSplitTray';
import { parseJsonResponse } from '../../utils/safeFetch';

interface Step7VideoStudioProps {
  project: PipelineProject;
  onUpdateProject: (updated: PipelineProject) => Promise<void>;
  onProjectUpdated: (updated: PipelineProject) => void;
  onGenerateVideoPrompts: (shotId?: string) => Promise<void>;
  onGenerateSingleVideo: (
    shotId: string,
    chainedLastFrameDataUrl?: string
  ) => Promise<void>;
  onApproveVideoStep: () => Promise<void>;
  onPreviewPdf?: () => void;
  onAddShot?: () => void;
  onDeleteShot?: (shotId: string) => void;
}

function formatShotModelLabel(model: PipelineShot['model']): string {
  switch (model) {
    case 'flux3':
      return 'FLUX 3';
    case 'veo':
      return 'Google Veo 3.1';
    case 'omni':
      return 'Gemini Omni Flash';
    case 'kling':
      return 'Kling 4.0';
    case 'wan':
      return 'Wan 3.0 Prime';
    case 'luma':
      return 'Luma Ray 3.2';
    default:
      return 'Seedance';
  }
}

/**
 * Extracts the last frame of a local/same-origin MP4 video element as a PNG data URL
 * so shots with `chainFrom` start seamlessly from the prior clip's final frame.
 */
async function extractLastFrameDataUrl(videoUrl: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.src = videoUrl;

    video.onloadedmetadata = () => {
      const targetTime = Math.max(0, (video.duration || 1) - 0.08);
      video.currentTime = targetTime;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(undefined);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(undefined);
      }
    };

    video.onerror = () => resolve(undefined);
  });
}

export const Step7VideoStudio: React.FC<Step7VideoStudioProps> = ({
  project,
  onUpdateProject,
  onProjectUpdated,
  onGenerateVideoPrompts,
  onGenerateSingleVideo,
  onApproveVideoStep,
  onPreviewPdf,
  onAddShot,
  onDeleteShot,
}) => {
  const [isWritingPrompts, setIsWritingPrompts] = useState(false);
  const [writingShotId, setWritingShotId] = useState<string | null>(null);
  const [generatingShotId, setGeneratingShotId] = useState<string | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [confirmBatchOpen, setConfirmBatchOpen] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [studioShotId, setStudioShotId] = useState<string | null>(null);
  const [studioChainedFrame, setStudioChainedFrame] = useState<string | undefined>(
    undefined
  );
  const [expandedSplitShotIds, setExpandedSplitShotIds] = useState<
    Record<string, boolean>
  >({});

  const startFrameInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Topaz Upscale modal state: `null` closed, `undefined` external upload, string = shot.id
  const [upscaleTarget, setUpscaleTarget] = useState<string | null | undefined>(
    undefined
  );
  const [upscaleModalOpen, setUpscaleModalOpen] = useState(false);

  const aiHybridShots = project.shots.filter((s) => s.route !== 'live');
  const liveShots = project.shots.filter((s) => s.route === 'live');
  const readyForGeneration = aiHybridShots.filter((s) => s.videoPrompt.trim().length > 0);
  const externalUpscales = project.externalUpscales || [];

  const updateShot = (shotId: string, patch: Partial<PipelineShot>) => {
    const nextShots = project.shots.map((s) =>
      s.id === shotId ? { ...s, ...patch } : s
    );
    void onUpdateProject({
      ...project,
      shots: nextShots,
      approvals: {
        ...project.approvals,
        videoPromptsApproved: false,
        voApproved: false,
        shootPlanApproved: false,
      },
    });
  };

  const handleUploadStartFrame = async (shotId: string, file: File) => {
    setErrorMsg(null);
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      try {
        const resp = await fetch(`/api/projects/${project.id}/assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, prefix: `shot-${shotId.toLowerCase()}-frame` }),
        });
        const data = await parseJsonResponse<{ url?: string; error?: string }>(resp, 'Could not upload image.');
        if (resp.ok && data.url) {
          updateShot(shotId, { frameImageUrl: data.url });
        } else {
          updateShot(shotId, { frameImageUrl: dataUrl });
        }
      } catch {
        updateShot(shotId, { frameImageUrl: dataUrl });
      }
    };
    reader.onerror = () => setErrorMsg('Could not read image file.');
    reader.readAsDataURL(file);
  };

  const handleWriteAllPrompts = async () => {
    setErrorMsg(null);
    setIsWritingPrompts(true);
    try {
      await onGenerateVideoPrompts();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not generate video prompts.'
      );
    } finally {
      setIsWritingPrompts(false);
    }
  };

  const handleWriteSinglePrompt = async (shotId: string) => {
    setErrorMsg(null);
    setWritingShotId(shotId);
    try {
      await onGenerateVideoPrompts(shotId);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not write video prompt.'
      );
    } finally {
      setWritingShotId(null);
    }
  };

  const runVideoForShot = async (shot: PipelineShot) => {
    setGeneratingShotId(shot.id);
    let chainedFrame: string | undefined;
    if (shot.chainFrom && shot.chainFrom !== 'none') {
      const parent = project.shots.find((s) => s.id === shot.chainFrom);
      if (parent?.videoUrl) {
        chainedFrame = await extractLastFrameDataUrl(parent.videoUrl);
      }
    }
    await onGenerateSingleVideo(shot.id, chainedFrame);
  };

  const handleOpenStudioForShot = async (shot: PipelineShot) => {
    setErrorMsg(null);
    let chainedFrame: string | undefined;
    if (shot.chainFrom && shot.chainFrom !== 'none') {
      const parent = project.shots.find((s) => s.id === shot.chainFrom);
      if (parent?.videoUrl) {
        chainedFrame = await extractLastFrameDataUrl(parent.videoUrl);
      }
    }
    setStudioChainedFrame(chainedFrame);
    setStudioShotId(shot.id);
  };

  const handleConfirmBatchGenerate = async () => {
    setConfirmBatchOpen(false);
    setErrorMsg(null);
    setIsGeneratingAll(true);
    try {
      for (const shot of readyForGeneration) {
        await runVideoForShot(shot);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Batch video generation stopped.'
      );
    } finally {
      setGeneratingShotId(null);
      setIsGeneratingAll(false);
    }
  };

  const handleCopy = async (key: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((p) => (p === key ? null : p)), 1800);
    } catch {
      // Ignore
    }
  };

  const openUpscaleModalForShot = (shotId: string | null) => {
    setUpscaleTarget(shotId);
    setUpscaleModalOpen(true);
  };

  const selectedUpscaleShot =
    typeof upscaleTarget === 'string'
      ? project.shots.find((s) => s.id === upscaleTarget) ?? null
      : null;

  return (
    <div className="max-w-[1320px] mx-auto px-6 py-7 space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-[#E2E2E6]">
        <div>
          <div className="text-xs font-medium text-[#C6202F]">
            AI Video Generation Studio · Motion Prompts &amp; Topaz Upscaling
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
            Motion Prompts &amp; Video Studio
          </h1>
          <p className="text-sm text-[#5A5A66] mt-1">
            Generate with FLUX 3, Seedance, Google Veo 3.1, Google Gemini Omni Flash, Kling 4.0, Wan 3.0 Prime, or Luma Ray 3.2,
            then upscale any clip to H.264 Premiere-ready quality via Topaz Video.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {onAddShot && (
            <button
              type="button"
              onClick={onAddShot}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Shot
            </button>
          )}

          {onPreviewPdf && aiHybridShots.length > 0 && (
            <button
              type="button"
              onClick={onPreviewPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-[#891A23]" />
              Preview PDF
            </button>
          )}

          <button
            type="button"
            onClick={() => openUpscaleModalForShot(null)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-white border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <UploadCloud className="w-4 h-4 text-[#C6202F]" />
            Upscale Existing Video
          </button>

          <button
            type="button"
            disabled={isWritingPrompts || aiHybridShots.length === 0}
            onClick={() => void handleWriteAllPrompts()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-white border border-[#E2E2E6] hover:border-[#C6202F] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isWritingPrompts ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#C6202F]" />
            ) : (
              <Sparkles className="w-4 h-4 text-[#C6202F]" />
            )}
            {isWritingPrompts ? 'Writing Prompts...' : 'Write all video prompts'}
          </button>

          <button
            type="button"
            disabled={
              isGeneratingAll ||
              Boolean(generatingShotId) ||
              readyForGeneration.length === 0
            }
            onClick={() => setConfirmBatchOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isGeneratingAll ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {isGeneratingAll
              ? `Generating ${generatingShotId}...`
              : `Generate all AI videos (${readyForGeneration.length})`}
          </button>
        </div>
      </div>

      {/* Paid Batch Confirmation Banner */}
      {confirmBatchOpen && (
        <div className="p-4 rounded-xl bg-[#FDF4F5] border border-[#C6202F]/55 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs text-[#6E141C]">
            <AlertTriangle className="w-4 h-4 text-[#C6202F] shrink-0 mt-0.5" />
            <div>
              <strong>Confirm paid generation:</strong> This will run{' '}
              <strong>{readyForGeneration.length}</strong> fal.ai video generation
              {readyForGeneration.length === 1 ? '' : 's'} sequentially (one shot at a time),
              since each generation costs money.
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmBatchOpen(false)}
              className="px-3 py-1.5 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] rounded-lg cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmBatchGenerate()}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer"
            >
              Run {readyForGeneration.length} video generations
            </button>
          </div>
        </div>
      )}

      {(isWritingPrompts || writingShotId) && (
        <div className="p-3.5 rounded-lg bg-[#FDF4F5] border border-[#EABAC0] text-xs text-[#891A23] flex items-center gap-2.5">
          <Loader2 className="w-4 h-4 animate-spin text-[#C6202F] shrink-0" />
          <span>
            {writingShotId
              ? `Writing motion video prompt & negative prompt for ${writingShotId}...`
              : `Writing motion video prompts & negative prompts for ${aiHybridShots.length} shots in a single fast batch...`}
          </span>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-300 text-xs text-[#891A23]">
          {errorMsg}
        </div>
      )}

      {liveShots.length > 0 && (
        <div className="text-xs text-[#5A5A66]">
          Note: {liveShots.length} Live shoot shot(s) ({liveShots.map((s) => s.id).join(', ')})
          are excluded here.
        </div>
      )}

      {/* AI & Hybrid Shot Cards */}
      <div className="space-y-5">
        {aiHybridShots.map((shot) => {
          const isGenerating = generatingShotId === shot.id;
          const isWritingThis = writingShotId === shot.id;
          const modelLabel = formatShotModelLabel(shot.model);

          return (
            <div
              key={shot.id}
              className="bg-white border border-[#E2E2E6] rounded-xl overflow-hidden shadow-xs"
            >
              <div className="px-5 py-3 bg-[#FBFBFC] border-b border-[#E2E2E6] flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono font-bold text-[#C6202F] text-sm">
                    {shot.id}
                  </span>
                  <select
                    aria-label={`Model for shot ${shot.id}`}
                    value={shot.model}
                    onChange={(e) => updateShot(shot.id, { model: e.target.value as PipelineShot['model'] })}
                    className="bg-white border border-[#E2E2E6] rounded px-2 py-1 text-xs font-semibold text-[#111114] cursor-pointer"
                  >
                    <option value="flux3">FLUX 3</option>
                    <option value="veo">Google Veo 3.1</option>
                    <option value="omni">Gemini Omni Flash</option>
                    <option value="kling">Kling 4.0</option>
                    <option value="wan">Wan 3.0 Prime</option>
                    <option value="luma">Luma Ray 3.2</option>
                    <option value="seedance">Seedance</option>
                  </select>

                  <span className="text-[#6E6E7A]">·</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={2}
                      max={20}
                      value={shot.durationSec}
                      onChange={(e) => updateShot(shot.id, { durationSec: Number(e.target.value) || 5 })}
                      className="w-14 bg-white border border-[#E2E2E6] rounded px-1.5 py-0.5 text-xs font-mono text-center"
                    />
                    <span className="text-[#5A5A66]">sec</span>
                  </div>

                  {shot.videoResolution && (
                    <>
                      <span className="text-[#6E6E7A]">·</span>
                      <span className="font-mono text-[#3A3A44]">
                        {shot.videoResolution}
                      </span>
                    </>
                  )}
                  {shot.isGridMode && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FDF2F3] border border-[#EABAC0] text-[#891A23] font-mono font-semibold text-[11px]">
                      <Grid2x2 className="w-3 h-3" />
                      2x2 Grid
                    </span>
                  )}
                  {shot.upscaledVideoUrl && (
                    <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-800 font-mono font-semibold text-[11px]">
                      {shot.upscaledResolution || '4K / Upscaled'}
                    </span>
                  )}
                  {(shot.videoHistory?.length ?? 0) > 1 && (
                    <span className="px-2 py-0.5 rounded bg-[#FDF2F3] border border-[#EABAC0] text-[#891A23] font-mono text-[11px]">
                      {shot.videoHistory?.length} takes
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isWritingThis || isWritingPrompts}
                    onClick={() => void handleWriteSinglePrompt(shot.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#24242B] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg cursor-pointer"
                  >
                    {isWritingThis ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6202F]" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-[#C6202F]" />
                    )}
                    Write video prompt
                  </button>

                  {shot.videoUrl &&
                    !shot.isGridMode &&
                    !(shot.gridSplitClips?.length) &&
                    !expandedSplitShotIds[shot.id] && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedSplitShotIds((prev) => ({
                            ...prev,
                            [shot.id]: true,
                          }))
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#24242B] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg cursor-pointer"
                      >
                        <Scissors className="w-3.5 h-3.5 text-[#C6202F]" />
                        2x2 Split
                      </button>
                    )}

                  {shot.videoUrl && (
                    <button
                      type="button"
                      onClick={() => openUpscaleModalForShot(shot.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 rounded-lg cursor-pointer"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      Upscale
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isGenerating || isGeneratingAll}
                    onClick={() => void handleOpenStudioForShot(shot)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer"
                  >
                    {isGenerating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    {isGenerating ? 'Generating...' : 'Generate AI video'}
                  </button>

                  {onDeleteShot && project.shots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteShot(shot.id)}
                      className="p-1.5 text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-lg cursor-pointer"
                      title="Delete shot"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="p-5 grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
                {/* Left: Original Clip + Linked Upscaled Clip + Manual Start Frame Upload */}
                <div className="space-y-3">
                  <div className="aspect-video bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg overflow-hidden flex items-center justify-center relative group">
                    {shot.videoUrl ? (
                      <video
                        src={shot.videoUrl}
                        controls
                        className="w-full h-full object-cover"
                      />
                    ) : shot.frameImageUrl ? (
                      <img
                        src={shot.frameImageUrl}
                        alt={`Shot ${shot.id} start frame`}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-center p-4 text-[#6E6E7A] space-y-1">
                        <Film className="w-5 h-5 mx-auto" />
                        <div className="text-xs">No start frame image</div>
                      </div>
                    )}
                    {shot.videoUrl && shot.videoResolution && (
                      <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/75 border border-white/15 text-[10px] font-mono text-white">
                        Original · {shot.videoResolution}
                      </span>
                    )}

                    <input
                      ref={(el) => {
                        startFrameInputRefs.current[shot.id] = el;
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleUploadStartFrame(shot.id, file);
                        e.target.value = '';
                      }}
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-4">
                      <button
                        type="button"
                        onClick={() => startFrameInputRefs.current[shot.id]?.click()}
                        className="px-3 py-2 bg-white text-[#111114] text-xs font-semibold rounded-lg shadow-lg hover:bg-[#F6F6F7] cursor-pointer"
                      >
                        {shot.frameImageUrl ? 'Change Start Frame' : 'Upload Start Frame Image'}
                      </button>
                    </div>
                  </div>

                  {/* Linked Topaz Upscaled Video Card */}
                  {shot.upscaledVideoUrl && (
                    <div className="p-2.5 rounded-lg bg-[#F6F6F7] border border-emerald-300 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="px-2 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-emerald-800 font-mono font-semibold">
                          {shot.upscaledResolution || '4K / Upscaled'}
                        </span>
                        {shot.upscaleDetails && (
                          <span className="text-[#5A5A66] font-mono truncate">
                            {shot.upscaleDetails.subModel} ·{' '}
                            {shot.upscaleDetails.scaleFactor}x H.264
                          </span>
                        )}
                      </div>
                      <div className="aspect-video rounded overflow-hidden bg-black border border-[#E2E2E6]">
                        <video
                          src={shot.upscaledVideoUrl}
                          controls
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <a
                        href={shot.upscaledVideoUrl}
                        download={`${project.id}-${shot.id}-upscaled.mp4`}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Upscaled MP4
                      </a>
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {shot.videoUrl && (
                      <a
                        href={shot.videoUrl}
                        download={`${project.id}-${shot.id}.mp4`}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#24242B] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download Clip
                      </a>
                    )}
                    {shot.frameImageUrl && (
                      <a
                        href={shot.frameImageUrl}
                        download={`${project.id}-${shot.id}-start-frame.png`}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#3A3A44] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Start Frame
                      </a>
                    )}
                  </div>
                </div>

                {/* Right: Scene Description + Video Prompt + Negative Prompt */}
                <div className="space-y-3.5">
                  <div>
                    <label className="text-[11px] font-semibold text-[#5A5A66] uppercase tracking-wider block mb-1">
                      Scene Description &amp; Deliverable
                    </label>
                    <input
                      type="text"
                      value={shot.scene}
                      onChange={(e) => updateShot(shot.id, { scene: e.target.value })}
                      placeholder="Describe what happens in this shot..."
                      className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-[#24242B]">
                        Video prompt ({modelLabel})
                      </label>
                      <button
                        type="button"
                        onClick={() => void handleCopy(`vp-${shot.id}`, shot.videoPrompt)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] hover:bg-[#FCE8EA] rounded cursor-pointer"
                      >
                        {copiedKey === `vp-${shot.id}` ? (
                          <>
                            <Check className="w-3 h-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={shot.videoPrompt}
                      onChange={(e) =>
                        updateShot(shot.id, { videoPrompt: e.target.value })
                      }
                      placeholder="Motion, camera move, timing, preservation line, and ambient sound..."
                      className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F] leading-relaxed"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-[#3A3A44]">
                        Negative prompt (artifacts + banned list)
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          void handleCopy(`np-${shot.id}`, shot.negativePrompt)
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#3A3A44] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] rounded cursor-pointer"
                      >
                        {copiedKey === `np-${shot.id}` ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-700" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={shot.negativePrompt}
                      onChange={(e) =>
                        updateShot(shot.id, { negativePrompt: e.target.value })
                      }
                      placeholder="warping, extra limbs, text glitches, logo distortion..."
                      className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#3A3A44] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
                    />
                  </div>
                </div>
              </div>

              {shot.videoUrl &&
                (shot.isGridMode ||
                  Boolean(shot.gridSplitClips?.length) ||
                  expandedSplitShotIds[shot.id]) && (
                  <div className="px-5 pb-5">
                    <GridSplitTray
                      projectId={project.id}
                      shotId={shot.id}
                      sourceVideoUrl={shot.videoUrl}
                      isGridMode={shot.isGridMode}
                      splitClips={shot.gridSplitClips}
                      compact
                      onProjectUpdated={onProjectUpdated}
                    />
                  </div>
                )}
            </div>
          );
        })}
      </div>

      {/* External Topaz Upscaled Clips Gallery */}
      {externalUpscales.length > 0 && (
        <div className="bg-white border border-[#E2E2E6] rounded-xl overflow-hidden">
          <div className="px-5 py-3 bg-[#FBFBFC] border-b border-[#E2E2E6] flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#111114]">
              <ArrowUpRight className="w-4 h-4 text-emerald-700" />
              Standalone Topaz Upscaled Videos ({externalUpscales.length})
            </div>
            <button
              type="button"
              onClick={() => openUpscaleModalForShot(null)}
              className="text-xs text-[#C6202F] hover:text-[#891A23] font-medium cursor-pointer"
            >
              + Upscale Another Clip
            </button>
          </div>
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {externalUpscales.map((item) => (
              <div
                key={item.id}
                className="bg-[#F6F6F7] border border-emerald-300 rounded-xl overflow-hidden flex flex-col"
              >
                <div className="aspect-video bg-black relative">
                  <video
                    src={item.upscaledVideoUrl}
                    controls
                    className="w-full h-full object-contain"
                  />
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-[#15803D]/90 text-white font-mono font-semibold text-[10px]">
                    {item.upscaledResolution || '4K / Upscaled'}
                  </span>
                </div>
                <div className="p-3 space-y-2 text-xs">
                  <div className="font-semibold text-[#111114] truncate">
                    {item.label}
                  </div>
                  <div className="text-[11px] font-mono text-[#5A5A66]">
                    {item.details.mode} · {item.details.subModel} ·{' '}
                    {item.details.scaleFactor}x H.264
                  </div>
                  <a
                    href={item.upscaledVideoUrl}
                    download={`${project.id}-${item.id}.mp4`}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Upscaled MP4
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <VideoStudioModal
        isOpen={Boolean(studioShotId)}
        project={project}
        shot={project.shots.find((s) => s.id === studioShotId) ?? null}
        chainedStartFrameDataUrl={studioChainedFrame}
        onClose={() => {
          setStudioShotId(null);
          setStudioChainedFrame(undefined);
        }}
        onProjectUpdated={onProjectUpdated}
      />

      <TopazUpscaleModal
        isOpen={upscaleModalOpen}
        project={project}
        shot={selectedUpscaleShot}
        onClose={() => {
          setUpscaleModalOpen(false);
          setUpscaleTarget(undefined);
        }}
        onProjectUpdated={onProjectUpdated}
      />
    </div>
  );
};
