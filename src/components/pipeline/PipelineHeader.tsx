import React, { useRef } from 'react';
import {
  ChevronDown,
  Download,
  Upload,
  Plus,
  Check,
  Lock,
  Printer,
  FileText,
  LayoutGrid,
  Rocket,
  Cpu,
} from 'lucide-react';
import {
  PipelineProject,
  PipelineStepNumber,
  ProjectSummary,
} from '../../types/pipeline';
import type { LlmRoutingMode } from '../../utils/googleDriveSync';

interface PipelineHeaderProps {
  projects: ProjectSummary[];
  activeProject: PipelineProject | null;
  activeStep: PipelineStepNumber;
  isWelcomeOpen: boolean;
  isLaunchScreenOpen?: boolean;
  isNewProjectMode: boolean;
  isPrintableOpen: boolean;
  onOpenWelcome: () => void;
  onOpenReadyToLaunch?: () => void;
  onSelectProject: (id: string) => void;
  onStartNewProject: () => void;
  onSelectStep: (step: PipelineStepNumber) => void;
  onTogglePrintable: () => void;
  onOpenMasterExport: () => void;
  onDownloadBackup: () => void;
  onImportBackup: (file: File) => void;
  llmMode?: LlmRoutingMode;
  falConfigured?: boolean;
  geminiConfigured?: boolean;
  onChangeLlmMode?: (mode: LlmRoutingMode) => void;
}

const STEPS: Array<{
  num: PipelineStepNumber;
  label: string;
  phaseNote?: string;
}> = [
  { num: 1, label: 'Project & Intake' },
  { num: 2, label: 'Brand Bible' },
  { num: 3, label: 'Creative Brief' },
  { num: 4, label: 'Shot List & Board' },
  { num: 5, label: 'Storyboard Studio' },
  { num: 6, label: 'Frame Suggestions' },
  { num: 7, label: 'Video Prompts & Video' },
  { num: 8, label: 'VO Script & Audio' },
  { num: 9, label: 'Shoot Plan' },
];

export const PipelineHeader: React.FC<PipelineHeaderProps> = ({
  projects,
  activeProject,
  activeStep,
  isWelcomeOpen,
  isLaunchScreenOpen = false,
  isNewProjectMode,
  isPrintableOpen,
  onOpenWelcome,
  onOpenReadyToLaunch,
  onSelectProject,
  onStartNewProject,
  onSelectStep,
  onTogglePrintable,
  onOpenMasterExport,
  onDownloadBackup,
  onImportBackup,
  llmMode = 'auto',
  falConfigured = false,
  geminiConfigured = false,
  onChangeLlmMode,
}) => {
  const importInputRef = useRef<HTMLInputElement>(null);

  const isStepEnabled = (step: PipelineStepNumber): boolean => {
    if (step === 1) return true;
    if (!activeProject || isNewProjectMode) return false;
    const a = activeProject.approvals;
    switch (step) {
      case 2:
        return a.intakeCompleted;
      case 3:
        return a.bibleApproved;
      case 4:
        return a.briefApproved;
      case 5:
        return a.shotListApproved;
      case 6:
        return a.shotListApproved;
      case 7:
        return a.shotListApproved;
      case 8:
        return a.videoPromptsApproved;
      case 9:
        return a.voApproved;
      default:
        return false;
    }
  };

  const isStepApproved = (step: PipelineStepNumber): boolean => {
    if (!activeProject) return false;
    const a = activeProject.approvals;
    switch (step) {
      case 1:
        return a.intakeCompleted;
      case 2:
        return a.bibleApproved;
      case 3:
        return a.briefApproved;
      case 4:
        return a.shotListApproved;
      case 5: {
        if (a.storyboardApproved) return true;
        const aiHybrid = activeProject.shots.filter((s) => s.route !== 'live');
        return (
          activeProject.shots.length > 0 &&
          aiHybrid.every((s) => Boolean(s.frameImageUrl))
        );
      }
      case 6:
        return a.storyboardApproved;
      case 7:
        return a.videoPromptsApproved;
      case 8:
        return a.voApproved;
      case 9:
        return a.shootPlanApproved;
      default:
        return false;
    }
  };

  return (
    <header className="no-print sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-[#E2E2E6]">
      {/* Thin 52Launch Red #5 top brand rule */}
      <div className="h-[3px] w-full bg-gradient-to-r from-[#C6202F] via-[#891A23] to-[#C6202F]" />

      {/* Top Row: 52Launch Wordmark, Project Selector, Primary Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
        <div className="flex items-center gap-3.5 min-w-0">
          <button
            type="button"
            onClick={onOpenWelcome}
            title="Return to Welcome & Saved Projects"
            className="flex items-center gap-2.5 shrink-0 cursor-pointer hover:opacity-85 transition-opacity"
          >
            <img
              src="/brand/wordmark-color.png"
              alt="fifty-two launch"
              className="h-6 w-auto object-contain"
            />
            <span className="hidden sm:inline-block h-4 w-[1.5px] bg-[#891A23]/40" aria-hidden="true" />
            <span className="hidden sm:inline-block text-xs font-semibold tracking-tight text-[#5A5A66] whitespace-nowrap font-display">
              Production Studio
            </span>
          </button>

          {!isWelcomeOpen && (
            <>
              <span className="text-[#D0D0D6]" aria-hidden="true">
                /
              </span>

              <button
                type="button"
                onClick={onOpenWelcome}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#3A3A44] bg-white border border-[#D8D8DF] hover:border-[#891A23] hover:text-[#111114] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LayoutGrid className="w-3.5 h-3.5 text-[#891A23]" />
                All projects
              </button>

              {/* Server Project Picker */}
              <div className="relative flex items-center">
                <select
                  aria-label="Choose client project"
                  value={isNewProjectMode ? '__new__' : activeProject?.id || ''}
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      onStartNewProject();
                    } else {
                      onSelectProject(e.target.value);
                    }
                  }}
                  className="appearance-none bg-[#F6F6F7] border border-[#D8D8DF] hover:border-[#891A23] text-[#111114] text-sm font-medium rounded-md pl-3 pr-8 py-1.5 focus:outline-none focus:border-[#C6202F] cursor-pointer max-w-[270px] truncate transition-colors"
                >
                  {isNewProjectMode && <option value="__new__">New client project...</option>}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.client} — {p.productName}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#5A5A66] pointer-events-none absolute right-2.5" />
              </div>
            </>
          )}

          <button
            type="button"
            onClick={onStartNewProject}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] brand-corner-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            New project
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onChangeLlmMode && (
            <div
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-[#F6F6F7] border border-[#D8D8DF] rounded-md"
              title="Choose how text & brief generation routes between Google Gemini Direct and Gemini via Fal"
            >
              <Cpu className="w-3.5 h-3.5 text-[#891A23] shrink-0" />
              <span className="text-[11px] font-medium text-[#5A5A66] hidden md:inline">
                AI Engine:
              </span>
              <select
                aria-label="AI Engine routing mode"
                value={llmMode}
                onChange={(e) => onChangeLlmMode(e.target.value as LlmRoutingMode)}
                className="bg-transparent text-xs font-semibold text-[#111114] focus:outline-none cursor-pointer pr-1"
              >
                <option value="auto">
                  Auto (Gemini{falConfigured ? ' + Fal Backup' : ''})
                </option>
                <option value="fal_gemini" disabled={!falConfigured}>
                  Gemini via Fal{falConfigured ? '' : ' (Not configured)'}
                </option>
                <option value="google_direct" disabled={!geminiConfigured}>
                  Gemini Direct{geminiConfigured ? '' : ' (Not configured)'}
                </option>
              </select>
            </div>
          )}

          {!isWelcomeOpen && activeProject && activeProject.shots.length > 0 && (
            <button
              type="button"
              onClick={onTogglePrintable}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                isPrintableOpen
                  ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23] font-semibold'
                  : 'bg-white border-[#D8D8DF] text-[#111114] hover:border-[#891A23]'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              {isPrintableOpen ? 'Back to workspace' : 'Printable storyboard'}
            </button>
          )}

          <input
            ref={importInputRef}
            type="file"
            accept=".52launch-backup,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onImportBackup(file);
                e.target.value = '';
              }
            }}
          />

          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#3A3A44] bg-white border border-[#D8D8DF] hover:border-[#891A23] hover:text-[#111114] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Import project backup
          </button>

          {!isWelcomeOpen && activeProject && !isNewProjectMode && (
            <>
              <button
                type="button"
                onClick={onOpenMasterExport}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#891A23] hover:bg-[#6E141C] brand-corner-sm transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
              >
                <FileText className="w-3.5 h-3.5" />
                Master PDF
              </button>

              <button
                type="button"
                onClick={onDownloadBackup}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#3A3A44] bg-white border border-[#D8D8DF] hover:border-[#891A23] hover:text-[#111114] rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Backup
              </button>
            </>
          )}
        </div>
      </div>

      {/* Left-to-Right Gated 9-Step Workflow Bar */}
      {!isWelcomeOpen && (
        <nav
          aria-label="Production workflow steps"
          className="flex items-center gap-1.5 px-5 py-2 bg-[#F6F6F7] border-t border-[#E6E6EB] overflow-x-auto"
        >
        {STEPS.map((st, idx) => {
          const enabled = isStepEnabled(st.num);
          const approved = isStepApproved(st.num);
          const current = !isPrintableOpen && !isLaunchScreenOpen && activeStep === st.num;

          return (
            <React.Fragment key={st.num}>
              <button
                type="button"
                disabled={!enabled}
                onClick={() => enabled && onSelectStep(st.num)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                  current
                    ? 'bg-[#C6202F] text-white border-[#AD1A27] font-semibold brand-corner-sm cursor-pointer shadow-xs'
                    : enabled
                      ? 'bg-white text-[#111114] border-[#DCDCE2] hover:border-[#891A23] rounded-md cursor-pointer'
                      : 'bg-[#EFEFF2] text-[#9A9AA6] border-[#E4E4EA] rounded-md cursor-not-allowed'
                }`}
              >
                {approved && !current ? (
                  <Check className="w-3.5 h-3.5 text-[#15803D] shrink-0" />
                ) : !enabled ? (
                  <Lock className="w-3 h-3 text-[#A0A0AC] shrink-0" />
                ) : null}
                <span className="tabular-nums">
                  {st.num}. {st.label}
                </span>
              </button>
              {idx < STEPS.length - 1 && (
                <span className="text-[#C8C8D2] text-xs select-none" aria-hidden="true">
                  →
                </span>
              )}
            </React.Fragment>
          );
        })}

        {onOpenReadyToLaunch && (
          <>
            <span className="text-[#C8C8D2] text-xs select-none" aria-hidden="true">
              →
            </span>
            <button
              type="button"
              disabled={!activeProject?.approvals.shootPlanApproved || isNewProjectMode}
              onClick={() =>
                activeProject?.approvals.shootPlanApproved && onOpenReadyToLaunch()
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                isLaunchScreenOpen
                  ? 'bg-[#111114] text-white border-[#111114] font-semibold brand-corner-sm cursor-pointer shadow-xs'
                  : activeProject?.approvals.shootPlanApproved && !isNewProjectMode
                    ? 'bg-white text-[#891A23] border-[#EABAC0] hover:border-[#C6202F] rounded-md cursor-pointer font-semibold'
                    : 'bg-[#EFEFF2] text-[#9A9AA6] border-[#E4E4EA] rounded-md cursor-not-allowed'
              }`}
            >
              {!activeProject?.approvals.shootPlanApproved || isNewProjectMode ? (
                <Lock className="w-3 h-3 text-[#A0A0AC] shrink-0" />
              ) : (
                <Rocket className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>Launch</span>
            </button>
          </>
        )}
      </nav>
      )}
    </header>
  );
};
