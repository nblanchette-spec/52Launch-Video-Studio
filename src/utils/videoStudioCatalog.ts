export type StudioModelId =
  | 'seedance-2.5'
  | 'seedance-2.0'
  | 'flux-3'
  | 'kling-4.0'
  | 'wan-3.0-prime'
  | 'luma-ray-3.2'
  | 'veo-3.1'
  | 'veo-3.1-fast'
  | 'gemini-omni-flash';

export type StudioModelFamily =
  | 'seedance'
  | 'flux-3'
  | 'kling'
  | 'wan'
  | 'luma'
  | 'veo'
  | 'gemini-omni';

export type StudioWorkflowMode =
  | 'text_to_video'
  | 'image_to_video'
  | 'first_last_frame'
  | 'keyframes_timeline'
  | 'reference_to_video'
  | 'video_edit'
  | 'video_reframe'
  | 'video_extend';

export type StudioReferenceTask = 'reference' | 'editing' | 'extension' | 'auto';

export interface StudioTimelineKeyframe {
  id: string;
  timeSeconds: number;
  imageUrl: string;
  label?: string;
}

export type StudioAspectRatio =
  | 'auto'
  | '16:9'
  | '9:16'
  | '1:1'
  | '21:9'
  | '2:1'
  | '4:3'
  | '3:4';

export type StudioResolution = '480p' | '540p' | '720p' | '1080p' | '1440p' | '2160p';
export type StudioQualityTier = 'draft' | 'final';

export type TopazUpscaleMode = 'precision' | 'generative' | 'creative';
export type TopazPrecisionModel = 'Proteus' | 'Iris' | 'Gaia 2';
export type TopazGenerativeModel = 'Starlight Fast 2' | 'Starlight Precise 2.6';

export interface TopazModeSpec {
  id: TopazUpscaleMode;
  label: string;
  shortLabel: string;
  description: string;
  endpoint: string;
  models: string[];
  defaultModel: string;
}

export const TOPAZ_UPSCALE_MODES: Record<TopazUpscaleMode, TopazModeSpec> = {
  precision: {
    id: 'precision',
    label: 'Precision (Default — Fast & Faithful)',
    shortLabel: 'Precision',
    description:
      'Preserves fine detail, edges, and brand logos accurately without altering facial or product identity.',
    endpoint: 'topaz/upscale/video/precision',
    models: ['Proteus', 'Iris', 'Gaia 2'],
    defaultModel: 'Proteus',
  },
  generative: {
    id: 'generative',
    label: 'AI Detail Enhance (Generative)',
    shortLabel: 'AI Detail Enhance',
    description:
      'Reconstructs crisp micro-textures and recovers soft or compressed source footage.',
    endpoint: 'topaz/upscale/video/generative',
    models: ['Starlight Fast 2', 'Starlight Precise 2.6'],
    defaultModel: 'Starlight Fast 2',
  },
  creative: {
    id: 'creative',
    label: 'Creative Rebuild (Stylized)',
    shortLabel: 'Creative Rebuild',
    description:
      'Uses Astra 2 to creatively re-imagine heavily compressed or low-res clips with adjustable creativity.',
    endpoint: 'topaz/upscale/video/creative',
    models: ['Astra 2'],
    defaultModel: 'Astra 2',
  },
};

export interface StudioModelSpec {
  id: StudioModelId;
  family: StudioModelFamily;
  label: string;
  tagline: string;
  resolutions: StudioResolution[];
  resolutionsByMode?: Partial<Record<StudioWorkflowMode, StudioResolution[]>>;
  resolutionSelectable: boolean;
  aspectRatios: StudioAspectRatio[];
  aspectRatiosByMode?: Partial<Record<StudioWorkflowMode, StudioAspectRatio[]>>;
  minDuration: number;
  maxDuration: number;
  durations?: number[];
  durationFormat: 'number' | 'string_s' | 'string';
  workflowModes: StudioWorkflowMode[];
  supportsTaskMode: boolean;
  supportsSeed: boolean;
  supportsSafetyTolerance: boolean;
  supportsDraftEnhance: boolean;
  supportsOptionalEndFrameInI2V?: boolean;
  supportsReferenceElements?: boolean;
  supportsReferenceAudio?: boolean;
  maxReferenceImages: number;
  maxReferenceVideos: number;
  maxTimelineFrames: number;
  draftResolution: StudioResolution;
  finalResolution: StudioResolution;
  endpoints: {
    textToVideo: string;
    imageToVideo: string;
    firstLastToVideo?: string;
    keyframesToVideo?: string;
    referenceToVideo?: string;
    videoEdit?: string;
    reframe?: string;
    extendVideo?: string;
    draftEnhance?: string;
  };
}

export const FLUX3_FPS = 24;

export const FLUX3_ENDPOINTS = {
  text: 'blackforestlabs/flux-3/text-to-video',
  image: 'blackforestlabs/flux-3/image-to-video',
  first_last: 'blackforestlabs/flux-3/first-last-frame-to-video',
  keyframes: 'blackforestlabs/flux-3/keyframes-to-video',
  extend: 'blackforestlabs/flux-3/extend-video',
  enhance: 'blackforestlabs/flux-3/draft-enhance',
} as const;

export const STUDIO_MODELS: Record<StudioModelId, StudioModelSpec> = {
  'seedance-2.0': {
    id: 'seedance-2.0',
    family: 'seedance',
    label: 'Seedance 2.0 Fast',
    tagline: 'Fast & lower cost · up to 720p, 15s',
    resolutions: ['480p', '720p'],
    resolutionSelectable: false,
    aspectRatios: ['16:9', '9:16', '1:1'],
    minDuration: 4,
    maxDuration: 15,
    durations: [5, 10, 15],
    durationFormat: 'string',
    workflowModes: [
      'text_to_video',
      'image_to_video',
      'first_last_frame',
      'keyframes_timeline',
      'reference_to_video',
    ],
    supportsTaskMode: false,
    supportsSeed: true,
    supportsSafetyTolerance: false,
    supportsDraftEnhance: false,
    maxReferenceImages: 9,
    maxReferenceVideos: 3,
    maxTimelineFrames: 9,
    draftResolution: '480p',
    finalResolution: '720p',
    endpoints: {
      textToVideo: 'bytedance/seedance-2.0/fast/text-to-video',
      imageToVideo: 'bytedance/seedance-2.0/fast/image-to-video',
      referenceToVideo: 'bytedance/seedance-2.0/fast/reference-to-video',
    },
  },
  'seedance-2.5': {
    id: 'seedance-2.5',
    family: 'seedance',
    label: 'Seedance 2.5',
    tagline: 'Highest quality · up to 1080p, 30s, 30 refs',
    resolutions: ['480p', '720p', '1080p'],
    resolutionSelectable: false,
    aspectRatios: ['auto', '16:9', '9:16', '1:1'],
    minDuration: 4,
    maxDuration: 30,
    durations: [5, 10, 15, 20, 25, 30],
    durationFormat: 'string',
    workflowModes: [
      'text_to_video',
      'image_to_video',
      'first_last_frame',
      'keyframes_timeline',
      'reference_to_video',
    ],
    supportsTaskMode: true,
    supportsSeed: true,
    supportsSafetyTolerance: false,
    supportsDraftEnhance: false,
    maxReferenceImages: 30,
    maxReferenceVideos: 10,
    maxTimelineFrames: 10,
    draftResolution: '480p',
    finalResolution: '1080p',
    endpoints: {
      textToVideo: 'bytedance/seedance-2.5/us/text-to-video',
      imageToVideo: 'bytedance/seedance-2.5/us/image-to-video',
      referenceToVideo: 'bytedance/seedance-2.5/us/reference-to-video',
    },
  },
  'flux-3': {
    id: 'flux-3',
    family: 'flux-3',
    label: 'FLUX 3',
    tagline: 'Black Forest Labs · native audio, 5–20s, up to 4K',
    resolutions: ['720p', '1080p', '1440p', '2160p'],
    resolutionsByMode: {
      text_to_video: ['720p', '1080p', '1440p', '2160p'],
      image_to_video: ['720p', '1080p', '1440p', '2160p'],
      first_last_frame: ['720p', '1080p'],
      keyframes_timeline: ['720p', '1080p'],
      reference_to_video: ['720p', '1080p'],
      video_extend: ['720p', '1080p'],
    },
    resolutionSelectable: true,
    aspectRatios: ['auto', '16:9', '9:16', '1:1', '21:9', '2:1', '4:3', '3:4'],
    minDuration: 5,
    maxDuration: 20,
    durations: [5, 10, 15, 20],
    durationFormat: 'number',
    workflowModes: [
      'text_to_video',
      'image_to_video',
      'first_last_frame',
      'keyframes_timeline',
      'reference_to_video',
    ],
    supportsTaskMode: false,
    supportsSeed: false,
    supportsSafetyTolerance: true,
    supportsDraftEnhance: true,
    maxReferenceImages: 0,
    maxReferenceVideos: 1,
    maxTimelineFrames: 10,
    draftResolution: '720p',
    finalResolution: '1080p',
    endpoints: {
      textToVideo: FLUX3_ENDPOINTS.text,
      imageToVideo: FLUX3_ENDPOINTS.image,
      firstLastToVideo: FLUX3_ENDPOINTS.first_last,
      keyframesToVideo: FLUX3_ENDPOINTS.keyframes,
      extendVideo: FLUX3_ENDPOINTS.extend,
      draftEnhance: FLUX3_ENDPOINTS.enhance,
    },
  },
  'kling-4.0': {
    id: 'kling-4.0',
    family: 'kling',
    label: 'Kling 4.0',
    tagline: '3–30s · T2V, I2V (start/end), @Element refs & V2V Edit',
    resolutions: ['720p', '1080p'],
    resolutionSelectable: true,
    aspectRatios: ['16:9', '9:16', '1:1', '21:9'],
    aspectRatiosByMode: {
      reference_to_video: ['auto', '16:9', '9:16', '1:1', '21:9'],
    },
    minDuration: 3,
    maxDuration: 30,
    durationFormat: 'number',
    workflowModes: [
      'text_to_video',
      'image_to_video',
      'reference_to_video',
      'video_edit',
    ],
    supportsTaskMode: false,
    supportsSeed: false,
    supportsSafetyTolerance: false,
    supportsDraftEnhance: false,
    supportsOptionalEndFrameInI2V: true,
    supportsReferenceElements: true,
    maxReferenceImages: 10,
    maxReferenceVideos: 3,
    maxTimelineFrames: 0,
    draftResolution: '720p',
    finalResolution: '720p',
    endpoints: {
      textToVideo: 'kling/v4/text-to-video',
      imageToVideo: 'kling/v4/image-to-video',
      referenceToVideo: 'kling/v4/reference-to-video',
      videoEdit: 'kling/v4/video-to-video/edit',
    },
  },
  'wan-3.0-prime': {
    id: 'wan-3.0-prime',
    family: 'wan',
    label: 'Wan 3.0 Prime',
    tagline: 'Alibaba · T2V, I2V (start/end) & multi-modal Ref + Audio',
    resolutions: ['720p', '1080p'],
    resolutionSelectable: true,
    aspectRatios: ['16:9', '9:16', '1:1'],
    minDuration: 5,
    maxDuration: 15,
    durations: [5, 10, 15],
    durationFormat: 'number',
    workflowModes: ['text_to_video', 'image_to_video', 'reference_to_video'],
    supportsTaskMode: false,
    supportsSeed: true,
    supportsSafetyTolerance: false,
    supportsDraftEnhance: false,
    supportsOptionalEndFrameInI2V: true,
    supportsReferenceAudio: true,
    maxReferenceImages: 8,
    maxReferenceVideos: 3,
    maxTimelineFrames: 0,
    draftResolution: '720p',
    finalResolution: '720p',
    endpoints: {
      textToVideo: 'alibaba/wan-3.0-prime/text-to-video',
      imageToVideo: 'alibaba/wan-3.0-prime/image-to-video',
      referenceToVideo: 'alibaba/wan-3.0-prime/reference-to-video',
    },
  },
  'luma-ray-3.2': {
    id: 'luma-ray-3.2',
    family: 'luma',
    label: 'Luma Ray 3.2',
    tagline: '540p–1080p · V2V Restyle & Reframe outpaint',
    resolutions: ['540p', '720p', '1080p'],
    resolutionSelectable: true,
    aspectRatios: ['16:9', '9:16', '1:1', '21:9', '4:3', '3:4'],
    minDuration: 5,
    maxDuration: 10,
    durations: [5, 9, 10],
    durationFormat: 'string_s',
    workflowModes: [
      'text_to_video',
      'image_to_video',
      'video_edit',
      'video_reframe',
    ],
    supportsTaskMode: false,
    supportsSeed: false,
    supportsSafetyTolerance: false,
    supportsDraftEnhance: false,
    supportsOptionalEndFrameInI2V: true,
    maxReferenceImages: 0,
    maxReferenceVideos: 1,
    maxTimelineFrames: 0,
    draftResolution: '540p',
    finalResolution: '720p',
    endpoints: {
      textToVideo: 'luma/agent/ray/v3.2/text-to-video',
      imageToVideo: 'luma/agent/ray/v3.2/image-to-video',
      videoEdit: 'luma/agent/ray/v3.2/video-to-video',
      reframe: 'luma/agent/ray/v3.2/reframe',
    },
  },
  'veo-3.1': {
    id: 'veo-3.1',
    family: 'veo',
    label: 'Google Veo 3.1',
    tagline: 'Google DeepMind · 720p–4K, native audio, T2V, I2V, Refs & Extend',
    resolutions: ['720p', '1080p', '2160p'],
    resolutionsByMode: {
      text_to_video: ['720p', '1080p', '2160p'],
      image_to_video: ['720p', '1080p', '2160p'],
      first_last_frame: ['720p', '1080p', '2160p'],
      reference_to_video: ['720p', '1080p', '2160p'],
      video_extend: ['720p'],
    },
    resolutionSelectable: true,
    aspectRatios: ['auto', '16:9', '9:16'],
    aspectRatiosByMode: {
      text_to_video: ['16:9', '9:16'],
      reference_to_video: ['16:9', '9:16'],
    },
    minDuration: 4,
    maxDuration: 8,
    durations: [4, 6, 8],
    durationFormat: 'string_s',
    workflowModes: [
      'text_to_video',
      'image_to_video',
      'first_last_frame',
      'reference_to_video',
      'video_extend',
    ],
    supportsTaskMode: false,
    supportsSeed: true,
    supportsSafetyTolerance: false,
    supportsDraftEnhance: false,
    supportsOptionalEndFrameInI2V: true,
    maxReferenceImages: 3,
    maxReferenceVideos: 0,
    maxTimelineFrames: 0,
    draftResolution: '720p',
    finalResolution: '1080p',
    endpoints: {
      textToVideo: 'fal-ai/veo3.1',
      imageToVideo: 'fal-ai/veo3.1/image-to-video',
      firstLastToVideo: 'fal-ai/veo3.1/first-last-frame-to-video',
      referenceToVideo: 'fal-ai/veo3.1/reference-to-video',
      extendVideo: 'fal-ai/veo3.1/extend-video',
    },
  },
  'veo-3.1-fast': {
    id: 'veo-3.1-fast',
    family: 'veo',
    label: 'Google Veo 3.1 Fast',
    tagline: 'Google DeepMind · Rapid & lower-cost 720p–4K, Audio, I2V & Extend',
    resolutions: ['720p', '1080p', '2160p'],
    resolutionsByMode: {
      text_to_video: ['720p', '1080p', '2160p'],
      image_to_video: ['720p', '1080p', '2160p'],
      first_last_frame: ['720p', '1080p', '2160p'],
      video_extend: ['720p'],
    },
    resolutionSelectable: true,
    aspectRatios: ['auto', '16:9', '9:16'],
    aspectRatiosByMode: {
      text_to_video: ['16:9', '9:16'],
    },
    minDuration: 4,
    maxDuration: 8,
    durations: [4, 6, 8],
    durationFormat: 'string_s',
    workflowModes: [
      'text_to_video',
      'image_to_video',
      'first_last_frame',
      'video_extend',
    ],
    supportsTaskMode: false,
    supportsSeed: true,
    supportsSafetyTolerance: false,
    supportsDraftEnhance: false,
    supportsOptionalEndFrameInI2V: true,
    maxReferenceImages: 0,
    maxReferenceVideos: 0,
    maxTimelineFrames: 0,
    draftResolution: '720p',
    finalResolution: '1080p',
    endpoints: {
      textToVideo: 'fal-ai/veo3.1/fast',
      imageToVideo: 'fal-ai/veo3.1/fast/image-to-video',
      firstLastToVideo: 'fal-ai/veo3.1/fast/first-last-frame-to-video',
      extendVideo: 'fal-ai/veo3.1/fast/extend-video',
    },
  },
  'gemini-omni-flash': {
    id: 'gemini-omni-flash',
    family: 'gemini-omni',
    label: 'Google Gemini Omni Flash',
    tagline: 'Google DeepMind · Text-to-Video, Reference-to-Video & V2V Edit + Audio',
    resolutions: ['720p', '1080p'],
    resolutionSelectable: true,
    aspectRatios: ['auto', '16:9', '9:16', '1:1'],
    minDuration: 4,
    maxDuration: 8,
    durations: [4, 6, 8],
    durationFormat: 'string_s',
    workflowModes: ['text_to_video', 'reference_to_video', 'video_edit'],
    supportsTaskMode: false,
    supportsSeed: true,
    supportsSafetyTolerance: false,
    supportsDraftEnhance: false,
    maxReferenceImages: 3,
    maxReferenceVideos: 1,
    maxTimelineFrames: 0,
    draftResolution: '720p',
    finalResolution: '1080p',
    endpoints: {
      textToVideo: 'google/gemini-omni-flash',
      imageToVideo: 'google/gemini-omni-flash/reference-to-video',
      referenceToVideo: 'google/gemini-omni-flash/reference-to-video',
      videoEdit: 'google/gemini-omni-flash/edit',
    },
  },
};

export interface StudioFamilyInfo {
  id: StudioModelFamily;
  label: string;
  tagline: string;
  modelIds: StudioModelId[];
  defaultModelId: StudioModelId;
}

export const STUDIO_MODEL_FAMILIES: Record<StudioModelFamily, StudioFamilyInfo> = {
  seedance: {
    id: 'seedance',
    label: 'Seedance (ByteDance)',
    tagline: 'Reference images & videos, edit/extend tasks, up to 30s',
    modelIds: ['seedance-2.5', 'seedance-2.0'],
    defaultModelId: 'seedance-2.5',
  },
  'flux-3': {
    id: 'flux-3',
    label: 'FLUX 3 (Black Forest Labs)',
    tagline: 'Draft & enhance, keyframes, up to 4K with native audio',
    modelIds: ['flux-3'],
    defaultModelId: 'flux-3',
  },
  kling: {
    id: 'kling',
    label: 'Kling 4.0',
    tagline: '3–30s duration, start/end frames, @Element refs & V2V edit',
    modelIds: ['kling-4.0'],
    defaultModelId: 'kling-4.0',
  },
  wan: {
    id: 'wan',
    label: 'Wan 3.0 Prime (Alibaba)',
    tagline: 'Start/end frames & reference images, video & audio sync',
    modelIds: ['wan-3.0-prime'],
    defaultModelId: 'wan-3.0-prime',
  },
  luma: {
    id: 'luma',
    label: 'Luma Ray 3.2',
    tagline: '540p–1080p, Video-to-Video Restyle & Reframe outpaint',
    modelIds: ['luma-ray-3.2'],
    defaultModelId: 'luma-ray-3.2',
  },
  veo: {
    id: 'veo',
    label: 'Google Veo 3.1',
    tagline: 'Google DeepMind · 720p–4K cinema renders with synchronized audio',
    modelIds: ['veo-3.1', 'veo-3.1-fast'],
    defaultModelId: 'veo-3.1',
  },
  'gemini-omni': {
    id: 'gemini-omni',
    label: 'Google Gemini Omni Flash',
    tagline: 'Google DeepMind · Multimodal T2V, Reference & V2V Edit via Fal.ai',
    modelIds: ['gemini-omni-flash'],
    defaultModelId: 'gemini-omni-flash',
  },
};

export function getStudioModel(id: StudioModelId): StudioModelSpec {
  return STUDIO_MODELS[id] ?? STUDIO_MODELS['seedance-2.5'];
}

export function getStudioFamily(id: StudioModelId): StudioFamilyInfo {
  return STUDIO_MODEL_FAMILIES[getStudioModel(id).family];
}

export function clampStudioDuration(modelId: StudioModelId, duration: number): number {
  const m = getStudioModel(modelId);
  return Math.min(m.maxDuration, Math.max(m.minDuration, Math.round(duration)));
}

export function keyframeFrameIndex(timeSeconds: number, durationSeconds: number): number {
  const raw = Math.round(timeSeconds * FLUX3_FPS);
  const last = Math.max(0, Math.round(durationSeconds * FLUX3_FPS) - 1);
  return Math.min(Math.max(0, raw), last);
}

export function getStudioAvailableAspectRatios(
  modelId: StudioModelId,
  mode: StudioWorkflowMode
): StudioAspectRatio[] {
  const m = getStudioModel(modelId);
  return m.aspectRatiosByMode?.[mode] ?? m.aspectRatios;
}

export function getStudioAvailableResolutions(
  modelId: StudioModelId,
  mode: StudioWorkflowMode
): StudioResolution[] {
  const m = getStudioModel(modelId);
  return m.resolutionsByMode?.[mode] ?? m.resolutions;
}

export function resolveStudioResolution(params: {
  modelId: StudioModelId;
  qualityTier: StudioQualityTier;
  workflowMode: StudioWorkflowMode;
  resolution?: StudioResolution;
}): StudioResolution {
  const m = getStudioModel(params.modelId);
  if (params.qualityTier === 'draft' && !m.resolutionSelectable) {
    return m.draftResolution;
  }
  if (params.qualityTier === 'draft' && m.family === 'flux-3') {
    return m.draftResolution;
  }
  if (!m.resolutionSelectable) return m.finalResolution;
  const available = getStudioAvailableResolutions(params.modelId, params.workflowMode);
  if (params.resolution && available.includes(params.resolution)) return params.resolution;
  return available.includes(m.finalResolution)
    ? m.finalResolution
    : available[available.length - 1];
}

export function estimateStudioCostUsd(params: {
  modelId: StudioModelId;
  qualityTier: StudioQualityTier;
  workflowMode: StudioWorkflowMode;
  resolution?: StudioResolution;
  duration: number;
  nativeAudio?: boolean;
}): number {
  const dur = clampStudioDuration(params.modelId, params.duration);
  const res = resolveStudioResolution(params);

  if (params.modelId === 'flux-3') {
    const isExtend =
      params.workflowMode === 'video_extend' || params.workflowMode === 'reference_to_video';
    if (params.qualityTier === 'draft') {
      const rate = isExtend ? 0.12 : 0.06;
      return Math.round(rate * dur * 100) / 100;
    }
    if (isExtend) {
      const rate = res === '1080p' ? 0.53 : 0.41;
      return Math.round(rate * dur * 100) / 100;
    }
    const rates: Partial<Record<StudioResolution, number>> = {
      '720p': 0.17,
      '1080p': 0.29,
      '1440p': 0.32,
      '2160p': 0.47,
    };
    const rate = rates[res] ?? 0.29;
    return Math.round(rate * dur * 100) / 100;
  }

  if (params.modelId === 'kling-4.0') {
    const rate = res === '1080p' ? 0.14 : 0.09;
    return Math.round(rate * dur * 100) / 100;
  }

  if (params.modelId === 'wan-3.0-prime') {
    const rate = res === '1080p' ? 0.12 : 0.08;
    return Math.round(rate * dur * 100) / 100;
  }

  if (params.modelId === 'luma-ray-3.2') {
    const rate = res === '1080p' ? 0.14 : res === '720p' ? 0.09 : 0.05;
    return Math.round(rate * dur * 100) / 100;
  }

  if (params.modelId === 'veo-3.1') {
    const rate = params.nativeAudio === false ? 0.2 : 0.4;
    return Math.round(rate * dur * 100) / 100;
  }

  if (params.modelId === 'veo-3.1-fast') {
    const rate = params.nativeAudio === false ? 0.1 : 0.15;
    return Math.round(rate * dur * 100) / 100;
  }

  if (params.modelId === 'gemini-omni-flash') {
    const rate = params.nativeAudio === false ? 0.1 : 0.18;
    return Math.round(rate * dur * 100) / 100;
  }

  const basePerSec =
    params.modelId === 'seedance-2.0'
      ? params.qualityTier === 'draft'
        ? 0.04
        : 0.08
      : params.qualityTier === 'draft'
        ? 0.06
        : 0.14;
  const audioMultiplier = params.nativeAudio ? 1.25 : 1.0;
  return Math.round(basePerSec * audioMultiplier * dur * 100) / 100;
}
