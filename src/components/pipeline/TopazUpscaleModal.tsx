import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  ArrowUpRight,
  Loader2,
  UploadCloud,
  Film,
  CheckCircle2,
  Sliders,
} from 'lucide-react';
import { PipelineProject, PipelineShot } from '../../types/pipeline';
import {
  TOPAZ_UPSCALE_MODES,
  TopazUpscaleMode,
} from '../../utils/videoStudioCatalog';
import { parseJsonResponse } from '../../utils/safeFetch';

interface TopazUpscaleModalProps {
  isOpen: boolean;
  project: PipelineProject;
  shot?: PipelineShot | null;
  onClose: () => void;
  onProjectUpdated: (updated: PipelineProject) => void;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read video file.'));
    reader.readAsDataURL(file);
  });
}

export const TopazUpscaleModal: React.FC<TopazUpscaleModalProps> = ({
  isOpen,
  project,
  shot,
  onClose,
  onProjectUpdated,
}) => {
  const [mode, setMode] = useState<TopazUpscaleMode>('precision');
  const [subModel, setSubModel] = useState<string>('Proteus');
  const [creativity, setCreativity] = useState<number>(0.5);
  const [scaleFactor, setScaleFactor] = useState<2 | 4>(2);

  // External file upload state (when no shot or user drops a custom clip)
  const [customVideoUrl, setCustomVideoUrl] = useState<string | null>(null);
  const [customLabel, setCustomLabel] = useState<string>('');
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [isUpscaling, setIsUpscaling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setMode('precision');
    setSubModel(TOPAZ_UPSCALE_MODES.precision.defaultModel);
    setCreativity(0.5);
    setScaleFactor(2);
    setCustomVideoUrl(null);
    setCustomLabel(shot ? `${shot.id} Clip` : '');
    setErrorMsg(null);
    setIsUpscaling(false);
  }, [isOpen, shot?.id]);

  if (!isOpen) return null;

  const activeSourceUrl = customVideoUrl || shot?.videoUrl || null;
  const activeModeSpec = TOPAZ_UPSCALE_MODES[mode];

  const handleModeChange = (nextMode: TopazUpscaleMode) => {
    setMode(nextMode);
    setSubModel(TOPAZ_UPSCALE_MODES[nextMode].defaultModel);
  };

  const handleVideoFile = async (file: File) => {
    setErrorMsg(null);
    setIsUploadingFile(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      const resp = await fetch('/api/pipeline/upload-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          dataUrl,
          prefix: 'upscale-src',
        }),
      });
      const data = await parseJsonResponse<{ falUrl?: string; url?: string }>(
        resp,
        'Could not upload video file.'
      );
      setCustomVideoUrl(data.falUrl || data.url || null);
      if (!customLabel.trim()) {
        setCustomLabel(file.name.replace(/\.[^.]+$/, ''));
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not read that video file.'
      );
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleSubmitUpscale = async () => {
    if (!activeSourceUrl) {
      setErrorMsg('Upload or select a video clip first.');
      return;
    }
    setErrorMsg(null);
    setIsUpscaling(true);
    try {
      const resp = await fetch('/api/pipeline/studio-upscale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          shotId: customVideoUrl ? undefined : shot?.id,
          videoUrl: activeSourceUrl,
          label: customLabel.trim() || undefined,
          mode,
          subModel,
          scaleFactor,
          creativity,
        }),
      });
      const data = await parseJsonResponse<{ project: PipelineProject }>(
        resp,
        'Topaz upscale failed.'
      );
      onProjectUpdated(data.project);
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Topaz upscale failed.');
    } finally {
      setIsUpscaling(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Topaz Video Upscaler"
    >
      <div className="bg-white border border-[#E2E2E6] rounded-2xl w-full max-w-[580px] overflow-hidden shadow-2xl text-[#111114]">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#FBFBFC] border-b border-[#E2E2E6] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ArrowUpRight className="w-4 h-4 text-[#C6202F]" />
            <div>
              <h2 className="text-sm font-bold text-[#111114]">
                Topaz Video Upscaling Pipeline
              </h2>
              <p className="text-[11px] text-[#5A5A66]">
                {shot && !customVideoUrl
                  ? `Upscaling generated clip for ${shot.id}`
                  : 'Upscale any uploaded MP4 or MOV clip'}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isUpscaling}
            onClick={onClose}
            className="p-1.5 text-[#5A5A66] hover:text-[#111114] rounded-lg cursor-pointer disabled:opacity-40"
            aria-label="Close upscale modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[80vh] overflow-y-auto text-xs">
          {/* Source Video Preview or External Drag-and-Drop Uploader */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#5A5A66]">
                Source Video
              </label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={isUploadingFile || isUpscaling}
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] text-[#C6202F] hover:text-[#891A23] font-medium cursor-pointer"
                >
                  {activeSourceUrl ? 'Upload different .mp4 / .mov' : '+ Upload video file'}
                </button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleVideoFile(file);
                e.target.value = '';
              }}
            />

            {activeSourceUrl ? (
              <div className="rounded-xl overflow-hidden border border-[#E2E2E6] bg-black space-y-2">
                <video
                  src={activeSourceUrl}
                  controls
                  playsInline
                  className="w-full max-h-[190px] object-contain"
                />
                {customVideoUrl && (
                  <div className="px-3 pb-2.5">
                    <input
                      type="text"
                      value={customLabel}
                      onChange={(e) => setCustomLabel(e.target.value)}
                      placeholder="Clip label (optional)"
                      className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleVideoFile(file);
                }}
                className={`py-7 px-4 rounded-xl border-2 border-dashed flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-[#C6202F] bg-[#FDF4F5]'
                    : 'border-[#E2E2E6] hover:border-[#C6202F]/60 bg-[#F6F6F7]'
                }`}
              >
                {isUploadingFile ? (
                  <>
                    <Loader2 className="w-6 h-6 text-[#C6202F] animate-spin mb-1.5" />
                    <span className="text-[#24242B] font-medium">
                      Uploading video to studio storage...
                    </span>
                  </>
                ) : (
                  <>
                    <UploadCloud className="w-6 h-6 text-[#C6202F] mb-1.5" />
                    <span className="text-[#24242B] font-medium">
                      Drag &amp; drop an .mp4 or .mov clip here, or browse
                    </span>
                    <span className="text-[11px] text-[#6E6E7A] mt-0.5">
                      Uploaded securely for Topaz upscaling via your Fal.ai connection
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* 1. Upscale Mode Selector */}
          <div className="space-y-2">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[#5A5A66] block">
              1. Upscale Mode
            </label>
            <div className="space-y-2">
              {(Object.keys(TOPAZ_UPSCALE_MODES) as TopazUpscaleMode[]).map((mKey) => {
                const spec = TOPAZ_UPSCALE_MODES[mKey];
                const active = mode === mKey;
                return (
                  <button
                    key={mKey}
                    type="button"
                    disabled={isUpscaling}
                    onClick={() => handleModeChange(mKey)}
                    className={`w-full text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                      active
                        ? 'bg-[#FDF4F5] border-[#C6202F] text-[#111114]'
                        : 'bg-[#F6F6F7] border-[#E2E2E6] hover:border-[#891A23] text-[#3A3A44]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs">{spec.label}</span>
                      <span className="font-mono text-[10px] text-[#5A5A66]">
                        {spec.endpoint}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#5A5A66] mt-1 leading-relaxed">
                      {spec.description}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Model Variant or Creativity Slider */}
          {mode !== 'creative' ? (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#5A5A66] block">
                Topaz Engine Model
              </label>
              <div
                className="grid gap-2"
                style={{
                  gridTemplateColumns: `repeat(${activeModeSpec.models.length}, minmax(0, 1fr))`,
                }}
              >
                {activeModeSpec.models.map((mName) => {
                  const selected = subModel === mName;
                  return (
                    <button
                      key={mName}
                      type="button"
                      disabled={isUpscaling}
                      onClick={() => setSubModel(mName)}
                      className={`py-2 px-3 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
                        selected
                          ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23] font-semibold'
                          : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44] hover:border-[#891A23]'
                      }`}
                    >
                      <div>{mName}</div>
                      {mName === 'Iris' && (
                        <div className="text-[10px] text-[#5A5A66] font-normal">
                          Best for faces
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-[#F6F6F7] border border-[#E2E2E6] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[#24242B] flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-[#C6202F]" />
                  Astra 2 Creativity
                </span>
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
                disabled={isUpscaling}
                onChange={(e) => setCreativity(Number(e.target.value))}
                className="w-full accent-[#C6202F] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-[#6E6E7A]">
                <span>0.0 (Faithful)</span>
                <span>0.5 (Balanced)</span>
                <span>1.0 (Stylized Rebuild)</span>
              </div>
            </div>
          )}

          {/* 2. Scale Factor */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wider text-[#5A5A66] block">
              2. Scale Factor
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([2, 4] as const).map((factor) => (
                <button
                  key={factor}
                  type="button"
                  disabled={isUpscaling}
                  onClick={() => setScaleFactor(factor)}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-colors ${
                    scaleFactor === factor
                      ? 'bg-[#FDF2F3] border-[#C6202F] text-[#6E141C]'
                      : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#3A3A44] hover:border-[#891A23]'
                  }`}
                >
                  <div className="font-bold text-sm font-mono">{factor}x</div>
                  <div className="text-[11px] text-[#5A5A66] mt-0.5">
                    {factor === 2
                      ? 'Default · 720p → 1440p / 1080p → 4K'
                      : '4K Mastering · Maximum detail scale'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Locked Codec & FPS Guarantee Badges */}
          <div className="p-3 rounded-xl bg-[#F6F6F7] border border-[#E2E2E6] flex flex-wrap items-center gap-3 text-[11px] text-[#3A3A44]">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              H.264 Codec (Premiere Pro ready)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Film className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              Frame Rate Locked (preserves native 24/30fps)
            </span>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-300 text-xs text-[#891A23]">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-[#FBFBFC] border-t border-[#E2E2E6] flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={isUpscaling}
            onClick={onClose}
            className="px-3.5 py-2 text-xs font-medium text-[#3A3A44] hover:text-[#111114] cursor-pointer disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!activeSourceUrl || isUpscaling || isUploadingFile}
            onClick={() => void handleSubmitUpscale()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer"
          >
            {isUpscaling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Upscaling ({scaleFactor}x)...
              </>
            ) : (
              <>
                <ArrowUpRight className="w-3.5 h-3.5" />
                Run {scaleFactor}x Topaz Upscale
              </>
            )}
          </button>
        </div>
      </div>

    </div>
  );
};
