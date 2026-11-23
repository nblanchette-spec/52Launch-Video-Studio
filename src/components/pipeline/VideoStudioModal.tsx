import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Sparkles,
  Loader2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Repeat,
  Download,
  Copy,
  Check,
  Volume2,
  VolumeX,
  UploadCloud,
  Dices,
  ArrowUpRight,
  ArrowRight,
  Sliders,
  ChevronDown,
  ChevronUp,
  Info,
  Type as TypeIcon,
  Image as ImageIcon,
  SplitSquareVertical,
  Clock,
  Images,
  Film,
  Plus,
  Trash2,
  Maximize2,
  Smartphone,
  Square,
  RectangleHorizontal,
  RectangleVertical,
  Music,
  Layers,
  ShieldCheck,
  FolderSync,
  RotateCcw,
  ClipboardPaste,
  Grid2x2,
  Lock,
  Scissors,
} from 'lucide-react';
import { parseJsonResponse } from '../../utils/safeFetch';
import {
  GridSplitClip,
  PipelineProject,
  PipelineShot,
  ShotClipHistoryItem,
} from '../../types/pipeline';
import { readAndOptimizeLocalImage } from '../../utils/imageUtils';
import { ImportedDriveAsset } from '../../utils/googleDriveSync';
import { DriveAssetPickerModal, DriveMediaFilter } from './DriveAssetPickerModal';
import {
  clampStudioDuration,
  estimateStudioCostUsd,
  getStudioAvailableAspectRatios,
  getStudioAvailableResolutions,
  getStudioFamily,
  getStudioModel,
  keyframeFrameIndex,
  resolveStudioResolution,
  STUDIO_MODELS,
  StudioAspectRatio,
  StudioModelId,
  StudioQualityTier,
  StudioReferenceTask,
  StudioResolution,
  StudioTimelineKeyframe,
  StudioWorkflowMode,
} from '../../utils/videoStudioCatalog';
import {
  appendGridBorderLockDirective,
  format2x2GridPrompt,
  GRID_QUADRANTS,
  resolveGridModeConfig,
  stitch2x2GridCanvas,
} from '../../utils/gridModeUtils';
import { GridSplitTray } from './GridSplitTray';
import { TopazUpscaleModal } from './TopazUpscaleModal';

interface VideoStudioModalProps {
  isOpen: boolean;
  project: PipelineProject;
  shot: PipelineShot | null;
  chainedStartFrameDataUrl?: string;
  onClose: () => void;
  onProjectUpdated: (updated: PipelineProject) => void;
}

const WORKFLOW_TABS: Array<{
  id: StudioWorkflowMode;
  label: string;
  icon: React.ElementType;
}> = [
  { id: 'text_to_video', label: 'Text', icon: TypeIcon },
  { id: 'image_to_video', label: 'Image', icon: ImageIcon },
  { id: 'first_last_frame', label: 'Pair', icon: SplitSquareVertical },
  { id: 'keyframes_timeline', label: 'Timeline', icon: Clock },
  { id: 'reference_to_video', label: 'Ref / Multi', icon: Images },
  { id: 'video_extend', label: 'Extend', icon: ArrowRight },
  { id: 'video_edit', label: 'V2V Edit', icon: Film },
  { id: 'video_reframe', label: 'Reframe', icon: Maximize2 },
];

const REFERENCE_TASKS: Array<{ id: StudioReferenceTask; label: string; hint: string }> = [
  { id: 'reference', label: 'Reference', hint: 'Use media as guidance' },
  { id: 'editing', label: 'Edit / Add', hint: 'Modify or add elements to video' },
  { id: 'extension', label: 'Extend', hint: 'Continue a video clip' },
  { id: 'auto', label: 'Auto', hint: 'Let the model decide' },
];

const CAMERA_TAGS = [
  'Dolly In',
  'Dynamic Orbit',
  'Drone Flyover',
  'Pan Right',
  'Crane Up',
  'FPV Dive',
  'Anamorphic 35mm',
  'Hyperlapse',
];

const ASPECT_ICONS: Record<StudioAspectRatio, { label: string; icon: React.ElementType }> = {
  auto: { label: 'Auto', icon: Sparkles },
  '16:9': { label: '16:9', icon: Maximize2 },
  '9:16': { label: '9:16', icon: Smartphone },
  '1:1': { label: '1:1', icon: Square },
  '21:9': { label: '21:9', icon: RectangleHorizontal },
  '2:1': { label: '2:1', icon: RectangleHorizontal },
  '4:3': { label: '4:3', icon: RectangleHorizontal },
  '3:4': { label: '3:4', icon: RectangleVertical },
};

const RESOLUTION_LABELS: Record<StudioResolution, string> = {
  '480p': '480p',
  '540p': '540p',
  '720p': '720p',
  '1080p': '1080p',
  '1440p': '2K',
  '2160p': '4K',
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function mapShotModelToStudioId(model: PipelineShot['model']): StudioModelId {
  switch (model) {
    case 'flux3':
      return 'flux-3';
    case 'kling':
      return 'kling-4.0';
    case 'wan':
      return 'wan-3.0-prime';
    case 'luma':
      return 'luma-ray-3.2';
    case 'veo':
      return 'veo-3.1';
    case 'omni':
      return 'gemini-omni-flash';
    default:
      return 'seedance-2.0';
  }
}

export const VideoStudioModal: React.FC<VideoStudioModalProps> = ({
  isOpen,
  project,
  shot,
  chainedStartFrameDataUrl,
  onClose,
  onProjectUpdated,
}) => {
  const [modelId, setModelId] = useState<StudioModelId>('seedance-2.0');
  const [workflowMode, setWorkflowMode] = useState<StudioWorkflowMode>('image_to_video');
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<StudioAspectRatio>('16:9');
  const [duration, setDuration] = useState(5);
  const [qualityTier, setQualityTier] = useState<StudioQualityTier>('draft');
  const [resolution, setResolution] = useState<StudioResolution | undefined>('480p');
  const [nativeAudio, setNativeAudio] = useState(true);
  const [safetyTolerance, setSafetyTolerance] = useState(2);
  const [enableSafetyChecker, setEnableSafetyChecker] = useState(false);
  const [seed, setSeed] = useState(428914);
  const [startFrameUrl, setStartFrameUrl] = useState<string | null>(null);
  const [endFrameUrl, setEndFrameUrl] = useState<string | null>(null);
  const [keyframes, setKeyframes] = useState<StudioTimelineKeyframe[]>([]);
  const [sourceVideoUrl, setSourceVideoUrl] = useState<string | null>(null);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [referenceElements, setReferenceElements] = useState<string[]>([]);
  const [referenceVideos, setReferenceVideos] = useState<string[]>([]);
  const [referenceAudioUrl, setReferenceAudioUrl] = useState<string | null>(null);
  const [referenceTask, setReferenceTask] = useState<StudioReferenceTask>('reference');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 2x2 Multi-Shot Grid Mode state
  const [isGridMode, setIsGridMode] = useState(false);
  const [gridInputTab, setGridInputTab] = useState<'frames' | 'prompts'>('frames');
  const [gridFrames, setGridFrames] = useState<
    [string | null, string | null, string | null, string | null]
  >([null, null, null, null]);
  const [gridShotPrompts, setGridShotPrompts] = useState<
    [string, string, string, string]
  >(['', '', '', '']);
  const [isStitchingGrid, setIsStitchingGrid] = useState(false);
  const [gridUpgradeNotice, setGridUpgradeNotice] = useState<string | null>(null);
  const [gridPasteIndex, setGridPasteIndex] = useState<number | null>(null);
  const [showSplitTrayManual, setShowSplitTrayManual] = useState(false);

  // Stage player state
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewVersion, setPreviewVersion] = useState<'original' | 'upscaled'>('original');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);

  const [falKeyConfigured, setFalKeyConfigured] = useState<boolean | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState(false);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [isDraggingSourceVideo, setIsDraggingSourceVideo] = useState(false);
  const [pasteHintTarget, setPasteHintTarget] = useState<'start' | 'end' | null>(null);
  const [upscaleModalOpen, setUpscaleModalOpen] = useState(false);
  const [drivePickerTarget, setDrivePickerTarget] = useState<
    | { kind: 'start' }
    | { kind: 'end' }
    | { kind: 'keyframe'; keyframeId: string }
    | { kind: 'grid_quadrant'; quadrantIndex: number }
    | { kind: 'ref_image' }
    | { kind: 'element' }
    | { kind: 'source_video' }
    | { kind: 'ref_video' }
    | { kind: 'ref_audio' }
    | null
  >(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const startInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);
  const startBoxRef = useRef<HTMLDivElement>(null);
  const endBoxRef = useRef<HTMLDivElement>(null);
  const sourceVideoInputRef = useRef<HTMLInputElement>(null);
  const refImagesInputRef = useRef<HTMLInputElement>(null);
  const refElementsInputRef = useRef<HTMLInputElement>(null);
  const refVideosInputRef = useRef<HTMLInputElement>(null);
  const refAudioInputRef = useRef<HTMLInputElement>(null);
  const keyframeInputRef = useRef<HTMLInputElement>(null);
  const keyframeTargetIdRef = useRef<string | null>(null);
  const gridQuadInputRef = useRef<HTMLInputElement>(null);
  const gridQuadTargetIdxRef = useRef<number>(0);

  const parentShot =
    shot?.chainFrom && shot.chainFrom !== 'none'
      ? project.shots.find((s) => s.id === shot.chainFrom)
      : undefined;

  const getClipGalleryForShot = (s: PipelineShot): ShotClipHistoryItem[] => {
    if (s.videoHistory && s.videoHistory.length > 0) {
      return s.videoHistory;
    }
    if (s.videoUrl) {
      const mId = mapShotModelToStudioId(s.model);
      const wf: StudioWorkflowMode = s.frameImageUrl ? 'image_to_video' : 'text_to_video';
      return [
        {
          id: `clip-legacy-${s.id}`,
          videoUrl: s.videoUrl,
          createdAt: project.updatedAt,
          modelId: mId,
          workflowMode: wf,
          prompt: s.videoPrompt || s.scene || '',
          negativePrompt: s.negativePrompt || '',
          aspectRatio: '16:9',
          duration: clampStudioDuration(mId, s.durationSec || 5),
          qualityTier: 'draft',
          resolution:
            s.videoResolution || getStudioAvailableResolutions(mId, wf)[0],
          nativeAudio: true,
          seed: s.videoSeed,
          startFrameUrl: s.frameImageUrl || null,
          draftCacheUrl: s.draftCacheUrl || null,
          upscaledVideoUrl: s.upscaledVideoUrl || null,
          upscaledResolution: s.upscaledResolution || null,
        },
      ];
    }
    return [];
  };

  const applyClipSettingsToPanel = (clip: ShotClipHistoryItem, fallbackShot: PipelineShot) => {
    const validModelId: StudioModelId =
      clip.modelId in STUDIO_MODELS
        ? (clip.modelId as StudioModelId)
        : mapShotModelToStudioId(fallbackShot.model);
    const spec = getStudioModel(validModelId);
    const nextMode: StudioWorkflowMode = spec.workflowModes.includes(
      clip.workflowMode as StudioWorkflowMode
    )
      ? (clip.workflowMode as StudioWorkflowMode)
      : spec.workflowModes[0];
    const validAspects = getStudioAvailableAspectRatios(validModelId, nextMode);
    const nextAspect: StudioAspectRatio = validAspects.includes(
      clip.aspectRatio as StudioAspectRatio
    )
      ? (clip.aspectRatio as StudioAspectRatio)
      : validAspects.includes('16:9')
        ? '16:9'
        : validAspects[0];
    const validResList = getStudioAvailableResolutions(validModelId, nextMode);
    const nextRes: StudioResolution = validResList.includes(
      clip.resolution as StudioResolution
    )
      ? (clip.resolution as StudioResolution)
      : validResList[0];
    const dur = clampStudioDuration(validModelId, clip.duration || fallbackShot.durationSec || 5);

    setActiveClipId(clip.id);
    setModelId(validModelId);
    setWorkflowMode(nextMode);
    setPrompt(clip.prompt || fallbackShot.videoPrompt || fallbackShot.scene || '');
    setNegativePrompt(clip.negativePrompt ?? fallbackShot.negativePrompt ?? '');
    setAspectRatio(nextAspect);
    setDuration(dur);
    setQualityTier(clip.qualityTier === 'final' ? 'final' : 'draft');
    setResolution(nextRes);
    setNativeAudio(clip.nativeAudio !== undefined ? clip.nativeAudio : true);
    if (clip.safetyTolerance !== undefined) setSafetyTolerance(clip.safetyTolerance);
    if (clip.enableSafetyChecker !== undefined) {
      setEnableSafetyChecker(clip.enableSafetyChecker);
    }
    if (clip.seed !== undefined && clip.seed !== null) {
      setSeed(clip.seed);
    }
    setStartFrameUrl(clip.startFrameUrl ?? fallbackShot.frameImageUrl ?? null);
    setEndFrameUrl(clip.endFrameUrl ?? null);
    setSourceVideoUrl(clip.sourceVideoUrl ?? null);
    setKeyframes(
      clip.keyframes && clip.keyframes.length > 0
        ? clip.keyframes
        : [
            {
              id: 'kf-start',
              timeSeconds: 0,
              imageUrl: clip.startFrameUrl || fallbackShot.frameImageUrl || '',
              label: 'Opening frame',
            },
            {
              id: 'kf-end',
              timeSeconds: dur,
              imageUrl: clip.endFrameUrl || '',
              label: 'Target ending',
            },
          ]
    );
    setReferenceImages(clip.referenceImages || []);
    setReferenceElements(clip.referenceElements || []);
    setReferenceVideos(clip.referenceVideos || []);
    setReferenceAudioUrl(clip.referenceAudioUrl ?? null);
    setReferenceTask((clip.referenceTask as StudioReferenceTask) || 'reference');
    const clipGrid = Boolean(clip.isGridMode || clip.gridSplitClips?.length);
    setIsGridMode(clipGrid);
    setShowSplitTrayManual(Boolean(clip.gridSplitClips?.length));
    setGridFrames([
      clip.gridFrameInputs?.[0] || null,
      clip.gridFrameInputs?.[1] || null,
      clip.gridFrameInputs?.[2] || null,
      clip.gridFrameInputs?.[3] || null,
    ]);
    setGridShotPrompts([
      clip.gridShotPrompts?.[0] || '',
      clip.gridShotPrompts?.[1] || '',
      clip.gridShotPrompts?.[2] || '',
      clip.gridShotPrompts?.[3] || '',
    ]);
    setGridUpgradeNotice(null);
    setPreviewVersion(clip.upscaledVideoUrl ? 'upscaled' : 'original');
    setIsPlaying(false);
    setCurrentTime(0);
  };

  // Pre-fill studio fields on open (cheapest draft defaults for new shots, or active clip settings if rendered)
  useEffect(() => {
    if (!isOpen || !shot) return;
    const gallery = getClipGalleryForShot(shot);
    if (gallery.length > 0 && !chainedStartFrameDataUrl) {
      applyClipSettingsToPanel(gallery[0], shot);
    } else {
      const initialModel = mapShotModelToStudioId(shot.model);
      const initialFrame = chainedStartFrameDataUrl || shot.frameImageUrl || null;
      const initialMode: StudioWorkflowMode = initialFrame
        ? 'image_to_video'
        : 'text_to_video';
      const initialDur = clampStudioDuration(initialModel, shot.durationSec || 5);
      const lowestRes = getStudioAvailableResolutions(initialModel, initialMode)[0];

      setActiveClipId(gallery[0]?.id || null);
      setModelId(initialModel);
      setWorkflowMode(initialMode);
      setPrompt(shot.videoPrompt || shot.scene || '');
      setNegativePrompt(shot.negativePrompt || '');
      setAspectRatio('16:9');
      setDuration(initialDur);
      setQualityTier('draft');
      setResolution(lowestRes);
      setNativeAudio(true);
      setSafetyTolerance(2);
      setEnableSafetyChecker(false);
      setSeed(shot.videoSeed ?? Math.floor(Math.random() * 900000 + 100000));
      setStartFrameUrl(initialFrame);
      setEndFrameUrl(null);
      setSourceVideoUrl(null);
      setKeyframes([
        {
          id: 'kf-start',
          timeSeconds: 0,
          imageUrl: initialFrame || '',
          label: 'Opening frame',
        },
        {
          id: 'kf-end',
          timeSeconds: initialDur,
          imageUrl: '',
          label: 'Target ending',
        },
      ]);
      setReferenceImages([]);
      setReferenceElements([]);
      setReferenceVideos([]);
      setReferenceAudioUrl(null);
      setReferenceTask('reference');
      setIsGridMode(Boolean(shot.isGridMode || shot.gridSplitClips?.length));
      setShowSplitTrayManual(Boolean(shot.gridSplitClips?.length));
      setGridFrames([
        shot.gridFrameInputs?.[0] || null,
        shot.gridFrameInputs?.[1] || null,
        shot.gridFrameInputs?.[2] || null,
        shot.gridFrameInputs?.[3] || null,
      ]);
      setGridShotPrompts([
        shot.gridShotPrompts?.[0] || '',
        shot.gridShotPrompts?.[1] || '',
        shot.gridShotPrompts?.[2] || '',
        shot.gridShotPrompts?.[3] || '',
      ]);
      setGridUpgradeNotice(null);
      setPreviewVersion(shot.upscaledVideoUrl ? 'upscaled' : 'original');
    }

    setUpscaleModalOpen(false);
    setDrivePickerTarget(null);
    setGridPasteIndex(null);
    setErrorMsg(null);
    setIsPlaying(false);
    setCurrentTime(0);

    fetch('/api/pipeline/fal-status')
      .then((r) => parseJsonResponse<{ falKeyConfigured?: boolean }>(r))
      .then((d) => setFalKeyConfigured(Boolean(d.falKeyConfigured)))
      .catch(() => setFalKeyConfigured(null));
  }, [isOpen, shot?.id, chainedStartFrameDataUrl]);

  if (!isOpen || !shot) return null;

  const model = getStudioModel(modelId);
  const family = getStudioFamily(modelId);
  const availableModes = WORKFLOW_TABS.filter((m) =>
    model.workflowModes.includes(m.id)
  );
  const availableAspectRatios = getStudioAvailableAspectRatios(modelId, workflowMode);
  const gridResolved = isGridMode
    ? resolveGridModeConfig({
        modelId,
        workflowMode,
        requestedResolution: resolution,
      })
    : null;
  const availableResolutions = gridResolved
    ? gridResolved.allowedResolutions
    : getStudioAvailableResolutions(modelId, workflowMode);
  const effectiveResolution = gridResolved
    ? gridResolved.resolvedResolution
    : resolveStudioResolution({
        modelId,
        qualityTier,
        workflowMode,
        resolution,
      });
  const effectiveQualityTierForEstimate: StudioQualityTier = isGridMode
    ? 'final'
    : qualityTier;
  const estimatedCost = estimateStudioCostUsd({
    modelId,
    qualityTier: effectiveQualityTierForEstimate,
    workflowMode,
    resolution: effectiveResolution,
    duration,
    nativeAudio,
  });

  const supportsDraftTier =
    model.family === 'seedance' || model.supportsDraftEnhance;

  const handleToggleGridMode = async (enable: boolean) => {
    setErrorMsg(null);
    setGridUpgradeNotice(null);
    setIsGridMode(enable);
    if (!enable) {
      return;
    }

    const hasAnyFrame = gridFrames.some(Boolean);
    const preferredMode: StudioWorkflowMode = hasAnyFrame
      ? 'image_to_video'
      : workflowMode === 'image_to_video' && startFrameUrl
        ? 'image_to_video'
        : 'text_to_video';

    const cfg = resolveGridModeConfig({
      modelId,
      workflowMode: preferredMode,
      requestedResolution: resolution,
    });

    if (cfg.upgradedFromModel) {
      setModelId(cfg.modelId);
      setDuration(clampStudioDuration(cfg.modelId, duration));
      setGridUpgradeNotice(
        `Switched from ${getStudioModel(cfg.upgradedFromModel).label} (720p cap) to ${getStudioModel(cfg.modelId).label} to enforce ${cfg.resolvedResolution} Grid Mode output.`
      );
    }

    const targetSpec = getStudioModel(cfg.modelId);
    const nextMode = targetSpec.workflowModes.includes(preferredMode)
      ? preferredMode
      : targetSpec.workflowModes.includes('image_to_video')
        ? 'image_to_video'
        : targetSpec.workflowModes[0];

    setWorkflowMode(nextMode);
    setAspectRatio('16:9');
    setQualityTier('final');
    setResolution(cfg.resolvedResolution);

    if (!hasAnyFrame && gridShotPrompts.every((p) => !p.trim())) {
      const seedPrompt = (shot.videoPrompt || shot.scene || '').trim();
      if (seedPrompt) {
        setGridShotPrompts([seedPrompt, '', '', '']);
      }
    }
  };

  const handleModelSelect = (nextId: StudioModelId) => {
    const requestedCfg = isGridMode
      ? resolveGridModeConfig({
          modelId: nextId,
          workflowMode,
          requestedResolution: resolution,
        })
      : null;
    const resolvedId = requestedCfg ? requestedCfg.modelId : nextId;
    if (requestedCfg?.upgradedFromModel) {
      setGridUpgradeNotice(
        `${getStudioModel(requestedCfg.upgradedFromModel).label} caps at 720p; using ${getStudioModel(resolvedId).label} (${requestedCfg.resolvedResolution}) for 2x2 Grid Mode.`
      );
    } else {
      setGridUpgradeNotice(null);
    }
    const spec = getStudioModel(resolvedId);
    const nextDuration = clampStudioDuration(resolvedId, duration);
    const nextMode = spec.workflowModes.includes(workflowMode)
      ? workflowMode
      : spec.workflowModes[0];
    const nextAspectList = getStudioAvailableAspectRatios(resolvedId, nextMode);
    const nextAspect = isGridMode
      ? '16:9'
      : nextAspectList.includes(aspectRatio)
        ? aspectRatio
        : nextAspectList.includes('16:9')
          ? '16:9'
          : nextAspectList[0];
    const nextResolutions = getStudioAvailableResolutions(resolvedId, nextMode);
    setModelId(resolvedId);
    setDuration(nextDuration);
    setWorkflowMode(nextMode);
    setAspectRatio(nextAspect);
    if (isGridMode) {
      setQualityTier('final');
      setResolution(
        resolveGridModeConfig({
          modelId: resolvedId,
          workflowMode: nextMode,
          requestedResolution: resolution,
        }).resolvedResolution
      );
    } else {
      setQualityTier('draft');
      setResolution(nextResolutions[0]);
    }
  };

  const handleModeSelect = (nextMode: StudioWorkflowMode) => {
    setWorkflowMode(nextMode);
    const nextAspectList = getStudioAvailableAspectRatios(modelId, nextMode);
    if (isGridMode) {
      setAspectRatio('16:9');
      setQualityTier('final');
      setResolution(
        resolveGridModeConfig({
          modelId,
          workflowMode: nextMode,
          requestedResolution: resolution,
        }).resolvedResolution
      );
      return;
    }
    if (!nextAspectList.includes(aspectRatio)) {
      setAspectRatio(nextAspectList.includes('16:9') ? '16:9' : nextAspectList[0]);
    }
    const nextResList = getStudioAvailableResolutions(modelId, nextMode);
    if (resolution && !nextResList.includes(resolution)) {
      setResolution(undefined);
    }
  };

  const handleInsertPromptTag = (tag: string) => {
    const el = promptRef.current;
    const current = prompt;
    const hasSel = el && el.selectionStart != null && el.selectionEnd != null;
    const start = hasSel ? el.selectionStart : current.length;
    const end = hasSel ? el.selectionEnd : current.length;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const needLead = before.length > 0 && !/\s$/.test(before);
    const needTrail = after.length === 0 || !/^\s/.test(after);
    const insert = `${needLead ? ' ' : ''}${tag}${needTrail ? ' ' : ''}`;
    setPrompt(before + insert + after);
    const caret = (before + insert).length;
    requestAnimationFrame(() => {
      if (promptRef.current) {
        promptRef.current.focus();
        promptRef.current.setSelectionRange(caret, caret);
      }
    });
  };

  const handleAddTag = (tag: string) => {
    const trimmed = prompt.trim();
    if (trimmed.includes(tag)) return;
    setPrompt(trimmed ? `${trimmed}, ${tag}` : tag);
  };

  const handleCopyPrompt = async () => {
    if (!prompt.trim()) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 1800);
    } catch {
      // Ignore
    }
  };

  const handleImageUpload = async (
    target: 'start' | 'end' | 'ref' | 'element' | 'keyframe',
    files: File[],
    keyframeId?: string
  ) => {
    setErrorMsg(null);
    try {
      if (target === 'ref') {
        const urls = await Promise.all(
          files.map((f) => readAndOptimizeLocalImage(f, 1400))
        );
        const maxAllowed =
          model.family === 'flux-3'
            ? STUDIO_MODELS['seedance-2.5'].maxReferenceImages
            : model.maxReferenceImages;
        if (model.family === 'flux-3') {
          handleModelSelect('seedance-2.5');
        }
        setReferenceImages((prev) => [...prev, ...urls].slice(0, Math.max(1, maxAllowed)));
        return;
      }
      if (target === 'element') {
        const urls = await Promise.all(
          files.map((f) => readAndOptimizeLocalImage(f, 1400))
        );
        setReferenceElements((prev) => [...prev, ...urls].slice(0, 6));
        return;
      }
      const file = files[0];
      if (!file) return;
      const dataUrl = await readAndOptimizeLocalImage(file, 1400);
      if (target === 'start') setStartFrameUrl(dataUrl);
      else if (target === 'end') setEndFrameUrl(dataUrl);
      else if (target === 'keyframe' && keyframeId) {
        setKeyframes((prev) =>
          prev.map((k) => (k.id === keyframeId ? { ...k, imageUrl: dataUrl } : k))
        );
      }
    } catch {
      setErrorMsg('Could not read that image file.');
    }
  };

  const extractImageFileFromClipboardEvent = (
    e: React.ClipboardEvent<HTMLElement>
  ): File | null => {
    const items = Array.from(e.clipboardData?.items || []);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) return file;
      }
    }
    const files = Array.from(e.clipboardData?.files || []);
    return files.find((f) => f.type.startsWith('image/')) || null;
  };

  const handleFramePasteEvent = async (
    target: 'start' | 'end',
    e: React.ClipboardEvent<HTMLElement>
  ) => {
    const imageFile = extractImageFileFromClipboardEvent(e);
    if (!imageFile) return;
    e.preventDefault();
    setPasteHintTarget(null);
    await handleImageUpload(target, [imageFile]);
  };

  const handlePasteButtonClick = async (target: 'start' | 'end') => {
    setErrorMsg(null);
    setPasteHintTarget(null);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
          const imgType = item.types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            const ext = imgType.split('/')[1]?.split('+')[0] || 'png';
            const file = new File([blob], `pasted-${target}.${ext}`, { type: imgType });
            await handleImageUpload(target, [file]);
            return;
          }
        }
        setErrorMsg('Clipboard does not contain an image. Copy an image first (e.g. from Google Flow) and paste.');
        return;
      }
    } catch {
      // Fallback for iframe permission restrictions
    }
    const refBox = target === 'start' ? startBoxRef.current : endBoxRef.current;
    refBox?.focus();
    setPasteHintTarget(target);
  };

  const uploadMediaViaServer = async (file: File, prefix: string): Promise<string> => {
    const dataUrl = await fileToDataUrl(file);
    const resp = await fetch('/api/pipeline/upload-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: project.id,
        dataUrl,
        prefix,
      }),
    });
    const data = await parseJsonResponse<{ url?: string; falUrl?: string }>(
      resp,
      'Could not upload media file.'
    );
    return (data.url || data.falUrl) as string;
  };

  const handleVideoUpload = async (
    target: 'source' | 'ref',
    files: File[]
  ) => {
    if (!files.length) return;
    setErrorMsg(null);
    setIsUploadingMedia(true);
    try {
      if (target === 'source') {
        const uploadedUrl = await uploadMediaViaServer(files[0], 'v2v-src');
        setSourceVideoUrl(uploadedUrl);
      } else {
        const uploaded = await Promise.all(
          files.map((f) => uploadMediaViaServer(f, 'ref-vid'))
        );
        const maxAllowed = Math.max(1, model.maxReferenceVideos);
        setReferenceVideos((prev) => [...prev, ...uploaded].slice(0, maxAllowed));
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not upload that video file.'
      );
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleAudioUpload = async (file: File) => {
    setErrorMsg(null);
    setIsUploadingMedia(true);
    try {
      const uploadedUrl = await uploadMediaViaServer(file, 'ref-audio');
      setReferenceAudioUrl(uploadedUrl);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not upload that audio file.'
      );
    } finally {
      setIsUploadingMedia(false);
    }
  };

  const handleDriveAssetsImported = (assets: ImportedDriveAsset[]) => {
    if (!drivePickerTarget || assets.length === 0) return;
    setErrorMsg(null);
    const urls = assets.map((a) => a.falUrl || a.url || '').filter(Boolean);
    if (urls.length === 0) return;

    switch (drivePickerTarget.kind) {
      case 'start':
        setStartFrameUrl(assets[0].url || urls[0]);
        break;
      case 'end':
        setEndFrameUrl(assets[0].url || urls[0]);
        break;
      case 'keyframe': {
        const kfUrl = assets[0].url || urls[0];
        const targetId = drivePickerTarget.keyframeId;
        setKeyframes((prev) =>
          prev.map((k) => (k.id === targetId ? { ...k, imageUrl: kfUrl } : k))
        );
        break;
      }
      case 'grid_quadrant': {
        const qUrl = assets[0].url || urls[0];
        void updateGridQuadrantFrame(drivePickerTarget.quadrantIndex, qUrl);
        break;
      }
      case 'ref_image': {
        const maxAllowed =
          model.family === 'flux-3'
            ? STUDIO_MODELS['seedance-2.5'].maxReferenceImages
            : model.maxReferenceImages;
        if (model.family === 'flux-3') {
          handleModelSelect('seedance-2.5');
        }
        const imgUrls = assets.map((a) => a.url || '').filter(Boolean);
        setReferenceImages((prev) =>
          [...prev, ...imgUrls].slice(0, Math.max(1, maxAllowed))
        );
        break;
      }
      case 'element': {
        const elUrls = assets.map((a) => a.url || '').filter(Boolean);
        setReferenceElements((prev) => [...prev, ...elUrls].slice(0, 6));
        break;
      }
      case 'source_video':
        setSourceVideoUrl(urls[0]);
        break;
      case 'ref_video': {
        const maxVid = Math.max(1, model.maxReferenceVideos);
        setReferenceVideos((prev) => [...prev, ...urls].slice(0, maxVid));
        break;
      }
      case 'ref_audio':
        setReferenceAudioUrl(urls[0]);
        break;
    }
  };

  const restitchAndApplyGridCanvas = async (
    nextFrames: [string | null, string | null, string | null, string | null]
  ) => {
    const hasAny = nextFrames.some(Boolean);
    if (!hasAny) {
      setStartFrameUrl(null);
      if (isGridMode && model.workflowModes.includes('text_to_video')) {
        setWorkflowMode('text_to_video');
      }
      return;
    }
    setIsStitchingGrid(true);
    setErrorMsg(null);
    try {
      const compositeDataUrl = await stitch2x2GridCanvas(nextFrames);
      setStartFrameUrl(compositeDataUrl);
      if (model.workflowModes.includes('image_to_video')) {
        setWorkflowMode('image_to_video');
      } else if (model.workflowModes.includes('reference_to_video')) {
        setWorkflowMode('reference_to_video');
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Could not stitch 2x2 grid canvas.'
      );
    } finally {
      setIsStitchingGrid(false);
    }
  };

  const updateGridQuadrantFrame = async (
    index: number,
    imageUrl: string | null
  ) => {
    const next: [string | null, string | null, string | null, string | null] = [
      ...gridFrames,
    ] as [string | null, string | null, string | null, string | null];
    next[index] = imageUrl;
    setGridFrames(next);
    await restitchAndApplyGridCanvas(next);
  };

  const handleGridQuadrantFileUpload = async (
    index: number,
    files: File[]
  ) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setErrorMsg(null);
    try {
      const next: [string | null, string | null, string | null, string | null] = [
        ...gridFrames,
      ] as [string | null, string | null, string | null, string | null];
      for (let offset = 0; offset < imageFiles.length && index + offset < 4; offset++) {
        next[index + offset] = await readAndOptimizeLocalImage(
          imageFiles[offset],
          1400
        );
      }
      setGridFrames(next);
      await restitchAndApplyGridCanvas(next);
    } catch {
      setErrorMsg('Could not load that quadrant image.');
    }
  };

  const handleGridQuadrantPasteButton = async (index: number) => {
    setErrorMsg(null);
    setGridPasteIndex(null);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
        const clipboardItems = await navigator.clipboard.read();
        for (const item of clipboardItems) {
          const imgType = item.types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            const ext = imgType.split('/')[1]?.split('+')[0] || 'png';
            const file = new File([blob], `pasted-grid-${index}.${ext}`, {
              type: imgType,
            });
            await handleGridQuadrantFileUpload(index, [file]);
            return;
          }
        }
        setErrorMsg(
          'Clipboard does not contain an image. Copy an image first and paste.'
        );
        return;
      }
    } catch {
      // Clipboard API fallback hint
    }
    setGridPasteIndex(index);
  };

  const handleGridShotPromptChange = (index: number, value: string) => {
    const next: [string, string, string, string] = [...gridShotPrompts] as [
      string,
      string,
      string,
      string,
    ];
    next[index] = value;
    setGridShotPrompts(next);
    setPrompt(
      format2x2GridPrompt({
        quadrantPrompts: next,
        hasStitchedImage: gridFrames.some(Boolean),
      })
    );
  };

  const handleFillGridFromProjectShots = (target: 'frames' | 'prompts') => {
    if (target === 'frames') {
      const shotImgs = project.shots
        .filter((s) => Boolean(s.frameImageUrl))
        .slice(0, 4)
        .map((s) => s.frameImageUrl as string);
      const next: [string | null, string | null, string | null, string | null] =
        [
          shotImgs[0] || gridFrames[0],
          shotImgs[1] || gridFrames[1],
          shotImgs[2] || gridFrames[2],
          shotImgs[3] || gridFrames[3],
        ];
      setGridFrames(next);
      void restitchAndApplyGridCanvas(next);
    } else {
      const candidatePrompts = project.shots
        .filter((s) => s.route !== 'live')
        .slice(0, 4)
        .map((s) => (s.videoPrompt || s.scene || '').trim());
      const next: [string, string, string, string] = [
        candidatePrompts[0] || gridShotPrompts[0],
        candidatePrompts[1] || gridShotPrompts[1],
        candidatePrompts[2] || gridShotPrompts[2],
        candidatePrompts[3] || gridShotPrompts[3],
      ];
      setGridShotPrompts(next);
      setPrompt(
        format2x2GridPrompt({
          quadrantPrompts: next,
          hasStitchedImage: gridFrames.some(Boolean),
        })
      );
    }
  };

  const handleGenerate = async () => {
    setErrorMsg(null);
    setIsGenerating(true);
    try {
      const submissionPrompt = isGridMode
        ? appendGridBorderLockDirective(
            prompt.trim() ||
              format2x2GridPrompt({
                quadrantPrompts: gridShotPrompts,
                hasStitchedImage: gridFrames.some(Boolean),
              })
          )
        : prompt;

      const resp = await fetch('/api/pipeline/studio-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          shotId: shot.id,
          modelId,
          workflowMode,
          prompt: submissionPrompt,
          negativePrompt,
          aspectRatio: isGridMode ? '16:9' : aspectRatio,
          duration,
          qualityTier: isGridMode
            ? 'final'
            : supportsDraftTier
              ? qualityTier
              : 'draft',
          resolution: effectiveResolution,
          nativeAudio,
          safetyTolerance,
          enableSafetyChecker,
          seed,
          startFrameUrl,
          endFrameUrl,
          keyframes,
          sourceVideoUrl,
          referenceImages,
          referenceElements,
          referenceVideos,
          referenceAudioUrl,
          referenceTask,
          isGridMode,
          gridFrameInputs: isGridMode
            ? gridFrames.map((f) => f || '')
            : undefined,
          gridShotPrompts: isGridMode ? gridShotPrompts : undefined,
        }),
      });
      const data = await parseJsonResponse<{ project: PipelineProject; clipId?: string }>(
        resp,
        'Video generation failed.'
      );
      onProjectUpdated(data.project);
      if (data.clipId) {
        setActiveClipId(data.clipId);
      }
      setPreviewVersion('original');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Video generation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExtendFromCurrent = () => {
    if (!shot.videoUrl) return;
    if (model.workflowModes.includes('video_extend') && model.family === 'veo') {
      setSourceVideoUrl(shot.videoUrl);
      handleModeSelect('video_extend');
    } else if (model.workflowModes.includes('video_edit') && model.family === 'gemini-omni') {
      setSourceVideoUrl(shot.videoUrl);
      handleModeSelect('video_edit');
    } else if (model.workflowModes.includes('reference_to_video')) {
      setReferenceVideos((prev) =>
        prev.includes(shot.videoUrl!)
          ? prev
          : [shot.videoUrl!, ...prev].slice(0, Math.max(1, model.maxReferenceVideos))
      );
      setReferenceTask('extension');
      handleModeSelect('reference_to_video');
    } else if (model.workflowModes.includes('video_edit')) {
      setSourceVideoUrl(shot.videoUrl);
      handleModeSelect('video_edit');
    }
  };

  const handleEnhanceDraft = async () => {
    if (!shot.draftCacheUrl) return;
    setErrorMsg(null);
    setIsEnhancing(true);
    try {
      const resp = await fetch('/api/pipeline/studio-enhance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: project.id,
          shotId: shot.id,
          draftCacheUrl: shot.draftCacheUrl,
          safetyTolerance,
        }),
      });
      const data = await parseJsonResponse<{ project: PipelineProject }>(
        resp,
        'Draft enhance failed.'
      );
      onProjectUpdated(data.project);
      setPreviewVersion('original');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Draft enhance failed.');
    } finally {
      setIsEnhancing(false);
    }
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const stepFrame = (dir: -1 | 1) => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    setIsPlaying(false);
    const next = Math.max(0, Math.min(v.duration || 5, v.currentTime + dir / 24));
    v.currentTime = next;
    setCurrentTime(next);
  };

  const busy = isGenerating || isEnhancing || isUploadingMedia || isStitchingGrid;

  const clipGallery = getClipGalleryForShot(shot);
  const activeClip =
    clipGallery.find((c) => c.id === activeClipId) || clipGallery[0] || null;

  const activeClipUpscaledUrl =
    activeClip?.upscaledVideoUrl ??
    (!activeClip || activeClip.videoUrl === shot.videoUrl ? shot.upscaledVideoUrl : null);
  const activeClipUpscaledRes =
    activeClip?.upscaledResolution ??
    (!activeClip || activeClip.videoUrl === shot.videoUrl ? shot.upscaledResolution : null);
  const activeClipOrigUrl = activeClip?.videoUrl || shot.videoUrl;
  const activeClipSplitClips: GridSplitClip[] | undefined =
    activeClip?.gridSplitClips ??
    (!activeClip || activeClip.videoUrl === shot.videoUrl
      ? shot.gridSplitClips
      : undefined);
  const activeClipIsGrid = Boolean(
    activeClip?.isGridMode ||
      (!activeClip && shot.isGridMode) ||
      activeClipSplitClips?.length
  );

  const activeStageVideoUrl =
    previewVersion === 'upscaled' && activeClipUpscaledUrl
      ? activeClipUpscaledUrl
      : activeClipOrigUrl;

  const activeStageBadge =
    previewVersion === 'upscaled' && activeClipUpscaledUrl
      ? activeClipUpscaledRes || '4K / Upscaled'
      : activeClip?.resolution || shot.videoResolution || null;

  // Build prompt tag chips for Reference-to-Video tray
  const promptChips: string[] = [
    ...referenceImages.map((_, i) => `@Image${i + 1}`),
    ...(model.supportsReferenceElements
      ? referenceElements.map((_, i) => `@Element${i + 1}`)
      : []),
    ...referenceVideos.map((_, i) => `@Video${i + 1}`),
  ];

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`52Video Studio — Shot ${shot.id}`}
    >
      <div className="bg-[#F6F6F7] border border-[#E2E2E6] rounded-2xl w-full max-w-[1280px] h-[92vh] flex flex-col overflow-hidden shadow-2xl text-[#111114]">
        {/* Top Modal Header */}
        <div className="px-5 py-3 bg-[#111114] border-b-2 border-[#C6202F] flex items-center justify-between gap-4 shrink-0 text-white">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-bold text-white tracking-tight">
              52Video Studio
            </span>
            <span className="text-white/40" aria-hidden="true">
              /
            </span>
            <span className="font-mono font-bold text-[#F39CA4] text-xs">{shot.id}</span>
            <span className="text-xs text-white/70 truncate hidden sm:inline">
              {shot.scene}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white/80 hover:text-white bg-white/10 hover:bg-white/15 border border-white/15 rounded-lg cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Close
          </button>
        </div>

        {/* Missing FAL_KEY Info Strip */}
        {falKeyConfigured === false && (
          <div className="px-5 py-2 bg-[#FDF4F5] border-b border-[#EABAC0] flex items-center gap-2 text-xs text-[#891A23] shrink-0">
            <Info className="w-4 h-4 text-[#C6202F] shrink-0" />
            <span>
              Your shot frame and prompt are pre-loaded. Add{' '}
              <strong className="font-mono">FAL_KEY</strong> to the server environment variables to
              run live renders directly inside this studio.
            </span>
          </div>
        )}

        {/* Two-Column Studio Workspace */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
          {/* Left Panel: Studio Controls */}
          <div className="w-full lg:w-[470px] shrink-0 h-full border-b lg:border-b-0 lg:border-r border-[#E2E2E6] bg-[#F6F6F7] flex flex-col overflow-y-auto p-4 sm:p-5 space-y-5">
            {/* Grouped Model Dropdown (FLUX 3 + Seedance + Kling 4.0 + Wan 3.0 Prime + Luma Ray 3.2) */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold tracking-wider uppercase text-[#5A5A66] block">
                Model
              </label>
              <div className="relative">
                <select
                  value={modelId}
                  disabled={busy}
                  onChange={(e) => handleModelSelect(e.target.value as StudioModelId)}
                  className="w-full appearance-none bg-white border border-[#D8D8DF] rounded-xl pl-3 pr-9 py-2.5 text-xs font-semibold text-[#111114] focus:outline-none focus:border-[#C6202F] cursor-pointer"
                >
                  <optgroup label="Google DeepMind">
                    <option value="veo-3.1">Google Veo 3.1 (720p–4K, Audio, T2V, I2V, Refs &amp; Extend)</option>
                    <option value="veo-3.1-fast">Google Veo 3.1 Fast (Rapid 720p–4K, Audio, I2V &amp; Extend)</option>
                    <option value="gemini-omni-flash">Google Gemini Omni Flash (T2V, Ref &amp; V2V Edit + Audio)</option>
                  </optgroup>
                  <optgroup label="ByteDance Seedance">
                    <option value="seedance-2.0">Seedance 2.0 Fast (Lowest Cost · 480p–720p)</option>
                    <option value="seedance-2.5">Seedance 2.5 (1080p, 30s, 30 refs)</option>
                  </optgroup>
                  <optgroup label="Black Forest Labs">
                    <option value="flux-3">FLUX 3 (Native Audio, up to 4K)</option>
                  </optgroup>
                  <optgroup label="Kuaishou Kling">
                    <option value="kling-4.0">
                      Kling 4.0 (3–30s · T2V, I2V, @Element Refs &amp; V2V Edit)
                    </option>
                  </optgroup>
                  <optgroup label="Alibaba Wan">
                    <option value="wan-3.0-prime">
                      Wan 3.0 Prime (T2V, I2V &amp; Multi-Ref + Audio)
                    </option>
                  </optgroup>
                  <optgroup label="Luma AI">
                    <option value="luma-ray-3.2">
                      Luma Ray 3.2 (T2V, I2V, V2V Restyle &amp; Reframe)
                    </option>
                  </optgroup>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#5A5A66] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <p className="text-[10px] text-[#6E6E7A]">{model.tagline}</p>
            </div>

            {/* Version Pills only when a provider family has multiple versions (Seedance / Google Veo) */}
            {family.modelIds.length > 1 && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold tracking-wider uppercase text-[#5A5A66] block">
                  {family.label} Engine Tier
                </label>
                <div
                  className="grid gap-1.5 p-1 bg-white rounded-xl border border-[#E2E2E6]"
                  style={{
                    gridTemplateColumns: `repeat(${family.modelIds.length}, minmax(0, 1fr))`,
                  }}
                >
                  {family.modelIds.map((id) => {
                    const m = getStudioModel(id);
                    const active = modelId === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={busy}
                        onClick={() => handleModelSelect(id)}
                        className={`p-2 rounded-lg text-left transition-all cursor-pointer ${
                          active
                            ? 'bg-[#111114] text-white border border-[#111114]'
                            : 'text-[#5A5A66] hover:text-[#111114] hover:bg-[#F6F6F7] border border-transparent'
                        }`}
                      >
                        <div className={`text-xs font-semibold leading-tight ${active ? 'text-white' : 'text-[#111114]'}`}>
                          {m.label}
                        </div>
                        <div className={`text-[10px] mt-0.5 leading-tight ${active ? 'text-white/75' : 'text-[#5A5A66]'}`}>
                          {m.tagline}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 2x2 Multi-Shot Grid Mode Toggle & Builder */}
            <div className="space-y-2.5 p-3 rounded-xl bg-white border border-[#E2E2E6]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Grid2x2 className="w-4 h-4 text-[#C6202F] shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[#111114] leading-tight">
                      2x2 Multi-Shot Grid Mode
                    </div>
                    <div className="text-[10px] text-[#5A5A66] leading-tight">
                      4 simultaneous shots per 1080p/4K render
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1 p-0.5 bg-[#F6F6F7] rounded-lg border border-[#E2E2E6] shrink-0 text-[11px]">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleToggleGridMode(false)}
                    className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                      !isGridMode
                        ? 'bg-[#111114] text-white font-semibold'
                        : 'text-[#5A5A66] hover:text-[#111114]'
                    }`}
                  >
                    Single Shot
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleToggleGridMode(true)}
                    className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                      isGridMode
                        ? 'bg-[#C6202F] text-white font-semibold'
                        : 'text-[#5A5A66] hover:text-[#111114]'
                    }`}
                  >
                    2x2 Grid
                  </button>
                </div>
              </div>

              {gridUpgradeNotice && (
                <div className="px-2.5 py-1.5 rounded-lg bg-[#FDF4F5] border border-[#EABAC0] text-[10px] text-[#891A23]">
                  {gridUpgradeNotice}
                </div>
              )}

              {isGridMode && (
                <div className="space-y-3 pt-1 border-t border-[#E2E2E6]">
                  <div className="grid grid-cols-2 gap-1 p-1 bg-[#F6F6F7] rounded-lg border border-[#E2E2E6] text-[11px]">
                    <button
                      type="button"
                      onClick={() => setGridInputTab('frames')}
                      className={`py-1.5 px-2 rounded-md font-medium cursor-pointer flex items-center justify-center gap-1.5 ${
                        gridInputTab === 'frames'
                          ? 'bg-white text-[#111114] font-semibold shadow-xs border border-[#E2E2E6]'
                          : 'text-[#5A5A66] hover:text-[#111114]'
                      }`}
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-[#C6202F]" />
                      4 Still Frames
                    </button>
                    <button
                      type="button"
                      onClick={() => setGridInputTab('prompts')}
                      className={`py-1.5 px-2 rounded-md font-medium cursor-pointer flex items-center justify-center gap-1.5 ${
                        gridInputTab === 'prompts'
                          ? 'bg-white text-[#111114] font-semibold shadow-xs border border-[#E2E2E6]'
                          : 'text-[#5A5A66] hover:text-[#111114]'
                      }`}
                    >
                      <TypeIcon className="w-3.5 h-3.5 text-[#C6202F]" />
                      4 Shot Prompts
                    </button>
                  </div>

                  <input
                    ref={gridQuadInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      if (files.length) {
                        void handleGridQuadrantFileUpload(
                          gridQuadTargetIdxRef.current,
                          files
                        );
                      }
                      e.target.value = '';
                    }}
                  />

                  {gridInputTab === 'frames' ? (
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[11px]">
                        <span className="text-[#5A5A66]">
                          Auto-stitches onto a 1920x1080 16:9 canvas
                        </span>
                        <div className="flex items-center gap-2">
                          {project.shots.some((s) => Boolean(s.frameImageUrl)) && (
                            <button
                              type="button"
                              onClick={() => handleFillGridFromProjectShots('frames')}
                              className="text-[#891A23] hover:text-[#C6202F] font-medium cursor-pointer"
                            >
                              Fill from Shots
                            </button>
                          )}
                          {gridFrames.some(Boolean) && (
                            <button
                              type="button"
                              onClick={() => {
                                setGridFrames([null, null, null, null]);
                                void restitchAndApplyGridCanvas([
                                  null,
                                  null,
                                  null,
                                  null,
                                ]);
                              }}
                              className="text-[#5A5A66] hover:text-[#C6202F] cursor-pointer"
                            >
                              Clear Grid
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        {GRID_QUADRANTS.map((q) => {
                          const frameUrl = gridFrames[q.index];
                          return (
                            <div
                              key={q.key}
                              tabIndex={0}
                              onPaste={(e) => {
                                const imgFile = extractImageFileFromClipboardEvent(e);
                                if (!imgFile) return;
                                e.preventDefault();
                                setGridPasteIndex(null);
                                void handleGridQuadrantFileUpload(q.index, [imgFile]);
                              }}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={(e) => {
                                e.preventDefault();
                                const files = Array.from(
                                  e.dataTransfer.files || []
                                ).filter((f) => f.type.startsWith('image/'));
                                if (files.length) {
                                  void handleGridQuadrantFileUpload(q.index, files);
                                }
                              }}
                              className="rounded-lg border border-[#D8D8DF] focus:outline-none focus:border-[#C6202F] bg-[#F6F6F7] overflow-hidden flex flex-col"
                            >
                              <div className="px-2 py-1 bg-white border-b border-[#E2E2E6] flex items-center justify-between gap-1 text-[10px]">
                                <span className="font-mono font-semibold text-[#111114]">
                                  {q.label}
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleGridQuadrantPasteButton(q.index)
                                    }
                                    title="Paste image from clipboard"
                                    className="p-0.5 text-[#891A23] hover:text-[#C6202F] cursor-pointer"
                                  >
                                    <ClipboardPaste className="w-3 h-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setDrivePickerTarget({
                                        kind: 'grid_quadrant',
                                        quadrantIndex: q.index,
                                      })
                                    }
                                    title="Pick from Google Drive"
                                    className="p-0.5 text-[#891A23] hover:text-[#C6202F] cursor-pointer"
                                  >
                                    <FolderSync className="w-3 h-3" />
                                  </button>
                                  {frameUrl && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void updateGridQuadrantFrame(q.index, null)
                                      }
                                      title={`Clear ${q.label}`}
                                      className="p-0.5 text-[#5A5A66] hover:text-[#C6202F] cursor-pointer"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => {
                                  gridQuadTargetIdxRef.current = q.index;
                                  gridQuadInputRef.current?.click();
                                }}
                                className="aspect-video w-full flex items-center justify-center bg-[#18181D] cursor-pointer relative overflow-hidden"
                              >
                                {frameUrl ? (
                                  <img
                                    src={frameUrl}
                                    alt={q.label}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <div className="text-center px-2 text-[10px] text-[#A0A0AC]">
                                    <UploadCloud className="w-3.5 h-3.5 mx-auto mb-0.5 text-[#F39CA4]" />
                                    <span>Drop / Browse / Paste</span>
                                  </div>
                                )}
                              </button>

                              {gridPasteIndex === q.index && (
                                <div className="px-2 py-1 bg-[#FDF4F5] text-[9px] text-[#891A23]">
                                  Press Ctrl+V / Cmd+V now
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {isStitchingGrid && (
                        <div className="flex items-center gap-1.5 text-[11px] text-[#891A23]">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Stitching 1920x1080 2x2 Grid Canvas...
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-[#5A5A66]">
                          Describe each quadrant — compiles into a 2x2 storyboard prompt
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleFillGridFromProjectShots('prompts')}
                            className="text-[#891A23] hover:text-[#C6202F] font-medium cursor-pointer"
                          >
                            Fill from 4 Shots
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const synced = format2x2GridPrompt({
                                quadrantPrompts: gridShotPrompts,
                                hasStitchedImage: gridFrames.some(Boolean),
                              });
                              setPrompt(synced);
                            }}
                            className="text-[#24242B] hover:text-[#C6202F] font-medium cursor-pointer"
                          >
                            Sync Prompt
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-2">
                        {GRID_QUADRANTS.map((q) => (
                          <div key={q.key} className="space-y-0.5">
                            <label className="text-[10px] font-mono font-semibold text-[#5A5A66] block">
                              {q.shortLabel} ({q.label})
                            </label>
                            <textarea
                              rows={2}
                              value={gridShotPrompts[q.index]}
                              disabled={busy}
                              onChange={(e) =>
                                handleGridShotPromptChange(q.index, e.target.value)
                              }
                              placeholder={`Describe action & camera in ${q.label} quadrant...`}
                              className="w-full bg-[#F6F6F7] border border-[#D8D8DF] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="px-2.5 py-1.5 rounded-lg bg-[#F6F6F7] border border-[#E2E2E6] flex items-center gap-2 text-[10px] text-[#3A3A44]">
                    <Lock className="w-3 h-3 text-[#C6202F] shrink-0" />
                    <span>
                      Enforces <strong className="font-mono">{effectiveResolution}</strong> · 16:9 · Locked divider borders &amp; 4-quadrant simultaneous animation
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Dynamic Workflow Mode Tabs */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold tracking-wider uppercase text-[#5A5A66] block">
                Workflow Mode
              </label>
              <div
                className="grid gap-1 p-1 bg-white rounded-xl border border-[#E2E2E6]"
                style={{
                  gridTemplateColumns: `repeat(${availableModes.length}, minmax(0, 1fr))`,
                }}
              >
                {availableModes.map((tab) => {
                  const Icon = tab.icon;
                  const active = workflowMode === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      disabled={busy}
                      onClick={() => handleModeSelect(tab.id)}
                      title={tab.label}
                      className={`flex flex-col items-center justify-center py-2 px-1 rounded-lg transition-all cursor-pointer ${
                        active
                          ? 'bg-[#111114] text-white font-semibold'
                          : 'text-[#5A5A66] hover:text-[#111114] hover:bg-[#F6F6F7]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 mb-1 shrink-0" />
                      <span className="text-[10px] leading-tight text-center line-clamp-1">
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Media Dropzones per Workflow Mode */}
            {workflowMode !== 'text_to_video' && (
              <div className="space-y-3">
                {/* Image-to-Video / Pair Mode Start & Optional/Required End Frame */}
                {(workflowMode === 'image_to_video' ||
                  workflowMode === 'first_last_frame') && (
                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#24242B]">
                          Start Frame{chainedStartFrameDataUrl ? ' (chained)' : ''}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handlePasteButtonClick('start')}
                            className="inline-flex items-center gap-1 text-[11px] text-[#891A23] hover:text-[#C6202F] cursor-pointer"
                            title="Paste image from clipboard (Google Flow / screenshot)"
                          >
                            <ClipboardPaste className="w-3 h-3" />
                            Paste
                          </button>
                          <button
                            type="button"
                            onClick={() => setDrivePickerTarget({ kind: 'start' })}
                            className="inline-flex items-center gap-1 text-[11px] text-[#891A23] hover:text-[#891A23] cursor-pointer"
                          >
                            <FolderSync className="w-3 h-3" />
                            Drive
                          </button>
                          <button
                            type="button"
                            onClick={() => startInputRef.current?.click()}
                            className="text-[11px] text-[#C6202F] hover:text-[#891A23] cursor-pointer"
                          >
                            Replace
                          </button>
                          {startFrameUrl && (
                            <button
                              type="button"
                              onClick={() => setStartFrameUrl(null)}
                              className="text-[#5A5A66] hover:text-[#C6202F] cursor-pointer"
                              aria-label="Clear start frame"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        ref={startInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length) void handleImageUpload('start', files);
                          e.target.value = '';
                        }}
                      />
                      <div
                        ref={startBoxRef}
                        tabIndex={0}
                        onClick={() => startInputRef.current?.click()}
                        onPaste={(e) => void handleFramePasteEvent('start', e)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const files = Array.from(e.dataTransfer.files || []).filter((f) =>
                            f.type.startsWith('image/')
                          );
                          if (files.length) void handleImageUpload('start', files);
                        }}
                        className="rounded-xl border-2 border-dashed border-[#D8D8DF] hover:border-[#C6202F]/70 focus:outline-none focus:border-[#C6202F] bg-[#F6F6F7] overflow-hidden cursor-pointer aspect-video flex items-center justify-center"
                      >
                        {startFrameUrl ? (
                          <img
                            src={startFrameUrl}
                            alt="Start frame"
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="text-center p-4 text-[#5A5A66] text-xs">
                            <UploadCloud className="w-5 h-5 mx-auto mb-1 text-[#C6202F]" />
                            Drop, browse, or paste (Ctrl+V / Cmd+V) opening image
                          </div>
                        )}
                      </div>
                      {pasteHintTarget === 'start' && (
                        <div className="text-[11px] text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] rounded-lg px-2.5 py-1.5">
                          Box focused — press <strong className="font-mono">Ctrl+V / Cmd+V</strong> now to paste your clipboard image.
                        </div>
                      )}
                    </div>

                    {(workflowMode === 'first_last_frame' ||
                      model.supportsOptionalEndFrameInI2V) && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#24242B]">
                            {workflowMode === 'first_last_frame'
                              ? `End Frame (${duration}s)`
                              : 'End Frame (Optional)'}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handlePasteButtonClick('end')}
                              className="inline-flex items-center gap-1 text-[11px] text-[#891A23] hover:text-[#C6202F] cursor-pointer"
                              title="Paste image from clipboard (Google Flow / screenshot)"
                            >
                              <ClipboardPaste className="w-3 h-3" />
                              Paste
                            </button>
                            <button
                              type="button"
                              onClick={() => setDrivePickerTarget({ kind: 'end' })}
                              className="inline-flex items-center gap-1 text-[11px] text-[#891A23] hover:text-[#891A23] cursor-pointer"
                            >
                              <FolderSync className="w-3 h-3" />
                              Drive
                            </button>
                            {endFrameUrl && (
                              <button
                                type="button"
                                onClick={() => setEndFrameUrl(null)}
                                className="text-[#5A5A66] hover:text-[#C6202F] cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                        <input
                          ref={endInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            if (files.length) void handleImageUpload('end', files);
                            e.target.value = '';
                          }}
                        />
                        <div
                          ref={endBoxRef}
                          tabIndex={0}
                          onClick={() => endInputRef.current?.click()}
                          onPaste={(e) => void handleFramePasteEvent('end', e)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            const files = Array.from(e.dataTransfer.files || []).filter((f) =>
                              f.type.startsWith('image/')
                            );
                            if (files.length) void handleImageUpload('end', files);
                          }}
                          className="rounded-xl border-2 border-dashed border-[#D8D8DF] hover:border-[#C6202F]/70 focus:outline-none focus:border-[#C6202F] bg-[#F6F6F7] overflow-hidden cursor-pointer aspect-video flex items-center justify-center"
                        >
                          {endFrameUrl ? (
                            <img
                              src={endFrameUrl}
                              alt="End frame"
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="text-center p-4 text-[#5A5A66] text-xs">
                              <UploadCloud className="w-5 h-5 mx-auto mb-1 text-[#C6202F]" />
                              {workflowMode === 'first_last_frame'
                                ? 'Drop, browse, or paste (Ctrl+V / Cmd+V) closing image'
                                : 'Optional closing keyframe (browse or paste Ctrl+V / Cmd+V)'}
                            </div>
                          )}
                        </div>
                        {pasteHintTarget === 'end' && (
                          <div className="text-[11px] text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] rounded-lg px-2.5 py-1.5">
                            Box focused — press <strong className="font-mono">Ctrl+V / Cmd+V</strong> now to paste your clipboard image.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Timeline Keyframes (Seedance / FLUX 3) */}
                {workflowMode === 'keyframes_timeline' && (
                  <div className="space-y-2.5 p-3 rounded-xl bg-white border border-[#E2E2E6]">
                    <input
                      ref={keyframeInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const files = Array.from(e.target.files || []);
                        const targetId = keyframeTargetIdRef.current;
                        if (files.length && targetId) {
                          void handleImageUpload('keyframe', files, targetId);
                        }
                        keyframeTargetIdRef.current = null;
                        e.target.value = '';
                      }}
                    />
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#24242B] flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#891A23]" />
                        Reference Timeline ({keyframes.length}/{model.maxTimelineFrames})
                      </span>
                      <button
                        type="button"
                        disabled={keyframes.length >= model.maxTimelineFrames}
                        onClick={() =>
                          setKeyframes((prev) => [
                            ...prev,
                            {
                              id: `kf-${Date.now()}`,
                              timeSeconds: Math.min(
                                duration,
                                Math.round((duration / 2) * 10) / 10
                              ),
                              imageUrl: '',
                              label: `Frame ${prev.length + 1}`,
                            },
                          ])
                        }
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FDF4F5] hover:bg-[#891A23] text-[#891A23] border border-[#EABAC0] text-[11px] disabled:opacity-40 cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                        Add Frame
                      </button>
                    </div>

                    <div className="space-y-2">
                      {keyframes.map((kf) => (
                        <div
                          key={kf.id}
                          className="flex items-center gap-2 bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg p-2"
                        >
                          <button
                            type="button"
                            onClick={() => {
                              keyframeTargetIdRef.current = kf.id;
                              keyframeInputRef.current?.click();
                            }}
                            className="w-16 h-10 rounded border border-[#D8D8DF] bg-black overflow-hidden shrink-0 flex items-center justify-center text-[10px] text-[#5A5A66] hover:border-[#C6202F] cursor-pointer"
                          >
                            {kf.imageUrl ? (
                              <img
                                src={kf.imageUrl}
                                alt={kf.label || 'Keyframe'}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              'Upload'
                            )}
                          </button>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-1.5 text-xs">
                              <input
                                type="number"
                                min={0}
                                max={duration}
                                step={0.5}
                                value={kf.timeSeconds}
                                onChange={(e) => {
                                  const t = Math.max(
                                    0,
                                    Math.min(duration, parseFloat(e.target.value) || 0)
                                  );
                                  setKeyframes((prev) =>
                                    prev.map((item) =>
                                      item.id === kf.id ? { ...item, timeSeconds: t } : item
                                    )
                                  );
                                }}
                                className="w-14 bg-white border border-[#D8D8DF] rounded px-1.5 py-0.5 text-xs font-mono text-[#111114]"
                              />
                              <span className="text-[10px] text-[#6E6E7A]">s</span>
                              {model.family === 'flux-3' && (
                                <span className="text-[10px] font-mono text-[#891A23]">
                                  f{keyframeFrameIndex(kf.timeSeconds, duration)}
                                </span>
                              )}
                            </div>
                            <input
                              type="text"
                              value={kf.label || ''}
                              placeholder="Scene cue..."
                              onChange={(e) =>
                                setKeyframes((prev) =>
                                  prev.map((item) =>
                                    item.id === kf.id
                                      ? { ...item, label: e.target.value }
                                      : item
                                  )
                                )
                              }
                              className="w-full bg-white border border-[#E2E2E6] rounded px-1.5 py-0.5 text-[11px] text-[#24242B]"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setDrivePickerTarget({ kind: 'keyframe', keyframeId: kf.id })
                            }
                            title="Pick keyframe from Google Drive"
                            className="p-1 text-[#891A23] hover:text-[#891A23] cursor-pointer"
                          >
                            <FolderSync className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setKeyframes((prev) => prev.filter((item) => item.id !== kf.id))
                            }
                            className="p-1 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                            aria-label="Remove keyframe"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Dedicated Drag-and-Drop Source Video Uploader for V2V Edit / Reframe / Veo Extend */}
                {(workflowMode === 'video_edit' ||
                  workflowMode === 'video_reframe' ||
                  (workflowMode === 'video_extend' && model.family === 'veo')) && (
                  <div className="space-y-3 p-3 rounded-xl bg-white border border-[#E2E2E6]">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#24242B] flex items-center gap-1.5">
                          <Film className="w-3.5 h-3.5 text-[#891A23]" />
                          {workflowMode === 'video_extend'
                            ? 'Source Video to Extend'
                            : workflowMode === 'video_reframe'
                              ? 'Source Video to Reframe'
                              : model.family === 'kling'
                                ? 'Source Video to Edit (3–30s)'
                                : model.family === 'gemini-omni'
                                  ? 'Source Video to Edit (Omni Flash)'
                                  : 'Source Video to Restyle'}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDrivePickerTarget({ kind: 'source_video' })}
                            className="inline-flex items-center gap-1 text-[11px] text-[#891A23] hover:text-[#891A23] cursor-pointer"
                          >
                            <FolderSync className="w-3 h-3" />
                            Pick from Drive
                          </button>
                          {sourceVideoUrl && (
                            <button
                              type="button"
                              onClick={() => setSourceVideoUrl(null)}
                              className="text-[11px] text-[#5A5A66] hover:text-[#C6202F] cursor-pointer"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>

                      <input
                        ref={sourceVideoInputRef}
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov"
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length) void handleVideoUpload('source', files);
                          e.target.value = '';
                        }}
                      />

                      {sourceVideoUrl ? (
                        <div className="rounded-xl overflow-hidden border border-[#D8D8DF] bg-black space-y-1.5">
                          <video
                            src={sourceVideoUrl}
                            controls
                            playsInline
                            className="w-full max-h-[160px] object-contain"
                          />
                          <div className="px-2.5 pb-2 flex items-center justify-between text-[10px] text-[#5A5A66]">
                            <span className="font-mono truncate">
                              Uploaded for Fal ({workflowMode === 'video_reframe' ? 'reframe' : 'video_url'})
                            </span>
                            <button
                              type="button"
                              onClick={() => sourceVideoInputRef.current?.click()}
                              className="text-[#891A23] hover:text-[#891A23] font-medium cursor-pointer shrink-0 ml-2"
                            >
                              Replace
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => sourceVideoInputRef.current?.click()}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsDraggingSourceVideo(true);
                          }}
                          onDragLeave={() => setIsDraggingSourceVideo(false)}
                          onDrop={(e) => {
                            e.preventDefault();
                            setIsDraggingSourceVideo(false);
                            const files = Array.from(e.dataTransfer.files || []);
                            if (files.length) void handleVideoUpload('source', files);
                          }}
                          className={`py-4 px-3 rounded-xl border-2 border-dashed flex flex-col items-center text-center cursor-pointer transition-colors ${
                            isDraggingSourceVideo
                              ? 'border-[#891A23] bg-[#FDF4F5]'
                              : 'border-[#D8D8DF] hover:border-[#891A23]/60 bg-[#F6F6F7]'
                          }`}
                        >
                          {isUploadingMedia ? (
                            <>
                              <Loader2 className="w-5 h-5 text-[#891A23] animate-spin mb-1" />
                              <span className="text-xs text-[#24242B]">
                                Uploading clip to Fal storage...
                              </span>
                            </>
                          ) : (
                            <>
                              <UploadCloud className="w-5 h-5 text-[#891A23] mb-1" />
                              <span className="text-xs text-[#24242B] font-medium">
                                Drag &amp; drop .mp4 or .mov here, or browse
                              </span>
                              <span className="text-[10px] text-[#6E6E7A] mt-0.5">
                                {workflowMode === 'video_reframe'
                                  ? 'Outpaints your clip to the target aspect ratio'
                                  : 'Uploads via studio helper and passes video_url'}
                              </span>
                            </>
                          )}
                        </div>
                      )}

                      {(shot.videoUrl || parentShot?.videoUrl) && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span className="text-[10px] text-[#6E6E7A]">Use clip:</span>
                          {shot.videoUrl && sourceVideoUrl !== shot.videoUrl && (
                            <button
                              type="button"
                              onClick={() => setSourceVideoUrl(shot.videoUrl!)}
                              className="px-2 py-0.5 rounded bg-[#EFEFF2] hover:bg-[#E5E5EA] text-[10px] text-[#24242B] cursor-pointer"
                            >
                              + {shot.id} Generated Clip
                            </button>
                          )}
                          {parentShot?.videoUrl &&
                            sourceVideoUrl !== parentShot.videoUrl && (
                              <button
                                type="button"
                                onClick={() => setSourceVideoUrl(parentShot.videoUrl!)}
                                className="px-2 py-0.5 rounded bg-[#EFEFF2] hover:bg-[#E5E5EA] text-[10px] text-[#24242B] cursor-pointer"
                              >
                                + {parentShot.id} Chained Clip
                              </button>
                            )}
                        </div>
                      )}
                    </div>

                    {/* Optional Reference Images for Kling 4.0 V2V Edit */}
                    {model.family === 'kling' && workflowMode === 'video_edit' && (
                      <div className="space-y-1.5 pt-2.5 border-t border-[#E2E2E6]">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#24242B] flex items-center gap-1.5">
                            <Images className="w-3.5 h-3.5 text-[#891A23]" />
                            Reference Images (Optional)
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setDrivePickerTarget({ kind: 'ref_image' })}
                              className="inline-flex items-center gap-1 text-[11px] text-[#891A23] hover:text-[#891A23] cursor-pointer"
                            >
                              <FolderSync className="w-3 h-3" />
                              + Drive
                            </button>
                            <button
                              type="button"
                              onClick={() => refImagesInputRef.current?.click()}
                              className="text-[11px] text-[#891A23] hover:text-[#891A23] cursor-pointer"
                            >
                              + Add images
                            </button>
                          </div>
                        </div>
                        <input
                          ref={refImagesInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            if (files.length) void handleImageUpload('ref', files);
                            e.target.value = '';
                          }}
                        />
                        {referenceImages.length > 0 && (
                          <div className="grid grid-cols-4 gap-1.5">
                            {referenceImages.map((img, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleInsertPromptTag(`@Image${idx + 1}`)}
                                className="relative group aspect-square rounded-lg overflow-hidden border border-[#D8D8DF] hover:border-[#C6202F] bg-black cursor-pointer"
                              >
                                <img
                                  src={img}
                                  alt={`Ref ${idx + 1}`}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                                <span className="absolute top-0.5 left-0.5 bg-black/80 text-[8px] font-mono text-white px-1 rounded">
                                  @Image{idx + 1}
                                </span>
                                <span
                                  role="button"
                                  tabIndex={-1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReferenceImages((prev) =>
                                      prev.filter((_, i) => i !== idx)
                                    );
                                  }}
                                  className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/80 text-white/80 hover:text-[#FCA5A5] opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Unified Multi-Reference / Video & Ref Tray */}
                {(workflowMode === 'reference_to_video' ||
                  (workflowMode === 'video_extend' && model.family !== 'veo')) && (
                  <div className="space-y-3 p-3 rounded-xl bg-white border border-[#E2E2E6]">
                    {/* Clickable Prompt Tag Chips (@Image1, @Element1, @Video1) */}
                    {promptChips.length > 0 && (
                      <div className="p-2 rounded-lg bg-[#F6F6F7] border border-[#E2E2E6] space-y-1">
                        <span className="text-[10px] font-medium text-[#5A5A66] block">
                          Click a tag to insert into prompt:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {promptChips.map((chip) => (
                            <button
                              key={chip}
                              type="button"
                              onClick={() => handleInsertPromptTag(chip)}
                              className="px-2 py-0.5 rounded bg-[#FDF2F3] hover:bg-[#FADEE1] border border-[#EABAC0] font-mono text-[11px] text-[#891A23] cursor-pointer"
                            >
                              + {chip}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Reference Videos (hidden when model supports 0 ref videos, e.g. Veo 3.1 R2V) */}
                    {model.maxReferenceVideos > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#24242B] flex items-center gap-1.5">
                          <Film className="w-3.5 h-3.5 text-[#891A23]" />
                          Reference Videos
                          <span className="text-[10px] text-[#6E6E7A] font-mono">
                            ({referenceVideos.length}/{Math.max(1, model.maxReferenceVideos)})
                          </span>
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={isUploadingMedia}
                            onClick={() => setDrivePickerTarget({ kind: 'ref_video' })}
                            className="inline-flex items-center gap-1 text-[11px] text-[#891A23] hover:text-[#891A23] cursor-pointer"
                          >
                            <FolderSync className="w-3 h-3" />
                            + Drive
                          </button>
                          <button
                            type="button"
                            disabled={isUploadingMedia}
                            onClick={() => refVideosInputRef.current?.click()}
                            className="text-[11px] text-[#891A23] hover:text-[#891A23] cursor-pointer"
                          >
                            {isUploadingMedia ? 'Uploading...' : '+ Add video'}
                          </button>
                          {referenceVideos.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setReferenceVideos([])}
                              className="text-[11px] text-[#5A5A66] hover:text-[#C6202F] cursor-pointer"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        ref={refVideosInputRef}
                        type="file"
                        accept="video/mp4,video/quicktime,video/webm,.mp4,.mov"
                        multiple={model.maxReferenceVideos > 1}
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length) void handleVideoUpload('ref', files);
                          e.target.value = '';
                        }}
                      />
                      {referenceVideos.length > 0 ? (
                        <div className="grid grid-cols-3 gap-1.5">
                          {referenceVideos.map((vidUrl, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleInsertPromptTag(`@Video${idx + 1}`)}
                              title={`Click to insert @Video${idx + 1} into prompt`}
                              className="relative group aspect-video rounded-lg overflow-hidden border border-[#D8D8DF] hover:border-[#891A23] bg-black cursor-pointer"
                            >
                              <video
                                src={vidUrl}
                                muted
                                playsInline
                                className="w-full h-full object-cover"
                              />
                              <span className="absolute top-0.5 left-0.5 bg-black/80 text-[8px] font-mono text-white px-1 rounded">
                                @Video{idx + 1}
                              </span>
                              <span
                                role="button"
                                tabIndex={-1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReferenceVideos((prev) =>
                                    prev.filter((_, i) => i !== idx)
                                  );
                                }}
                                className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/80 text-white/80 hover:text-[#FCA5A5] opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </span>
                            </button>
                          ))}
                          {referenceVideos.length < Math.max(1, model.maxReferenceVideos) && (
                            <button
                              type="button"
                              onClick={() => refVideosInputRef.current?.click()}
                              className="aspect-video rounded-lg border border-dashed border-[#D8D8DF] hover:border-[#891A23] bg-[#FAFAFB] flex flex-col items-center justify-center text-[#5A5A66] hover:text-[#891A23] cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span className="text-[9px] mt-0.5">Add</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div
                          onClick={() => refVideosInputRef.current?.click()}
                          className="py-3 rounded-lg border-2 border-dashed border-[#E2E2E6] hover:border-[#891A23]/55 bg-[#F6F6F7] flex flex-col items-center cursor-pointer"
                        >
                          <UploadCloud className="w-4 h-4 text-[#891A23] mb-1" />
                          <p className="text-xs text-[#3A3A44]">
                            Drop up to {Math.max(1, model.maxReferenceVideos)} video
                            {Math.max(1, model.maxReferenceVideos) > 1 ? 's' : ''} (.mp4/.mov) or{' '}
                            <span className="text-[#891A23]">browse</span>
                          </p>
                          <p className="text-[10px] text-[#6E6E7A] mt-0.5">
                            Tag @Video1 in prompt or combine with reference images below
                          </p>
                        </div>
                      )}

                      {(shot.videoUrl || parentShot?.videoUrl) && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span className="text-[10px] text-[#6E6E7A]">Quick add:</span>
                          {shot.videoUrl && !referenceVideos.includes(shot.videoUrl) && (
                            <button
                              type="button"
                              onClick={() =>
                                setReferenceVideos((prev) =>
                                  [...prev, shot.videoUrl!].slice(
                                    0,
                                    Math.max(1, model.maxReferenceVideos)
                                  )
                                )
                              }
                              className="px-2 py-0.5 rounded bg-[#EFEFF2] hover:bg-[#E5E5EA] text-[10px] text-[#24242B] cursor-pointer"
                            >
                              + {shot.id} Clip
                            </button>
                          )}
                          {parentShot?.videoUrl &&
                            !referenceVideos.includes(parentShot.videoUrl) && (
                              <button
                                type="button"
                                onClick={() =>
                                  setReferenceVideos((prev) =>
                                    [...prev, parentShot.videoUrl!].slice(
                                      0,
                                      Math.max(1, model.maxReferenceVideos)
                                    )
                                  )
                                }
                                className="px-2 py-0.5 rounded bg-[#EFEFF2] hover:bg-[#E5E5EA] text-[10px] text-[#24242B] cursor-pointer"
                              >
                                + {parentShot.id} Chained Clip
                              </button>
                            )}
                        </div>
                      )}
                    </div>
                    )}

                    {/* Reference Images (@Image1, @Image2...) */}
                    <div className={`space-y-1.5 ${model.maxReferenceVideos > 0 ? 'pt-2.5 border-t border-[#E2E2E6]' : ''}`}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#24242B] flex items-center gap-1.5">
                          <Images className="w-3.5 h-3.5 text-[#891A23]" />
                          Reference Images
                          <span className="text-[10px] text-[#6E6E7A] font-mono">
                            ({referenceImages.length}/
                            {model.family === 'flux-3'
                              ? STUDIO_MODELS['seedance-2.5'].maxReferenceImages
                              : model.maxReferenceImages}
                            )
                          </span>
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDrivePickerTarget({ kind: 'ref_image' })}
                            className="inline-flex items-center gap-1 text-[11px] text-[#891A23] hover:text-[#891A23] cursor-pointer"
                          >
                            <FolderSync className="w-3 h-3" />
                            + Drive
                          </button>
                          <button
                            type="button"
                            onClick={() => refImagesInputRef.current?.click()}
                            className="text-[11px] text-[#891A23] hover:text-[#891A23] cursor-pointer"
                          >
                            + Add images
                          </button>
                          {referenceImages.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setReferenceImages([])}
                              className="text-[11px] text-[#5A5A66] hover:text-[#C6202F] cursor-pointer"
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        ref={refImagesInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const files = Array.from(e.target.files || []);
                          if (files.length) void handleImageUpload('ref', files);
                          e.target.value = '';
                        }}
                      />

                      {referenceImages.length > 0 ? (
                        <div className="grid grid-cols-4 gap-1.5">
                          {referenceImages.map((img, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => handleInsertPromptTag(`@Image${idx + 1}`)}
                              title={`Click to insert @Image${idx + 1} into prompt`}
                              className="relative group aspect-square rounded-lg overflow-hidden border border-[#D8D8DF] hover:border-[#C6202F] bg-black cursor-pointer"
                            >
                              <img
                                src={img}
                                alt={`Ref ${idx + 1}`}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                              <span className="absolute top-0.5 left-0.5 bg-black/80 text-[8px] font-mono text-white px-1 rounded">
                                @Image{idx + 1}
                              </span>
                              <span
                                role="button"
                                tabIndex={-1}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReferenceImages((prev) =>
                                    prev.filter((_, i) => i !== idx)
                                  );
                                }}
                                className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/80 text-white/80 hover:text-[#FCA5A5] opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </span>
                            </button>
                          ))}
                          {referenceImages.length <
                            (model.family === 'flux-3'
                              ? STUDIO_MODELS['seedance-2.5'].maxReferenceImages
                              : model.maxReferenceImages) && (
                            <button
                              type="button"
                              onClick={() => refImagesInputRef.current?.click()}
                              className="aspect-square rounded-lg border border-dashed border-[#D8D8DF] hover:border-[#C6202F] bg-[#FAFAFB] flex flex-col items-center justify-center text-[#5A5A66] hover:text-[#891A23] cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span className="text-[9px] mt-0.5">Add</span>
                            </button>
                          )}
                        </div>
                      ) : (
                        <div
                          onClick={() => refImagesInputRef.current?.click()}
                          className="py-3 px-2 rounded-lg border border-dashed border-[#D8D8DF] hover:border-[#C6202F] bg-[#F6F6F7] flex flex-col items-center text-center cursor-pointer"
                        >
                          <UploadCloud className="w-4 h-4 text-[#891A23] mb-1" />
                          <p className="text-[11px] text-[#3A3A44]">
                            Upload reference images for @Image1 / @Image2 guidance
                          </p>
                          <p className="text-[10px] text-[#6E6E7A] mt-0.5">
                            {model.family === 'flux-3'
                              ? 'Adding images switches to Seedance 2.5 (supports video + images)'
                              : 'Click thumbnails to insert tags into your prompt'}
                          </p>
                        </div>
                      )}

                      {(project.product.photos.length > 0 || startFrameUrl) && (
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <span className="text-[10px] text-[#6E6E7A]">Quick add:</span>
                          {startFrameUrl && !referenceImages.includes(startFrameUrl) && (
                            <button
                              type="button"
                              onClick={() => {
                                if (model.family === 'flux-3') {
                                  handleModelSelect('seedance-2.5');
                                }
                                setReferenceImages((prev) =>
                                  [...prev, startFrameUrl].slice(0, 30)
                                );
                              }}
                              className="px-2 py-0.5 rounded bg-[#EFEFF2] hover:bg-[#E5E5EA] text-[10px] text-[#24242B] cursor-pointer"
                            >
                              + Shot Frame
                            </button>
                          )}
                          {project.product.photos.map((p, idx) =>
                            !referenceImages.includes(p.url) ? (
                              <button
                                key={p.id || idx}
                                type="button"
                                onClick={() => {
                                  if (model.family === 'flux-3') {
                                    handleModelSelect('seedance-2.5');
                                  }
                                  setReferenceImages((prev) =>
                                    [...prev, p.url].slice(0, 30)
                                  );
                                }}
                                className="px-2 py-0.5 rounded bg-[#EFEFF2] hover:bg-[#E5E5EA] text-[10px] text-[#24242B] cursor-pointer"
                              >
                                + Product Photo {idx + 1}
                              </button>
                            ) : null
                          )}
                        </div>
                      )}
                    </div>

                    {/* Subject Elements (@Element1, @Element2...) for Kling 4.0 */}
                    {model.supportsReferenceElements && (
                      <div className="space-y-1.5 pt-2.5 border-t border-[#E2E2E6]">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#24242B] flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-[#C6202F]" />
                            Subject / Character Elements (@Element1)
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setDrivePickerTarget({ kind: 'element' })}
                              className="inline-flex items-center gap-1 text-[11px] text-[#891A23] hover:text-[#891A23] cursor-pointer"
                            >
                              <FolderSync className="w-3 h-3" />
                              + Drive
                            </button>
                            <button
                              type="button"
                              onClick={() => refElementsInputRef.current?.click()}
                              className="text-[11px] text-[#C6202F] hover:text-[#891A23] cursor-pointer"
                            >
                              + Add element
                            </button>
                          </div>
                        </div>
                        <input
                          ref={refElementsInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            if (files.length) void handleImageUpload('element', files);
                            e.target.value = '';
                          }}
                        />
                        {referenceElements.length > 0 ? (
                          <div className="grid grid-cols-4 gap-1.5">
                            {referenceElements.map((img, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleInsertPromptTag(`@Element${idx + 1}`)}
                                className="relative group aspect-square rounded-lg overflow-hidden border border-[#D8D8DF] hover:border-[#C6202F] bg-black cursor-pointer"
                              >
                                <img
                                  src={img}
                                  alt={`Element ${idx + 1}`}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                                <span className="absolute top-0.5 left-0.5 bg-black/80 text-[8px] font-mono text-white px-1 rounded">
                                  @Element{idx + 1}
                                </span>
                                <span
                                  role="button"
                                  tabIndex={-1}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReferenceElements((prev) =>
                                      prev.filter((_, i) => i !== idx)
                                    );
                                  }}
                                  className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/80 text-white/80 hover:text-[#FCA5A5] opacity-0 group-hover:opacity-100"
                                >
                                  <Trash2 className="w-2.5 h-2.5" />
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => refElementsInputRef.current?.click()}
                            className="w-full py-2 px-3 rounded-lg border border-dashed border-[#D8D8DF] hover:border-[#C6202F] bg-[#F6F6F7] text-[11px] text-[#5A5A66] hover:text-[#891A23] cursor-pointer"
                          >
                            + Add product or character identity for @Element1 tagging
                          </button>
                        )}
                      </div>
                    )}

                    {/* Reference Audio Track for Wan 3.0 Prime */}
                    {model.supportsReferenceAudio && (
                      <div className="space-y-1.5 pt-2.5 border-t border-[#E2E2E6]">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-[#24242B] flex items-center gap-1.5">
                            <Music className="w-3.5 h-3.5 text-emerald-700" />
                            Reference Audio Track (Optional)
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setDrivePickerTarget({ kind: 'ref_audio' })}
                              className="inline-flex items-center gap-1 text-[11px] text-[#891A23] hover:text-[#891A23] cursor-pointer"
                            >
                              <FolderSync className="w-3 h-3" />
                              + Drive
                            </button>
                            {referenceAudioUrl && (
                              <button
                                type="button"
                                onClick={() => setReferenceAudioUrl(null)}
                                className="text-[11px] text-[#5A5A66] hover:text-[#C6202F] cursor-pointer"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                        <input
                          ref={refAudioInputRef}
                          type="file"
                          accept="audio/mpeg,audio/wav,audio/mp3,.mp3,.wav,.m4a"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleAudioUpload(file);
                            e.target.value = '';
                          }}
                        />
                        {referenceAudioUrl ? (
                          <div className="p-2 rounded-lg bg-[#F6F6F7] border border-[#D8D8DF]">
                            <audio src={referenceAudioUrl} controls className="w-full h-8" />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => refAudioInputRef.current?.click()}
                            className="w-full py-2 px-3 rounded-lg border border-dashed border-[#D8D8DF] hover:border-emerald-600 bg-[#F6F6F7] text-[11px] text-[#5A5A66] hover:text-emerald-800 cursor-pointer"
                          >
                            + Attach voiceover or audio track (.mp3 / .wav)
                          </button>
                        )}
                      </div>
                    )}

                    {/* Seedance 2.5 Task Mode */}
                    {model.supportsTaskMode && (
                      <div className="space-y-1.5 pt-2.5 border-t border-[#E2E2E6]">
                        <label className="text-[11px] font-semibold tracking-wider uppercase text-[#5A5A66] block">
                          Task
                        </label>
                        <div className="grid grid-cols-4 gap-1 p-1 bg-white rounded-lg border border-[#E2E2E6]">
                          {REFERENCE_TASKS.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => setReferenceTask(t.id)}
                              title={t.hint}
                              className={`py-1.5 rounded text-xs cursor-pointer ${
                                referenceTask === t.id
                                  ? 'bg-[#111114] text-white font-semibold'
                                  : 'text-[#5A5A66] hover:text-[#111114] hover:bg-[#F6F6F7]'
                              }`}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Prompt & Motion Direction */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-semibold tracking-wider uppercase text-[#5A5A66]">
                  {workflowMode === 'video_reframe'
                    ? 'Reframe Guidance (Optional)'
                    : isGridMode
                      ? '2x2 Grid Motion Prompt (Border-Lock Auto-Appended)'
                      : 'Prompt & Motion Direction'}
                </label>
                <button
                  type="button"
                  onClick={() => void handleCopyPrompt()}
                  className="inline-flex items-center gap-1 text-[11px] text-[#891A23] hover:text-[#C6202F] cursor-pointer shrink-0"
                >
                  {copiedPrompt ? (
                    <>
                      <Check className="w-3 h-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy prompt
                    </>
                  )}
                </button>
              </div>
              <textarea
                ref={promptRef}
                rows={isGridMode ? 5 : 4}
                value={prompt}
                disabled={busy}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  workflowMode === 'video_reframe'
                    ? 'Optional guidance for outpainted edges...'
                    : isGridMode
                      ? 'Describe simultaneous motion across Top-Left, Top-Right, Bottom-Left, and Bottom-Right panels...'
                      : 'Describe motion, camera move, timing, or tag @Image1 / @Element1 / @Video1...'
                }
                className="w-full bg-white border border-[#D8D8DF] rounded-xl px-3 py-2 text-xs text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F] leading-relaxed"
              />
              {isGridMode && (
                <div className="text-[10px] text-[#5A5A66] bg-white border border-[#E2E2E6] rounded-lg px-2.5 py-1.5">
                  On submit, simultaneous 4-quadrant animation &amp; strict locked-border divider instructions are automatically enforced.
                </div>
              )}
              <div className="flex flex-wrap gap-1">
                {CAMERA_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    disabled={busy}
                    onClick={() => handleAddTag(tag)}
                    className="px-2 py-0.5 text-[10px] font-medium text-[#3A3A44] bg-white border border-[#D8D8DF] hover:border-[#C6202F] hover:text-[#891A23] rounded-md cursor-pointer"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Negative Prompt */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold tracking-wider uppercase text-[#5A5A66]">
                  Negative Prompt
                </label>
                {shot.negativePrompt && negativePrompt !== shot.negativePrompt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setNegativePrompt(shot.negativePrompt)}
                    className="inline-flex items-center gap-1 text-[10px] text-[#891A23] hover:text-[#C6202F] cursor-pointer"
                  >
                    <RotateCcw className="w-2.5 h-2.5" />
                    Reset to shot default
                  </button>
                )}
              </div>
              <textarea
                rows={2}
                value={negativePrompt}
                disabled={busy}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="Artifacts to avoid (e.g., warping, extra limbs, text glitches, logo distortion)..."
                className="w-full bg-white border border-[#D8D8DF] rounded-xl px-3 py-2 text-xs text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F] leading-relaxed"
              />
            </div>

            {/* Aspect Ratio & Duration */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold tracking-wider uppercase text-[#5A5A66] block">
                    Aspect Ratio
                  </label>
                  {isGridMode && (
                    <span className="text-[10px] font-mono text-[#891A23]">
                      16:9 locked for 2x2 split
                    </span>
                  )}
                </div>
                {isGridMode ? (
                  <div className="px-3 py-2 rounded-lg bg-[#111114] text-white text-xs font-semibold flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Maximize2 className="w-3.5 h-3.5" />
                      16:9 Widescreen (2x2 Grid)
                    </span>
                    <Lock className="w-3 h-3 opacity-80" />
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5">
                    {availableAspectRatios.map((ar) => {
                      const meta = ASPECT_ICONS[ar];
                      const Icon = meta.icon;
                      const active = aspectRatio === ar;
                      return (
                        <button
                          key={ar}
                          type="button"
                          disabled={busy}
                          onClick={() => setAspectRatio(ar)}
                          className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] border cursor-pointer ${
                            active
                              ? 'bg-[#111114] text-white border-[#111114] font-semibold'
                              : 'bg-white text-[#5A5A66] border-[#E2E2E6] hover:text-[#111114] hover:border-[#C6202F]'
                          }`}
                        >
                          <Icon className="w-3 h-3" />
                          <span>{meta.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {workflowMode !== 'video_reframe' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#5A5A66]">Duration</span>
                    <span className="font-mono font-semibold text-[#111114] tabular-nums">
                      {duration}s
                      {model.durationFormat === 'string_s' && (
                        <span className="text-[10px] text-[#6E6E7A] ml-1">
                          (&quot;{duration}s&quot;)
                        </span>
                      )}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={model.minDuration}
                    max={model.maxDuration}
                    step={1}
                    value={duration}
                    disabled={busy}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full accent-[#C6202F] cursor-pointer"
                  />
                  <div className="flex justify-between items-center text-[10px] font-mono text-[#6E6E7A]">
                    <span>{model.minDuration}s</span>
                    {model.durations && (
                      <div className="flex gap-1">
                        {model.durations.map((d) => (
                          <button
                            key={d}
                            type="button"
                            disabled={busy}
                            onClick={() => setDuration(d)}
                            className={`px-1.5 py-0.5 rounded border cursor-pointer ${
                              duration === d
                                ? 'border-[#111114] bg-[#111114] text-white font-semibold'
                                : 'border-[#E2E2E6] bg-white text-[#5A5A66] hover:text-[#111114]'
                            }`}
                          >
                            {d}s
                          </button>
                        ))}
                      </div>
                    )}
                    <span>{model.maxDuration}s</span>
                  </div>
                </div>
              )}
            </div>

            {/* Quality Tier + Resolution Selector + Native Audio */}
            <div className="space-y-3">
              {isGridMode ? (
                <div className="space-y-2 p-2.5 rounded-xl bg-white border border-[#E2E2E6]">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold uppercase tracking-wider text-[#5A5A66]">
                      Grid Mode Resolution Lock
                    </span>
                    <span className="font-mono font-semibold text-[#C6202F]">
                      Full Quality ({effectiveResolution})
                    </span>
                  </div>
                  <div
                    className="grid gap-1 p-1 bg-[#F6F6F7] rounded-lg border border-[#E2E2E6]"
                    style={{
                      gridTemplateColumns: `repeat(${availableResolutions.length}, minmax(0, 1fr))`,
                    }}
                  >
                    {availableResolutions.map((res) => (
                      <button
                        key={res}
                        type="button"
                        disabled={busy}
                        onClick={() => setResolution(res)}
                        className={`py-1.5 rounded-md text-xs font-mono cursor-pointer ${
                          effectiveResolution === res
                            ? 'bg-[#111114] text-white font-semibold'
                            : 'text-[#5A5A66] hover:text-[#111114]'
                        }`}
                      >
                        {RESOLUTION_LABELS[res]}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#6E6E7A]">
                    {availableResolutions.includes('2160p')
                      ? 'This endpoint supports up to 4K (2160p) so each split shot retains full HD crispness.'
                      : 'Forced to 1080p full quality so each cropped quadrant can be upscaled cleanly with Topaz.'}
                  </p>
                </div>
              ) : (
                <>
                  {supportsDraftTier && (
                    <div className="grid grid-cols-2 gap-1.5 p-1 bg-white rounded-xl border border-[#E2E2E6]">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setQualityTier('draft')}
                        className={`py-2 rounded-lg text-xs cursor-pointer ${
                          qualityTier === 'draft'
                            ? 'bg-[#111114] text-white font-semibold'
                            : 'text-[#5A5A66] hover:text-[#111114]'
                        }`}
                      >
                        Draft ({model.draftResolution})
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setQualityTier('final')}
                        className={`py-2 rounded-lg text-xs cursor-pointer ${
                          qualityTier === 'final'
                            ? 'bg-[#111114] text-white font-semibold'
                            : 'text-[#5A5A66] hover:text-[#111114]'
                        }`}
                      >
                        Full Quality ({effectiveResolution})
                      </button>
                    </div>
                  )}

                  {model.resolutionSelectable &&
                    (!supportsDraftTier || qualityTier === 'final') && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold tracking-wider uppercase text-[#5A5A66] block">
                          Resolution
                        </label>
                        <div
                          className="grid gap-1 p-1 bg-white rounded-xl border border-[#E2E2E6]"
                          style={{
                            gridTemplateColumns: `repeat(${availableResolutions.length}, minmax(0, 1fr))`,
                          }}
                        >
                          {availableResolutions.map((res) => (
                            <button
                              key={res}
                              type="button"
                              disabled={busy}
                              onClick={() => setResolution(res)}
                              className={`py-1.5 rounded-lg text-xs font-mono cursor-pointer ${
                                effectiveResolution === res
                                  ? 'bg-[#111114] text-white font-semibold'
                                  : 'text-[#5A5A66] hover:text-[#111114]'
                              }`}
                            >
                              {RESOLUTION_LABELS[res]}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                  <p className="text-[10px] text-[#6E6E7A]">
                    Defaults to lowest-cost Draft settings ({effectiveResolution}) — upscale winning takes later with Topaz.
                  </p>
                </>
              )}

              {(model.family === 'seedance' ||
                model.family === 'flux-3' ||
                model.family === 'kling' ||
                model.family === 'veo' ||
                model.family === 'gemini-omni') && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setNativeAudio((v) => !v)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs border cursor-pointer ${
                    nativeAudio
                      ? 'bg-emerald-50 border-emerald-400 text-[#111114] font-medium'
                      : 'bg-white border-[#E2E2E6] text-[#5A5A66]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    {nativeAudio ? (
                      <Volume2 className="w-3.5 h-3.5 text-emerald-700" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5 text-[#6E6E7A]" />
                    )}
                    Native Sound Design
                  </span>
                  <span className="font-mono text-[11px]">{nativeAudio ? 'On' : 'Off'}</span>
                </button>
              )}
            </div>

            {/* Advanced Accordion */}
            <div className="pt-2 border-t border-[#E2E2E6]">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="w-full flex items-center justify-between py-1.5 text-xs font-medium text-[#5A5A66] hover:text-[#111114] cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5" />
                  Advanced Parameters
                </span>
                {showAdvanced ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>

              {showAdvanced && (
                <div className="mt-2 p-3.5 bg-white border border-[#E2E2E6] rounded-xl space-y-3 text-xs">
                  {model.supportsSafetyTolerance && (
                    <div className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-[#3A3A44]">Content Filter Strictness</span>
                        <span className="font-mono font-semibold text-[#111114]">{safetyTolerance}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={4}
                        step={1}
                        value={safetyTolerance}
                        onChange={(e) => setSafetyTolerance(Number(e.target.value))}
                        className="w-full accent-[#C6202F] cursor-pointer"
                      />
                    </div>
                  )}

                  {model.family === 'luma' && (
                    <button
                      type="button"
                      onClick={() => setEnableSafetyChecker((v) => !v)}
                      className="w-full flex items-center justify-between py-1.5 px-2.5 rounded-lg bg-[#F6F6F7] border border-[#E2E2E6] text-xs cursor-pointer"
                    >
                      <span className="flex items-center gap-1.5 text-[#3A3A44]">
                        <ShieldCheck className="w-3.5 h-3.5 text-[#C6202F]" />
                        Luma Safety Checker (default Off)
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-[#111114]">
                        {enableSafetyChecker ? 'On' : 'Off'}
                      </span>
                    </button>
                  )}

                  {model.supportsSeed && (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[#3A3A44]">Generation Seed</span>
                        <button
                          type="button"
                          onClick={() =>
                            setSeed(Math.floor(Math.random() * 900000 + 100000))
                          }
                          className="inline-flex items-center gap-1 text-[11px] text-[#5A5A66] hover:text-[#111114] cursor-pointer"
                        >
                          <Dices className="w-3 h-3" />
                          Randomize
                        </button>
                      </div>
                      <input
                        type="number"
                        value={seed}
                        onChange={(e) =>
                          setSeed(Math.max(0, parseInt(e.target.value, 10) || 0))
                        }
                        className="w-full bg-[#F6F6F7] border border-[#D8D8DF] rounded-lg px-2.5 py-1 text-xs font-mono text-[#111114]"
                      />
                    </div>
                  )}

                  {!model.supportsSafetyTolerance &&
                    !model.supportsSeed &&
                    model.family !== 'luma' && (
                      <p className="text-[11px] text-[#5A5A66]">
                        No extra engine parameters required for {model.label}.
                      </p>
                    )}
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Stage Preview + Scrubber + Topaz Upscale + Action Bar */}
          <div className="flex-1 h-full flex flex-col justify-between p-4 sm:p-5 overflow-y-auto gap-4 bg-[#F6F6F7]">
            <div className="space-y-3">
              {/* Stage Player with Scrubber & Transport */}
              <div className="bg-white border border-[#E2E2E6] rounded-2xl overflow-hidden shadow-sm">
                <div className="aspect-video bg-black relative flex items-center justify-center">
                  {activeStageVideoUrl ? (
                    <video
                      key={activeStageVideoUrl}
                      ref={videoRef}
                      src={activeStageVideoUrl}
                      poster={startFrameUrl || undefined}
                      loop={isLooping}
                      muted={isMuted}
                      playsInline
                      onTimeUpdate={() => {
                        if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
                      }}
                      onLoadedMetadata={() => {
                        if (videoRef.current) setVideoDuration(videoRef.current.duration);
                      }}
                      onEnded={() => setIsPlaying(false)}
                      className="w-full h-full object-contain"
                    />
                  ) : startFrameUrl ? (
                    <img
                      src={startFrameUrl}
                      alt={`Shot ${shot.id} preview`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="text-center text-[#6E6E7A] text-xs space-y-1 p-6">
                      <Play className="w-7 h-7 mx-auto text-[#8A8A96]" />
                      <div>Ready to synthesize shot {shot.id}</div>
                    </div>
                  )}

                  {activeStageVideoUrl && activeStageBadge && (
                    <span
                      className={`absolute top-3 left-3 px-2.5 py-0.5 rounded-md border text-[10px] font-mono font-semibold ${
                        previewVersion === 'upscaled' && activeClipUpscaledUrl
                          ? 'bg-[#15803D]/90 border-emerald-300 text-white'
                          : 'bg-black/75 border-white/20 text-white'
                      }`}
                    >
                      {activeStageBadge}
                    </span>
                  )}

                  {activeClipOrigUrl && activeClipUpscaledUrl && (
                    <div className="absolute top-3 right-3 flex items-center gap-1 p-1 rounded-lg bg-black/80 border border-white/15 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setPreviewVersion('original')}
                        className={`px-2 py-0.5 rounded cursor-pointer ${
                          previewVersion === 'original'
                            ? 'bg-[#C6202F] text-white font-semibold'
                            : 'text-white/75 hover:text-white'
                        }`}
                      >
                        Original
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewVersion('upscaled')}
                        className={`px-2 py-0.5 rounded cursor-pointer ${
                          previewVersion === 'upscaled'
                            ? 'bg-[#15803D] text-white font-semibold'
                            : 'text-white/75 hover:text-white'
                        }`}
                      >
                        {activeClipUpscaledRes || '4K / Upscaled'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Scrubber + Transport Controls */}
                <div className="p-3 bg-white border-t border-[#E2E2E6] space-y-2">
                  <input
                    type="range"
                    min={0}
                    max={videoDuration || duration}
                    step={1 / 24}
                    value={currentTime}
                    disabled={!activeStageVideoUrl}
                    onChange={(e) => {
                      const t = parseFloat(e.target.value);
                      setCurrentTime(t);
                      if (videoRef.current) videoRef.current.currentTime = t;
                    }}
                    className="w-full accent-[#C6202F] cursor-pointer disabled:opacity-30"
                  />
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={!activeStageVideoUrl}
                        onClick={togglePlay}
                        className="w-7 h-7 rounded-lg bg-[#C6202F] hover:bg-[#AD1A27] text-white flex items-center justify-center disabled:opacity-30 cursor-pointer"
                      >
                        {isPlaying ? (
                          <Pause className="w-3.5 h-3.5 fill-current" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={!activeStageVideoUrl}
                        onClick={() => stepFrame(-1)}
                        className="p-1.5 rounded-lg text-[#5A5A66] hover:text-[#111114] disabled:opacity-30 cursor-pointer"
                        title="Step back 1 frame"
                      >
                        <SkipBack className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={!activeStageVideoUrl}
                        onClick={() => stepFrame(1)}
                        className="p-1.5 rounded-lg text-[#5A5A66] hover:text-[#111114] disabled:opacity-30 cursor-pointer"
                        title="Step forward 1 frame"
                      >
                        <SkipForward className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsLooping((v) => !v)}
                        className={`p-1.5 rounded-lg border cursor-pointer ${
                          isLooping
                            ? 'text-[#891A23] bg-[#FDF2F3] border-[#EABAC0]'
                            : 'text-[#6E6E7A] border-transparent hover:text-[#111114]'
                        }`}
                        title="Loop playback"
                      >
                        <Repeat className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="flex items-center bg-[#F6F6F7] rounded-md p-0.5 border border-[#E2E2E6] text-[10px] font-mono">
                        {[0.5, 1, 1.5].map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => {
                              setPlaybackRate(rate);
                              if (videoRef.current) videoRef.current.playbackRate = rate;
                            }}
                            className={`px-1.5 py-0.5 rounded cursor-pointer ${
                              playbackRate === rate
                                ? 'bg-[#111114] text-white font-semibold'
                                : 'text-[#5A5A66] hover:text-[#111114]'
                            }`}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsMuted((v) => !v)}
                        className="p-1.5 rounded-lg text-[#5A5A66] hover:text-[#111114] cursor-pointer"
                      >
                        {isMuted ? (
                          <VolumeX className="w-3.5 h-3.5" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {errorMsg && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-xs text-[#891A23]">
                  {errorMsg}
                </div>
              )}

              {/* Clip Gallery (Select any generated take to preview & repopulate all settings) */}
              {clipGallery.length > 0 && (
                <div className="p-3 rounded-xl bg-white border border-[#E2E2E6] space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-[#24242B] flex items-center gap-1.5">
                      <Film className="w-3.5 h-3.5 text-[#C6202F]" />
                      Clip Gallery ({clipGallery.length})
                    </span>
                    <span className="text-[11px] text-[#5A5A66]">
                      Select a take to load its model, prompt, negative prompt &amp; settings
                    </span>
                  </div>
                  <div className="flex gap-2.5 overflow-x-auto pb-1">
                    {clipGallery.map((clip, idx) => {
                      const isSelected = activeClip?.id === clip.id;
                      const takeNum = clipGallery.length - idx;
                      return (
                        <button
                          key={clip.id}
                          type="button"
                          onClick={() => applyClipSettingsToPanel(clip, shot)}
                          className={`w-44 shrink-0 rounded-xl border overflow-hidden text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'border-[#C6202F] bg-[#FDF4F5] ring-1 ring-[#C6202F]/35'
                              : 'border-[#E2E2E6] bg-[#F6F6F7] hover:border-[#891A23]'
                          }`}
                        >
                          <div className="aspect-video bg-black relative">
                            <video
                              src={clip.upscaledVideoUrl || clip.videoUrl}
                              muted
                              playsInline
                              preload="metadata"
                              className="w-full h-full object-cover pointer-events-none"
                            />
                            <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/80 border border-white/15 text-[10px] font-mono text-white">
                              Take #{takeNum}
                            </span>
                            {clip.upscaledVideoUrl && (
                              <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-[#15803D]/90 text-white text-[9px] font-mono font-bold">
                                {clip.upscaledResolution || 'Upscaled'}
                              </span>
                            )}
                          </div>
                          <div className="p-2 space-y-0.5">
                            <div className="text-[11px] font-semibold text-[#111114] truncate">
                              {STUDIO_MODELS[clip.modelId as StudioModelId]?.label ||
                                clip.modelId}
                            </div>
                            <div className="text-[10px] font-mono text-[#5A5A66] truncate">
                              {clip.resolution} · {clip.qualityTier} · {clip.duration}s
                              {clip.isGridMode ? ' · 2x2' : ''}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Draft Enhance + Universal Topaz Upscaling Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 p-3 rounded-xl bg-white border border-[#E2E2E6] text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  {(activeClip?.draftCacheUrl || shot.draftCacheUrl) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleEnhanceDraft()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-[#15803D] hover:bg-[#166534] disabled:opacity-50 rounded-lg cursor-pointer"
                    >
                      {isEnhancing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-3.5 h-3.5" />
                      )}
                      {isEnhancing ? 'Enhancing to 1080p...' : 'Enhance Draft to 1080p'}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setUpscaleModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-[#891A23] hover:bg-[#6E141C] disabled:opacity-40 rounded-lg cursor-pointer"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5" />
                    {activeClipOrigUrl ? 'Upscale with Topaz' : 'Upscale Existing Video'}
                  </button>

                  {activeClipOrigUrl &&
                    !activeClipIsGrid &&
                    !showSplitTrayManual && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setShowSplitTrayManual(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-[#24242B] bg-[#F6F6F7] border border-[#D8D8DF] hover:border-[#C6202F] rounded-lg cursor-pointer"
                      >
                        <Scissors className="w-3.5 h-3.5 text-[#C6202F]" />
                        2x2 Split Tools
                      </button>
                    )}
                </div>

                {activeClipUpscaledUrl && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-800 font-mono text-[11px] font-semibold">
                      {activeClipUpscaledRes || '4K / Upscaled'}
                      {shot.upscaleDetails?.subModel
                        ? ` · ${shot.upscaleDetails.subModel}`
                        : ''}
                    </span>
                    <a
                      href={activeClipUpscaledUrl}
                      download={`${project.id}-${shot.id}-upscaled.mp4`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-emerald-900 bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 rounded-lg"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Upscaled
                    </a>
                  </div>
                )}
              </div>

              {/* 2x2 4-Shot Splitter & Topaz Batch Pipeline */}
              {activeClipOrigUrl &&
                (activeClipIsGrid || isGridMode || showSplitTrayManual) && (
                  <GridSplitTray
                    projectId={project.id}
                    shotId={shot.id}
                    clipId={activeClip?.id}
                    sourceVideoUrl={activeClipOrigUrl}
                    isGridMode={activeClipIsGrid || isGridMode}
                    splitClips={activeClipSplitClips}
                    onProjectUpdated={onProjectUpdated}
                  />
                )}
            </div>

            {/* Action Bar */}
            <div className="bg-white border border-[#E2E2E6] rounded-2xl p-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex-1 min-w-[220px]">
                <button
                  type="button"
                  disabled={
                    busy ||
                    (!prompt.trim() &&
                      workflowMode !== 'video_reframe' &&
                      !(
                        isGridMode &&
                        (gridFrames.some(Boolean) ||
                          gridShotPrompts.some((p) => p.trim().length > 0))
                      ))
                  }
                  onClick={() => void handleGenerate()}
                  className="w-full py-2.5 px-5 brand-corner-sm font-medium text-xs text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>
                        {isGridMode
                          ? `Synthesizing 2x2 Grid (${effectiveResolution})...`
                          : 'Synthesizing Video...'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span className="font-semibold">
                        {isGridMode
                          ? `Generate 2x2 Grid (${effectiveResolution}) with ${model.label}`
                          : `Generate with ${model.label}`}
                      </span>
                      <span className="ml-1 text-[11px] font-mono opacity-85">
                        · Est. ${estimatedCost.toFixed(2)}
                      </span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!shot.videoUrl || busy}
                  onClick={handleExtendFromCurrent}
                  className="flex items-center gap-1.5 py-2.5 px-3.5 rounded-xl bg-[#EFEFF2] hover:bg-[#E2E2E6] text-[#111114] border border-[#D8D8DF] text-xs font-medium disabled:opacity-30 cursor-pointer"
                  title="Send current clip into V2V / Reference mode"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>Extend / Edit</span>
                </button>

                {activeStageVideoUrl ? (
                  <a
                    href={activeStageVideoUrl}
                    download={`${project.id}-${shot.id}${previewVersion === 'upscaled' && shot.upscaledVideoUrl ? '-upscaled' : ''}.mp4`}
                    className="flex items-center gap-1.5 py-2.5 px-3.5 rounded-xl bg-[#EFEFF2] hover:bg-[#E2E2E6] text-[#111114] border border-[#D8D8DF] text-xs font-medium"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export MP4</span>
                  </a>
                ) : startFrameUrl ? (
                  <a
                    href={startFrameUrl}
                    download={`${project.id}-${shot.id}-start-frame.png`}
                    className="flex items-center gap-1.5 py-2.5 px-3.5 rounded-xl bg-[#EFEFF2] hover:bg-[#E2E2E6] text-[#111114] border border-[#D8D8DF] text-xs font-medium"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Start Frame</span>
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      <TopazUpscaleModal
        isOpen={upscaleModalOpen}
        project={project}
        shot={shot}
        onClose={() => setUpscaleModalOpen(false)}
        onProjectUpdated={(updated) => {
          onProjectUpdated(updated);
          setPreviewVersion('upscaled');
        }}
      />

      <DriveAssetPickerModal
        isOpen={Boolean(drivePickerTarget)}
        projectId={project.id}
        initialFolderUrls={
          project.googleDriveFolderUrls?.length
            ? project.googleDriveFolderUrls
            : project.googleDriveFolderUrl
              ? [project.googleDriveFolderUrl]
              : []
        }
        mediaFilter={
          (drivePickerTarget?.kind === 'source_video' ||
          drivePickerTarget?.kind === 'ref_video'
            ? 'video'
            : drivePickerTarget?.kind === 'ref_audio'
              ? 'audio'
              : 'image') as DriveMediaFilter
        }
        multiple={
          drivePickerTarget?.kind === 'ref_image' ||
          drivePickerTarget?.kind === 'element' ||
          drivePickerTarget?.kind === 'ref_video'
        }
        prefix={
          drivePickerTarget?.kind === 'source_video'
            ? 'v2v-src'
            : drivePickerTarget?.kind === 'ref_video'
              ? 'ref-vid'
              : drivePickerTarget?.kind === 'ref_audio'
                ? 'ref-audio'
                : 'studio'
        }
        uploadToFal={
          drivePickerTarget?.kind === 'source_video' ||
          drivePickerTarget?.kind === 'ref_video' ||
          drivePickerTarget?.kind === 'ref_audio'
        }
        title={
          drivePickerTarget?.kind === 'source_video'
            ? 'Pick Source Video from Google Drive'
            : drivePickerTarget?.kind === 'ref_video'
              ? 'Pick Reference Videos from Google Drive'
              : drivePickerTarget?.kind === 'ref_audio'
                ? 'Pick Reference Audio from Google Drive'
                : 'Pick Image Asset from Google Drive'
        }
        onClose={() => setDrivePickerTarget(null)}
        onImported={handleDriveAssetsImported}
        onFoldersChange={(urls) => {
          onProjectUpdated({
            ...project,
            googleDriveFolderUrls: urls,
            googleDriveFolderUrl: urls[0] || undefined,
          });
        }}
      />
    </div>
  );
};
