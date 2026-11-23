import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileText,
  LayoutGrid,
  Loader2,
  Printer,
  Rocket,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import { PipelineProject } from '../../types/pipeline';
import { downloadCallSheetPdf, DriveSaveResult } from '../../utils/pdfExporter';

interface ReadyToLaunchViewProps {
  project: PipelineProject;
  playAnimationOnMount?: boolean;
  onOpenMasterExport: () => void;
  onOpenPrintableStoryboard: () => void;
  onOpenPrintableCallSheet?: () => void;
  onDownloadBackup: () => void;
  onBackToShootPlan: () => void;
  onOpenWelcome: () => void;
}

const PREFLIGHT_CHECKS = [
  { step: 'Espresso thermos pressurized', status: 'CAFFEINATED' },
  { step: 'Hero product & props taped down', status: 'LOCKED' },
  { step: 'Sun & golden hour negotiated', status: 'PENCIL-IN' },
  { step: 'Director clapboard greased for action', status: 'SNAPPY' },
];

const CartoonRocketSvg: React.FC<{
  ignited: boolean;
  blasting: boolean;
}> = ({ ignited, blasting }) => {
  return (
    <svg
      viewBox="0 0 220 280"
      className="w-44 h-56 sm:w-52 sm:h-64 overflow-visible select-none drop-shadow-[0_14px_24px_rgba(0,0,0,0.45)]"
      aria-hidden="true"
    >
      {/* Animated Comic Exhaust Flame */}
      {(ignited || blasting) && (
        <g>
          <motion.path
            d="M84 205 Q110 278 136 205 Z"
            fill="#F97316"
            stroke="#111114"
            strokeWidth="4"
            strokeLinejoin="round"
            animate={{
              scaleY: blasting ? [1, 1.38, 0.92, 1.28] : [0.8, 1.15, 0.9],
              scaleX: blasting ? [1, 0.88, 1.12, 0.95] : [0.9, 1.05, 0.95],
            }}
            transition={{ repeat: Infinity, duration: 0.22 }}
            style={{ transformOrigin: '110px 205px' }}
          />
          <motion.path
            d="M95 205 Q110 254 125 205 Z"
            fill="#FACC15"
            animate={{
              scaleY: blasting ? [1, 1.3, 0.85] : [0.85, 1.1, 0.9],
            }}
            transition={{ repeat: Infinity, duration: 0.16 }}
            style={{ transformOrigin: '110px 205px' }}
          />
        </g>
      )}

      {/* Tiny Clapperboard Antenna on Top */}
      <line x1="110" y1="8" x2="110" y2="24" stroke="#F8FAFC" strokeWidth="4" strokeLinecap="round" />
      <rect x="97" y="4" width="26" height="10" rx="2" fill="#111114" stroke="#F8FAFC" strokeWidth="2.5" />
      <path d="M100 4 L106 14 M110 4 L116 14" stroke="#FACC15" strokeWidth="2.5" />

      {/* Left & Right Chunky Tail Fins */}
      <path
        d="M66 148 Q30 172 34 206 L74 188 Z"
        fill="#C6202F"
        stroke="#111114"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M154 148 Q190 172 186 206 L146 188 Z"
        fill="#891A23"
        stroke="#111114"
        strokeWidth="5"
        strokeLinejoin="round"
      />

      {/* Engine Nozzle Bell */}
      <path
        d="M84 192 L136 192 L144 208 L76 208 Z"
        fill="#3F3F4C"
        stroke="#111114"
        strokeWidth="5"
        strokeLinejoin="round"
      />

      {/* Plump Cream Fuselage */}
      <path
        d="M110 22 C148 56 156 126 144 192 L76 192 C64 126 72 56 110 22 Z"
        fill="#FAF8F5"
        stroke="#111114"
        strokeWidth="5"
        strokeLinejoin="round"
      />

      {/* Crimson Nosecone Tip */}
      <path
        d="M110 22 C131 41 142 66 146 84 L74 84 C78 66 89 41 110 22 Z"
        fill="#C6202F"
        stroke="#111114"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      {/* Highlight Swoosh on Nose */}
      <path
        d="M94 48 Q86 60 84 74"
        fill="none"
        stroke="#FDA4AF"
        strokeWidth="4"
        strokeLinecap="round"
      />

      {/* Racing Stripe */}
      <rect x="73" y="84" width="74" height="10" fill="#891A23" stroke="#111114" strokeWidth="4" />

      {/* Cockpit Porthole */}
      <circle cx="110" cy="128" r="24" fill="#1E293B" stroke="#111114" strokeWidth="5" />
      <circle cx="110" cy="128" r="18" fill="#BAE6FD" stroke="#111114" strokeWidth="3" />

      {/* Quirky Googly-Eyed Director Inside Porthole */}
      <circle cx="110" cy="133" r="11" fill="#FDE68A" stroke="#111114" strokeWidth="2.5" />
      {/* Goggles / Big Eyes */}
      <circle cx="105" cy="129" r="5" fill="#FFFFFF" stroke="#111114" strokeWidth="2" />
      <circle cx="115" cy="129" r="5" fill="#FFFFFF" stroke="#111114" strokeWidth="2" />
      <circle cx="106" cy="128" r="2.2" fill="#111114" />
      <circle cx="116" cy="129" r="2" fill="#111114" />
      {/* Big Grin */}
      <path
        d="M104 137 Q110 142 116 137"
        fill="none"
        stroke="#111114"
        strokeWidth="2.2"
        strokeLinecap="round"
      />

      {/* "52L" Hull Stamp */}
      <text
        x="110"
        y="175"
        textAnchor="middle"
        fill="#111114"
        fontWeight="800"
        fontSize="16"
        fontFamily="Outfit, sans-serif"
        letterSpacing="0.5"
      >
        52L
      </text>
    </svg>
  );
};

export const ReadyToLaunchView: React.FC<ReadyToLaunchViewProps> = ({
  project,
  playAnimationOnMount = true,
  onOpenMasterExport,
  onOpenPrintableStoryboard,
  onOpenPrintableCallSheet,
  onDownloadBackup,
  onBackToShootPlan,
  onOpenWelcome,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<'launching' | 'engage'>(
    playAnimationOnMount && !prefersReducedMotion ? 'launching' : 'engage'
  );
  const [countdownIndex, setCountdownIndex] = useState<number>(0); // 0..3 -> ignition -> blast
  const [isBlasting, setIsBlasting] = useState(false);
  const [isDownloadingCallSheet, setIsDownloadingCallSheet] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [callSheetDriveStatus, setCallSheetDriveStatus] = useState<DriveSaveResult | null>(null);

  const runLaunchSequence = () => {
    if (prefersReducedMotion) {
      setPhase('engage');
      return;
    }
    setPhase('launching');
    setCountdownIndex(0);
    setIsBlasting(false);
  };

  useEffect(() => {
    if (phase !== 'launching') return;
    if (prefersReducedMotion) {
      setPhase('engage');
      return;
    }

    const t1 = setTimeout(() => setCountdownIndex(1), 550);
    const t2 = setTimeout(() => setCountdownIndex(2), 1100);
    const t3 = setTimeout(() => setCountdownIndex(3), 1650);
    const t4 = setTimeout(() => setIsBlasting(true), 2000);
    const t5 = setTimeout(() => setPhase('engage'), 3150);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [phase, prefersReducedMotion]);

  const stats = useMemo(() => {
    const frames = project.shots.filter((s) => Boolean(s.frameImageUrl)).length;
    const clips = project.shots.filter((s) =>
      Boolean(s.upscaledVideoUrl || s.videoUrl)
    ).length;
    const voStems = project.voScript.filter((v) => Boolean(v.audioUrl)).length;
    return {
      shots: project.shots.length,
      frames,
      clips,
      voStems,
      shootDays: project.shootPlan.shootDays.length,
    };
  }, [project]);

  const checklistNotes = useMemo(() => {
    const notes: Array<{ label: string; kind: 'Question' | 'Risk' }> = [];
    for (const q of project.shootPlan.clientQuestions || []) {
      if (q.trim()) notes.push({ label: q.trim(), kind: 'Question' });
    }
    for (const r of project.shootPlan.risks || []) {
      if (r.trim()) notes.push({ label: r.trim(), kind: 'Risk' });
    }
    return notes.slice(0, 4);
  }, [project.shootPlan]);

  const handleQuickDownloadCallSheet = async () => {
    setDownloadError(null);
    setCallSheetDriveStatus(null);
    setIsDownloadingCallSheet(true);
    try {
      const res = await downloadCallSheetPdf(project, project.shootPlan);
      setCallSheetDriveStatus(res);
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Could not download Call Sheet PDF.'
      );
    } finally {
      setIsDownloadingCallSheet(false);
    }
  };

  const countdownWord =
    countdownIndex === 0
      ? '3'
      : countdownIndex === 1
        ? '2'
        : countdownIndex === 2
          ? '1'
          : isBlasting
            ? 'LAUNCHING!'
            : 'IGNITION!';

  return (
    <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-8 sm:py-10">
      <AnimatePresence mode="wait">
        {phase === 'launching' ? (
          <motion.section
            key="launch-stage"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25 }}
            className="bg-white border border-[#E2E2E6] brand-corner overflow-hidden shadow-sm"
          >
            {/* Playful Quirky Cosmic Launch Pad Viewport */}
            <div className="relative h-[440px] sm:h-[490px] bg-gradient-to-b from-[#11131D] via-[#1B1E2E] to-[#272230] overflow-hidden flex flex-col items-center justify-between p-6">
              {/* Top Launch Control Header */}
              <div className="relative z-20 w-full flex items-center justify-between text-xs text-white/85">
                <span className="font-mono tabular-nums tracking-wide">
                  FLIGHT 52L · {project.product.name.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={() => setPhase('engage')}
                  className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-white font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Skip to Engage →
                </button>
              </div>

              {/* Quirky Cartoon Stars & Ringed Moon */}
              <div className="pointer-events-none absolute inset-0">
                <svg className="w-full h-full" viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice">
                  {/* Comic Stars */}
                  {[
                    { x: 110, y: 80, r: 4 },
                    { x: 240, y: 150, r: 3 },
                    { x: 320, y: 70, r: 5 },
                    { x: 690, y: 95, r: 4 },
                    { x: 830, y: 140, r: 5 },
                    { x: 890, y: 70, r: 3 },
                    { x: 170, y: 270, r: 3.5 },
                    { x: 770, y: 260, r: 3.5 },
                  ].map((st, idx) => (
                    <motion.circle
                      key={idx}
                      cx={st.x}
                      cy={st.y}
                      r={st.r}
                      fill={idx % 2 === 0 ? '#FDE68A' : '#FFFFFF'}
                      animate={{ opacity: [0.4, 1, 0.4], scale: [0.9, 1.2, 0.9] }}
                      transition={{
                        repeat: Infinity,
                        duration: 1.4 + idx * 0.2,
                        ease: 'easeInOut',
                      }}
                    />
                  ))}

                  {/* Ringed Quirky Planet */}
                  <g transform="translate(815, 115) rotate(-14)">
                    <circle cx="0" cy="0" r="24" fill="#F4A261" stroke="#111114" strokeWidth="3" />
                    <ellipse
                      cx="0"
                      cy="0"
                      rx="44"
                      ry="11"
                      fill="none"
                      stroke="#FDE68A"
                      strokeWidth="4"
                    />
                  </g>

                  {/* Tiny Crescent Smile Moon */}
                  <g transform="translate(155, 115)">
                    <circle cx="0" cy="0" r="22" fill="#E2E8F0" stroke="#111114" strokeWidth="3" />
                    <circle cx="-7" cy="-4" r="2.2" fill="#111114" />
                    <circle cx="5" cy="-4" r="2.2" fill="#111114" />
                    <path d="M-5 5 Q0 9 5 5" fill="none" stroke="#111114" strokeWidth="2.2" strokeLinecap="round" />
                  </g>
                </svg>
              </div>

              {/* Quirky Floating Comic Callout Bubbles */}
              <AnimatePresence>
                {countdownIndex >= 1 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.7, rotate: -8 }}
                    animate={{ opacity: 1, scale: 1, rotate: -6 }}
                    exit={{ opacity: 0 }}
                    className="hidden sm:block absolute left-10 md:left-24 top-36 z-20 bg-[#FDE68A] text-[#111114] border-2 border-[#111114] px-3 py-1.5 rounded-lg font-display font-bold text-xs shadow-md"
                  >
                    {isBlasting ? 'TO THE EDIT BAY!' : 'HOLD ONTO YOUR CALL SHEET!'}
                  </motion.div>
                )}
                {countdownIndex >= 2 && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.7, rotate: 6 }}
                    animate={{ opacity: 1, scale: 1, rotate: 5 }}
                    exit={{ opacity: 0 }}
                    className="hidden sm:block absolute right-10 md:right-24 top-44 z-20 bg-white text-[#111114] border-2 border-[#111114] px-3 py-1.5 rounded-lg font-display font-bold text-xs shadow-md"
                  >
                    {isBlasting ? 'VROOOM!!' : 'TAPE & CAFFEINE: 100%'}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Centerpiece Rocket + Launch Pad */}
              <div className="relative z-10 flex flex-col items-center justify-end flex-1 w-full pb-6">
                <motion.div
                  animate={
                    isBlasting
                      ? {
                          y: -520,
                          scale: [1, 1.06, 0.94],
                          rotate: [0, -2, 2, 0],
                        }
                      : countdownIndex >= 1
                        ? {
                            x: [-2, 3, -3, 2, 0],
                            y: [0, -2, 1, -1, 0],
                          }
                        : { y: [0, -4, 0] }
                  }
                  transition={
                    isBlasting
                      ? { duration: 1.05, ease: [0.35, 0, 0.85, 0.4] }
                      : { repeat: Infinity, duration: countdownIndex >= 1 ? 0.16 : 1.6 }
                  }
                  className="relative z-20"
                >
                  <CartoonRocketSvg
                    ignited={countdownIndex >= 1}
                    blasting={isBlasting}
                  />
                </motion.div>

                {/* Cartoon Exhaust Cloud Puffs */}
                <div className="pointer-events-none absolute bottom-1 inset-x-0 flex justify-center items-end z-10">
                  {[
                    { dx: -110, size: 68, delay: 0 },
                    { dx: -52, size: 84, delay: 0.05 },
                    { dx: 0, size: 96, delay: 0 },
                    { dx: 56, size: 82, delay: 0.08 },
                    { dx: 112, size: 64, delay: 0.04 },
                  ].map((cloud, idx) => (
                    <motion.div
                      key={idx}
                      initial={{ scale: 0.3, opacity: 0 }}
                      animate={
                        countdownIndex >= 1
                          ? {
                              scale: isBlasting ? [1, 1.5, 1.8] : [0.7, 1.05, 0.92],
                              opacity: isBlasting ? [0.95, 0.85, 0] : 0.9,
                              x: cloud.dx * (isBlasting ? 1.55 : 1),
                              y: isBlasting ? 18 : 0,
                            }
                          : { scale: 0.25, opacity: 0 }
                      }
                      transition={{
                        duration: isBlasting ? 0.9 : 0.4,
                        delay: cloud.delay,
                      }}
                      style={{
                        width: cloud.size,
                        height: cloud.size * 0.72,
                      }}
                      className="rounded-full bg-[#F8FAFC] border-4 border-[#111114] -mx-4"
                    />
                  ))}
                </div>
              </div>

              {/* Bottom Countdown & Pre-flight Ticker */}
              <div className="relative z-20 w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-white/15 pt-4 text-white">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center px-3 py-1 rounded bg-[#C6202F] text-white font-display font-bold text-sm tabular-nums">
                    {countdownWord}
                  </span>
                  <span className="text-xs sm:text-sm text-white/85 font-medium">
                    {PREFLIGHT_CHECKS[countdownIndex]?.step} —{' '}
                    <span className="font-mono text-[#FDE68A]">
                      {PREFLIGHT_CHECKS[countdownIndex]?.status}
                    </span>
                  </span>
                </div>
                <span className="text-xs font-mono tabular-nums text-white/60">
                  {stats.shots} shots · {stats.frames} frames · {stats.shootDays} shoot day(s)
                </span>
              </div>
            </div>
          </motion.section>
        ) : (
          <motion.section
            key="engage-screen"
            initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-8"
          >
            {/* Hero Bookend Card: "ENGAGE!" */}
            <div className="bg-white border border-[#E2E2E6] brand-corner p-6 sm:p-10 shadow-xs">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                <div className="lg:col-span-8 space-y-5">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#15803D]">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>All 9 Pipeline Gates Cleared</span>
                    <span className="text-[#D0D0D6]" aria-hidden="true">
                      ·
                    </span>
                    <span className="text-[#5A5A66]">
                      {project.client} — {project.product.name}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <h1
                      className="text-4xl sm:text-5xl font-bold tracking-tight text-[#111114] font-display"
                      style={{ textWrap: 'balance' }}
                    >
                      Engage! You’re Cleared for Production.
                    </h1>
                    <p className="text-[15px] sm:text-base text-[#5A5A66] leading-relaxed max-w-2xl">
                      The whole assembly stream for{' '}
                      <strong className="text-[#111114]">{project.product.name}</strong> is locked,
                      synced, and packed into client-ready deliverables. Grab your Master PDF,
                      Call Sheet, and storyboard binder below and go make something great.
                    </p>
                  </div>

                  {/* Primary Execution Handoff Actions */}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={onOpenMasterExport}
                      className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] brand-corner-sm transition-colors cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
                    >
                      <FileText className="w-4 h-4" />
                      Download Master PDF
                    </button>

                    <button
                      type="button"
                      disabled={isDownloadingCallSheet}
                      onClick={() => void handleQuickDownloadCallSheet()}
                      className="inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold text-white bg-[#111114] hover:bg-[#2A2A34] disabled:opacity-50 brand-corner-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      {isDownloadingCallSheet ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      {isDownloadingCallSheet ? 'Exporting Call Sheet...' : 'Download Call Sheet PDF'}
                    </button>

                    {onOpenPrintableCallSheet && (
                      <button
                        type="button"
                        onClick={onOpenPrintableCallSheet}
                        className="inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium text-[#111114] bg-[#F6F6F7] hover:bg-[#EFEFF2] border border-[#D8D8DF] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Eye className="w-4 h-4 text-[#891A23]" />
                        Preview Call Sheet
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={onOpenPrintableStoryboard}
                      className="inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium text-[#111114] bg-[#F6F6F7] hover:bg-[#EFEFF2] border border-[#D8D8DF] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Printer className="w-4 h-4 text-[#891A23]" />
                      Printable Storyboard
                    </button>

                    <button
                      type="button"
                      onClick={onDownloadBackup}
                      className="inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium text-[#111114] bg-white hover:bg-[#F6F6F7] border border-[#D8D8DF] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Download className="w-4 h-4 text-[#5A5A66]" />
                      Save Project Backup
                    </button>
                  </div>

                  {downloadError && (
                    <p className="text-xs text-[#C6202F] font-medium">{downloadError}</p>
                  )}

                  {callSheetDriveStatus && callSheetDriveStatus.attempted && (
                    <div
                      className={`p-2.5 rounded-md border text-xs flex items-center justify-between gap-2 ${
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
                </div>

                {/* Right Column: Quirky Floating Cartoon Rocket Badge + Replay */}
                <div className="lg:col-span-4 bg-[#141622] border border-[#24283A] brand-corner p-6 flex flex-col items-center justify-center text-center space-y-4">
                  <motion.div
                    animate={
                      prefersReducedMotion
                        ? undefined
                        : { y: [-4, 5, -4], rotate: [-1.5, 1.5, -1.5] }
                    }
                    transition={{ repeat: Infinity, duration: 3.2, ease: 'easeInOut' }}
                  >
                    <CartoonRocketSvg ignited={true} blasting={false} />
                  </motion.div>

                  <div className="space-y-1">
                    <div className="text-xs font-mono tabular-nums text-[#FDE68A]">
                      ORBIT ACHIEVED · READY FOR SET
                    </div>
                    <p className="text-xs text-white/75">
                      Zero orphaned prompts. Zero missed props.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={runLaunchSequence}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-white/10 hover:bg-white/20 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Replay Rocket Launch
                  </button>
                </div>
              </div>
            </div>

            {/* Mission Manifest Strip (Verifiable Real Project Counts) */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              {[
                { label: 'Shots Planned', value: stats.shots },
                { label: 'Frames Locked', value: stats.frames },
                { label: 'Rendered Clips', value: stats.clips },
                { label: 'VO Audio Stems', value: stats.voStems },
                { label: 'Shoot Days Scheduled', value: stats.shootDays },
              ].map((item) => (
                <div
                  key={item.label}
                  className="bg-white border border-[#E2E2E6] rounded-lg p-4 space-y-1"
                >
                  <div className="text-2xl font-semibold text-[#111114] font-mono tabular-nums">
                    {item.value}
                  </div>
                  <div className="text-xs text-[#5A5A66]">{item.label}</div>
                </div>
              ))}
            </div>

            {/* Bottom Two-Column Handoff: Pre-Flight Checklist & Navigation Bookend */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7 bg-white border border-[#E2E2E6] rounded-lg p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-[#EFEFF2] pb-3">
                  <h2 className="text-base font-semibold text-[#111114] font-display flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#C6202F]" />
                    Final Set Reminders Before Action
                  </h2>
                  <span className="text-xs text-[#5A5A66]">From Step 9 Shoot Plan</span>
                </div>

                {checklistNotes.length > 0 ? (
                  <ul className="space-y-2.5">
                    {checklistNotes.map((note, idx) => (
                      <li
                        key={idx}
                        className="flex items-start gap-2.5 text-sm text-[#24242B] bg-[#F6F6F7] border border-[#E2E2E6] rounded-md p-3"
                      >
                        <ShieldAlert className="w-4 h-4 text-[#891A23] shrink-0 mt-0.5" />
                        <div>
                          <span className="text-xs font-semibold text-[#891A23]">
                            {note.kind}:{' '}
                          </span>
                          <span>{note.label}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="bg-[#F6F6F7] border border-[#E2E2E6] rounded-md p-4 text-sm text-[#5A5A66]">
                    No unresolved client questions or risk flags remain on this shoot plan.
                    Download your Master PDF and Call Sheet and brief the crew!
                  </div>
                )}
              </div>

              <div className="lg:col-span-5 bg-white border border-[#E2E2E6] rounded-lg p-6 flex flex-col justify-between space-y-4">
                <div className="space-y-1.5">
                  <h2 className="text-base font-semibold text-[#111114] font-display flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-[#891A23]" />
                    Need One Last Tweak?
                  </h2>
                  <p className="text-xs text-[#5A5A66] leading-relaxed">
                    You can reopen your Shoot Plan to adjust call times, catering, or crew
                    assignments, or return to the Welcome Hub to launch your next client film.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={onBackToShootPlan}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-[#F6F6F7] hover:bg-[#EFEFF2] border border-[#D8D8DF] rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Edit Shoot Plan (Step 9)
                  </button>

                  <button
                    type="button"
                    onClick={onOpenWelcome}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#891A23] hover:bg-[#6E141C] brand-corner-sm transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    Back to Saved Projects
                  </button>
                </div>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
};
