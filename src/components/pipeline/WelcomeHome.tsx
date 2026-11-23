import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  Clapperboard,
  Compass,
  Film,
  FolderOpen,
  Grid,
  Image as ImageIcon,
  Layers,
  List,
  Mic,
  Plus,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { PipelineStepNumber, ProjectSummary } from '../../types/pipeline';

interface WelcomeHomeProps {
  projects: ProjectSummary[];
  onOpenProject: (projectId: string, step?: PipelineStepNumber) => void;
  onStartNewProject: () => void;
  onImportBackup: (file: File) => void;
  onDeleteProject: (projectId: string) => Promise<void>;
}

interface GateDefinition {
  step: PipelineStepNumber;
  title: string;
  shortName: string;
  phase: string;
  description: string;
  deliverables: string[];
  icon: React.ComponentType<{ className?: string }>;
}

const GATES: GateDefinition[] = [
  {
    step: 1,
    shortName: '01. Intake',
    title: 'Project & Asset Intake',
    phase: 'Phase 1 · Strategy',
    description: 'Collect client brief, upload real product photos and logos, and extract style guidelines from brand guide PDFs.',
    deliverables: ['Client metadata', 'Product photos & logo', 'Extracted style guide rules'],
    icon: FolderOpen,
  },
  {
    step: 2,
    shortName: '02. Bible',
    title: 'Brand Bible',
    phase: 'Phase 1 · Strategy',
    description: 'Locks brand positioning, character appearances, lighting rules, provable claims, and banned clichés into one source of truth.',
    deliverables: ['Brand tone & grammar', 'Named recurring characters', 'Allowed claims list'],
    icon: BookOpen,
  },
  {
    step: 3,
    shortName: '03. Brief',
    title: 'Creative Brief',
    phase: 'Phase 1 · Strategy',
    description: 'Develops distinct commercial concepts tailored to your deliverables and sets voiceover pacing and emotional arc.',
    deliverables: ['Ranked concepts', 'Recommended logline', 'VO tone direction'],
    icon: Compass,
  },
  {
    step: 4,
    shortName: '04. Shots',
    title: 'Shot List & Board',
    phase: 'Phase 1 · Strategy',
    description: 'Breaks the approved concept into numbered shots (S01, S02…), routing each as AI Video, Hybrid, or Live Action.',
    deliverables: ['Sequenced shot list', 'Route assignment', 'Initial frame prompts'],
    icon: Clapperboard,
  },
  {
    step: 5,
    shortName: '05. Storyboard',
    title: 'Storyboard Studio',
    phase: 'Phase 2 · Visuals',
    description: 'Choose an art style, generate 2×2 Character Contact Sheets, Location Multi-Angle Sheets, and Product-Anchored Props via Fal Nano Banana.',
    deliverables: ['Locked continuity sheets', 'Storyboard frames', 'Custom image uploads'],
    icon: ImageIcon,
  },
  {
    step: 6,
    shortName: '06. QA',
    title: 'Frame Suggestions & QA',
    phase: 'Phase 2 · Visuals',
    description: 'Audits storyboard frames against your Brand Bible and real product photos, flagging fidelity drift and suggesting prompt rewrites.',
    deliverables: ['Continuity audit score', 'Product fidelity check', 'Approved reference frames'],
    icon: ShieldCheck,
  },
  {
    step: 7,
    shortName: '07. Video',
    title: 'Video Prompts & Studio',
    phase: 'Phase 2 · Visuals',
    description: 'Writes camera motion video prompts with negative constraints and renders clips using Veo 3.1, Gemini Omni, Kling, Seedance, Luma, Wan, or Topaz.',
    deliverables: ['Rendered AI clips', 'Clip take history', 'Optional 4K upscales'],
    icon: Video,
  },
  {
    step: 8,
    shortName: '08. Voice',
    title: 'VO Script & Audio',
    phase: 'Phase 2 · Visuals',
    description: 'Refines narration to match shot durations word-for-word and synthesizes broadcast-ready voice tracks via Gemini TTS.',
    deliverables: ['Shot-timed VO script', 'Generated TTS audio clips', 'Downloadable stem files'],
    icon: Mic,
  },
  {
    step: 9,
    shortName: '09. Shoot Plan',
    title: 'Live Shoot Plan & Call Sheet',
    phase: 'Phase 3 · Execution',
    description: 'Compiles call times, setup schedules, gear checklists, prop counts, crew roles, and one-click Master PDF & Printable Call Sheet packages.',
    deliverables: ['Day-by-day setup schedule', 'Equipment & crew checklist', 'Master Production PDF'],
    icon: Film,
  },
];

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Recently updated';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

const ContactThumbCell: React.FC<{
  url?: string;
  label?: string;
  index: number;
}> = ({ url, label, index }) => {
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div className="relative w-full h-full bg-[#EFEFF2] flex flex-col items-center justify-center p-1 select-none">
        <ImageIcon className="w-3.5 h-3.5 text-[#B0B0BC] mb-0.5" />
        <span className="text-[9px] font-mono tabular-nums text-[#8A8A98]">
          {label || `0${index + 1}`}
        </span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-[#18181D] overflow-hidden group/cell">
      <img
        src={url}
        alt={label || `Thumbnail ${index + 1}`}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full object-cover transition-transform duration-300 group-hover/card:scale-[1.03]"
      />
      <div className="absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-black/80 via-black/30 to-transparent pointer-events-none" />
      {label && (
        <span className="absolute left-1 bottom-0.5 max-w-[88%] truncate text-[9px] font-mono tabular-nums text-white/95">
          {label}
        </span>
      )}
    </div>
  );
};

export const WelcomeHome: React.FC<WelcomeHomeProps> = ({
  projects,
  onOpenProject,
  onStartNewProject,
  onImportBackup,
  onDeleteProject,
}) => {
  const importRef = useRef<HTMLInputElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'completed'>('all');
  const [viewStyle, setViewStyle] = useState<'grid' | 'list'>('grid');
  const [selectedInspectProjectId, setSelectedInspectProjectId] = useState<string | null>(
    projects[0]?.id || null
  );
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const currentInspectProject = useMemo(() => {
    if (!projects.length) return null;
    const found = projects.find((p) => p.id === selectedInspectProjectId);
    return found || projects[0];
  }, [projects, selectedInspectProjectId]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((proj) => {
      const isComplete = proj.approvals.shootPlanApproved;
      if (filterMode === 'active' && isComplete) return false;
      if (filterMode === 'completed' && !isComplete) return false;
      if (!q) return true;
      return (
        proj.client.toLowerCase().includes(q) ||
        proj.productName.toLowerCase().includes(q) ||
        (proj.conceptTitle || '').toLowerCase().includes(q)
      );
    });
  }, [projects, searchQuery, filterMode]);

  const handleConfirmDelete = async (projectId: string) => {
    setDeletingId(projectId);
    try {
      await onDeleteProject(projectId);
      setConfirmDeleteId(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="max-w-[1360px] mx-auto px-5 sm:px-8 py-8 sm:py-10 space-y-10">
      {/* Streamlined Hero: Title + Tagline */}
      <section className="bg-white border border-[#E2E2E6] brand-corner p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <img
            src="/brand/logo-badge-black.png"
            alt="52Launch Logo"
            referrerPolicy="no-referrer"
            className="h-12 w-auto object-contain shrink-0"
          />
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#111114] font-display">
              52Launch Production Studio
            </h1>
            <p className="text-sm text-[#5A5A66] mt-0.5">
              End-to-end creative direction, brand bibles, storyboarding, video studio, and call sheets from concept to reality.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <input
            ref={importRef}
            type="file"
            accept=".52launch-backup,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                onImportBackup(f);
                e.target.value = '';
              }
            }}
          />
          <button
            type="button"
            onClick={() => importRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#5A5A66] hover:text-[#111114] bg-[#F6F6F7] hover:bg-[#EFEFF2] border border-[#D8D8DF] rounded-md transition-colors cursor-pointer whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import backup</span>
          </button>
        </div>
      </section>

      {/* Two-Column Layout: Left = New Project Card, Right = Saved Projects List/Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Column: New Project Explainer Card / Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              onStartNewProject();
            }
          }}
          className={`lg:col-span-4 bg-white border brand-corner p-6 sm:p-7 space-y-6 shadow-xs flex flex-col justify-between h-full transition-all relative ${
            isDraggingOver
              ? 'border-[#C6202F] bg-[#FDF2F3] ring-4 ring-[#C6202F]/20 scale-[1.01]'
              : 'border-[#E2E2E6]'
          }`}
        >
          {isDraggingOver && (
            <div className="absolute inset-0 bg-[#C6202F]/10 brand-corner z-10 flex flex-col items-center justify-center pointer-events-none p-6 text-center">
              <Upload className="w-10 h-10 text-[#C6202F] animate-bounce mb-2" />
              <div className="text-base font-bold text-[#C6202F] font-display">
                Drop files here to initiate new project
              </div>
              <div className="text-xs text-[#5A5A66] mt-1">
                PDFs, brand guides, product photos, and notes accepted
              </div>
            </div>
          )}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#891A23] uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              <span>New Production Intake</span>
            </div>

            <h2 className="text-xl font-bold tracking-tight text-[#111114] font-display">
              Launch a New Film
            </h2>

            <p className="text-sm text-[#5A5A66] leading-relaxed">
              All you need to do is drop in your brand guide PDFs, product photos, logo, creative notes, or a Google Drive link, and the 9-gate pipeline takes care of the rest.
            </p>

            <div className="space-y-2 pt-2 border-t border-[#EFEFF2]">
              <div className="text-xs font-semibold text-[#111114]">What to prepare:</div>
              <ul className="space-y-1.5 text-xs text-[#5A5A66]">
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                  <span>Brand guide / style guide PDF</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                  <span>Product hero photo &amp; logo</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                  <span>Client marketing ideas &amp; notes</span>
                </li>
              </ul>
            </div>
          </div>

          <button
            type="button"
            onClick={onStartNewProject}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] brand-corner-sm transition-colors cursor-pointer shadow-md"
          >
            <Rocket className="w-4 h-4" />
            <span>Create New Project</span>
          </button>
        </div>

        {/* Right Column: Saved Projects List / Grid with Search & View Style Toggle */}
        <div className="lg:col-span-8 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-[#E2E2E6] pb-4">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-[#111114] font-display">
                Saved Projects
              </h2>
              <p className="text-sm text-[#5A5A66] mt-0.5">
                Select any project to inspect its gates in the interactive guide below.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Search Box */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#7A7A86] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search client or product..."
                  aria-label="Search saved projects"
                  className="bg-white border border-[#D8D8DF] focus:border-[#C6202F] rounded-md pl-8 pr-3 py-1.5 text-xs text-[#111114] placeholder:text-[#8A8A98] focus:outline-none w-48 sm:w-56 transition-colors"
                />
              </div>

              {/* Filter Tabs */}
              <div className="flex items-center gap-1 p-1 bg-[#EFEFF2] rounded-md">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'active', label: 'Active' },
                    { id: 'completed', label: 'Done' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilterMode(tab.id)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                      filterMode === tab.id
                        ? 'bg-white text-[#111114] shadow-xs font-semibold'
                        : 'text-[#5A5A66] hover:text-[#111114]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Grid / List View Toggle */}
              <div className="flex items-center gap-1 p-1 bg-[#EFEFF2] rounded-md" aria-label="View style toggle">
                <button
                  type="button"
                  onClick={() => setViewStyle('grid')}
                  title="Grid contact sheet view"
                  className={`p-1.5 rounded transition-colors cursor-pointer ${
                    viewStyle === 'grid' ? 'bg-white text-[#111114] shadow-xs' : 'text-[#5A5A66]'
                  }`}
                >
                  <Grid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewStyle('list')}
                  title="List view with small thumbnail"
                  className={`p-1.5 rounded transition-colors cursor-pointer ${
                    viewStyle === 'list' ? 'bg-white text-[#111114] shadow-xs' : 'text-[#5A5A66]'
                  }`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {filteredProjects.length === 0 ? (
            <div className="bg-white border border-[#E2E2E6] rounded-lg p-10 text-center space-y-4">
              <div className="w-11 h-11 rounded-md bg-[#F6F6F7] border border-[#E2E2E6] mx-auto flex items-center justify-center text-[#891A23]">
                <Clapperboard className="w-5 h-5" />
              </div>
              <div className="space-y-1 max-w-md mx-auto">
                <h3 className="text-base font-semibold text-[#111114] font-display">
                  No projects match your filter
                </h3>
                <p className="text-sm text-[#5A5A66]">
                  Create a new project or clear your search to view your saved films.
                </p>
              </div>
            </div>
          ) : viewStyle === 'grid' ? (
            /* Grid Contact Sheet View */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {filteredProjects.map((proj) => {
                const thumbs = proj.thumbnailStrip || [];
                const sheetSlots = [0, 1, 2, 3].map((idx) => thumbs[idx]);
                const isSelectedInspect = currentInspectProject?.id === proj.id;
                const isConfirmingDelete = confirmDeleteId === proj.id;

                return (
                  <article
                    key={proj.id}
                    onClick={() => {
                      setSelectedInspectProjectId(proj.id);
                      inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`bg-white border brand-corner overflow-hidden flex flex-col justify-between transition-all cursor-pointer shadow-xs group/card ${
                      isSelectedInspect
                        ? 'border-[#C6202F] ring-2 ring-[#C6202F]/20'
                        : 'border-[#E2E2E6] hover:border-[#891A23]/60'
                    }`}
                  >
                    <div className="relative w-full aspect-[16/10] bg-[#141418] grid grid-cols-2 grid-rows-2 gap-[1px]">
                      {sheetSlots.map((slot, idx) => (
                        <ContactThumbCell
                          key={`${proj.id}-slot-${idx}`}
                          url={slot?.url}
                          label={slot?.label}
                          index={idx}
                        />
                      ))}
                      {thumbs.length > 4 && (
                        <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/75 text-white text-[10px] font-mono tabular-nums rounded">
                          +{thumbs.length - 4}
                        </div>
                      )}
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-[#5A5A66]">
                          <span className="font-medium text-[#891A23] truncate">
                            {proj.client}
                          </span>
                          <span className="font-mono tabular-nums text-[11px]">
                            {formatRelativeDate(proj.updatedAt)}
                          </span>
                        </div>

                        <h3 className="text-base font-semibold text-[#111114] leading-snug font-display line-clamp-1">
                          {proj.productName}
                        </h3>

                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-[#5A5A66] font-mono tabular-nums">
                          <span>{proj.shotCount} shots</span>
                          <span aria-hidden="true">·</span>
                          <span>{proj.framesReadyCount} frames</span>
                          <span aria-hidden="true">·</span>
                          <span>{proj.videosReadyCount} clips</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#EFEFF2]">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenProject(proj.id);
                          }}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#111114] hover:bg-[#C6202F] brand-corner-sm transition-colors cursor-pointer whitespace-nowrap"
                        >
                          <span>Open Studio</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>

                        {isConfirmingDelete ? (
                          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              disabled={deletingId === proj.id}
                              onClick={() => void handleConfirmDelete(proj.id)}
                              className="px-2 py-1.5 text-xs font-semibold text-white bg-[#C6202F] rounded-md cursor-pointer"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-2 py-1.5 text-xs font-medium text-[#5A5A66] bg-[#F6F6F7] rounded-md cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(proj.id);
                            }}
                            className="p-1.5 text-[#7A7A86] hover:text-[#C6202F] border border-[#E2E2E6] rounded-md transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            /* List View with Small Thumbnails */
            <div className="bg-white border border-[#E2E2E6] brand-corner divide-y divide-[#EFEFF2] overflow-hidden shadow-xs">
              {filteredProjects.map((proj) => {
                const isSelectedInspect = currentInspectProject?.id === proj.id;
                const firstThumb = proj.thumbnailStrip?.[0]?.url;

                return (
                  <div
                    key={proj.id}
                    onClick={() => {
                      setSelectedInspectProjectId(proj.id);
                      inspectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 cursor-pointer transition-colors ${
                      isSelectedInspect ? 'bg-[#FDF2F3]' : 'hover:bg-[#FAFAFB]'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="w-10 h-10 rounded bg-[#18181D] overflow-hidden shrink-0 border border-[#E2E2E6]">
                        {firstThumb ? (
                          <img
                            src={firstThumb}
                            alt={proj.productName}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-white/50 text-[10px] font-mono">
                            52L
                          </div>
                        )}
                      </div>

                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-[#5A5A66]">
                          <span className="font-semibold text-[#891A23] truncate">
                            {proj.client}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums text-[11px]">
                            {formatRelativeDate(proj.updatedAt)}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-[#111114] font-display truncate">
                          {proj.productName}
                        </h3>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-xs text-[#5A5A66] font-mono tabular-nums hidden md:block">
                        <span>{proj.shotCount} shots</span> · <span>{proj.framesReadyCount} frames</span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenProject(proj.id);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#111114] hover:bg-[#C6202F] brand-corner-sm transition-colors cursor-pointer"
                      >
                        <span>Open</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 3. Interactive Gate Inspector (Bottom) */}
      <section
        ref={inspectorRef}
        className="bg-white border border-[#E2E2E6] brand-corner p-6 sm:p-9 space-y-6 shadow-xs"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#EFEFF2] pb-5">
          <div className="space-y-1">
            <div className="text-xs font-semibold text-[#891A23] uppercase tracking-wider">
              Interactive Gate Inspector
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-[#111114] font-display">
              {currentInspectProject
                ? `Inspecting: ${currentInspectProject.client} — ${currentInspectProject.productName}`
                : 'Interactive Pipeline Guide'}
            </h2>
            <p className="text-sm text-[#5A5A66]">
              Click any gate below to jump directly to that step in the studio for the selected project.
            </p>
          </div>

          {currentInspectProject && (
            <button
              type="button"
              onClick={() => onOpenProject(currentInspectProject.id)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] brand-corner-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Open Studio for {currentInspectProject.productName}</span>
            </button>
          )}
        </div>

        {/* 9 Interactive Jump-To-Gate Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-9 gap-2.5">
          {GATES.map((gate) => {
            const GateIcon = gate.icon;
            const a = currentInspectProject?.approvals;
            let isApproved = false;
            if (a) {
              if (gate.step === 1) isApproved = a.intakeCompleted;
              else if (gate.step === 2) isApproved = a.bibleApproved;
              else if (gate.step === 3) isApproved = a.briefApproved;
              else if (gate.step === 4) isApproved = a.shotListApproved;
              else if (gate.step === 5 || gate.step === 6) isApproved = a.storyboardApproved;
              else if (gate.step === 7) isApproved = a.videoPromptsApproved;
              else if (gate.step === 8) isApproved = a.voApproved;
              else if (gate.step === 9) isApproved = a.shootPlanApproved;
            }

            return (
              <button
                key={gate.step}
                type="button"
                disabled={!currentInspectProject}
                onClick={() => {
                  if (currentInspectProject) {
                    onOpenProject(currentInspectProject.id, gate.step);
                  }
                }}
                className={`p-3 rounded-lg border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                  isApproved
                    ? 'bg-[#F0FDF4] border-[#15803D]/40 text-[#111114] hover:border-[#15803D]'
                    : currentInspectProject
                      ? 'bg-[#F6F6F7] border-[#E2E2E6] text-[#111114] hover:border-[#C6202F] hover:bg-white'
                      : 'bg-[#EFEFF2] border-[#E4E4EA] text-[#9A9AA6] cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-[#891A23] tabular-nums">
                    0{gate.step}
                  </span>
                  {isApproved ? (
                    <Check className="w-3.5 h-3.5 text-[#15803D]" />
                  ) : (
                    <GateIcon className="w-3.5 h-3.5 text-[#5A5A66]" />
                  )}
                </div>
                <div>
                  <div className="text-xs font-semibold leading-tight font-display">
                    {gate.shortName.replace(/0\d+\.\s*/, '')}
                  </div>
                  <div className="text-[10px] text-[#5A5A66] mt-0.5">
                    {isApproved ? 'Gate Cleared' : 'Open Gate'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {currentInspectProject && (
          <div className="bg-[#FAFAFB] border border-[#E2E2E6] rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-mono text-[#5A5A66]">
                Selected Project Summary
              </div>
              <div className="text-sm font-semibold text-[#111114] font-display">
                {currentInspectProject.client} — {currentInspectProject.productName}
              </div>
              <div className="text-xs text-[#5A5A66]">
                {currentInspectProject.shotCount} shots · {currentInspectProject.framesReadyCount} frames ready · Updated {formatRelativeDate(currentInspectProject.updatedAt)}
              </div>
            </div>

            <button
              type="button"
              onClick={() => onOpenProject(currentInspectProject.id)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] brand-corner-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Resume Work on Project</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
