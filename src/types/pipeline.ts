export type PipelineStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type ShotRoute = 'ai_video' | 'hybrid' | 'live';
export type VideoModelOption =
  | 'flux3'
  | 'seedance'
  | 'kling'
  | 'wan'
  | 'luma'
  | 'veo'
  | 'omni'
  | 'none';
export type ShotStatus =
  | 'Draft'
  | 'Frame Uploaded'
  | 'Needs Fix'
  | 'Frame Passed'
  | 'Video Ready';

export interface ProductPhoto {
  id: string;
  url: string;
  caption: string;
}

export interface ProductInfo {
  name: string;
  description: string;
  provableClaims: string[];
  photos: ProductPhoto[];
}

export interface IntakeInfo {
  audience: string;
  tone: string;
  clientMarketingIdeas: string;
  videosWanted: string;
  shootLocationDatesBudgetNotes: string;
}

export interface BibleCharacter {
  id: string;
  name: string;
  fixedDescriptor: string;
}

export interface BrandBible {
  positioning: string;
  audience: string;
  toneOfVoice: {
    adjectives: string[];
    guidance: string;
  };
  visualStyle: {
    palette: string;
    typography?: string;
    lighting: string;
    lensAndFraming: string;
    grade: string;
  };
  brandLogoUrl?: string | null;
  brandLogoCaption?: string;
  brandGraphics?: ProductPhoto[];
  characters: BibleCharacter[];
  productRules: string;
  bannedList: string[];
  claimsAllowed: string[];
  claimsToFlag: string[];
  hasGenerated: boolean;
  manuallyEdited: boolean;
}

export interface BriefConcept {
  id: string;
  title: string;
  logline: string;
  whyItWorks: string;
  risks: string;
}

export interface CreativeBriefPipeline {
  objective: string;
  keyMessage: string;
  concepts: BriefConcept[];
  recommendedConcept: {
    title: string;
    reason: string;
  };
  deliverables: string[];
  voDirection: {
    pace: string;
    emotionalArc: string;
    speaker: string;
  };
  claimsCheck: string;
  hasGenerated: boolean;
  manuallyEdited: boolean;
}

export interface FrameCheckResult {
  passed: boolean;
  scores: {
    characterMatch: number;
    styleMatch: number;
    compositionMatch: number;
    artifacts: number;
    productFidelity: number | null;
  };
  problems: string[];
  productDifferences: string[];
  improvedFramePrompt: string;
  checkedAt: string;
}

export type GridQuadrantKey =
  | 'top_left'
  | 'top_right'
  | 'bottom_left'
  | 'bottom_right';

export interface GridSplitClip {
  quadrant: GridQuadrantKey;
  label: string;
  videoUrl: string;
  upscaledVideoUrl?: string | null;
  upscaledResolution?: string | null;
  upscaleDetails?: UpscaleDetails | null;
  createdAt: string;
}

export interface ShotClipHistoryItem {
  id: string;
  videoUrl: string;
  createdAt: string;
  modelId: string;
  workflowMode: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  duration: number;
  qualityTier: 'draft' | 'final';
  resolution: string;
  nativeAudio: boolean;
  safetyTolerance?: number;
  enableSafetyChecker?: boolean;
  seed?: number | null;
  startFrameUrl?: string | null;
  endFrameUrl?: string | null;
  keyframes?: Array<{
    id: string;
    timeSeconds: number;
    imageUrl: string;
    label?: string;
  }>;
  sourceVideoUrl?: string | null;
  referenceImages?: string[];
  referenceElements?: string[];
  referenceVideos?: string[];
  referenceAudioUrl?: string | null;
  referenceTask?: string;
  draftCacheUrl?: string | null;
  upscaledVideoUrl?: string | null;
  upscaledResolution?: string | null;
  isGridMode?: boolean;
  gridFrameInputs?: string[];
  gridShotPrompts?: string[];
  gridSplitClips?: GridSplitClip[];
}

export interface PipelineShot {
  id: string; // S01, S02...
  deliverable: string;
  durationSec: number;
  scene: string;
  route: ShotRoute;
  model: VideoModelOption;
  productInFrame: boolean;
  framePrompt: string;
  shootDirection: string;
  voLine: string;
  continuityNotes: string;
  chainFrom: string; // 'none' or shot id
  frameImageUrl: string | null;
  frameCheck: FrameCheckResult | null;
  productFrameApproved: boolean;
  videoPrompt: string;
  negativePrompt: string;
  videoUrl: string | null;
  videoSeed: number | null;
  videoResolution?: string;
  draftCacheUrl?: string | null;
  upscaledVideoUrl?: string | null;
  upscaledResolution?: string | null;
  upscaleDetails?: UpscaleDetails | null;
  videoHistory?: ShotClipHistoryItem[];
  isGridMode?: boolean;
  gridFrameInputs?: string[];
  gridShotPrompts?: string[];
  gridSplitClips?: GridSplitClip[];
  status: ShotStatus;
}

export interface UpscaleDetails {
  mode: 'precision' | 'generative' | 'creative';
  subModel: string;
  scaleFactor: 2 | 4;
  creativity?: number;
  h264Output: boolean;
  upscaledAt: string;
}

export interface ExternalUpscaleItem {
  id: string;
  label: string;
  sourceUrl: string;
  upscaledVideoUrl: string;
  upscaledResolution: string;
  details: UpscaleDetails;
}

export interface VoScriptLine {
  id: string;
  shotId: string;
  speaker: string;
  direction: string;
  line: string;
  audioTags: string;
  emotionalTone?: string;
  emotionIntensity?: number;
  voiceName?: string;
  speed?: number;
  pitch?: number;
  language?: string;
  pauseAfter?: number;
  audioUrl?: string | null;
  durationSec?: number;
  targetWords?: number;
}

export interface VoStudioSettings {
  voiceName: string;
  emotionalTone: string;
  emotionIntensity: number;
  speed: number;
  pitch: number;
  language: string;
  pauseAfter: number;
  ttsModel: 'gemini-3.8-flash-tts' | 'gemini-3.8-flash-lite-tts';
  enhanceWithDSP: boolean;
  singleVoiceMode: boolean;
  customStylePrompt?: string;
}

export interface ShootScheduleBlock {
  id: string;
  timeSlot: string; // e.g., "07:00 - 08:00"
  activity: string; // e.g., "Crew Call & Equipment Load-In", "Setup A", "Lunch Break"
  category: 'call' | 'setup' | 'meal' | 'move' | 'wrap' | 'general';
  shotIds?: string[];
  notes?: string;
  estimatedMinutes?: number;
}

export interface ShootDayPlan {
  id: string;
  dayLabel: string;
  location: string;
  callTime: string;
  wrapTime: string;
  breakfastTime?: string;
  lunchTime?: string;
  scheduleBreakdown?: ShootScheduleBlock[];
  setups: Array<{
    setupName: string;
    lightingNotes: string;
    shotIds: string[];
    estimatedMinutes: number;
    timeSlot?: string;
  }>;
}

export interface ShootPlan {
  shootDays: ShootDayPlan[];
  equipment: string[];
  propsAndUnits: Array<{
    item: string;
    quantity: string;
    suppliedBy: string;
  }>;
  crew: string[];
  risks: string[];
  clientQuestions: string[];
  hasGenerated: boolean;
  manuallyEdited?: boolean;
}

export interface ApprovalState {
  intakeCompleted: boolean;
  bibleApproved: boolean;
  briefApproved: boolean;
  shotListApproved: boolean;
  storyboardApproved: boolean;
  videoPromptsApproved: boolean;
  voApproved: boolean;
  shootPlanApproved: boolean;
}

export interface GenerationLogEntry {
  id: string;
  timestamp: string;
  step: string;
  shotId?: string;
  model: string;
  prompt: string;
  seed?: number | null;
  status: 'success' | 'error';
  notes?: string;
}

export interface BrandGuideDocument {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  extractedAt: string;
  graphicCount?: number;
}

export interface ExtractedStyleGuide {
  summary: string;
  palette: string;
  paletteHexes: string[];
  typography: string;
  lighting: string;
  lensAndFraming: string;
  grade: string;
  visualStyleNotes: string;
  productVisualRules: string;
  brandLogoNotes: string;
  bannedElements: string[];
  sourceFileNames: string[];
}

export type StoryboardStylePreset =
  | 'sketch'
  | '3d_animation'
  | 'charcoal'
  | 'claymation'
  | 'concept_sketch'
  | 'realistic';

export type StoryboardImageModel =
  | 'nano-banana-2'
  | 'nano-banana-pro'
  | 'nano-banana';

export type StoryboardAssetCategory = 'character' | 'location' | 'prop';

export interface StoryboardStudioAsset {
  id: string;
  category: StoryboardAssetCategory;
  name: string;
  description: string;
  sheetType: 'contact_sheet' | 'multi_angle' | 'prop_study';
  imageUrl: string | null;
  locked: boolean;
  useRealProductPhoto?: boolean;
  linkedShotIds?: string[];
}

export interface StoryboardStudioState {
  style: StoryboardStylePreset;
  customStyleNote?: string;
  model: StoryboardImageModel;
  aspectRatio: '16:9' | '9:16' | '4:5' | '1:1' | '21:9';
  resolution: '1K' | '2K';
  assets: StoryboardStudioAsset[];
  hasSeededAssets?: boolean;
}

export interface PipelineProject {
  id: string;
  createdAt: string;
  updatedAt: string;
  client: string;
  product: ProductInfo;
  intake: IntakeInfo;
  brandGuideDocuments?: BrandGuideDocument[];
  extractedStyleGuide?: ExtractedStyleGuide | null;
  brandBible: BrandBible;
  creativeBrief: CreativeBriefPipeline;
  shots: PipelineShot[];
  shotListHasGenerated: boolean;
  shotListManuallyEdited: boolean;
  storyboardStudio?: StoryboardStudioState;
  voScript: VoScriptLine[];
  voHasGenerated?: boolean;
  voManuallyEdited?: boolean;
  voSettings?: VoStudioSettings;
  externalUpscales?: ExternalUpscaleItem[];
  shootPlan: ShootPlan;
  googleDriveFolderUrl?: string;
  googleDriveFolderUrls?: string[];
  googleDriveDestinationFolderId?: string;
  googleDriveDestinationFolderUrl?: string;
  googleDriveDestinationFolderName?: string;
  googleDriveBackupFolderId?: string;
  googleDriveBackupFolderUrl?: string;
  googleDriveSyncError?: string;
  lockedDriveReferences?: Array<{
    fileId: string;
    name: string;
    mimeType: string;
    webViewLink?: string;
    folderUrl?: string;
    selected: boolean;
  }>;
  googleDriveSyncedAt?: string;
  googleDriveSyncStatus?: 'idle' | 'syncing' | 'synced' | 'error';
  approvals: ApprovalState;
  generationLog: GenerationLogEntry[];
}

export interface ProjectThumbnailItem {
  url: string;
  label: string;
  kind: 'frame' | 'product' | 'asset' | 'logo';
}

export interface ProjectSummary {
  id: string;
  client: string;
  productName: string;
  updatedAt: string;
  shotCount: number;
  framesReadyCount: number;
  videosReadyCount: number;
  voReadyCount: number;
  totalVoCount: number;
  coverImageUrl: string | null;
  brandLogoUrl: string | null;
  thumbnailStrip: ProjectThumbnailItem[];
  paletteHexes: string[];
  conceptTitle: string;
  nextStepNumber: PipelineStepNumber;
  nextStepLabel: string;
  approvals: ApprovalState;
}
