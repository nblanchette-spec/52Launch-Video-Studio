import React, { useEffect, useState, useRef } from 'react';
import { Loader2, Plus, Download, Upload, Cpu, Film, Sparkles, Play, Trash2 } from 'lucide-react';
import {
  PipelineProject,
  PipelineShot,
  ProjectSummary,
} from './types/pipeline';
import { Step7VideoStudio } from './components/pipeline/Step7VideoStudio';
import {
  getLlmRoutingStatus,
  LlmRoutingMode,
  LlmRoutingStatus,
  setLlmRoutingMode,
} from './utils/googleDriveSync';
import { parseJsonResponse } from './utils/safeFetch';

const DEFAULT_STANDALONE_PROJECT: PipelineProject = {
  id: 'standalone-video-studio-01',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  client: '52Launch Production Studio',
  product: {
    name: 'Launch Product X',
    description: 'High-performance next-generation hardware product designed for creators and professionals.',
    provableClaims: ['Zero latency performance', 'Aircraft-grade titanium chassis', 'All-day battery life'],
    photos: [],
  },
  intake: {
    audience: 'Tech enthusiasts and creators',
    tone: 'Sleek, futuristic, high-end',
    clientMarketingIdeas: 'Cinematic reveal followed by feature close-ups and in-use lifestyle shots.',
    videosWanted: '3-shot promotional commercial spot',
    shootLocationDatesBudgetNotes: 'Standalone AI video production studio',
  },
  brandBible: {
    positioning: 'The ultimate standalone creative tool.',
    audience: 'Professional directors and content creators.',
    toneOfVoice: { adjectives: ['Sleek', 'Modern', 'Authoritative'], guidance: 'Speak with quiet confidence.' },
    visualStyle: {
      palette: 'Pantone 1795 C Red, Matte Black #111114, Silver #F6F6F7',
      lighting: 'Dramatic studio rim lighting with volumetric highlights.',
      lensAndFraming: 'Anamorphic 35mm lens, shallow depth of field.',
      grade: 'High contrast cinematic color grade.',
    },
    brandLogoUrl: null,
    brandLogoCaption: '',
    brandGraphics: [],
    characters: [],
    productRules: 'Maintain pristine product branding and correct geometry.',
    bannedList: ['Warping', 'Distorted text', 'Extra limbs'],
    claimsAllowed: ['Zero latency performance', 'Aircraft-grade titanium chassis', 'All-day battery life'],
    claimsToFlag: [],
    hasGenerated: true,
    manuallyEdited: false,
  },
  creativeBrief: {
    objective: 'Showcase product superiority through cinematic AI video generation.',
    keyMessage: 'Concept to reality in seconds.',
    concepts: [],
    recommendedConcept: { title: 'Cinematic Reveal', reason: 'High visual impact.' },
    deliverables: ['3-shot promotional spot'],
    voDirection: { pace: '2.5 words/sec', emotionalArc: 'Confident build', speaker: 'Narrator' },
    claimsCheck: 'All claims verified.',
    hasGenerated: true,
    manuallyEdited: false,
  },
  shots: [
    {
      id: 'S01',
      deliverable: 'Hero Reveal',
      durationSec: 5,
      scene: 'Macro slow pan across the sleek exterior of launch product under dramatic studio rim lighting.',
      route: 'ai_video',
      model: 'flux3',
      productInFrame: true,
      framePrompt: 'Macro cinematic product shot of Launch Product X, dark minimalist studio, dramatic red rim lighting, 35mm anamorphic lens, photorealistic 8k.',
      shootDirection: '',
      voLine: 'Meet the new standard in creative power.',
      continuityNotes: 'Match lighting across cuts.',
      chainFrom: 'none',
      frameImageUrl: null,
      frameCheck: null,
      productFrameApproved: true,
      videoPrompt: 'Cinematic macro camera pan sliding smoothly along the metallic body of Launch Product X, volumetric lighting, 4k resolution, smooth motion.',
      negativePrompt: 'warping, extra limbs, blur, low quality, distortion',
      videoUrl: null,
      videoSeed: null,
      videoResolution: '720p',
      status: 'Draft',
    },
    {
      id: 'S02',
      deliverable: 'Feature Demo',
      durationSec: 6,
      scene: 'Close-up on interface interaction and zero latency response in modern workstation environment.',
      route: 'hybrid',
      model: 'veo',
      productInFrame: true,
      framePrompt: 'Close-up shot of hands interacting with Launch Product X interface, clean modern desk, soft natural window light, shallow depth of field.',
      shootDirection: '',
      voLine: 'Lightning-fast response when every millisecond counts.',
      continuityNotes: 'Keep hand positioning consistent.',
      chainFrom: 'S01',
      frameImageUrl: null,
      frameCheck: null,
      productFrameApproved: true,
      videoPrompt: 'Smooth cinematic push-in tracking shot of hands operating Launch Product X, crisp focus on interface, natural lighting, photorealistic movement.',
      negativePrompt: 'glitches, text errors, jittery camera motion',
      videoUrl: null,
      videoSeed: null,
      videoResolution: '1080p',
      status: 'Draft',
    },
    {
      id: 'S03',
      deliverable: 'Brand Signoff',
      durationSec: 5,
      scene: 'Orbital camera reveal ending on centered product lockup against dark minimalist backdrop.',
      route: 'ai_video',
      model: 'kling',
      productInFrame: true,
      framePrompt: 'Orbital camera movement around Launch Product X on reflective obsidian podium, dark moody atmosphere, premium commercial lighting.',
      shootDirection: '',
      voLine: 'Concept to reality. 52Launch.',
      continuityNotes: 'Clean final frame lockup.',
      chainFrom: 'S02',
      frameImageUrl: null,
      frameCheck: null,
      productFrameApproved: true,
      videoPrompt: 'Smooth orbital 360 degree arc shot around Launch Product X, premium cinematic lighting, reflections on obsidian surface, 4k.',
      negativePrompt: 'warping, bad geometry, low resolution',
      videoUrl: null,
      videoSeed: null,
      videoResolution: '1080p',
      status: 'Draft',
    },
  ],
  shotListHasGenerated: true,
  shotListManuallyEdited: false,
  voScript: [],
  shootPlan: {
    shootDays: [],
    equipment: [],
    propsAndUnits: [],
    crew: [],
    risks: [],
    clientQuestions: [],
    hasGenerated: false,
  },
  approvals: {
    intakeCompleted: true,
    bibleApproved: true,
    briefApproved: true,
    shotListApproved: true,
    storyboardApproved: true,
    videoPromptsApproved: false,
    voApproved: false,
    shootPlanApproved: false,
  },
  generationLog: [],
  externalUpscales: [],
};

export default function App() {
  const [activeProject, setActiveProject] = useState<PipelineProject | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pipelineNotice, setPipelineNotice] = useState<string | null>(null);
  const [llmStatus, setLlmStatus] = useState<LlmRoutingStatus | null>(null);

  const importInputRef = useRef<HTMLInputElement>(null);

  const showPipelineNotice = (msg: string) => {
    setPipelineNotice(msg);
    setTimeout(() => {
      setPipelineNotice((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const loadOrCreateProject = async () => {
    try {
      const resp = await fetch('/api/projects');
      const data = await parseJsonResponse<{ projects?: ProjectSummary[]; error?: string }>(
        resp,
        'Could not load projects.'
      );
      if (resp.ok && data.projects && data.projects.length > 0) {
        const firstId = data.projects[0].id;
        const pResp = await fetch(`/api/projects/${firstId}`);
        const pData = await parseJsonResponse<{ project: PipelineProject }>(pResp, 'Could not load project.');
        if (pResp.ok && pData.project) {
          setActiveProject(pData.project);
          setIsLoading(false);
          return;
        }
      }

      // If none found, create default standalone project
      const createResp = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client: DEFAULT_STANDALONE_PROJECT.client,
          product: DEFAULT_STANDALONE_PROJECT.product,
          intake: DEFAULT_STANDALONE_PROJECT.intake,
          initialPhotoDataUrls: [],
        }),
      });
      const createData = await parseJsonResponse<{ project: PipelineProject }>(createResp, 'Could not create project.');
      if (createResp.ok && createData.project) {
        const fullProj = { ...createData.project, shots: DEFAULT_STANDALONE_PROJECT.shots };
        await handleUpdateProject(fullProj);
        setActiveProject(fullProj);
      } else {
        setActiveProject(DEFAULT_STANDALONE_PROJECT);
      }
    } catch {
      setActiveProject(DEFAULT_STANDALONE_PROJECT);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadOrCreateProject();
    void getLlmRoutingStatus()
      .then((status) => setLlmStatus(status))
      .catch(() => undefined);
  }, []);

  const handleChangeLlmMode = async (mode: LlmRoutingMode) => {
    try {
      const updated = await setLlmRoutingMode(mode);
      setLlmStatus(updated);
      showPipelineNotice(`AI Engine switched successfully.`);
    } catch (err) {
      showPipelineNotice(
        err instanceof Error ? err.message : 'Could not switch AI Engine mode.'
      );
    }
  };

  const handleUpdateProject = async (updated: PipelineProject) => {
    setActiveProject(updated);
    try {
      const resp = await fetch(`/api/projects/${updated.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: updated }),
      });
      const data = await parseJsonResponse<{ project?: PipelineProject }>(resp, 'Could not save project.');
      if (resp.ok && data.project) {
        setActiveProject(data.project);
      }
    } catch {
      // Keep local state
    }
  };

  const handleGenerateVideoPrompts = async (shotId?: string) => {
    if (!activeProject) return;
    const resp = await fetch('/api/pipeline/video-prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: activeProject.id, shotId }),
    });
    const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
      resp,
      'Could not generate video prompts.'
    );
    if (!resp.ok) throw new Error(data.error || 'Could not generate video prompts.');
    setActiveProject(data.project);
    showPipelineNotice(shotId ? `Updated video prompt for ${shotId}.` : 'Video prompts generated successfully.');
  };

  const handleGenerateSingleVideo = async (
    shotId: string,
    chainedLastFrameDataUrl?: string
  ) => {
    if (!activeProject) return;
    const resp = await fetch('/api/pipeline/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: activeProject.id,
        shotId,
        chainedLastFrameDataUrl,
      }),
    });
    const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
      resp,
      'Video generation failed.'
    );
    if (!resp.ok) throw new Error(data.error || 'Video generation failed.');
    setActiveProject(data.project);
    showPipelineNotice(`Video generated successfully for ${shotId}.`);
  };

  const handleAddShot = () => {
    if (!activeProject) return;
    const nextNum = activeProject.shots.length + 1;
    const newId = `S${String(nextNum).padStart(2, '0')}`;
    const newShot: PipelineShot = {
      id: newId,
      deliverable: `Custom Shot ${nextNum}`,
      durationSec: 5,
      scene: 'New cinematic shot description...',
      route: 'ai_video',
      model: 'flux3',
      productInFrame: true,
      framePrompt: 'Cinematic commercial shot, dramatic lighting, 35mm anamorphic lens, 8k.',
      shootDirection: '',
      voLine: '',
      continuityNotes: '',
      chainFrom: 'none',
      frameImageUrl: null,
      frameCheck: null,
      productFrameApproved: true,
      videoPrompt: 'Cinematic motion, smooth camera tracking, high quality production.',
      negativePrompt: 'warping, extra limbs, blur, low quality',
      videoUrl: null,
      videoSeed: null,
      videoResolution: '720p',
      status: 'Draft',
    };
    const updated = {
      ...activeProject,
      shots: [...activeProject.shots, newShot],
    };
    void handleUpdateProject(updated);
    showPipelineNotice(`Added shot ${newId}.`);
  };

  const handleDeleteShot = (shotId: string) => {
    if (!activeProject) return;
    if (activeProject.shots.length <= 1) {
      showPipelineNotice('Cannot delete the last remaining shot.');
      return;
    }
    const nextShots = activeProject.shots.filter((s) => s.id !== shotId);
    const updated = {
      ...activeProject,
      shots: nextShots,
    };
    void handleUpdateProject(updated);
    showPipelineNotice(`Deleted shot ${shotId}.`);
  };

  const handleDownloadBackup = () => {
    if (!activeProject) return;
    window.location.href = `/api/projects/${activeProject.id}/backup`;
    showPipelineNotice('Downloading project backup...');
  };

  const handleImportBackup = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const resp = await fetch('/api/projects/import-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const data = await parseJsonResponse<{ project: PipelineProject; error?: string }>(
        resp,
        'Could not import project backup.'
      );
      if (!resp.ok) throw new Error(data.error || 'Could not import backup.');
      setActiveProject(data.project);
      showPipelineNotice(`Imported "${data.project.product.name}".`);
    } catch (err) {
      showPipelineNotice(err instanceof Error ? err.message : 'Invalid project backup file.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F6F7] text-[#111114] flex flex-col">
      {/* Sleek Standalone Video Studio Header */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E2E2E6]">
        <div className="h-[3px] w-full bg-gradient-to-r from-[#C6202F] via-[#891A23] to-[#C6202F]" />
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          <div className="flex items-center gap-3.5">
            <img
              src="/brand/wordmark-color.png"
              alt="52Launch"
              className="h-6 w-auto object-contain"
            />
            <span className="hidden sm:inline-block h-4 w-[1.5px] bg-[#891A23]/40" aria-hidden="true" />
            <span className="text-xs font-bold tracking-tight text-[#111114] uppercase font-display">
              Standalone AI Video Generation Studio
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {handleChangeLlmMode && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[#F6F6F7] border border-[#D8D8DF] rounded-lg">
                <Cpu className="w-3.5 h-3.5 text-[#891A23]" />
                <span className="text-[11px] font-medium text-[#5A5A66] hidden md:inline">AI Engine:</span>
                <select
                  aria-label="AI Engine routing mode"
                  value={llmStatus?.mode || 'auto'}
                  onChange={(e) => void handleChangeLlmMode(e.target.value as LlmRoutingMode)}
                  className="bg-transparent text-xs font-semibold text-[#111114] focus:outline-none cursor-pointer"
                >
                  <option value="auto">Auto (Gemini + Fal)</option>
                  <option value="fal_gemini">Gemini via Fal</option>
                  <option value="google_direct">Gemini Direct</option>
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={handleAddShot}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg transition-colors cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Shot
            </button>

            <input
              ref={importInputRef}
              type="file"
              accept=".52launch-backup,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleImportBackup(file);
                  e.target.value = '';
                }
              }}
            />
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#3A3A44] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              Import Backup
            </button>

            <button
              type="button"
              onClick={handleDownloadBackup}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#3A3A44] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Export Backup
            </button>
          </div>
        </div>
      </header>

      {pipelineNotice && (
        <div className="fixed bottom-5 right-5 z-50 bg-[#111114] border border-[#C6202F] text-xs text-white px-4 py-2.5 rounded-xl shadow-2xl">
          {pipelineNotice}
        </div>
      )}

      <main className="flex-1 min-w-0 overflow-y-auto">
        {isLoading || !activeProject ? (
          <div className="flex items-center justify-center py-32 gap-3 text-sm text-[#5A5A66]">
            <Loader2 className="w-6 h-6 animate-spin text-[#C6202F]" />
            Loading Video Generation Studio...
          </div>
        ) : (
          <Step7VideoStudio
            project={activeProject}
            onUpdateProject={handleUpdateProject}
            onProjectUpdated={(updated) => void handleUpdateProject(updated)}
            onGenerateVideoPrompts={handleGenerateVideoPrompts}
            onGenerateSingleVideo={handleGenerateSingleVideo}
            onApproveVideoStep={async () => {
              await handleUpdateProject({
                ...activeProject,
                approvals: { ...activeProject.approvals, videoPromptsApproved: true },
              });
              showPipelineNotice('Video generation step approved successfully.');
            }}
            onAddShot={handleAddShot}
            onDeleteShot={handleDeleteShot}
          />
        )}
      </main>
    </div>
  );
}
