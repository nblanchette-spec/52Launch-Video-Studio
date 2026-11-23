import React, { useMemo, useState } from 'react';
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Printer,
  Calendar,
  Clapperboard,
  Package,
  Users,
  Camera,
  HelpCircle,
  ShieldAlert,
  Download,
  FileText,
  Utensils,
  Coffee,
  Clock,
  RotateCcw,
  Rocket,
  ChevronUp,
  ChevronDown,
  ExternalLink,
} from 'lucide-react';
import {
  PipelineProject,
  ShootDayPlan,
  ShootPlan,
  ShootScheduleBlock,
} from '../../types/pipeline';
import { PrintableCallSheetView } from './PrintableCallSheetView';
import { downloadCallSheetPdf, DriveSaveResult } from '../../utils/pdfExporter';

interface Step9ShootPlanProps {
  project: PipelineProject;
  onUpdateProject: (updated: PipelineProject) => Promise<void>;
  onGenerateShootPlan: () => Promise<void>;
  onApproveShootPlan: () => Promise<void>;
  onOpenMasterExport: () => void;
  onOpenReadyToLaunch?: () => void;
}

export const Step9ShootPlan: React.FC<Step9ShootPlanProps> = ({
  project,
  onUpdateProject,
  onGenerateShootPlan,
  onApproveShootPlan,
  onOpenMasterExport,
  onOpenReadyToLaunch,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloadingCallSheet, setIsDownloadingCallSheet] = useState(false);
  const [confirmOverwriteOpen, setConfirmOverwriteOpen] = useState(false);
  const [isPrintableOpen, setIsPrintableOpen] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [callSheetDriveStatus, setCallSheetDriveStatus] = useState<DriveSaveResult | null>(null);

  const handleQuickDownloadCallSheet = async () => {
    setErrorMsg(null);
    setCallSheetDriveStatus(null);
    setIsDownloadingCallSheet(true);
    try {
      const res = await downloadCallSheetPdf(project, project.shootPlan);
      setCallSheetDriveStatus(res);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not download Call Sheet PDF.'
      );
    } finally {
      setIsDownloadingCallSheet(false);
    }
  };

  const liveHybridShots = useMemo(
    () => project.shots.filter((s) => s.route === 'live' || s.route === 'hybrid'),
    [project.shots]
  );
  const aiOnlyShots = useMemo(
    () => project.shots.filter((s) => s.route === 'ai_video'),
    [project.shots]
  );

  const plan = project.shootPlan;

  const updatePlan = (patch: Partial<ShootPlan>) => {
    void onUpdateProject({
      ...project,
      shootPlan: {
        ...plan,
        ...patch,
        hasGenerated: true,
        manuallyEdited: true,
      },
      approvals: {
        ...project.approvals,
        shootPlanApproved: false,
      },
    });
  };

  const handleGenerateClick = async (confirmed = false) => {
    if (plan.manuallyEdited && !confirmed) {
      setConfirmOverwriteOpen(true);
      return;
    }
    setConfirmOverwriteOpen(false);
    setErrorMsg(null);
    setIsGenerating(true);
    try {
      await onGenerateShootPlan();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not build shoot plan.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const updateDay = (dayId: string, patch: Partial<ShootDayPlan>) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) =>
        d.id === dayId ? { ...d, ...patch } : d
      ),
    });
  };

  const defaultScheduleBreakdown = (day: ShootDayPlan): ShootScheduleBlock[] => {
    const blocks: ShootScheduleBlock[] = [
      {
        id: `block-call-${Date.now()}-1`,
        timeSlot: day.callTime && day.callTime !== 'TBD' ? `${day.callTime} - 07:45` : '07:00 - 07:45',
        activity: 'Crew Call, Safety Briefing & Equipment Load-In',
        category: 'call',
        notes: 'Crew check-in, staging area setup, lighting prep',
      },
      {
        id: `block-bfast-${Date.now()}-2`,
        timeSlot: day.breakfastTime || '07:45 - 08:15',
        activity: 'Crew Breakfast & Craft Services',
        category: 'meal',
        notes: 'Coffee, light breakfast, review morning shot list',
      },
    ];

    const setups = day.setups || [];
    const halfSetups = Math.max(1, Math.ceil(setups.length / 2));
    const morningSetups = setups.slice(0, halfSetups);
    const afternoonSetups = setups.slice(halfSetups);

    morningSetups.forEach((st, idx) => {
      blocks.push({
        id: `block-setup-m-${Date.now()}-${idx}`,
        timeSlot: st.timeSlot || (idx === 0 ? '08:15 - 10:30' : '10:30 - 12:30'),
        activity: `${st.setupName} — Shooting`,
        category: 'setup',
        shotIds: st.shotIds,
        notes: st.lightingNotes || `${st.estimatedMinutes} mins est.`,
        estimatedMinutes: st.estimatedMinutes,
      });
    });

    blocks.push({
      id: `block-lunch-${Date.now()}-lunch`,
      timeSlot: day.lunchTime || '12:30 - 01:30',
      activity: 'Mandatory Crew Lunch Break (Hot Catering Provided)',
      category: 'meal',
      notes: 'Hot catering served; 60m off-the-clock break; equipment & media recharge',
    });

    afternoonSetups.forEach((st, idx) => {
      blocks.push({
        id: `block-setup-a-${Date.now()}-${idx}`,
        timeSlot: st.timeSlot || (idx === 0 ? '01:30 - 03:45' : '03:45 - 05:30'),
        activity: `${st.setupName} — Shooting`,
        category: 'setup',
        shotIds: st.shotIds,
        notes: st.lightingNotes || `${st.estimatedMinutes} mins est.`,
        estimatedMinutes: st.estimatedMinutes,
      });
    });

    blocks.push({
      id: `block-wrap-${Date.now()}-wrap`,
      timeSlot: day.wrapTime && day.wrapTime !== 'TBD' ? `05:30 - ${day.wrapTime}` : '05:30 - 06:00',
      activity: 'Wrap, DIT Media Dump & Equipment Load-Out',
      category: 'wrap',
      notes: 'Verify dual media backups, pack equipment, site clean-up',
    });

    return blocks;
  };

  const handleAddDay = () => {
    const newDay: ShootDayPlan = {
      id: `day-${Date.now()}`,
      dayLabel: `Shoot Day ${plan.shootDays.length + 1}`,
      location: 'Location TBD — confirm with client',
      callTime: '07:00 AM',
      breakfastTime: '07:30 AM',
      lunchTime: '12:30 PM - 01:30 PM',
      wrapTime: '06:00 PM',
      setups: [
        {
          setupName: 'Setup A',
          lightingNotes: '',
          shotIds: liveHybridShots.slice(0, 1).map((s) => s.id),
          estimatedMinutes: 60,
        },
      ],
    };
    newDay.scheduleBreakdown = defaultScheduleBreakdown(newDay);
    updatePlan({ shootDays: [...plan.shootDays, newDay] });
  };

  const updateScheduleBlock = (
    dayId: string,
    blockId: string,
    patch: Partial<ShootScheduleBlock>
  ) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) => {
        if (d.id !== dayId) return d;
        const currentBlocks = d.scheduleBreakdown?.length
          ? d.scheduleBreakdown
          : defaultScheduleBreakdown(d);
        return {
          ...d,
          scheduleBreakdown: currentBlocks.map((b) =>
            b.id === blockId ? { ...b, ...patch } : b
          ),
        };
      }),
    });
  };

  const handleAddScheduleBlock = (dayId: string) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) => {
        if (d.id !== dayId) return d;
        const currentBlocks = d.scheduleBreakdown?.length
          ? d.scheduleBreakdown
          : defaultScheduleBreakdown(d);
        const newBlock: ShootScheduleBlock = {
          id: `block-${Date.now()}`,
          timeSlot: '14:00 - 15:00',
          activity: 'New Activity / Setup',
          category: 'setup',
          notes: '',
        };
        return {
          ...d,
          scheduleBreakdown: [...currentBlocks, newBlock],
        };
      }),
    });
  };

  const handleAddLunchBreak = (dayId: string) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) => {
        if (d.id !== dayId) return d;
        const currentBlocks = d.scheduleBreakdown?.length
          ? d.scheduleBreakdown
          : defaultScheduleBreakdown(d);
        const lunchBlock: ShootScheduleBlock = {
          id: `block-lunch-${Date.now()}`,
          timeSlot: d.lunchTime || '12:30 PM - 01:30 PM',
          activity: 'Mandatory Crew Lunch Break (Hot Catering Provided)',
          category: 'meal',
          notes: 'Full crew 60-min meal break; hot catering in dining area; battery charging',
        };
        return {
          ...d,
          scheduleBreakdown: [...currentBlocks, lunchBlock],
        };
      }),
    });
  };

  const handleRemoveScheduleBlock = (dayId: string, blockId: string) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) => {
        if (d.id !== dayId) return d;
        const currentBlocks = d.scheduleBreakdown?.length
          ? d.scheduleBreakdown
          : defaultScheduleBreakdown(d);
        return {
          ...d,
          scheduleBreakdown: currentBlocks.filter((b) => b.id !== blockId),
        };
      }),
    });
  };

  const handleResetTimeline = (dayId: string) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) => {
        if (d.id !== dayId) return d;
        return {
          ...d,
          scheduleBreakdown: defaultScheduleBreakdown(d),
        };
      }),
    });
  };

  const moveDay = (index: number, direction: -1 | 1) => {
    const days = [...plan.shootDays];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= days.length) return;
    const [removed] = days.splice(index, 1);
    days.splice(targetIndex, 0, removed);
    updatePlan({ shootDays: days });
  };

  const moveScheduleBlock = (dayId: string, blockIndex: number, direction: -1 | 1) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) => {
        if (d.id !== dayId) return d;
        const blocks = [...(d.scheduleBreakdown?.length ? d.scheduleBreakdown : defaultScheduleBreakdown(d))];
        const targetIndex = blockIndex + direction;
        if (targetIndex < 0 || targetIndex >= blocks.length) return d;
        const [removed] = blocks.splice(blockIndex, 1);
        blocks.splice(targetIndex, 0, removed);
        return { ...d, scheduleBreakdown: blocks };
      }),
    });
  };

  const moveSetup = (dayId: string, setupIndex: number, direction: -1 | 1) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) => {
        if (d.id !== dayId) return d;
        const setups = [...d.setups];
        const targetIndex = setupIndex + direction;
        if (targetIndex < 0 || targetIndex >= setups.length) return d;
        const [removed] = setups.splice(setupIndex, 1);
        setups.splice(targetIndex, 0, removed);
        return { ...d, setups };
      }),
    });
  };

  const parseTimeToMinutes = (timeStr: string): number => {
    if (!timeStr) return 420;
    const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
    if (!match) return 420;
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = (match[3] || '').toUpperCase();
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  };

  const formatMinutesToTime = (totalMins: number): string => {
    const normalized = ((totalMins % 1440) + 1440) % 1440;
    let hours = Math.floor(normalized / 60);
    const minutes = normalized % 60;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${ampm}`;
  };

  const autoScheduleDay = (dayId: string) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) => {
        if (d.id !== dayId) return d;
        let currentMins = parseTimeToMinutes(d.callTime || '07:00 AM');
        const blocks = d.scheduleBreakdown?.length ? [...d.scheduleBreakdown] : defaultScheduleBreakdown(d);
        
        const updatedBlocks = blocks.map((b) => {
          let duration = b.estimatedMinutes || 45;
          if (b.category === 'call') duration = 45;
          else if (b.category === 'meal') duration = 60;
          else if (b.category === 'wrap') duration = 30;
          else if (b.category === 'setup') duration = b.estimatedMinutes || 60;

          const startMins = currentMins;
          const endMins = currentMins + duration;
          const timeSlot = `${formatMinutesToTime(startMins)} - ${formatMinutesToTime(endMins)}`;
          currentMins = endMins;

          return {
            ...b,
            timeSlot,
            estimatedMinutes: duration,
          };
        });

        return {
          ...d,
          scheduleBreakdown: updatedBlocks,
        };
      }),
    });
  };

  const handleRemoveDay = (dayId: string) => {
    updatePlan({
      shootDays: plan.shootDays.filter((d) => d.id !== dayId),
    });
  };

  const updateSetup = (
    dayId: string,
    setupIndex: number,
    patch: Partial<ShootDayPlan['setups'][number]>
  ) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) => {
        if (d.id !== dayId) return d;
        return {
          ...d,
          setups: d.setups.map((st, idx) =>
            idx === setupIndex ? { ...st, ...patch } : st
          ),
        };
      }),
    });
  };

  const handleAddSetup = (dayId: string) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) =>
        d.id === dayId
          ? {
              ...d,
              setups: [
                ...d.setups,
                {
                  setupName: `Setup ${String.fromCharCode(65 + d.setups.length)}`,
                  lightingNotes: '',
                  shotIds: [],
                  estimatedMinutes: 45,
                },
              ],
            }
          : d
      ),
    });
  };

  const handleRemoveSetup = (dayId: string, setupIndex: number) => {
    updatePlan({
      shootDays: plan.shootDays.map((d) =>
        d.id === dayId
          ? { ...d, setups: d.setups.filter((_, i) => i !== setupIndex) }
          : d
      ),
    });
  };

  const updateStringList = (
    key: 'equipment' | 'crew' | 'risks' | 'clientQuestions',
    index: number,
    value: string
  ) => {
    const next = [...plan[key]];
    next[index] = value;
    updatePlan({ [key]: next } as Partial<ShootPlan>);
  };

  const addStringListItem = (
    key: 'equipment' | 'crew' | 'risks' | 'clientQuestions',
    placeholder = ''
  ) => {
    updatePlan({ [key]: [...plan[key], placeholder] } as Partial<ShootPlan>);
  };

  const removeStringListItem = (
    key: 'equipment' | 'crew' | 'risks' | 'clientQuestions',
    index: number
  ) => {
    updatePlan({
      [key]: plan[key].filter((_, i) => i !== index),
    } as Partial<ShootPlan>);
  };

  if (isPrintableOpen) {
    return (
      <PrintableCallSheetView
        project={project}
        plan={plan}
        onBack={() => setIsPrintableOpen(false)}
      />
    );
  }

  return (
    <>
      {/* Screen Interactive Workspace */}
      <div className="no-print max-w-[1320px] mx-auto px-6 py-7 space-y-6">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-5 border-b border-[#E2E2E6]">
          <div>
            <div className="text-xs font-medium text-[#C6202F]">
              Step 9 · Live &amp; Hybrid Shoot Plan
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
              Line Producer Call Sheet &amp; Production Schedule
            </h1>
            <p className="text-sm text-[#5A5A66] mt-1">
              Covers <strong className="text-[#24242B]">{liveHybridShots.length}</strong>{' '}
              Live &amp; Hybrid shot{liveHybridShots.length === 1 ? '' : 's'} grouped by
              location and lighting ({aiOnlyShots.length} AI-only shot
              {aiOnlyShots.length === 1 ? '' : 's'} excluded). Missing dates or budget
              notes appear under Client Questions rather than being guessed.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={isGenerating}
              onClick={() => void handleGenerateClick(false)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
            >
              {isGenerating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {isGenerating
                ? 'Building Shoot Plan...'
                : plan.hasGenerated
                  ? 'Refresh shoot plan'
                  : 'Generate shoot plan'}
            </button>

            {plan.hasGenerated && (
              <>
                <button
                  type="button"
                  onClick={() => setIsPrintableOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Preview Call Sheet
                </button>

                <button
                  type="button"
                  disabled={isDownloadingCallSheet}
                  onClick={() => void handleQuickDownloadCallSheet()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#C6202F] disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                >
                  {isDownloadingCallSheet ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6202F]" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-[#C6202F]" />
                  )}
                  {isDownloadingCallSheet ? 'Saving PDF...' : 'Save Call Sheet PDF'}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onOpenMasterExport}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] hover:bg-[#FCE8EA] rounded-lg transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5" />
              Master Download PDF
            </button>

            {project.approvals.shootPlanApproved ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#15803D] rounded-lg whitespace-nowrap">
                  <CheckCircle2 className="w-4 h-4" />
                  Shoot Plan Approved
                </span>
                {onOpenReadyToLaunch && (
                  <button
                    type="button"
                    onClick={onOpenReadyToLaunch}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#111114] hover:bg-[#C6202F] brand-corner-sm transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    Ready to Launch
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                disabled={!plan.hasGenerated}
                onClick={() => void onApproveShootPlan()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-[#111114] bg-white border border-emerald-600 hover:bg-emerald-50 disabled:opacity-40 rounded-lg transition-colors cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                Approve shoot plan
              </button>
            )}
          </div>
        </div>

        {/* Master Production Packet Completion Banner */}
        {(project.approvals.shootPlanApproved || plan.hasGenerated) && (
          <div className="p-4 brand-corner bg-gradient-to-r from-[#FDF4F5] via-white to-[#F6F6F7] border border-[#EABAC0] flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
            <div className="space-y-0.5">
              <div className="text-xs font-bold uppercase tracking-wider text-[#C6202F] flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                {project.approvals.shootPlanApproved
                  ? 'Pipeline Complete · All Deliverables Ready'
                  : 'Production Deliverables Ready for Export'}
              </div>
              <p className="text-xs text-[#3A3A44]">
                Download your Brand Bible, Creative Brief, Shot List &amp; Storyboard,
                Frame Suggestions, Video Prompts &amp; Takes, VO Script, and Shoot Plan
                in one combined Master PDF or individually as selectable files.
              </p>
            </div>
            <button
              type="button"
              onClick={onOpenMasterExport}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Master Download PDF
            </button>
          </div>
        )}

        {/* Manual edit overwrite confirmation */}
        {confirmOverwriteOpen && (
          <div className="p-4 rounded-xl bg-[#FDF4F5] border border-[#C6202F]/55 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs text-[#6E141C]">
              <AlertTriangle className="w-4 h-4 text-[#C6202F] shrink-0 mt-0.5" />
              <div>
                <strong>You have manual edits in the Shoot Plan.</strong> Regenerating
                will replace your current schedule, crew, and gear lists. Continue?
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmOverwriteOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] rounded-lg cursor-pointer"
              >
                Keep my edits
              </button>
              <button
                type="button"
                onClick={() => void handleGenerateClick(true)}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer"
              >
                Replace with fresh plan
              </button>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-300 text-xs text-[#891A23]">
            {errorMsg}
          </div>
        )}

        {callSheetDriveStatus && callSheetDriveStatus.attempted && (
          <div
            className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-2 ${
              callSheetDriveStatus.success
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-amber-50 border-amber-300 text-amber-950'
            }`}
          >
            <span>
              {callSheetDriveStatus.success
                ? 'Call Sheet PDF saved to Google Drive.'
                : `Call Sheet downloaded locally, but couldn’t save to Drive: ${callSheetDriveStatus.error || 'Unknown error'}`}
            </span>
            {callSheetDriveStatus.success && callSheetDriveStatus.backupFolderUrl && (
              <a
                href={callSheetDriveStatus.backupFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold underline hover:no-underline shrink-0"
              >
                Open on Drive
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* Included Live & Hybrid Shots Reference Bar */}
        <div className="bg-white border border-[#E2E2E6] rounded-xl p-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[#24242B] flex items-center gap-1.5">
              <Clapperboard className="w-3.5 h-3.5 text-emerald-700" />
              Live &amp; Hybrid Shots Included on Set ({liveHybridShots.length})
            </span>
            <span className="text-[#6E6E7A]">
              Intake notes:{' '}
              {project.intake.shootLocationDatesBudgetNotes || 'Not provided in intake'}
            </span>
          </div>
          {liveHybridShots.length === 0 ? (
            <div className="text-xs text-[#5A5A66]">
              All current shots are routed to AI video only. You can still review or add
              pickup shoot notes below.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
              {liveHybridShots.map((shot) => (
                <div
                  key={shot.id}
                  className="bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg p-3 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-[#C6202F]">{shot.id}</span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        shot.route === 'live'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-300'
                          : 'bg-[#FDF2F3] text-[#891A23] border border-[#EABAC0]'
                      }`}
                    >
                      {shot.route === 'live' ? 'Live Shoot' : 'Hybrid'}
                    </span>
                  </div>
                  <div className="text-[#24242B] line-clamp-2">{shot.scene}</div>
                  {shot.shootDirection && (
                    <div className="text-[11px] text-[#5A5A66] line-clamp-2">
                      {shot.shootDirection}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Empty State Before First Generation */}
        {!plan.hasGenerated ? (
          <div className="bg-white border border-dashed border-[#E2E2E6] rounded-xl p-12 text-center space-y-3">
            <Calendar className="w-8 h-8 text-[#C6202F] mx-auto" />
            <h2 className="text-base font-semibold text-[#111114]">
              Ready to Build the Live &amp; Hybrid Shoot Plan
            </h2>
            <p className="text-xs text-[#5A5A66] max-w-lg mx-auto leading-relaxed">
              Gemini will group your live and hybrid shots by location and lighting, specify
              gear, crew, and backup product units, and flag any missing shoot dates or
              budget answers for the client.
            </p>
            <div className="pt-2">
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => void handleGenerateClick(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Generate shoot plan
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Client Questions Banner */}
            <section className="bg-white border border-[#EABAC0] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#891A23] flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  Questions for Client (Missing Dates, Budget, or Location Details)
                </h2>
                <button
                  type="button"
                  onClick={() => addStringListItem('clientQuestions', '')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] rounded-lg cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  Add question
                </button>
              </div>
              {plan.clientQuestions.length === 0 ? (
                <p className="text-xs text-[#5A5A66]">
                  No open client questions flagged.
                </p>
              ) : (
                <div className="space-y-2">
                  {plan.clientQuestions.map((q, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={q}
                        onChange={(e) =>
                          updateStringList('clientQuestions', idx, e.target.value)
                        }
                        placeholder="Question for the client before confirming shoot..."
                        className="flex-1 bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                      />
                      <button
                        type="button"
                        onClick={() => removeStringListItem('clientQuestions', idx)}
                        className="p-2 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                        aria-label="Remove question"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Shoot Days & Location/Lighting Setups */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#111114] flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[#C6202F]" />
                  Shoot Days &amp; Location / Lighting Setups
                </h2>
                <button
                  type="button"
                  onClick={handleAddDay}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#111114] bg-white border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-[#C6202F]" />
                  Add shoot day
                </button>
              </div>

              {plan.shootDays.length === 0 ? (
                <div className="bg-white border border-[#E2E2E6] rounded-xl p-6 text-xs text-[#5A5A66]">
                  No shoot days scheduled. Click <strong>Add shoot day</strong> to create
                  one manually.
                </div>
              ) : (
                <div className="space-y-4">
                  {plan.shootDays.map((day, dIdx) => (
                    <div
                      key={day.id}
                      className="bg-white border border-[#E2E2E6] rounded-xl overflow-hidden"
                    >
                      <div className="px-5 py-3.5 bg-[#FBFBFC] border-b border-[#E2E2E6] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-[160px_1fr_120px_120px_150px_120px_auto] gap-3 items-end">
                        <div>
                          <label className="text-[11px] text-[#5A5A66] block mb-1">
                            Shoot Day
                          </label>
                          <input
                            type="text"
                            value={day.dayLabel}
                            onChange={(e) =>
                              updateDay(day.id, { dayLabel: e.target.value })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#891A23] focus:outline-none focus:border-[#C6202F]"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#5A5A66] block mb-1">
                            Location
                          </label>
                          <input
                            type="text"
                            value={day.location}
                            onChange={(e) =>
                              updateDay(day.id, { location: e.target.value })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#5A5A66] block mb-1">
                            Call Time
                          </label>
                          <input
                            type="text"
                            value={day.callTime}
                            onChange={(e) =>
                              updateDay(day.id, { callTime: e.target.value })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#111114] focus:outline-none focus:border-[#C6202F]"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#5A5A66] block mb-1 flex items-center gap-1">
                            <Coffee className="w-3 h-3 text-[#5A5A66]" />
                            Breakfast
                          </label>
                          <input
                            type="text"
                            value={day.breakfastTime || ''}
                            placeholder="07:30 AM"
                            onChange={(e) =>
                              updateDay(day.id, { breakfastTime: e.target.value })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#111114] focus:outline-none focus:border-[#C6202F]"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#5A5A66] block mb-1 flex items-center gap-1 font-semibold text-[#891A23]">
                            <Utensils className="w-3 h-3 text-[#C6202F]" />
                            Lunch Break
                          </label>
                          <input
                            type="text"
                            value={day.lunchTime || ''}
                            placeholder="12:30 PM - 01:30 PM"
                            onChange={(e) =>
                              updateDay(day.id, { lunchTime: e.target.value })
                            }
                            className="w-full bg-[#FDF4F5] border border-[#EABAC0] rounded-lg px-2.5 py-1.5 text-xs font-mono font-semibold text-[#891A23] focus:outline-none focus:border-[#C6202F]"
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-[#5A5A66] block mb-1">
                            Wrap Time
                          </label>
                          <input
                            type="text"
                            value={day.wrapTime}
                            onChange={(e) =>
                              updateDay(day.id, { wrapTime: e.target.value })
                            }
                            className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#111114] focus:outline-none focus:border-[#C6202F]"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={dIdx === 0}
                            onClick={() => moveDay(dIdx, -1)}
                            className="p-1.5 text-[#6E6E7A] hover:text-[#111114] disabled:opacity-30 cursor-pointer"
                            title="Move day up"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={dIdx === plan.shootDays.length - 1}
                            onClick={() => moveDay(dIdx, 1)}
                            className="p-1.5 text-[#6E6E7A] hover:text-[#111114] disabled:opacity-30 cursor-pointer"
                            title="Move day down"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveDay(day.id)}
                            className="p-2 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                            aria-label="Delete shoot day"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="p-5 space-y-6">
                        {/* Chronological Schedule Breakdown & Timeline */}
                        <div className="bg-[#FAFBFD] border border-[#D5D9E2] rounded-xl p-4 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <Clock className="w-4 h-4 text-[#C6202F]" />
                              <h3 className="text-xs font-bold text-[#111114] uppercase tracking-wider">
                                Chronological Day Schedule &amp; Timeline
                              </h3>
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#EAECEF] text-[#4A4F59]">
                                Includes Meals, Load-In &amp; Setups
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => autoScheduleDay(day.id)}
                                title="Automatically calculate and adjust all block times from call time"
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#111114] bg-white border border-[#D5D5DC] hover:border-[#C6202F] rounded-lg cursor-pointer transition-colors shadow-sm"
                              >
                                <Clock className="w-3 h-3 text-[#C6202F]" />
                                Auto-Schedule Times
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAddLunchBreak(day.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] hover:bg-[#FCE8EB] rounded-lg cursor-pointer transition-colors"
                              >
                                <Utensils className="w-3 h-3 text-[#C6202F]" />
                                + Add Lunch Break
                              </button>
                              <button
                                type="button"
                                onClick={() => handleAddScheduleBlock(day.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#111114] bg-white border border-[#D5D5DC] hover:border-[#C6202F] rounded-lg cursor-pointer transition-colors shadow-sm"
                              >
                                <Plus className="w-3 h-3 text-[#C6202F]" />
                                + Add Schedule Block
                              </button>
                              <button
                                type="button"
                                onClick={() => handleResetTimeline(day.id)}
                                title="Re-generate timeline from setups and standard meals"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#5A5A66] hover:text-[#111114] rounded-lg cursor-pointer"
                              >
                                <RotateCcw className="w-3 h-3" />
                                Reset Timeline
                              </button>
                            </div>
                          </div>

                          {/* Quick Time Milestones */}
                          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                            <div className="px-2.5 py-1 rounded-md bg-white border border-[#E2E2E6] font-mono text-[11px] text-[#3A3A44]">
                              <span className="text-[#6E6E7A]">CALL:</span> <strong>{day.callTime}</strong>
                            </div>
                            <div className="px-2.5 py-1 rounded-md bg-white border border-[#E2E2E6] font-mono text-[11px] text-[#3A3A44] flex items-center gap-1">
                              <Coffee className="w-3 h-3 text-amber-700" />
                              <span className="text-[#6E6E7A]">BREAKFAST:</span> <strong>{day.breakfastTime || '07:30 AM'}</strong>
                            </div>
                            <div className="px-2.5 py-1 rounded-md bg-[#FDF4F5] border border-[#EABAC0] font-mono text-[11px] text-[#891A23] font-semibold flex items-center gap-1">
                              <Utensils className="w-3 h-3 text-[#C6202F]" />
                              <span>LUNCH BREAK:</span> <strong>{day.lunchTime || '12:30 PM - 01:30 PM'}</strong>
                              <span className="text-[10px] font-normal text-[#891A23]/80">(Catering)</span>
                            </div>
                            <div className="px-2.5 py-1 rounded-md bg-white border border-[#E2E2E6] font-mono text-[11px] text-[#3A3A44]">
                              <span className="text-[#6E6E7A]">WRAP:</span> <strong>{day.wrapTime}</strong>
                            </div>
                          </div>

                          {/* Timeline Table */}
                          <div className="space-y-1.5 pt-1">
                            {(() => {
                              const blocks = day.scheduleBreakdown?.length
                                ? day.scheduleBreakdown
                                : defaultScheduleBreakdown(day);
                              return blocks.map((block, bIdx) => {
                                const isMeal = block.category === 'meal';
                                return (
                                  <div
                                    key={block.id}
                                    className={`p-2.5 rounded-lg border grid grid-cols-1 md:grid-cols-[130px_100px_1fr_130px_1fr_auto] gap-2 items-center text-xs ${
                                      isMeal
                                        ? 'bg-[#FDF4F5] border-[#EABAC0]'
                                        : 'bg-white border-[#E2E2E6]'
                                    }`}
                                  >
                                    <div>
                                      <input
                                        type="text"
                                        value={block.timeSlot}
                                        onChange={(e) =>
                                          updateScheduleBlock(day.id, block.id, {
                                            timeSlot: e.target.value,
                                          })
                                        }
                                        placeholder="00:00 - 00:00"
                                        className={`w-full font-mono text-xs px-2 py-1 rounded border focus:outline-none focus:border-[#C6202F] ${
                                          isMeal
                                            ? 'bg-white border-[#EABAC0] font-bold text-[#891A23]'
                                            : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#111114]'
                                        }`}
                                      />
                                    </div>

                                    <div>
                                      <select
                                        value={block.category}
                                        onChange={(e) =>
                                          updateScheduleBlock(day.id, block.id, {
                                            category: e.target.value as any,
                                          })
                                        }
                                        className="w-full text-xs px-2 py-1 rounded bg-[#F6F6F7] border border-[#E2E2E6] text-[#111114] focus:outline-none focus:border-[#C6202F]"
                                      >
                                        <option value="call">Call</option>
                                        <option value="setup">Setup</option>
                                        <option value="meal">Meal Break</option>
                                        <option value="move">Move</option>
                                        <option value="wrap">Wrap</option>
                                        <option value="general">General</option>
                                      </select>
                                    </div>

                                    <div>
                                      <div className="relative">
                                        <input
                                          type="text"
                                          value={block.activity}
                                          onChange={(e) =>
                                            updateScheduleBlock(day.id, block.id, {
                                              activity: e.target.value,
                                            })
                                          }
                                          placeholder="Activity / Milestone description"
                                          className={`w-full text-xs px-2 py-1 rounded border focus:outline-none focus:border-[#C6202F] ${
                                            isMeal
                                              ? 'bg-white border-[#EABAC0] font-bold text-[#891A23]'
                                              : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#111114]'
                                          }`}
                                        />
                                      </div>
                                    </div>

                                    <div>
                                      <input
                                        type="text"
                                        value={(block.shotIds || []).join(', ')}
                                        onChange={(e) =>
                                          updateScheduleBlock(day.id, block.id, {
                                            shotIds: e.target.value
                                              .split(',')
                                              .map((x) => x.trim())
                                              .filter(Boolean),
                                          })
                                        }
                                        placeholder="Shots (optional)"
                                        className="w-full font-mono text-xs px-2 py-1 rounded bg-[#F6F6F7] border border-[#E2E2E6] text-[#891A23] focus:outline-none focus:border-[#C6202F]"
                                      />
                                    </div>

                                    <div>
                                      <input
                                        type="text"
                                        value={block.notes || ''}
                                        onChange={(e) =>
                                          updateScheduleBlock(day.id, block.id, {
                                            notes: e.target.value,
                                          })
                                        }
                                        placeholder="Notes (e.g. Catering provided, load-in)"
                                        className="w-full text-xs px-2 py-1 rounded bg-[#F6F6F7] border border-[#E2E2E6] text-[#5A5A66] focus:outline-none focus:border-[#C6202F]"
                                      />
                                    </div>

                                    <div className="flex items-center gap-0.5 shrink-0">
                                      <button
                                        type="button"
                                        disabled={bIdx === 0}
                                        onClick={() => moveScheduleBlock(day.id, bIdx, -1)}
                                        className="p-1 text-[#6E6E7A] hover:text-[#111114] disabled:opacity-30 cursor-pointer"
                                        title="Move block up"
                                      >
                                        <ChevronUp className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        disabled={bIdx === blocks.length - 1}
                                        onClick={() => moveScheduleBlock(day.id, bIdx, 1)}
                                        className="p-1 text-[#6E6E7A] hover:text-[#111114] disabled:opacity-30 cursor-pointer"
                                        title="Move block down"
                                      >
                                        <ChevronDown className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveScheduleBlock(day.id, block.id)}
                                        className="p-1.5 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                                        title="Delete schedule row"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>

                        {/* Setups Section Header */}
                        <div className="flex items-center justify-between pt-2">
                          <h4 className="text-xs font-bold text-[#111114] uppercase tracking-wider">
                            Lighting &amp; Camera Setups ({day.setups.length})
                          </h4>
                          <button
                            type="button"
                            onClick={() => handleAddSetup(day.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-[#111114] bg-white border border-[#D5D5DC] hover:border-[#C6202F] rounded-lg cursor-pointer transition-colors shadow-sm"
                          >
                            <Plus className="w-3 h-3 text-[#C6202F]" />
                            Add Setup
                          </button>
                        </div>
                        {day.setups.map((setup, sIdx) => (
                          <div
                            key={sIdx}
                            className="bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg p-4 space-y-3"
                          >
                            <div className="grid grid-cols-1 md:grid-cols-[1fr_180px_120px_auto] gap-3 items-end">
                              <div>
                                <label className="text-[11px] text-[#5A5A66] block mb-1">
                                  Setup Name
                                </label>
                                <input
                                  type="text"
                                  value={setup.setupName}
                                  onChange={(e) =>
                                    updateSetup(day.id, sIdx, {
                                      setupName: e.target.value,
                                    })
                                  }
                                  className="w-full bg-white border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#111114] focus:outline-none focus:border-[#C6202F]"
                                />
                              </div>

                              <div>
                                <label className="text-[11px] text-[#5A5A66] block mb-1">
                                  Shots in Setup (comma-separated)
                                </label>
                                <input
                                  type="text"
                                  value={setup.shotIds.join(', ')}
                                  onChange={(e) =>
                                    updateSetup(day.id, sIdx, {
                                      shotIds: e.target.value
                                        .split(',')
                                        .map((x) => x.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                  className="w-full bg-white border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#891A23] focus:outline-none focus:border-[#C6202F]"
                                />
                              </div>

                              <div>
                                <label className="text-[11px] text-[#5A5A66] block mb-1">
                                  Est. Minutes
                                </label>
                                <input
                                  type="number"
                                  min={5}
                                  step={5}
                                  value={setup.estimatedMinutes}
                                  onChange={(e) =>
                                    updateSetup(day.id, sIdx, {
                                      estimatedMinutes: Number(e.target.value) || 30,
                                    })
                                  }
                                  className="w-full bg-white border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs font-mono text-[#111114] focus:outline-none focus:border-[#C6202F]"
                                />
                              </div>

                              <div className="flex items-center gap-0.5 shrink-0">
                                <button
                                  type="button"
                                  disabled={sIdx === 0}
                                  onClick={() => moveSetup(day.id, sIdx, -1)}
                                  className="p-1 text-[#6E6E7A] hover:text-[#111114] disabled:opacity-30 cursor-pointer"
                                  title="Move setup up"
                                >
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={sIdx === day.setups.length - 1}
                                  onClick={() => moveSetup(day.id, sIdx, 1)}
                                  className="p-1 text-[#6E6E7A] hover:text-[#111114] disabled:opacity-30 cursor-pointer"
                                  title="Move setup down"
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveSetup(day.id, sIdx)}
                                  className="p-1.5 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                                  title="Delete setup"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <div>
                              <label className="text-[11px] text-[#5A5A66] block mb-1">
                                Lighting &amp; Camera Approach
                              </label>
                              <textarea
                                rows={2}
                                value={setup.lightingNotes}
                                onChange={(e) =>
                                  updateSetup(day.id, sIdx, {
                                    lightingNotes: e.target.value,
                                  })
                                }
                                className="w-full bg-white border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#24242B] focus:outline-none focus:border-[#C6202F]"
                              />
                            </div>
                          </div>
                        ))}

                        <button
                          type="button"
                          onClick={() => handleAddSetup(day.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#3A3A44] bg-[#F6F6F7] border border-dashed border-[#E2E2E6] hover:border-[#C6202F]/60 rounded-lg cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add setup to {day.dayLabel}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Props & Product Units Table Card */}
            <section className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#111114] flex items-center gap-2">
                  <Package className="w-4 h-4 text-[#C6202F]" />
                  Props &amp; Real Product Units (Including Backups)
                </h2>
                <button
                  type="button"
                  onClick={() =>
                    updatePlan({
                      propsAndUnits: [
                        ...plan.propsAndUnits,
                        { item: '', quantity: '2 hero + 1 spare', suppliedBy: 'Client' },
                      ],
                    })
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#24242B] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#C6202F] rounded-lg cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  Add prop / unit
                </button>
              </div>

              <div className="space-y-2">
                {plan.propsAndUnits.map((prop, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-1 md:grid-cols-[1fr_200px_180px_auto] gap-2.5 items-center"
                  >
                    <input
                      type="text"
                      value={prop.item}
                      placeholder="Item name"
                      onChange={(e) => {
                        const next = [...plan.propsAndUnits];
                        next[idx] = { ...next[idx], item: e.target.value };
                        updatePlan({ propsAndUnits: next });
                      }}
                      className="bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                    />
                    <input
                      type="text"
                      value={prop.quantity}
                      placeholder="Quantity (incl. spares)"
                      onChange={(e) => {
                        const next = [...plan.propsAndUnits];
                        next[idx] = { ...next[idx], quantity: e.target.value };
                        updatePlan({ propsAndUnits: next });
                      }}
                      className="bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#24242B] focus:outline-none focus:border-[#C6202F]"
                    />
                    <input
                      type="text"
                      value={prop.suppliedBy}
                      placeholder="Supplied by"
                      onChange={(e) => {
                        const next = [...plan.propsAndUnits];
                        next[idx] = { ...next[idx], suppliedBy: e.target.value };
                        updatePlan({ propsAndUnits: next });
                      }}
                      className="bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#3A3A44] focus:outline-none focus:border-[#C6202F]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updatePlan({
                          propsAndUnits: plan.propsAndUnits.filter((_, i) => i !== idx),
                        })
                      }
                      className="p-2 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                      aria-label="Remove prop row"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Equipment, Crew, Risks Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Equipment */}
              <section className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#111114] flex items-center gap-2">
                    <Camera className="w-4 h-4 text-[#C6202F]" />
                    Camera &amp; Grip Gear
                  </h2>
                  <button
                    type="button"
                    onClick={() => addStringListItem('equipment', '')}
                    className="p-1 text-[#5A5A66] hover:text-[#891A23] cursor-pointer"
                    aria-label="Add equipment item"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  {plan.equipment.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={item}
                        onChange={(e) =>
                          updateStringList('equipment', idx, e.target.value)
                        }
                        className="flex-1 bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                      />
                      <button
                        type="button"
                        onClick={() => removeStringListItem('equipment', idx)}
                        className="p-1.5 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                        aria-label="Remove equipment"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Crew */}
              <section className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#111114] flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-700" />
                    Crew Roles
                  </h2>
                  <button
                    type="button"
                    onClick={() => addStringListItem('crew', '')}
                    className="p-1 text-[#5A5A66] hover:text-[#891A23] cursor-pointer"
                    aria-label="Add crew role"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  {plan.crew.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => updateStringList('crew', idx, e.target.value)}
                        className="flex-1 bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                      />
                      <button
                        type="button"
                        onClick={() => removeStringListItem('crew', idx)}
                        className="p-1.5 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                        aria-label="Remove crew"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>

              {/* Production Risks */}
              <section className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-[#111114] flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-[#C6202F]" />
                    Risks &amp; Contingencies
                  </h2>
                  <button
                    type="button"
                    onClick={() => addStringListItem('risks', '')}
                    className="p-1 text-[#5A5A66] hover:text-[#891A23] cursor-pointer"
                    aria-label="Add risk"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
                <div className="space-y-2">
                  {plan.risks.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="text"
                        value={item}
                        onChange={(e) => updateStringList('risks', idx, e.target.value)}
                        className="flex-1 bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-2.5 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                      />
                      <button
                        type="button"
                        onClick={() => removeStringListItem('risks', idx)}
                        className="p-1.5 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                        aria-label="Remove risk"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      {/* Print-Only Light-Mode Call Sheet PDF View */}
      <div className="hidden print:block bg-white text-slate-900 p-6 space-y-6">
        <div className="border-b-2 border-slate-900 pb-4 flex items-end justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
              52Launch Production Call Sheet &amp; Shoot Plan
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">
              {project.client} — {project.product.name}
            </h1>
          </div>
          <div className="text-right text-xs font-mono text-slate-700">
            <div>{liveHybridShots.length} Live/Hybrid Shots</div>
            <div>{plan.shootDays.length} Shoot Day(s)</div>
          </div>
        </div>

        {plan.shootDays.map((day) => (
          <div
            key={day.id}
            className="print-avoid-break border border-slate-300 rounded-lg p-4 space-y-3"
          >
            <div className="flex flex-wrap justify-between border-b border-slate-200 pb-2 text-xs">
              <div>
                <span className="font-bold text-sm">{day.dayLabel}</span> ·{' '}
                <span>{day.location}</span>
              </div>
              <div className="font-mono">
                Call: {day.callTime} | Wrap: {day.wrapTime}
              </div>
            </div>
            {day.setups.map((st, idx) => (
              <div key={idx} className="text-xs space-y-1 pl-2 border-l-2 border-slate-400">
                <div className="font-bold">
                  {st.setupName} — Shots: {st.shotIds.join(', ')} ({st.estimatedMinutes} min)
                </div>
                <div className="text-slate-700">{st.lightingNotes}</div>
              </div>
            ))}
          </div>
        ))}

        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="print-avoid-break border border-slate-300 rounded-lg p-3">
            <div className="font-bold mb-1.5">Equipment</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {plan.equipment.map((eq, i) => (
                <li key={i}>{eq}</li>
              ))}
            </ul>
          </div>
          <div className="print-avoid-break border border-slate-300 rounded-lg p-3">
            <div className="font-bold mb-1.5">Crew</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {plan.crew.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        </div>

        {plan.propsAndUnits.length > 0 && (
          <div className="print-avoid-break border border-slate-300 rounded-lg p-3 text-xs">
            <div className="font-bold mb-1.5">Props &amp; Product Units</div>
            <ul className="space-y-1">
              {plan.propsAndUnits.map((p, i) => (
                <li key={i}>
                  <strong>{p.item}</strong> — {p.quantity} ({p.suppliedBy})
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.clientQuestions.length > 0 && (
          <div className="print-avoid-break border border-slate-300 rounded-lg p-3 text-xs">
            <div className="font-bold mb-1.5">Open Client Questions</div>
            <ul className="list-disc pl-4 space-y-0.5">
              {plan.clientQuestions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
};
