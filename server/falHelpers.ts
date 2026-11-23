import { fal } from '@fal-ai/client';
import {
  clampStudioDuration,
  getStudioModel,
  keyframeFrameIndex,
  resolveStudioResolution,
  type StudioAspectRatio,
  type StudioModelId,
  type StudioQualityTier,
  type StudioReferenceTask,
  type StudioResolution,
  type StudioTimelineKeyframe,
  type StudioWorkflowMode,
  TOPAZ_UPSCALE_MODES,
  type TopazUpscaleMode,
} from '../src/utils/videoStudioCatalog.ts';
import type { StoryboardImageModel } from '../src/types/pipeline.ts';
import { readAssetAsInlineData } from './projectStore.ts';

export interface StudioGenerateInput {
  projectId: string;
  modelId: StudioModelId;
  workflowMode: StudioWorkflowMode;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: StudioAspectRatio;
  duration: number;
  qualityTier: StudioQualityTier;
  resolution?: StudioResolution;
  nativeAudio: boolean;
  safetyTolerance: number;
  enableSafetyChecker?: boolean;
  seed: number;
  startFrameUrl?: string | null;
  endFrameUrl?: string | null;
  keyframes?: StudioTimelineKeyframe[];
  sourceVideoUrl?: string | null;
  referenceImages?: string[];
  referenceElements?: string[];
  referenceVideos?: string[];
  referenceAudioUrl?: string | null;
  referenceTask?: StudioReferenceTask;
}

export async function uploadMediaRefToFal(
  projectId: string,
  urlOrDataUrl: string | null | undefined
): Promise<string | null> {
  if (!urlOrDataUrl) return null;

  if (/^https?:\/\//i.test(urlOrDataUrl)) {
    return urlOrDataUrl;
  }

  if (urlOrDataUrl.startsWith('data:')) {
    const match = urlOrDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    const blob = new Blob([Buffer.from(match[2], 'base64')], { type: match[1] });
    return fal.storage.upload(blob);
  }

  const inline = await readAssetAsInlineData(projectId, urlOrDataUrl);
  if (!inline) return null;
  const blob = new Blob([Buffer.from(inline.data, 'base64')], {
    type: inline.mimeType,
  });
  return fal.storage.upload(blob);
}

export async function buildFalVideoRequest(
  params: StudioGenerateInput
): Promise<{
  endpointId: string;
  input: Record<string, unknown>;
  resolvedResolution: StudioResolution;
  clampedDuration: number;
}> {
  const model = getStudioModel(params.modelId);
  const clampedDuration = clampStudioDuration(params.modelId, params.duration);
  const resolvedResolution = resolveStudioResolution({
    modelId: params.modelId,
    qualityTier: params.qualityTier,
    workflowMode: params.workflowMode,
    resolution: params.resolution,
  });

  const trimmedNeg = (params.negativePrompt || '').trim();

  // 1. FLUX 3 (Black Forest Labs) — preserved intact
  if (model.family === 'flux-3') {
    const draft = params.qualityTier === 'draft';
    const basePrompt = params.prompt.trim();
    const fluxPrompt =
      trimmedNeg && basePrompt ? `${basePrompt}\nAvoid: ${trimmedNeg}` : basePrompt;
    const input: Record<string, unknown> = {
      prompt: fluxPrompt,
      aspect_ratio: params.aspectRatio,
      duration: clampedDuration,
      generate_audio: params.nativeAudio,
      safety_tolerance: Math.min(4, Math.max(0, Math.round(params.safetyTolerance ?? 2))),
    };
    if (!draft) {
      input.resolution = resolvedResolution;
    }

    let endpoint = model.endpoints.textToVideo;
    switch (params.workflowMode) {
      case 'text_to_video':
        break;
      case 'image_to_video': {
        const start = await uploadMediaRefToFal(params.projectId, params.startFrameUrl);
        if (!start) throw new Error('Image to Video needs a start frame image.');
        input.image_url = start;
        endpoint = model.endpoints.imageToVideo;
        break;
      }
      case 'first_last_frame': {
        const [start, end] = await Promise.all([
          uploadMediaRefToFal(params.projectId, params.startFrameUrl),
          uploadMediaRefToFal(params.projectId, params.endFrameUrl),
        ]);
        if (!start || !end) {
          throw new Error('Keyframe Pair needs both a start frame and an end frame.');
        }
        input.start_image_url = start;
        input.end_image_url = end;
        endpoint = model.endpoints.firstLastToVideo || model.endpoints.imageToVideo;
        break;
      }
      case 'keyframes_timeline': {
        const filled = (params.keyframes || []).filter((k) => Boolean(k.imageUrl));
        const hosted = await Promise.all(
          filled.map(async (k) => ({
            time: k.timeSeconds,
            url: await uploadMediaRefToFal(params.projectId, k.imageUrl),
          }))
        );
        const frames = hosted
          .filter((h): h is { time: number; url: string } => Boolean(h.url))
          .map((h) => ({
            frame_index: keyframeFrameIndex(h.time, clampedDuration),
            image_url: h.url,
          }));
        if (frames.length === 0) {
          throw new Error('Timeline needs at least one frame with an image.');
        }
        if (new Set(frames.map((f) => f.frame_index)).size !== frames.length) {
          throw new Error(
            'Two timeline frames land on the same frame index. Adjust their timestamps.'
          );
        }
        frames.sort((a, b) => a.frame_index - b.frame_index);
        input.keyframes = frames.slice(0, model.maxTimelineFrames);
        endpoint = model.endpoints.keyframesToVideo || model.endpoints.imageToVideo;
        break;
      }
      case 'reference_to_video':
      case 'video_extend': {
        if (params.referenceImages && params.referenceImages.length > 0) {
          throw new Error(
            'FLUX 3 Video Extend does not accept reference images. Switch to Seedance 2.5, Kling 4.0, or Wan 3.0 Prime to combine reference images with video.'
          );
        }
        const vidCandidate = params.sourceVideoUrl || params.referenceVideos?.[0];
        const vid = await uploadMediaRefToFal(params.projectId, vidCandidate);
        if (!vid) {
          throw new Error('Video & Ref mode on FLUX 3 needs a video clip (or switch to Seedance 2.5 to use reference images).');
        }
        input.video_url = vid;
        endpoint = model.endpoints.extendVideo || model.endpoints.imageToVideo;
        break;
      }
      default:
        throw new Error('Unsupported workflow mode for FLUX 3.');
    }

    return {
      endpointId: draft ? `${endpoint}/draft` : endpoint,
      input,
      resolvedResolution,
      clampedDuration,
    };
  }

  // 2. Kling 4.0 (T2V / I2V / Reference / V2V Edit)
  if (model.family === 'kling') {
    const mappedAspect =
      params.workflowMode === 'reference_to_video'
        ? params.aspectRatio
        : params.aspectRatio === 'auto' || params.aspectRatio === '2:1'
          ? '16:9'
          : params.aspectRatio;
    const klingRes: StudioResolution =
      resolvedResolution === '1080p' ? '1080p' : '720p';

    const base: Record<string, unknown> = {
      prompt: params.prompt.trim(),
      duration: clampedDuration, // integer 3-30
      resolution: klingRes,
      aspect_ratio: mappedAspect,
      generate_audio: params.nativeAudio,
      ...(trimmedNeg ? { negative_prompt: trimmedNeg } : {}),
    };

    if (params.workflowMode === 'image_to_video' || params.workflowMode === 'first_last_frame') {
      const start = await uploadMediaRefToFal(params.projectId, params.startFrameUrl);
      if (!start) {
        throw new Error('Kling 4.0 Image-to-Video requires a start frame image.');
      }
      const input: Record<string, unknown> = {
        ...base,
        start_image_url: start,
      };
      if (params.endFrameUrl) {
        const end = await uploadMediaRefToFal(params.projectId, params.endFrameUrl);
        if (end) input.end_image_url = end;
      }
      return {
        endpointId: model.endpoints.imageToVideo,
        input,
        resolvedResolution: klingRes,
        clampedDuration,
      };
    }

    if (params.workflowMode === 'reference_to_video') {
      const rawVideos = [
        ...(params.sourceVideoUrl ? [params.sourceVideoUrl] : []),
        ...(params.referenceVideos || []),
      ];
      const uniqueVideos = Array.from(new Set(rawVideos));
      const [refImgs, refElements, refVids] = await Promise.all([
        Promise.all(
          (params.referenceImages || []).map((r) => uploadMediaRefToFal(params.projectId, r))
        ),
        Promise.all(
          (params.referenceElements || []).map((r) => uploadMediaRefToFal(params.projectId, r))
        ),
        Promise.all(uniqueVideos.map((r) => uploadMediaRefToFal(params.projectId, r))),
      ]);

      const imageUrls = refImgs.filter((u): u is string => Boolean(u));
      const elementUrls = refElements.filter((u): u is string => Boolean(u));
      const videoUrls = refVids.filter((u): u is string => Boolean(u));

      if (imageUrls.length === 0 && elementUrls.length === 0 && videoUrls.length === 0) {
        throw new Error(
          'Kling 4.0 Reference-to-Video needs at least one reference image, element, or video.'
        );
      }

      const input: Record<string, unknown> = { ...base };
      if (imageUrls.length > 0) input.image_urls = imageUrls;
      if (elementUrls.length > 0) {
        input.elements = elementUrls.map((url) => ({ frontal_image_url: url }));
      }
      if (videoUrls.length > 0) {
        input.video_url = videoUrls[0];
        if (videoUrls.length > 1) input.video_urls = videoUrls;
      }
      return {
        endpointId: model.endpoints.referenceToVideo || 'kling/v4/reference-to-video',
        input,
        resolvedResolution: klingRes,
        clampedDuration,
      };
    }

    if (params.workflowMode === 'video_edit' || params.workflowMode === 'video_extend') {
      const vidCandidate = params.sourceVideoUrl || params.referenceVideos?.[0];
      const videoUrl = await uploadMediaRefToFal(params.projectId, vidCandidate);
      if (!videoUrl) {
        throw new Error('Kling 4.0 V2V Edit requires a source video clip (3–30s).');
      }
      const refImgs = (
        await Promise.all(
          (params.referenceImages || []).map((r) => uploadMediaRefToFal(params.projectId, r))
        )
      ).filter((u): u is string => Boolean(u));

      const input: Record<string, unknown> = {
        ...base,
        video_url: videoUrl,
      };
      if (refImgs.length > 0) input.image_urls = refImgs;
      return {
        endpointId: model.endpoints.videoEdit || 'kling/v4/video-to-video/edit',
        input,
        resolvedResolution: klingRes,
        clampedDuration,
      };
    }

    return {
      endpointId: model.endpoints.textToVideo,
      input: base,
      resolvedResolution: klingRes,
      clampedDuration,
    };
  }

  // 3. Wan 3.0 Prime (Alibaba T2V / I2V / Reference-to-Video)
  if (model.family === 'wan') {
    const wanRes: StudioResolution =
      resolvedResolution === '1080p' ? '1080p' : '720p';
    const mappedAspect =
      params.aspectRatio === '9:16' || params.aspectRatio === '1:1'
        ? params.aspectRatio
        : '16:9';

    const base: Record<string, unknown> = {
      prompt: params.prompt.trim(),
      duration: clampedDuration,
      resolution: wanRes,
      aspect_ratio: mappedAspect,
      seed: params.seed,
      ...(trimmedNeg ? { negative_prompt: trimmedNeg } : {}),
    };

    if (params.workflowMode === 'image_to_video' || params.workflowMode === 'first_last_frame') {
      const start = await uploadMediaRefToFal(params.projectId, params.startFrameUrl);
      if (!start) {
        throw new Error('Wan 3.0 Prime Image-to-Video requires a start frame image.');
      }
      const input: Record<string, unknown> = {
        ...base,
        start_image_url: start,
      };
      if (params.endFrameUrl) {
        const end = await uploadMediaRefToFal(params.projectId, params.endFrameUrl);
        if (end) input.end_image_url = end;
      }
      return {
        endpointId: model.endpoints.imageToVideo,
        input,
        resolvedResolution: wanRes,
        clampedDuration,
      };
    }

    if (params.workflowMode === 'reference_to_video') {
      const rawVideos = [
        ...(params.sourceVideoUrl ? [params.sourceVideoUrl] : []),
        ...(params.referenceVideos || []),
      ];
      const [refImgs, refVids, refAudio] = await Promise.all([
        Promise.all(
          (params.referenceImages || []).map((r) => uploadMediaRefToFal(params.projectId, r))
        ),
        Promise.all(
          Array.from(new Set(rawVideos)).map((r) => uploadMediaRefToFal(params.projectId, r))
        ),
        uploadMediaRefToFal(params.projectId, params.referenceAudioUrl),
      ]);
      const imageUrls = refImgs.filter((u): u is string => Boolean(u));
      const videoUrls = refVids.filter((u): u is string => Boolean(u));

      if (imageUrls.length === 0 && videoUrls.length === 0 && !refAudio) {
        throw new Error(
          'Wan 3.0 Prime Reference-to-Video needs at least one reference image, video, or audio clip.'
        );
      }

      const input: Record<string, unknown> = { ...base };
      if (imageUrls.length > 0) input.image_urls = imageUrls;
      if (videoUrls.length > 0) {
        input.video_urls = videoUrls;
        input.video_url = videoUrls[0];
      }
      if (refAudio) input.audio_url = refAudio;

      return {
        endpointId:
          model.endpoints.referenceToVideo || 'alibaba/wan-3.0-prime/reference-to-video',
        input,
        resolvedResolution: wanRes,
        clampedDuration,
      };
    }

    return {
      endpointId: model.endpoints.textToVideo,
      input: base,
      resolvedResolution: wanRes,
      clampedDuration,
    };
  }

  // 4. Luma Ray 3.2 (T2V / I2V / V2V Restyle / Reframe)
  if (model.family === 'luma') {
    const lumaRes: StudioResolution =
      resolvedResolution === '540p' || resolvedResolution === '1080p'
        ? resolvedResolution
        : '720p';
    const mappedAspect =
      params.aspectRatio === 'auto' || params.aspectRatio === '2:1'
        ? '16:9'
        : params.aspectRatio;

    const lumaPromptBase = params.prompt.trim();
    const lumaPrompt =
      trimmedNeg && lumaPromptBase && params.workflowMode !== 'video_reframe'
        ? `${lumaPromptBase}\nAvoid: ${trimmedNeg}`
        : lumaPromptBase;

    const base: Record<string, unknown> = {
      prompt: lumaPrompt,
      duration: `${clampedDuration}s`,
      resolution: lumaRes,
      aspect_ratio: mappedAspect,
      enable_safety_checker: params.enableSafetyChecker ?? false,
    };

    if (params.workflowMode === 'image_to_video' || params.workflowMode === 'first_last_frame') {
      const start = await uploadMediaRefToFal(params.projectId, params.startFrameUrl);
      if (!start) {
        throw new Error('Luma Ray 3.2 Image-to-Video requires a start frame image.');
      }
      const input: Record<string, unknown> = {
        ...base,
        image_url: start,
      };
      if (params.endFrameUrl) {
        const end = await uploadMediaRefToFal(params.projectId, params.endFrameUrl);
        if (end) input.end_image_url = end;
      }
      return {
        endpointId: model.endpoints.imageToVideo,
        input,
        resolvedResolution: lumaRes,
        clampedDuration,
      };
    }

    if (params.workflowMode === 'video_edit') {
      const vidCandidate = params.sourceVideoUrl || params.referenceVideos?.[0];
      const videoUrl = await uploadMediaRefToFal(params.projectId, vidCandidate);
      if (!videoUrl) {
        throw new Error('Luma Ray 3.2 Video-to-Video Restyle requires a source video clip.');
      }
      return {
        endpointId: model.endpoints.videoEdit || 'luma/agent/ray/v3.2/video-to-video',
        input: {
          ...base,
          video_url: videoUrl,
        },
        resolvedResolution: lumaRes,
        clampedDuration,
      };
    }

    if (params.workflowMode === 'video_reframe') {
      const vidCandidate = params.sourceVideoUrl || params.referenceVideos?.[0];
      const videoUrl = await uploadMediaRefToFal(params.projectId, vidCandidate);
      if (!videoUrl) {
        throw new Error('Luma Ray 3.2 Reframe requires a source video clip.');
      }
      const input: Record<string, unknown> = {
        video_url: videoUrl,
        aspect_ratio: mappedAspect,
        enable_safety_checker: params.enableSafetyChecker ?? false,
      };
      if (params.prompt.trim()) input.prompt = params.prompt.trim();
      return {
        endpointId: model.endpoints.reframe || 'luma/agent/ray/v3.2/reframe',
        input,
        resolvedResolution: lumaRes,
        clampedDuration,
      };
    }

    return {
      endpointId: model.endpoints.textToVideo,
      input: base,
      resolvedResolution: lumaRes,
      clampedDuration,
    };
  }

  // 5. Google DeepMind Veo 3.1 / Veo 3.1 Fast (T2V / I2V / First-Last / Reference / Extend)
  if (model.family === 'veo') {
    const veoRes: StudioResolution =
      resolvedResolution === '2160p'
        ? '2160p'
        : resolvedResolution === '1080p'
          ? '1080p'
          : '720p';
    const apiRes = veoRes === '2160p' ? '4k' : veoRes;
    const veoDur = [4, 6, 8].reduce(
      (best, cand) =>
        Math.abs(cand - clampedDuration) < Math.abs(best - clampedDuration) ? cand : best,
      6
    );
    const mappedAspect =
      params.aspectRatio === '9:16' || params.aspectRatio === 'auto'
        ? params.aspectRatio
        : '16:9';

    const base: Record<string, unknown> = {
      prompt: params.prompt.trim(),
      duration: `${veoDur}s`,
      aspect_ratio: mappedAspect,
      resolution: apiRes,
      generate_audio: params.nativeAudio,
      seed: params.seed,
      ...(trimmedNeg ? { negative_prompt: trimmedNeg } : {}),
    };

    if (params.workflowMode === 'first_last_frame') {
      const [start, end] = await Promise.all([
        uploadMediaRefToFal(params.projectId, params.startFrameUrl),
        uploadMediaRefToFal(params.projectId, params.endFrameUrl),
      ]);
      if (!start || !end) {
        throw new Error('Google Veo 3.1 First/Last Frame mode requires both a start and end frame.');
      }
      return {
        endpointId: model.endpoints.firstLastToVideo || model.endpoints.imageToVideo,
        input: {
          ...base,
          first_frame_url: start,
          last_frame_url: end,
        },
        resolvedResolution: veoRes,
        clampedDuration: veoDur,
      };
    }

    if (params.workflowMode === 'image_to_video') {
      const start = await uploadMediaRefToFal(params.projectId, params.startFrameUrl);
      if (!start) {
        throw new Error('Google Veo 3.1 Image-to-Video requires a start frame image.');
      }
      if (params.endFrameUrl && model.endpoints.firstLastToVideo) {
        const end = await uploadMediaRefToFal(params.projectId, params.endFrameUrl);
        if (end) {
          return {
            endpointId: model.endpoints.firstLastToVideo,
            input: {
              ...base,
              first_frame_url: start,
              last_frame_url: end,
            },
            resolvedResolution: veoRes,
            clampedDuration: veoDur,
          };
        }
      }
      return {
        endpointId: model.endpoints.imageToVideo,
        input: {
          ...base,
          image_url: start,
        },
        resolvedResolution: veoRes,
        clampedDuration: veoDur,
      };
    }

    if (params.workflowMode === 'reference_to_video') {
      const rawRefs =
        params.referenceImages && params.referenceImages.length > 0
          ? params.referenceImages
          : params.startFrameUrl
            ? [params.startFrameUrl]
            : [];
      const refImgs = (
        await Promise.all(
          rawRefs.slice(0, Math.max(1, model.maxReferenceImages)).map((r) =>
            uploadMediaRefToFal(params.projectId, r)
          )
        )
      ).filter((u): u is string => Boolean(u));

      if (refImgs.length === 0) {
        throw new Error('Google Veo 3.1 Reference-to-Video requires at least one reference image (up to 3).');
      }
      return {
        endpointId: model.endpoints.referenceToVideo || 'fal-ai/veo3.1/reference-to-video',
        input: {
          ...base,
          duration: '8s',
          aspect_ratio: mappedAspect === 'auto' ? '16:9' : mappedAspect,
          image_urls: refImgs,
        },
        resolvedResolution: veoRes,
        clampedDuration: 8,
      };
    }

    if (params.workflowMode === 'video_extend') {
      const vidCandidate = params.sourceVideoUrl || params.referenceVideos?.[0];
      const videoUrl = await uploadMediaRefToFal(params.projectId, vidCandidate);
      if (!videoUrl) {
        throw new Error('Google Veo 3.1 Extend Video requires a source video clip.');
      }
      return {
        endpointId: model.endpoints.extendVideo || 'fal-ai/veo3.1/fast/extend-video',
        input: {
          ...base,
          resolution: apiRes,
          video_url: videoUrl,
        },
        resolvedResolution: veoRes,
        clampedDuration: veoDur,
      };
    }

    return {
      endpointId: model.endpoints.textToVideo,
      input: {
        ...base,
        aspect_ratio: mappedAspect === 'auto' ? '16:9' : mappedAspect,
      },
      resolvedResolution: veoRes,
      clampedDuration: veoDur,
    };
  }

  // 6. Google Gemini Omni Flash (T2V / Reference-to-Video / V2V Edit via Fal.ai)
  if (model.family === 'gemini-omni') {
    const omniRes: StudioResolution =
      resolvedResolution === '1080p' ? '1080p' : '720p';
    const omniDur = [4, 6, 8].reduce(
      (best, cand) =>
        Math.abs(cand - clampedDuration) < Math.abs(best - clampedDuration) ? cand : best,
      6
    );
    const mappedAspect =
      params.aspectRatio === '9:16' ||
      params.aspectRatio === '1:1' ||
      params.aspectRatio === 'auto'
        ? params.aspectRatio
        : '16:9';

    const base: Record<string, unknown> = {
      prompt: params.prompt.trim(),
      aspect_ratio: mappedAspect,
      duration: `${omniDur}s`,
      resolution: omniRes,
      generate_audio: params.nativeAudio,
      seed: params.seed,
      ...(trimmedNeg ? { negative_prompt: trimmedNeg } : {}),
    };

    if (params.workflowMode === 'video_edit' || params.workflowMode === 'video_extend') {
      const vidCandidate = params.sourceVideoUrl || params.referenceVideos?.[0];
      const videoUrl = await uploadMediaRefToFal(params.projectId, vidCandidate);
      if (!videoUrl) {
        throw new Error(
          'Google Gemini Omni Flash Video-to-Video Edit requires a source video clip.'
        );
      }
      return {
        endpointId: model.endpoints.videoEdit || 'google/gemini-omni-flash/edit',
        input: {
          ...base,
          video_url: videoUrl,
        },
        resolvedResolution: omniRes,
        clampedDuration: omniDur,
      };
    }

    if (
      params.workflowMode === 'reference_to_video' ||
      params.workflowMode === 'image_to_video'
    ) {
      const rawRefs =
        params.referenceImages && params.referenceImages.length > 0
          ? params.referenceImages
          : params.startFrameUrl
            ? [params.startFrameUrl]
            : [];
      const refImgs = (
        await Promise.all(
          rawRefs.slice(0, Math.max(1, model.maxReferenceImages)).map((r) =>
            uploadMediaRefToFal(params.projectId, r)
          )
        )
      ).filter((u): u is string => Boolean(u));
      const vidCandidate = params.sourceVideoUrl || params.referenceVideos?.[0];
      const videoUrl = await uploadMediaRefToFal(params.projectId, vidCandidate);

      if (refImgs.length === 0 && !videoUrl) {
        throw new Error(
          'Google Gemini Omni Flash Reference-to-Video requires at least one reference image or video.'
        );
      }

      const input: Record<string, unknown> = { ...base };
      if (refImgs.length > 0) input.image_urls = refImgs;
      if (videoUrl) input.video_url = videoUrl;

      return {
        endpointId:
          model.endpoints.referenceToVideo || 'google/gemini-omni-flash/reference-to-video',
        input,
        resolvedResolution: omniRes,
        clampedDuration: omniDur,
      };
    }

    return {
      endpointId: model.endpoints.textToVideo || 'google/gemini-omni-flash',
      input: base,
      resolvedResolution: omniRes,
      clampedDuration: omniDur,
    };
  }

  // 7. Seedance (2.5 or 2.0 Fast) — preserved intact
  const is25 = params.modelId === 'seedance-2.5';
  const referenceEndpoint = model.endpoints.referenceToVideo as string;
  const mappedAspect = params.aspectRatio === '2:1' ? '16:9' : params.aspectRatio;
  const base: Record<string, unknown> = {
    prompt: params.prompt.trim(),
    resolution: resolvedResolution,
    duration: String(clampedDuration),
    aspect_ratio: mappedAspect,
    generate_audio: params.nativeAudio,
    seed: params.seed,
    ...(trimmedNeg ? { negative_prompt: trimmedNeg } : {}),
  };

  if (params.workflowMode === 'keyframes_timeline') {
    const kfUrls = (
      await Promise.all(
        (params.keyframes || [])
          .filter((k) => Boolean(k.imageUrl))
          .map((k) => uploadMediaRefToFal(params.projectId, k.imageUrl))
      )
    ).filter((u): u is string => Boolean(u));
    if (kfUrls.length === 0) {
      throw new Error('Timeline needs at least one frame with an image.');
    }
    const input: Record<string, unknown> = {
      ...base,
      image_urls: kfUrls.slice(0, model.maxReferenceImages),
    };
    if (is25) input.task = 'reference';
    return {
      endpointId: referenceEndpoint,
      input,
      resolvedResolution,
      clampedDuration,
    };
  }

  if (params.workflowMode === 'image_to_video' || params.workflowMode === 'first_last_frame') {
    const start = await uploadMediaRefToFal(params.projectId, params.startFrameUrl);
    if (!start) {
      throw new Error('A start frame image is required for this mode.');
    }
    const input: Record<string, unknown> = { ...base, image_url: start };
    if (is25) input.aspect_ratio = 'auto';
    if (params.workflowMode === 'first_last_frame') {
      const end = await uploadMediaRefToFal(params.projectId, params.endFrameUrl);
      if (end) input.end_image_url = end;
    }
    return {
      endpointId: model.endpoints.imageToVideo,
      input,
      resolvedResolution,
      clampedDuration,
    };
  }

  if (params.workflowMode === 'reference_to_video' || params.workflowMode === 'video_extend') {
    const rawVideos = [
      ...(params.sourceVideoUrl ? [params.sourceVideoUrl] : []),
      ...(params.referenceVideos || []),
    ];
    const uniqueRawVideos = Array.from(new Set(rawVideos));
    const refImgs = (
      await Promise.all(
        (params.referenceImages || []).map((r) => uploadMediaRefToFal(params.projectId, r))
      )
    ).filter((u): u is string => Boolean(u));
    const refVids = (
      await Promise.all(
        uniqueRawVideos.map((r) => uploadMediaRefToFal(params.projectId, r))
      )
    ).filter((u): u is string => Boolean(u));
    if (refImgs.length === 0 && refVids.length === 0) {
      throw new Error('Add at least one video clip or reference image.');
    }
    const input: Record<string, unknown> = { ...base };
    if (refImgs.length > 0) input.image_urls = refImgs.slice(0, model.maxReferenceImages);
    if (refVids.length > 0) input.video_urls = refVids.slice(0, model.maxReferenceVideos);
    if (is25) {
      input.task =
        params.referenceTask ||
        (params.workflowMode === 'video_extend' ? 'extension' : 'reference');
    }
    return {
      endpointId: referenceEndpoint,
      input,
      resolvedResolution,
      clampedDuration,
    };
  }

  return {
    endpointId: model.endpoints.textToVideo,
    input: base,
    resolvedResolution,
    clampedDuration,
  };
}

export async function buildTopazUpscaleRequest(params: {
  projectId: string;
  videoUrl: string;
  mode: TopazUpscaleMode;
  subModel?: string;
  scaleFactor: 2 | 4;
  creativity?: number;
}): Promise<{
  endpointId: string;
  input: Record<string, unknown>;
  resolvedSubModel: string;
  scaleFactor: 2 | 4;
}> {
  const hostedSource = await uploadMediaRefToFal(params.projectId, params.videoUrl);
  if (!hostedSource) {
    throw new Error('No video source was found to upscale.');
  }

  const modeSpec = TOPAZ_UPSCALE_MODES[params.mode] || TOPAZ_UPSCALE_MODES.precision;
  const resolvedSubModel =
    params.subModel && modeSpec.models.includes(params.subModel)
      ? params.subModel
      : modeSpec.defaultModel;
  const scaleFactor: 2 | 4 = params.scaleFactor === 4 ? 4 : 2;

  // Frame Rate Lock: intentionally omit `target_fps` so original cadence (e.g. 24fps/30fps) is preserved without interpolation
  const input: Record<string, unknown> = {
    video_url: hostedSource,
    upscale_factor: scaleFactor,
    H264_output: true,
  };

  if (modeSpec.id === 'creative') {
    input.model = 'Astra 2';
    input.creativity = Math.min(
      1.0,
      Math.max(0.0, typeof params.creativity === 'number' ? params.creativity : 0.5)
    );
  } else {
    input.model = resolvedSubModel;
  }

  return {
    endpointId: modeSpec.endpoint,
    input,
    resolvedSubModel,
    scaleFactor,
  };
}

export function describeFalFailure(err: unknown): {
  status: number;
  message: string;
} {
  const errObj = err as {
    status?: number;
    body?: { detail?: unknown; error_type?: string };
    message?: string;
  };

  const status = typeof errObj?.status === 'number' ? errObj.status : 500;
  let rawMsg = err instanceof Error ? err.message : '';
  const detail = errObj?.body?.detail;
  const types: string[] = [];

  if (Array.isArray(detail)) {
    const parts: string[] = [];
    for (const item of detail) {
      const o = (item ?? {}) as { type?: string; msg?: string };
      if (o.type) types.push(o.type);
      if (o.msg) parts.push(o.msg);
    }
    if (parts.length > 0) rawMsg = parts.join('; ');
  } else if (typeof detail === 'string') {
    rawMsg = detail;
    if (errObj.body?.error_type) types.push(errObj.body.error_type);
  }

  const lower = rawMsg.toLowerCase();
  if (/audio/.test(lower) && /sensitive/.test(lower)) {
    return {
      status: 422,
      message:
        'The generated audio was flagged by safety filters. Turn off Native Sound Design and generate again.',
    };
  }
  if (
    types.includes('content_policy_violation') ||
    /sensitive|policy|moderat|not allowed|prohibited/.test(lower)
  ) {
    return {
      status: 422,
      message:
        'fal.ai content filter blocked this request. Adjust the wording or try a different frame.',
    };
  }
  if (types.includes('generation_timeout')) {
    return {
      status: 504,
      message: 'Generation timed out on fal.ai. Try again or pick a shorter duration.',
    };
  }
  if (status === 401 || status === 403) {
    return {
      status: 401,
      message: 'fal.ai rejected the FAL_KEY. Add FAL_KEY to the server environment variables.',
    };
  }
  if (status === 429) {
    return {
      status: 429,
      message: 'Too many requests running on fal.ai right now. Wait a moment and try again.',
    };
  }

  return {
    status: status >= 400 && status < 600 ? status : 500,
    message: rawMsg || 'Generation failed on fal.ai.',
  };
}

export interface NanoBananaFalInput {
  projectId: string;
  model: StoryboardImageModel;
  prompt: string;
  aspectRatio?: '16:9' | '9:16' | '4:5' | '1:1' | '21:9' | '4:3' | '3:4';
  resolution?: '1K' | '2K';
  referenceImageUrls?: string[];
}

export async function generateNanoBananaImageViaFal(
  params: NanoBananaFalInput
): Promise<{
  imageUrl: string;
  endpointUsed: string;
  uploadedRefCount: number;
}> {
  const uniqueRefs = Array.from(
    new Set((params.referenceImageUrls || []).map((u) => u.trim()).filter(Boolean))
  ).slice(0, 14);

  const hostedRefs = (
    await Promise.all(
      uniqueRefs.map((refUrl) => uploadMediaRefToFal(params.projectId, refUrl))
    )
  ).filter((u): u is string => Boolean(u));

  const isEdit = hostedRefs.length > 0;
  const candidateEndpoints: string[] =
    params.model === 'nano-banana-pro'
      ? isEdit
        ? ['fal-ai/nano-banana-pro/edit', 'fal-ai/nano-banana-2/edit', 'fal-ai/nano-banana/edit']
        : ['fal-ai/nano-banana-pro', 'fal-ai/nano-banana-2', 'fal-ai/nano-banana']
      : params.model === 'nano-banana'
        ? isEdit
          ? ['fal-ai/nano-banana/edit']
          : ['fal-ai/nano-banana']
        : isEdit
          ? ['fal-ai/nano-banana-2/edit', 'fal-ai/nano-banana/edit']
          : ['fal-ai/nano-banana-2', 'fal-ai/nano-banana'];

  const ratio = params.aspectRatio || '16:9';
  const resolution = params.resolution === '2K' ? '2K' : '1K';

  let lastErr: unknown = null;
  for (let i = 0; i < candidateEndpoints.length; i++) {
    const endpointId = candidateEndpoints[i];
    const supportsResolution =
      endpointId.includes('nano-banana-2') || endpointId.includes('nano-banana-pro');
    const input: Record<string, unknown> = {
      prompt: params.prompt.trim(),
      aspect_ratio: ratio,
      output_format: 'png',
      num_images: 1,
      ...(supportsResolution ? { resolution } : {}),
      ...(isEdit ? { image_urls: hostedRefs } : {}),
    };

    try {
      const result = await fal.subscribe(endpointId, { input, logs: false });
      const data = result.data as {
        images?: Array<{ url?: string }>;
        image?: { url?: string };
      };
      const imageUrl = data?.images?.[0]?.url || data?.image?.url;
      if (!imageUrl) {
        throw new Error('fal.ai Nano Banana completed without returning an image.');
      }
      return {
        imageUrl,
        endpointUsed: endpointId,
        uploadedRefCount: hostedRefs.length,
      };
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if ((status === 404 || status === 422) && i < candidateEndpoints.length - 1) {
        continue;
      }
      throw err;
    }
  }

  throw lastErr || new Error('Nano Banana generation failed on fal.ai.');
}

