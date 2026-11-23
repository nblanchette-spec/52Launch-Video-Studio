import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Upload,
  Copy,
  Check,
  Loader2,
  ArrowRight,
  Package,
  CheckCircle2,
  AlertCircle,
  FolderSync,
  ClipboardPaste,
  Sparkles,
  Palette,
  User,
  MapPin,
  Box,
  Clapperboard,
  Lock,
  Unlock,
  Plus,
  Trash2,
  RefreshCw,
  Wand2,
  Square,
  Eye,
} from 'lucide-react';
import {
  PipelineProject,
  PipelineShot,
  StoryboardAssetCategory,
  StoryboardImageModel,
  StoryboardStudioAsset,
  StoryboardStudioState,
  StoryboardStylePreset,
} from '../../types/pipeline';
import { readAndOptimizeLocalImage } from '../../utils/imageUtils';
import { ImportedDriveAsset } from '../../utils/googleDriveSync';
import { parseJsonResponse } from '../../utils/safeFetch';
import { DriveAssetPickerModal } from './DriveAssetPickerModal';

interface Step5StoryboardFramesProps {
  project: PipelineProject;
  onUpdateProject: (updated: PipelineProject) => Promise<void>;
  onGoToFrameSuggestions: () => void;
  onApproveAndGoToVideo: () => Promise<void>;
  onPreviewPdf?: () => void;
}

type StudioStage = 'style' | 'assets' | 'storyboard';

const STYLE_OPTIONS: Array<{
  id: StoryboardStylePreset;
  label: string;
  tagline: string;
  detail: string;
}> = [
  {
    id: 'sketch',
    label: 'Sketch',
    tagline: 'Graphite & fine ink',
    detail: 'Clean hand-drawn commercial storyboard linework on matte paper.',
  },
  {
    id: '3d_animation',
    label: '3D Animation',
    tagline: 'Stylized CG render',
    detail: 'Theatrical animated film lighting, depth, and expressive shaders.',
  },
  {
    id: 'charcoal',
    label: 'Charcoal',
    tagline: 'Dramatic chiaroscuro',
    detail: 'Bold tonal charcoal shadows and textured paper highlights.',
  },
  {
    id: 'claymation',
    label: 'Claymation',
    tagline: 'Stop-motion miniature',
    detail: 'Handcrafted sculpted clay forms with tactile studio lighting.',
  },
  {
    id: 'concept_sketch',
    label: 'Concept Sketch',
    tagline: 'Painterly production art',
    detail: 'Atmospheric color washes over expressive director keyframes.',
  },
  {
    id: 'realistic',
    label: 'Realistic',
    tagline: 'Live-action cinema still',
    detail: 'Photorealistic 35mm lens framing and natural commercial lighting.',
  },
];

const MODEL_OPTIONS: Array<{
  id: StoryboardImageModel;
  label: string;
  note: string;
}> = [
  {
    id: 'nano-banana-2',
    label: 'Nano Banana 2 (Fal)',
    note: 'Fast multi-reference consistency (up to 14 refs)',
  },
  {
    id: 'nano-banana-pro',
    label: 'Nano Banana Pro (Fal)',
    note: 'Highest detail & crisp product branding fidelity',
  },
  {
    id: 'nano-banana',
    label: 'Nano Banana Standard (Fal)',
    note: 'Lightweight quick storyboard iteration',
  },
];

const DEFAULT_STUDIO = (project: PipelineProject): StoryboardStudioState => {
  if (project.storyboardStudio) return project.storyboardStudio;
  return {
    style: 'sketch',
    customStyleNote: '',
    model: 'nano-banana-2',
    aspectRatio: '16:9',
    resolution: '1K',
    assets: (project.brandBible?.characters || []).map((c, idx) => ({
      id: `asset-char-${c.id || idx}`,
      category: 'character',
      name: c.name,
      description: c.fixedDescriptor,
      sheetType: 'contact_sheet',
      imageUrl: null,
      locked: true,
      linkedShotIds: [],
    })),
    hasSeededAssets: false,
  };
};

export const Step5StoryboardFrames: React.FC<Step5StoryboardFramesProps> = ({
  project,
  onUpdateProject,
  onGoToFrameSuggestions,
  onApproveAndGoToVideo,
  onPreviewPdf,
}) => {
  const studio = useMemo(() => DEFAULT_STUDIO(project), [project]);

  const [activeStage, setActiveStage] = useState<StudioStage>(() => {
    const anyFrames = project.shots.some((s) => Boolean(s.frameImageUrl));
    if (anyFrames) return 'storyboard';
    const anyAssetImages = project.storyboardStudio?.assets?.some((a) => Boolean(a.imageUrl));
    if (anyAssetImages) return 'assets';
    return 'style';
  });

  const [assetFilter, setAssetFilter] = useState<'all' | StoryboardAssetCategory>('all');
  const [falConfigured, setFalConfigured] = useState<boolean | null>(null);

  const [isSeedingAssets, setIsSeedingAssets] = useState(false);
  const [generatingAssetIds, setGeneratingAssetIds] = useState<Record<string, boolean>>({});
  const [isBatchGeneratingAssets, setIsBatchGeneratingAssets] = useState(false);
  const [batchAssetProgress, setBatchAssetProgress] = useState<string | null>(null);

  const [generatingShotIds, setGeneratingShotIds] = useState<Record<string, boolean>>({});
  const [isBatchGeneratingFrames, setIsBatchGeneratingFrames] = useState(false);
  const [batchFrameProgress, setBatchFrameProgress] = useState<string | null>(null);
  const stopBatchRef = useRef(false);

  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadingAssetId, setUploadingAssetId] = useState<string | null>(null);
  const [drivePickerShotId, setDrivePickerShotId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [pasteHintShotId, setPasteHintShotId] = useState<string | null>(null);
  const [prevContinuityMap, setPrevContinuityMap] = useState<Record<string, boolean>>({});
  const [productOverrideMap, setProductOverrideMap] = useState<Record<string, boolean>>({});

  const frameInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const frameBoxRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const assetInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    fetch('/api/pipeline/fal-status')
      .then((r) => parseJsonResponse<{ falKeyConfigured?: boolean }>(r))
      .then((d) => setFalConfigured(Boolean(d?.falKeyConfigured)))
      .catch(() => setFalConfigured(null));
  }, []);

  const aiHybridShots = project.shots.filter((s) => s.route !== 'live');
  const uploadedAiHybridCount = aiHybridShots.filter((s) => Boolean(s.frameImageUrl)).length;
  const totalUploadedCount = project.shots.filter((s) => Boolean(s.frameImageUrl)).length;

  const lockedReadyAssets = studio.assets.filter((a) => a.locked && Boolean(a.imageUrl));
  const generatedAssetCount = studio.assets.filter((a) => Boolean(a.imageUrl)).length;
  const activeStyleMeta =
    STYLE_OPTIONS.find((s) => s.id === studio.style) || STYLE_OPTIONS[0];

  const updateStudio = async (patch: Partial<StoryboardStudioState>) => {
    const nextStudio: StoryboardStudioState = {
      ...studio,
      ...patch,
    };
    await onUpdateProject({
      ...project,
      storyboardStudio: nextStudio,
    });
  };

  const updateAsset = async (assetId: string, patch: Partial<StoryboardStudioAsset>) => {
    const nextAssets = studio.assets.map((a) =>
      a.id === assetId ? { ...a, ...patch } : a
    );
    await updateStudio({ assets: nextAssets });
  };

  const addCustomAsset = async (category: StoryboardAssetCategory) => {
    const id = `asset-${category}-${Date.now()}`;
    const newAsset: StoryboardStudioAsset =
      category === 'character'
        ? {
            id,
            category: 'character',
            name: 'New Character',
            description: 'Age, ethnicity, hair, wardrobe, and distinct visual traits.',
            sheetType: 'contact_sheet',
            imageUrl: null,
            locked: true,
            linkedShotIds: [],
          }
        : category === 'location'
          ? {
              id,
              category: 'location',
              name: 'New Location',
              description: 'Architectural setting, time of day, natural or practical lighting.',
              sheetType: 'multi_angle',
              imageUrl: null,
              locked: true,
              linkedShotIds: [],
            }
          : {
              id,
              category: 'prop',
              name: 'New Prop',
              description: 'Object silhouette, material texture, finish, and scale.',
              sheetType: 'prop_study',
              imageUrl: null,
              locked: true,
              useRealProductPhoto: false,
              linkedShotIds: [],
            };

    await updateStudio({ assets: [...studio.assets, newAsset] });
    setAssetFilter('all');
  };

  const removeAsset = async (assetId: string) => {
    await updateStudio({
      assets: studio.assets.filter((a) => a.id !== assetId),
    });
  };

  const handleSeedAssets = async () => {
    setErrorMsg(null);
    setStatusNote(null);
    setIsSeedingAssets(true);
    try {
      const resp = await fetch('/api/pipeline/storyboard-studio/seed-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = await parseJsonResponse<{ project: PipelineProject }>(
        resp,
        'Could not extract assets.'
      );
      await onUpdateProject(data.project);
      setStatusNote(
        `Extracted ${data.project.storyboardStudio?.assets?.length || 0} characters, locations & props from your Brand Bible and Shot List.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Asset extraction failed.');
    } finally {
      setIsSeedingAssets(false);
    }
  };

  const handleGenerateAssetSheet = async (
    assetId: string,
    latestProject?: PipelineProject
  ): Promise<PipelineProject | null> => {
    const targetProject = latestProject || project;
    const targetStudio = DEFAULT_STUDIO(targetProject);
    setErrorMsg(null);
    setGeneratingAssetIds((prev) => ({ ...prev, [assetId]: true }));
    try {
      const resp = await fetch('/api/pipeline/storyboard-studio/generate-asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: targetProject.id,
          assetId,
          styleOverride: targetStudio.style,
          modelOverride: targetStudio.model,
          resolutionOverride: targetStudio.resolution,
          customStyleNoteOverride: targetStudio.customStyleNote,
        }),
      });
      const data = await parseJsonResponse<{ project: PipelineProject }>(
        resp,
        'Could not generate asset sheet.'
      );
      await onUpdateProject(data.project);
      return data.project;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Asset sheet generation failed.');
      return null;
    } finally {
      setGeneratingAssetIds((prev) => ({ ...prev, [assetId]: false }));
    }
  };

  const handleGenerateAllMissingAssets = async () => {
    const missing = studio.assets.filter((a) => !a.imageUrl);
    if (missing.length === 0) return;

    setErrorMsg(null);
    setStatusNote(null);
    setIsBatchGeneratingAssets(true);
    stopBatchRef.current = false;

    let currentProj = project;
    let completed = 0;
    for (let i = 0; i < missing.length; i++) {
      if (stopBatchRef.current) break;
      const item = missing[i];
      setBatchAssetProgress(`Generating ${i + 1}/${missing.length}: ${item.name}...`);
      const updated = await handleGenerateAssetSheet(item.id, currentProj);
      if (updated) {
        currentProj = updated;
        completed++;
      } else {
        break;
      }
    }

    setBatchAssetProgress(null);
    setIsBatchGeneratingAssets(false);
    if (completed > 0) {
      setStatusNote(`Generated ${completed} Storyboard Studio reference sheet(s) via Fal Nano Banana.`);
    }
  };

  const handleUploadAssetSheet = async (assetId: string, file: File) => {
    setErrorMsg(null);
    setUploadingAssetId(assetId);
    try {
      const dataUrl = await readAndOptimizeLocalImage(file, 1400);
      const resp = await fetch(`/api/projects/${project.id}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, prefix: 'frame' }),
      });
      const data = await parseJsonResponse<{ url: string }>(
        resp,
        'Could not upload sheet.'
      );
      await updateAsset(assetId, { imageUrl: data.url, locked: true });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not upload asset image.');
    } finally {
      setUploadingAssetId(null);
    }
  };

  const updateShot = (shotId: string, patch: Partial<PipelineShot>) => {
    const nextShots = project.shots.map((s) =>
      s.id === shotId ? { ...s, ...patch } : s
    );
    void onUpdateProject({
      ...project,
      shots: nextShots,
      approvals: {
        ...project.approvals,
        storyboardApproved: false,
        videoPromptsApproved: false,
        voApproved: false,
        shootPlanApproved: false,
      },
    });
  };

  const handleGenerateShotFrame = async (
    shot: PipelineShot,
    latestProject?: PipelineProject
  ): Promise<PipelineProject | null> => {
    const targetProject = latestProject || project;
    setErrorMsg(null);
    setGeneratingShotIds((prev) => ({ ...prev, [shot.id]: true }));
    try {
      const includeProduct =
        productOverrideMap[shot.id] !== undefined
          ? productOverrideMap[shot.id]
          : shot.productInFrame;
      const includePrev = Boolean(prevContinuityMap[shot.id]);

      const resp = await fetch('/api/pipeline/storyboard-studio/generate-frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: targetProject.id,
          shotId: shot.id,
          framePromptOverride: shot.framePrompt,
          includeRealProductPhotos: includeProduct,
          includePrevShotFrame: includePrev,
        }),
      });
      const data = await parseJsonResponse<{
        project: PipelineProject;
        endpointUsed?: string;
        refCount?: number;
      }>(resp, `Could not generate frame for ${shot.id}.`);
      await onUpdateProject(data.project);
      setStatusNote(
        `Generated ${shot.id} frame via ${data.endpointUsed || 'Fal Nano Banana'} (${data.refCount || 0} reference image${data.refCount === 1 ? '' : 's'} applied).`
      );
      return data.project;
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : `Failed to generate ${shot.id}.`);
      return null;
    } finally {
      setGeneratingShotIds((prev) => ({ ...prev, [shot.id]: false }));
    }
  };

  const handleGenerateAllMissingFrames = async (includeLiveShots: boolean) => {
    const targets = project.shots.filter(
      (s) => !s.frameImageUrl && (includeLiveShots || s.route !== 'live')
    );
    if (targets.length === 0) return;

    setErrorMsg(null);
    setIsBatchGeneratingFrames(true);
    stopBatchRef.current = false;

    let currentProj = project;
    let count = 0;
    for (let i = 0; i < targets.length; i++) {
      if (stopBatchRef.current) break;
      const shot = currentProj.shots.find((s) => s.id === targets[i].id) || targets[i];
      setBatchFrameProgress(`Rendering ${shot.id} (${i + 1}/${targets.length})...`);
      const updated = await handleGenerateShotFrame(shot, currentProj);
      if (updated) {
        currentProj = updated;
        count++;
      } else {
        break;
      }
    }

    setBatchFrameProgress(null);
    setIsBatchGeneratingFrames(false);
    if (count > 0) {
      setStatusNote(`Generated ${count} storyboard frame(s) in ${activeStyleMeta.label} style via Fal Nano Banana.`);
    }
  };

  const handleUploadFrame = async (shotId: string, file: File) => {
    setErrorMsg(null);
    setUploadingId(shotId);
    try {
      const dataUrl = await readAndOptimizeLocalImage(file, 1400);
      const resp = await fetch(`/api/projects/${project.id}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, prefix: 'frame' }),
      });
      const data = await parseJsonResponse<{ url: string }>(
        resp,
        'Could not upload frame.'
      );

      updateShot(shotId, {
        frameImageUrl: data.url,
        status: 'Frame Uploaded',
        frameCheck: null,
        productFrameApproved: false,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Frame upload failed.');
    } finally {
      setUploadingId(null);
    }
  };

  const handleCopyPrompt = async (shotId: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(shotId);
      setTimeout(() => setCopiedId((prev) => (prev === shotId ? null : prev)), 1800);
    } catch {
      // Ignore clipboard failure
    }
  };

  const extractClipboardImageFile = (clipboardData: DataTransfer | null): File | null => {
    if (!clipboardData) return null;
    const items = Array.from(clipboardData.items || []);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
    const files = Array.from(clipboardData.files || []);
    return files.find((f) => f.type.startsWith('image/')) || null;
  };

  const handlePasteFromClipboardButton = async (shotId: string) => {
    setErrorMsg(null);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            const ext = imgType.includes('jpeg') ? 'jpg' : imgType.includes('webp') ? 'webp' : 'png';
            const file = new File([blob], `pasted-${shotId}.${ext}`, { type: imgType });
            await handleUploadFrame(shotId, file);
            return;
          }
        }
        setPasteHintShotId(shotId);
        frameBoxRefs.current[shotId]?.focus();
        setErrorMsg('No image found on clipboard. Copy an image first or press Ctrl+V / Cmd+V in the box.');
        return;
      }
    } catch {
      // Fallback: focus the paste target box
    }
    setPasteHintShotId(shotId);
    frameBoxRefs.current[shotId]?.focus();
  };

  const visibleAssets =
    assetFilter === 'all'
      ? studio.assets
      : studio.assets.filter((a) => a.category === assetFilter);

  const missingAssetSheetsCount = studio.assets.filter((a) => !a.imageUrl).length;
  const missingAiHybridFrames = aiHybridShots.filter((s) => !s.frameImageUrl).length;
  const missingAllFrames = project.shots.filter((s) => !s.frameImageUrl).length;

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-7 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-[#E2E2E6]">
        <div>
          <div className="text-xs font-medium text-[#C6202F]">
            Step 5 · Storyboard Studio (Fal.ai Nano Banana)
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
            Style → Reference Sheets → Consistent Storyboard
          </h1>
          <p className="text-sm text-[#5A5A66] mt-1">
            Pick your visual style, generate character contact sheets, location multi-angle shots &amp; props, then render storyboard frames anchored to your real product photos.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {onPreviewPdf && project.shots.length > 0 && (
            <button
              type="button"
              onClick={onPreviewPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-[#891A23]" />
              Preview Storyboard PDF
            </button>
          )}

          <button
            type="button"
            onClick={onGoToFrameSuggestions}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Optional AI frame QC
          </button>

          <button
            type="button"
            onClick={() => void onApproveAndGoToVideo()}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Approve frames &amp; continue to Video
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 3-Stage Storyboard Studio Switcher Bar */}
      <div className="bg-white border border-[#E2E2E6] rounded-xl p-2 grid grid-cols-1 md:grid-cols-3 gap-2 shadow-xs">
        <button
          type="button"
          onClick={() => setActiveStage('style')}
          className={`flex items-center justify-between px-4 py-3 rounded-lg text-left transition-colors cursor-pointer ${
            activeStage === 'style'
              ? 'bg-[#C6202F] text-white shadow-xs'
              : 'bg-[#F6F6F7] text-[#111114] hover:bg-[#EAEAEF]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Palette className="w-4 h-4 shrink-0" />
            <div>
              <div className="text-xs font-bold">1. Image Style</div>
              <div className={`text-[11px] ${activeStage === 'style' ? 'text-white/85' : 'text-[#5A5A66]'}`}>
                {activeStyleMeta.label} · {studio.aspectRatio}
              </div>
            </div>
          </div>
          <ArrowRight className="w-3.5 h-3.5 opacity-60" />
        </button>

        <button
          type="button"
          onClick={() => setActiveStage('assets')}
          className={`flex items-center justify-between px-4 py-3 rounded-lg text-left transition-colors cursor-pointer ${
            activeStage === 'assets'
              ? 'bg-[#C6202F] text-white shadow-xs'
              : 'bg-[#F6F6F7] text-[#111114] hover:bg-[#EAEAEF]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <User className="w-4 h-4 shrink-0" />
            <div>
              <div className="text-xs font-bold">2. Continuity Assets</div>
              <div className={`text-[11px] ${activeStage === 'assets' ? 'text-white/85' : 'text-[#5A5A66]'}`}>
                {generatedAssetCount}/{studio.assets.length} sheets · {project.product.photos.length} product photos
              </div>
            </div>
          </div>
          <ArrowRight className="w-3.5 h-3.5 opacity-60" />
        </button>

        <button
          type="button"
          onClick={() => setActiveStage('storyboard')}
          className={`flex items-center justify-between px-4 py-3 rounded-lg text-left transition-colors cursor-pointer ${
            activeStage === 'storyboard'
              ? 'bg-[#C6202F] text-white shadow-xs'
              : 'bg-[#F6F6F7] text-[#111114] hover:bg-[#EAEAEF]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Clapperboard className="w-4 h-4 shrink-0" />
            <div>
              <div className="text-xs font-bold">3. Storyboard Generator</div>
              <div className={`text-[11px] ${activeStage === 'storyboard' ? 'text-white/85' : 'text-[#5A5A66]'}`}>
                {totalUploadedCount}/{project.shots.length} frames · {lockedReadyAssets.length} locked refs
              </div>
            </div>
          </div>
          <CheckCircle2
            className={`w-4 h-4 ${
              totalUploadedCount === project.shots.length && project.shots.length > 0
                ? activeStage === 'storyboard'
                  ? 'text-white'
                  : 'text-emerald-600'
                : 'opacity-40'
            }`}
          />
        </button>
      </div>

      {falConfigured === false && (
        <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-300 text-xs text-amber-900">
          Add <span className="font-mono font-semibold">FAL_KEY</span> to the server environment variables to run Fal Nano Banana generation directly here (or continue pasting/uploading frames below).
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-300 text-xs text-[#891A23]">
          {errorMsg}
        </div>
      )}

      {statusNote && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-300 text-xs text-emerald-900">
          {statusNote}
        </div>
      )}

      {/* ==================== STAGE 1: STYLE SELECTOR ==================== */}
      {activeStage === 'style' && (
        <section className="bg-white border border-[#E2E2E6] rounded-xl p-6 space-y-6">
          <div>
            <h2 className="text-base font-bold text-[#111114]">
              Choose Your Storyboard Visual Style
            </h2>
            <p className="text-xs text-[#5A5A66] mt-0.5">
              This style drives every Character Contact Sheet, Location Multi-Angle Sheet, Prop Study, and Storyboard Frame so the entire deck feels cohesive.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {STYLE_OPTIONS.map((opt) => {
              const selected = studio.style === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => void updateStudio({ style: opt.id })}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
                    selected
                      ? 'bg-[#FDF4F5] border-[#C6202F] ring-2 ring-[#C6202F]/20'
                      : 'bg-[#FBFBFC] border-[#E2E2E6] hover:border-[#891A23]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-[#111114]">{opt.label}</span>
                    {selected && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#C6202F] text-white text-[10px] font-semibold">
                        <Check className="w-3 h-3" />
                        Selected
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-[#891A23] mt-1">
                    {opt.tagline}
                  </div>
                  <p className="text-xs text-[#5A5A66] mt-1.5 leading-relaxed">
                    {opt.detail}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-[#EAEAEF]">
            <div>
              <label className="block text-xs font-semibold text-[#3A3A44] mb-1.5">
                Fal.ai Nano Banana Model
              </label>
              <select
                value={studio.model}
                onChange={(e) =>
                  void updateStudio({ model: e.target.value as StoryboardImageModel })
                }
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.note}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#3A3A44] mb-1.5">
                Storyboard Aspect Ratio
              </label>
              <select
                value={studio.aspectRatio}
                onChange={(e) =>
                  void updateStudio({
                    aspectRatio: e.target.value as StoryboardStudioState['aspectRatio'],
                  })
                }
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
              >
                <option value="16:9">16:9 Widescreen (Hero Commercial)</option>
                <option value="9:16">9:16 Vertical (Reels / TikTok)</option>
                <option value="4:5">4:5 Social Feed</option>
                <option value="1:1">1:1 Square</option>
                <option value="21:9">21:9 Anamorphic Cinema</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#3A3A44] mb-1.5">
                Output Resolution
              </label>
              <select
                value={studio.resolution}
                onChange={(e) =>
                  void updateStudio({ resolution: e.target.value as '1K' | '2K' })
                }
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
              >
                <option value="1K">1K Fast Storyboard</option>
                <option value="2K">2K High Detail</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#3A3A44] mb-1.5">
              Optional Art Direction / Style Note (applied across all sheets &amp; frames)
            </label>
            <input
              type="text"
              value={studio.customStyleNote || ''}
              onChange={(e) => void updateStudio({ customStyleNote: e.target.value })}
              placeholder="e.g., High contrast dawn stadium silhouette, warm amber accents, tight 35mm depth..."
              className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2 text-xs text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setActiveStage('assets')}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer transition-colors shadow"
            >
              Continue to Continuity Assets
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {/* ==================== STAGE 2: CONTINUITY ASSETS ==================== */}
      {activeStage === 'assets' && (
        <section className="space-y-5">
          {/* Toolbar & Real Product Anchor */}
          <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-[#111114]">
                  Continuity Assets — Contact Sheets, Location Angles &amp; Props
                </h2>
                <p className="text-xs text-[#5A5A66] mt-0.5">
                  Style: <span className="font-semibold text-[#111114]">{activeStyleMeta.label}</span> · Lock the reference sheets you want carried into Storyboard generation.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isSeedingAssets || isBatchGeneratingAssets}
                  onClick={() => void handleSeedAssets()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#111114] bg-[#F6F6F7] hover:bg-[#EAEAEF] border border-[#D5D5DC] disabled:opacity-50 rounded-lg cursor-pointer transition-colors"
                >
                  {isSeedingAssets ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6202F]" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-[#C6202F]" />
                  )}
                  {isSeedingAssets
                    ? 'Extracting Assets...'
                    : 'Auto-Extract from Shot List & Bible'}
                </button>

                {missingAssetSheetsCount > 0 && !isBatchGeneratingAssets && (
                  <button
                    type="button"
                    onClick={() => void handleGenerateAllMissingAssets()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer transition-colors shadow"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    Generate {missingAssetSheetsCount} Missing Sheet{missingAssetSheetsCount > 1 ? 's' : ''}
                  </button>
                )}

                {isBatchGeneratingAssets && (
                  <button
                    type="button"
                    onClick={() => {
                      stopBatchRef.current = true;
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#891A23] bg-rose-50 border border-rose-300 rounded-lg cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5" />
                    {batchAssetProgress || 'Stopping...'}
                  </button>
                )}
              </div>
            </div>

            {/* Anchored Real Product Photos */}
            <div className="p-3.5 rounded-xl bg-[#FBFBFC] border border-[#E2E2E6] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Package className="w-4 h-4 text-[#C6202F] shrink-0" />
                <div className="text-xs">
                  <span className="font-semibold text-[#111114]">
                    Real Product Photos ({project.product.photos.length})
                  </span>
                  <span className="text-[#5A5A66] ml-1.5">
                    — Automatically passed as visual references for product props &amp; “Product in frame” storyboard shots.
                  </span>
                </div>
              </div>
              {(project.product.photos.length > 0 ||
                project.brandBible?.brandLogoUrl ||
                (project.brandBible?.brandGraphics?.length || 0) > 0) && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {project.product.photos.slice(0, 4).map((p) => (
                    <img
                      key={p.id}
                      src={p.url}
                      alt={p.caption || 'Product'}
                      className="w-9 h-9 rounded-md object-cover border border-[#D5D5DC]"
                    />
                  ))}
                  {(() => {
                    const logos: Array<{ id: string; url: string; caption?: string }> = [];
                    const seen = new Set<string>();
                    if (project.brandBible?.brandLogoUrl) {
                      seen.add(project.brandBible.brandLogoUrl);
                      logos.push({
                        id: 'primary-logo',
                        url: project.brandBible.brandLogoUrl,
                        caption: project.brandBible.brandLogoCaption || 'Primary Logo',
                      });
                    }
                    (project.brandBible?.brandGraphics || []).forEach((g, idx) => {
                      if (g.url && !seen.has(g.url)) {
                        seen.add(g.url);
                        logos.push({ id: g.id || `bg-${idx}`, url: g.url, caption: g.caption });
                      }
                    });
                    return logos.slice(0, 4).map((g) => (
                      <img
                        key={g.id}
                        src={g.url}
                        alt={g.caption || 'Brand Graphic'}
                        className="w-9 h-9 rounded-md object-contain bg-white border border-[#C6202F]/50 p-0.5"
                        title={g.caption || 'Brand Graphic'}
                      />
                    ));
                  })()}
                </div>
              )}
            </div>

            {/* Category Filter + Add Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: `All (${studio.assets.length})` },
                    {
                      id: 'character',
                      label: `Characters (${studio.assets.filter((a) => a.category === 'character').length})`,
                    },
                    {
                      id: 'location',
                      label: `Locations (${studio.assets.filter((a) => a.category === 'location').length})`,
                    },
                    {
                      id: 'prop',
                      label: `Props (${studio.assets.filter((a) => a.category === 'prop').length})`,
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setAssetFilter(tab.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                      assetFilter === tab.id
                        ? 'bg-[#111114] text-white'
                        : 'bg-[#F6F6F7] text-[#3A3A44] hover:bg-[#EAEAEF]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void addCustomAsset('character')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#C6202F]" />
                  Character
                </button>
                <button
                  type="button"
                  onClick={() => void addCustomAsset('location')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#C6202F]" />
                  Location
                </button>
                <button
                  type="button"
                  onClick={() => void addCustomAsset('prop')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#C6202F]" />
                  Prop
                </button>
              </div>
            </div>
          </div>

          {/* Assets Cards Grid */}
          {visibleAssets.length === 0 ? (
            <div className="bg-white border border-dashed border-[#D5D5DC] rounded-xl p-10 text-center space-y-3">
              <Sparkles className="w-8 h-8 text-[#C6202F] mx-auto" />
              <div className="text-sm font-semibold text-[#111114]">
                No continuity asset cards yet
              </div>
              <p className="text-xs text-[#5A5A66] max-w-md mx-auto">
                Click &ldquo;Auto-Extract from Shot List &amp; Bible&rdquo; to automatically create Characters, Locations, and Props for your project, or add cards manually.
              </p>
              <button
                type="button"
                disabled={isSeedingAssets}
                onClick={() => void handleSeedAssets()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer"
              >
                {isSeedingAssets ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                Auto-Extract Assets Now
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {visibleAssets.map((asset) => {
                const isGen = Boolean(generatingAssetIds[asset.id]);
                const isUp = uploadingAssetId === asset.id;
                const sheetLabel =
                  asset.category === 'character'
                    ? '2×2 Contact Sheet'
                    : asset.category === 'location'
                      ? '2×2 Multi-Angle Sheet'
                      : 'Prop Study Sheet';
                const IconComp =
                  asset.category === 'character'
                    ? User
                    : asset.category === 'location'
                      ? MapPin
                      : Box;

                return (
                  <div
                    key={asset.id}
                    className={`bg-white border rounded-xl overflow-hidden flex flex-col ${
                      asset.locked ? 'border-[#C6202F]/55' : 'border-[#E2E2E6]'
                    }`}
                  >
                    <div className="px-4 py-2.5 bg-[#FBFBFC] border-b border-[#E2E2E6] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <IconComp className="w-4 h-4 text-[#C6202F]" />
                        <span className="font-semibold text-[#111114] capitalize">
                          {asset.category}
                        </span>
                        <span className="text-[#8A8A96]">·</span>
                        <span className="text-[#5A5A66]">{sheetLabel}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void updateAsset(asset.id, { locked: !asset.locked })}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold cursor-pointer ${
                            asset.locked
                              ? 'bg-[#FDF4F5] border border-[#EABAC0] text-[#891A23]'
                              : 'bg-[#F6F6F7] border border-[#E2E2E6] text-[#5A5A66]'
                          }`}
                          title="Locked sheets are sent as references when generating storyboard frames"
                        >
                          {asset.locked ? (
                            <>
                              <Lock className="w-3 h-3" />
                              Locked Ref
                            </>
                          ) : (
                            <>
                              <Unlock className="w-3 h-3" />
                              Unlocked
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeAsset(asset.id)}
                          className="p-1 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                          title="Delete asset card"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Reference Sheet Preview */}
                    <input
                      ref={(el) => {
                        assetInputRefs.current[asset.id] = el;
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleUploadAssetSheet(asset.id, f);
                        e.target.value = '';
                      }}
                    />
                    <div className="aspect-video bg-[#F6F6F7] border-b border-[#E2E2E6] relative flex items-center justify-center overflow-hidden">
                      {isGen ? (
                        <div className="text-center space-y-2 p-6">
                          <Loader2 className="w-6 h-6 animate-spin text-[#C6202F] mx-auto" />
                          <div className="text-xs font-medium text-[#111114]">
                            Generating {sheetLabel} in {activeStyleMeta.label} style...
                          </div>
                        </div>
                      ) : asset.imageUrl ? (
                        <img
                          src={asset.imageUrl}
                          alt={asset.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center p-6 space-y-1.5 text-[#6E6E7A]">
                          <IconComp className="w-6 h-6 mx-auto text-[#8A8A96]" />
                          <div className="text-xs font-medium text-[#24242B]">
                            No {sheetLabel.toLowerCase()} generated yet
                          </div>
                          <div className="text-[11px]">
                            Click Generate below or upload an existing sheet
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                      <div className="space-y-2.5">
                        <input
                          type="text"
                          value={asset.name}
                          onChange={(e) => void updateAsset(asset.id, { name: e.target.value })}
                          className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-1.5 text-xs font-semibold text-[#111114] focus:outline-none focus:border-[#C6202F]"
                        />
                        <textarea
                          rows={2}
                          value={asset.description}
                          onChange={(e) =>
                            void updateAsset(asset.id, { description: e.target.value })
                          }
                          className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#24242B] focus:outline-none focus:border-[#C6202F]"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#5A5A66]">
                          <div className="flex items-center gap-1.5">
                            <span>Shots:</span>
                            <input
                              type="text"
                              value={(asset.linkedShotIds || []).join(', ')}
                              onChange={(e) =>
                                void updateAsset(asset.id, {
                                  linkedShotIds: e.target.value
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean),
                                })
                              }
                              placeholder="S01, S02"
                              className="w-32 bg-[#F6F6F7] border border-[#E2E2E6] rounded px-2 py-0.5 font-mono text-[11px] text-[#111114]"
                            />
                          </div>

                          {asset.category === 'prop' && (
                            <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#111114] font-medium">
                              <input
                                type="checkbox"
                                checked={Boolean(asset.useRealProductPhoto)}
                                onChange={(e) =>
                                  void updateAsset(asset.id, {
                                    useRealProductPhoto: e.target.checked,
                                  })
                                }
                                className="accent-[#C6202F]"
                              />
                              Anchor to Real Product Photo
                            </label>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#EAEAEF]">
                        <button
                          type="button"
                          disabled={isGen || isBatchGeneratingAssets}
                          onClick={() => void handleGenerateAssetSheet(asset.id)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-50 rounded-lg cursor-pointer transition-colors"
                        >
                          {isGen ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : asset.imageUrl ? (
                            <RefreshCw className="w-3.5 h-3.5" />
                          ) : (
                            <Wand2 className="w-3.5 h-3.5" />
                          )}
                          {asset.imageUrl ? 'Regenerate Sheet' : `Generate ${sheetLabel}`}
                        </button>

                        <button
                          type="button"
                          disabled={isUp}
                          onClick={() => assetInputRefs.current[asset.id]?.click()}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#24242B] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
                        >
                          {isUp ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Upload className="w-3.5 h-3.5 text-[#C6202F]" />
                          )}
                          Upload
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setActiveStage('style')}
              className="px-4 py-2 text-xs font-medium text-[#3A3A44] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
            >
              ← Back to Style
            </button>
            <button
              type="button"
              onClick={() => setActiveStage('storyboard')}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer shadow"
            >
              Generate Storyboard Frames
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>
      )}

      {/* ==================== STAGE 3: STORYBOARD GENERATOR & SHOTS ==================== */}
      {activeStage === 'storyboard' && (
        <section className="space-y-5">
          {/* Active Style & References Strip + Batch Generate Bar */}
          <div className="bg-white border border-[#E2E2E6] rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-[#111114]">
                  Active References:
                </span>
                <button
                  type="button"
                  onClick={() => setActiveStage('style')}
                  className="px-2 py-0.5 rounded bg-[#FDF4F5] border border-[#EABAC0] text-[#891A23] font-semibold cursor-pointer hover:bg-[#FCE8EA]"
                >
                  Style: {activeStyleMeta.label} ({studio.aspectRatio})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveStage('assets')}
                  className="px-2 py-0.5 rounded bg-[#F6F6F7] border border-[#D5D5DC] text-[#111114] font-medium cursor-pointer hover:border-[#C6202F]"
                >
                  {lockedReadyAssets.length} Locked Sheet{lockedReadyAssets.length === 1 ? '' : 's'}
                </button>
                <span className="px-2 py-0.5 rounded bg-[#F6F6F7] border border-[#D5D5DC] text-[#111114] font-medium">
                  {project.product.photos.length} Real Product Photo{project.product.photos.length === 1 ? '' : 's'}
                </span>
              </div>

              {/* Readiness Stats */}
              <div className="flex flex-wrap items-center gap-3 text-xs text-[#5A5A66] font-mono tabular-nums">
                <span>
                  Frames ready: <span className="text-[#111114]">{totalUploadedCount}/{project.shots.length}</span>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  AI &amp; hybrid ready:{' '}
                  <span
                    className={
                      uploadedAiHybridCount === aiHybridShots.length
                        ? 'text-emerald-700'
                        : 'text-[#891A23]'
                    }
                  >
                    {uploadedAiHybridCount}/{aiHybridShots.length}
                  </span>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isBatchGeneratingFrames ? (
                <button
                  type="button"
                  onClick={() => {
                    stopBatchRef.current = true;
                  }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#891A23] bg-rose-50 border border-rose-300 rounded-lg cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  {batchFrameProgress || 'Stopping...'}
                </button>
              ) : (
                <>
                  {missingAiHybridFrames > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleGenerateAllMissingFrames(false)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer shadow"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Generate {missingAiHybridFrames} AI/Hybrid Frame{missingAiHybridFrames > 1 ? 's' : ''}
                    </button>
                  )}
                  {missingAllFrames > missingAiHybridFrames && (
                    <button
                      type="button"
                      onClick={() => void handleGenerateAllMissingFrames(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#111114] bg-[#F6F6F7] hover:bg-[#EAEAEF] border border-[#D5D5DC] rounded-lg cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-[#C6202F]" />
                      Generate All {missingAllFrames} Missing (incl. Live)
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Ordered Shot Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {project.shots.map((shot) => {
              const isUploading = uploadingId === shot.id;
              const isGeneratingShot = Boolean(generatingShotIds[shot.id]);
              const routeLabel =
                shot.route === 'live'
                  ? 'Live shoot'
                  : shot.route === 'hybrid'
                    ? 'Hybrid'
                    : 'AI video';
              const includeProduct =
                productOverrideMap[shot.id] !== undefined
                  ? productOverrideMap[shot.id]
                  : shot.productInFrame;
              const includePrev = Boolean(prevContinuityMap[shot.id]);

              // Reference assets linked to this shot (or all locked sheets)
              const shotLinkedAssets = lockedReadyAssets.filter(
                (a) => !a.linkedShotIds?.length || a.linkedShotIds.includes(shot.id)
              );

              return (
                <div
                  key={shot.id}
                  className="bg-white border border-[#E2E2E6] rounded-xl overflow-hidden flex flex-col"
                >
                  {/* Card Header */}
                  <div className="px-4 py-3 bg-[#FBFBFC] border-b border-[#E2E2E6] flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-[#C6202F]">{shot.id}</span>
                      <span className="text-[#3A3A44] font-medium">{routeLabel}</span>
                      <span className="text-[#8A8A96]">·</span>
                      <span className="font-mono text-[#5A5A66] tabular-nums">
                        {shot.durationSec}s
                      </span>
                      {shot.productInFrame && (
                        <>
                          <span className="text-[#8A8A96]">·</span>
                          <span className="inline-flex items-center gap-1 text-[#891A23] font-medium">
                            <Package className="w-3.5 h-3.5" />
                            Product in frame
                          </span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      {shot.frameCheck?.passed ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Passed
                        </span>
                      ) : shot.frameCheck && !shot.frameCheck.passed ? (
                        <span className="inline-flex items-center gap-1 text-[#C6202F] font-medium">
                          <AlertCircle className="w-3.5 h-3.5" />
                          Needs Fix
                        </span>
                      ) : shot.frameImageUrl ? (
                        <span className="text-[#3A3A44]">Ready</span>
                      ) : (
                        <span className="text-[#6E6E7A]">Waiting</span>
                      )}
                    </div>
                  </div>

                  {/* Click / Paste / Drop Frame Area */}
                  <input
                    ref={(el) => {
                      frameInputRefs.current[shot.id] = el;
                    }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUploadFrame(shot.id, f);
                      e.target.value = '';
                    }}
                  />
                  <div
                    ref={(el) => {
                      frameBoxRefs.current[shot.id] = el;
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Upload or paste frame for ${shot.id}`}
                    onClick={() => frameInputRefs.current[shot.id]?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        frameInputRefs.current[shot.id]?.click();
                      }
                    }}
                    onPaste={(e) => {
                      const imgFile = extractClipboardImageFile(e.clipboardData);
                      if (imgFile) {
                        e.preventDefault();
                        setPasteHintShotId(null);
                        void handleUploadFrame(shot.id, imgFile);
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const dropped = Array.from(e.dataTransfer.files || []).find((f) =>
                        f.type.startsWith('image/')
                      );
                      if (dropped) void handleUploadFrame(shot.id, dropped);
                    }}
                    className={`aspect-video bg-[#F6F6F7] border-b relative flex items-center justify-center cursor-pointer transition-colors overflow-hidden focus:outline-none ${
                      pasteHintShotId === shot.id
                        ? 'border-[#C6202F] ring-2 ring-inset ring-[#C6202F]/40'
                        : 'border-[#E2E2E6] hover:bg-[#EAEAEF]'
                    }`}
                  >
                    {isGeneratingShot ? (
                      <div className="text-center p-6 space-y-2 text-[#111114]">
                        <Loader2 className="w-6 h-6 animate-spin text-[#C6202F] mx-auto" />
                        <div className="text-xs font-semibold">
                          Generating {shot.id} ({activeStyleMeta.label}) via Fal Nano Banana...
                        </div>
                        <div className="text-[11px] text-[#5A5A66]">
                          Using {shotLinkedAssets.length} sheet{shotLinkedAssets.length === 1 ? '' : 's'}
                          {includeProduct && project.product.photos.length > 0
                            ? ` + ${project.product.photos.length} product photo(s)`
                            : ''}
                        </div>
                      </div>
                    ) : shot.frameImageUrl ? (
                      <>
                        <img
                          src={shot.frameImageUrl}
                          alt={`Shot ${shot.id} frame`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-black/55 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center text-xs font-semibold text-white">
                          Click to upload replacement or paste (Ctrl+V / Cmd+V)
                        </div>
                      </>
                    ) : (
                      <div className="text-center p-6 space-y-2 text-[#6E6E7A]">
                        {isUploading ? (
                          <Loader2 className="w-6 h-6 animate-spin text-[#C6202F] mx-auto" />
                        ) : (
                          <Wand2 className="w-6 h-6 mx-auto text-[#C6202F]" />
                        )}
                        <div className="text-xs font-semibold text-[#24242B]">
                          {isUploading
                            ? 'Saving frame...'
                            : 'Generate via Nano Banana below, or click / paste image'}
                        </div>
                        <div className="text-[11px] text-[#6E6E7A]">
                          Drag an image, press Ctrl+V / Cmd+V, or generate with your locked references
                        </div>
                      </div>
                    )}
                  </div>

                  {pasteHintShotId === shot.id && (
                    <div className="px-4 py-1.5 bg-[#FDF4F5] border-b border-[#EABAC0] text-[11px] text-[#891A23]">
                      Frame box focused — press Ctrl+V (or Cmd+V) to paste an image.
                    </div>
                  )}

                  {/* Generate + Reference Controls Bar */}
                  <div className="px-4 py-2.5 bg-[#FBFBFC] border-b border-[#E2E2E6] space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        disabled={isGeneratingShot || isBatchGeneratingFrames}
                        onClick={() => void handleGenerateShotFrame(shot)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-50 rounded-lg cursor-pointer transition-colors"
                      >
                        {isGeneratingShot ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : shot.frameImageUrl ? (
                          <RefreshCw className="w-3.5 h-3.5" />
                        ) : (
                          <Wand2 className="w-3.5 h-3.5" />
                        )}
                        {shot.frameImageUrl ? 'Regenerate Frame' : 'Generate Frame'}
                      </button>

                      <div className="flex flex-wrap items-center gap-3 text-[11px]">
                        <button
                          type="button"
                          disabled={isUploading}
                          onClick={() => void handlePasteFromClipboardButton(shot.id)}
                          className="inline-flex items-center gap-1 text-[#24242B] hover:text-[#C6202F] font-medium cursor-pointer"
                        >
                          <ClipboardPaste className="w-3.5 h-3.5 text-[#C6202F]" />
                          Paste
                        </button>
                        <button
                          type="button"
                          onClick={() => setDrivePickerShotId(shot.id)}
                          className="inline-flex items-center gap-1 text-[#891A23] font-medium cursor-pointer"
                        >
                          <FolderSync className="w-3.5 h-3.5" />
                          Drive
                        </button>
                      </div>
                    </div>

                    {/* Per-shot reference switches */}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#5A5A66]">
                      {project.product.photos.length > 0 && (
                        <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#111114]">
                          <input
                            type="checkbox"
                            checked={includeProduct}
                            onChange={(e) =>
                              setProductOverrideMap((prev) => ({
                                ...prev,
                                [shot.id]: e.target.checked,
                              }))
                            }
                            className="accent-[#C6202F]"
                          />
                          Real Product Ref ({project.product.photos.length})
                        </label>
                      )}
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#111114]">
                        <input
                          type="checkbox"
                          checked={includePrev}
                          onChange={(e) =>
                            setPrevContinuityMap((prev) => ({
                              ...prev,
                              [shot.id]: e.target.checked,
                            }))
                          }
                          className="accent-[#C6202F]"
                        />
                        Chain Prev Frame
                      </label>
                      {shotLinkedAssets.length > 0 && (
                        <span className="truncate text-[#6E6E7A]">
                          Sheets: {shotLinkedAssets.map((a) => a.name).join(', ')}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Scene & Editable Copyable Frame Prompt */}
                  <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                    <div className="text-xs text-[#3A3A44] leading-relaxed">
                      <span className="text-[#6E6E7A] font-medium">Scene: </span>
                      {shot.scene}
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[#5A5A66]">
                          Frame prompt
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyPrompt(shot.id, shot.framePrompt)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] hover:bg-[#FCE8EA] rounded-md transition-colors cursor-pointer"
                        >
                          {copiedId === shot.id ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Copied
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              Copy
                            </>
                          )}
                        </button>
                      </div>

                      <textarea
                        rows={3}
                        value={shot.framePrompt}
                        onChange={(e) => updateShot(shot.id, { framePrompt: e.target.value })}
                        className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#24242B] focus:outline-none focus:border-[#C6202F] leading-relaxed"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <DriveAssetPickerModal
        isOpen={Boolean(drivePickerShotId)}
        projectId={project.id}
        initialFolderUrls={
          project.googleDriveFolderUrls?.length
            ? project.googleDriveFolderUrls
            : project.googleDriveFolderUrl
              ? [project.googleDriveFolderUrl]
              : []
        }
        mediaFilter="image"
        multiple={false}
        prefix="frame"
        title={
          drivePickerShotId
            ? `Pick Storyboard Frame for ${drivePickerShotId} from Google Drive`
            : 'Pick Storyboard Frame from Google Drive'
        }
        onClose={() => setDrivePickerShotId(null)}
        onImported={(assets: ImportedDriveAsset[]) => {
          const picked = assets[0];
          if (picked?.url && drivePickerShotId) {
            updateShot(drivePickerShotId, {
              frameImageUrl: picked.url,
              status: 'Frame Uploaded',
              frameCheck: null,
              productFrameApproved: false,
            });
          }
        }}
        onFoldersChange={(urls) => {
          void onUpdateProject({
            ...project,
            googleDriveFolderUrls: urls,
            googleDriveFolderUrl: urls[0] || undefined,
          });
        }}
      />
    </div>
  );
};
