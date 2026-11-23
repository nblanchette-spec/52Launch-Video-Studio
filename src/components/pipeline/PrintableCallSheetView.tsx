import React, { useState } from 'react';
import {
  Download,
  Loader2,
  ArrowLeft,
  Clock,
  MapPin,
  Users,
  Wrench,
  Package,
  HelpCircle,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { PipelineProject, ShootPlan } from '../../types/pipeline';
import { downloadCallSheetPdf, DriveSaveResult } from '../../utils/pdfExporter';

interface PrintableCallSheetViewProps {
  project: PipelineProject;
  plan: ShootPlan;
  onBack: () => void;
}

export const PrintableCallSheetView: React.FC<PrintableCallSheetViewProps> = ({
  project,
  plan,
  onBack,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [driveSaveResult, setDriveSaveResult] = useState<DriveSaveResult | null>(null);

  const liveHybridShots = project.shots.filter((s) => s.route !== 'ai_video');

  const handleDownloadPdf = async () => {
    setDownloadError(null);
    setDriveSaveResult(null);
    setIsDownloading(true);
    try {
      const res = await downloadCallSheetPdf(project, plan);
      setDriveSaveResult(res);
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Could not generate call sheet PDF.'
      );
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="max-w-[1060px] mx-auto px-6 py-7 space-y-6 print-only-full">
      {/* Screen Toolbar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-[#E2E2E6]">
        <div>
          <div className="text-xs font-semibold text-[#891A23]">
            Printable Call Sheet &amp; Shoot Plan
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
            {project.client} — {project.product.name}
          </h1>
          <p className="text-sm text-[#5A5A66] mt-1">
            Line producer call sheet, shoot days, equipment, crew, and props ready for direct PDF download.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-white border border-[#D8D8DF] hover:border-[#891A23] rounded-md transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Shoot Plan
          </button>

          <button
            type="button"
            disabled={isDownloading}
            onClick={() => void handleDownloadPdf()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-50 brand-corner-sm transition-colors cursor-pointer"
          >
            {isDownloading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {isDownloading ? 'Generating PDF...' : 'Download Call Sheet PDF'}
          </button>
        </div>
      </div>

      {downloadError && (
        <div className="no-print p-3 rounded-md bg-[#FDF2F3] border border-[#C6202F]/50 text-xs text-[#891A23]">
          {downloadError}
        </div>
      )}

      {driveSaveResult && driveSaveResult.attempted && (
        <div
          className={`no-print p-3 rounded-md border text-xs flex items-center justify-between gap-3 ${
            driveSaveResult.success
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-300 text-amber-950'
          }`}
        >
          <div className="flex items-center gap-2">
            {driveSaveResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            )}
            <span>
              {driveSaveResult.success
                ? 'Saved formatted Call Sheet PDF to Google Drive.'
                : `PDF downloaded locally, but couldn’t save to Drive: ${driveSaveResult.error || 'Unknown error'}`}
            </span>
          </div>
          {driveSaveResult.success && driveSaveResult.backupFolderUrl && (
            <a
              href={driveSaveResult.backupFolderUrl}
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

      {/* Light-Mode Print Document */}
      <div className="bg-white text-[#111114] border border-[#E2E2E6] brand-corner p-8 space-y-6 shadow-sm print:border-0 print:shadow-none print:p-0">
        {/* Document Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-[#C6202F] pb-4">
          <div className="flex items-center gap-4 min-w-0">
            <img
              src="/brand/logo-primary.png"
              alt="52Launch"
              className="h-12 w-auto object-contain shrink-0"
            />
            <div className="min-w-0">
              <div className="text-[11px] font-bold tracking-wider text-[#891A23] uppercase">
                52Launch Production Call Sheet &amp; Shoot Plan
              </div>
              <h2 className="text-2xl font-bold text-[#111114] mt-0.5">
                {project.client} — {project.product.name}
              </h2>
              <div className="text-xs text-[#5A5A66] mt-0.5 line-clamp-2">
                Objective: {project.creativeBrief.objective}
              </div>
            </div>
          </div>
          <div className="text-right text-xs font-mono text-[#3A3A44] tabular-nums shrink-0">
            <div>{liveHybridShots.length} Live/Hybrid Shots</div>
            <div>{plan.shootDays.length} Shoot Day(s)</div>
          </div>
        </div>

        {/* Shoot Days & Setups */}
        <div className="space-y-5">
          <h3 className="text-sm font-bold tracking-wider text-[#891A23] uppercase border-b border-[#E2E2E6] pb-1.5 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#C6202F]" />
            Schedule &amp; Shoot Days
          </h3>

          {plan.shootDays.length === 0 ? (
            <p className="text-xs text-[#5A5A66] italic">No shoot days scheduled.</p>
          ) : (
            plan.shootDays.map((day) => {
              const scheduleBlocks = day.scheduleBreakdown?.length
                ? day.scheduleBreakdown
                : [
                    {
                      id: 'call',
                      timeSlot: day.callTime && day.callTime !== 'TBD' ? `${day.callTime} - 07:45` : '07:00 - 07:45',
                      activity: 'Crew Call, Safety Briefing & Equipment Load-In',
                      category: 'call' as const,
                      shotIds: [] as string[],
                      notes: 'Check-in, staging area setup, lighting prep',
                    },
                    {
                      id: 'breakfast',
                      timeSlot: day.breakfastTime || '07:45 - 08:15',
                      activity: 'Crew Breakfast & Craft Services',
                      category: 'meal' as const,
                      shotIds: [] as string[],
                      notes: 'Coffee, light breakfast, morning briefing',
                    },
                    ...day.setups.slice(0, Math.max(1, Math.ceil(day.setups.length / 2))).map((st, i) => ({
                      id: `setup-m-${i}`,
                      timeSlot: st.timeSlot || (i === 0 ? '08:15 - 10:30' : '10:30 - 12:30'),
                      activity: `${st.setupName} — Shooting`,
                      category: 'setup' as const,
                      shotIds: st.shotIds,
                      notes: st.lightingNotes || `${st.estimatedMinutes} mins est.`,
                    })),
                    {
                      id: 'lunch',
                      timeSlot: day.lunchTime || '12:30 - 01:30',
                      activity: 'Mandatory Crew Lunch Break (Hot Catering Provided)',
                      category: 'meal' as const,
                      shotIds: [] as string[],
                      notes: 'Hot catering served; 60m off-the-clock break; equipment & media recharge',
                    },
                    ...day.setups.slice(Math.max(1, Math.ceil(day.setups.length / 2))).map((st, i) => ({
                      id: `setup-a-${i}`,
                      timeSlot: st.timeSlot || (i === 0 ? '01:30 - 03:45' : '03:45 - 05:30'),
                      activity: `${st.setupName} — Shooting`,
                      category: 'setup' as const,
                      shotIds: st.shotIds,
                      notes: st.lightingNotes || `${st.estimatedMinutes} mins est.`,
                    })),
                    {
                      id: 'wrap',
                      timeSlot: day.wrapTime && day.wrapTime !== 'TBD' ? `05:30 - ${day.wrapTime}` : '05:30 - 06:00',
                      activity: 'Wrap, DIT Media Dump & Equipment Load-Out',
                      category: 'wrap' as const,
                      shotIds: [] as string[],
                      notes: 'Verify dual media backups, strike lights, pack gear',
                    },
                  ];

              return (
                <div
                  key={day.id}
                  className="print-avoid-break border border-[#DCDCE2] rounded-md p-5 space-y-4 bg-white"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ECECF0] pb-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-base text-[#111114]">{day.dayLabel}</span>
                      <span className="text-[#9A9AA6]">·</span>
                      <span className="text-[#3A3A44] font-medium inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-[#891A23]" />
                        {day.location}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums">
                      <span className="bg-[#F6F6F7] px-2.5 py-1 rounded border border-[#E2E2E6] text-[#111114]">
                        Call: <strong>{day.callTime}</strong>
                      </span>
                      <span className="bg-[#F6F6F7] px-2.5 py-1 rounded border border-[#E2E2E6] text-[#111114]">
                        Breakfast: <strong>{day.breakfastTime || '07:30 AM'}</strong>
                      </span>
                      <span className="bg-[#FDF4F5] px-2.5 py-1 rounded border border-[#EABAC0] text-[#891A23] font-bold">
                        Lunch: <strong>{day.lunchTime || '12:30 PM - 01:30 PM'}</strong> (Catering)
                      </span>
                      <span className="bg-[#F6F6F7] px-2.5 py-1 rounded border border-[#E2E2E6] text-[#111114]">
                        Wrap: <strong>{day.wrapTime}</strong>
                      </span>
                    </div>
                  </div>

                  {/* Chronological Schedule Table */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-bold text-[#891A23] uppercase tracking-wider flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-[#C6202F]" />
                      Chronological Shoot Schedule &amp; Meal Breaks
                    </div>
                    <div className="overflow-x-auto rounded border border-[#E2E2E6]">
                      <table className="w-full text-xs text-left border-collapse">
                        <thead>
                          <tr className="bg-[#111114] text-white text-[10px] uppercase font-bold tracking-wider">
                            <th className="py-2 px-3 w-28">Time Slot</th>
                            <th className="py-2 px-3">Activity / Milestone</th>
                            <th className="py-2 px-3 w-24">Type</th>
                            <th className="py-2 px-3 w-28">Shots</th>
                            <th className="py-2 px-3">Notes &amp; Details</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#E2E2E6]">
                          {scheduleBlocks.map((block, bIdx) => {
                            const isMeal = block.category === 'meal';
                            return (
                              <tr
                                key={bIdx}
                                className={
                                  isMeal
                                    ? 'bg-[#FDF4F5] font-semibold text-[#891A23]'
                                    : bIdx % 2 === 1
                                      ? 'bg-[#FAFBFD]'
                                      : 'bg-white'
                                }
                              >
                                <td className="py-2 px-3 font-mono font-bold whitespace-nowrap">
                                  {block.timeSlot}
                                </td>
                                <td className="py-2 px-3">
                                  {block.activity}
                                </td>
                                <td className="py-2 px-3">
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                                      isMeal
                                        ? 'bg-[#F9D2D6] text-[#891A23]'
                                        : block.category === 'call'
                                          ? 'bg-blue-100 text-blue-900'
                                          : block.category === 'wrap'
                                            ? 'bg-slate-200 text-slate-800'
                                            : 'bg-emerald-100 text-emerald-900'
                                    }`}
                                  >
                                    {block.category}
                                  </span>
                                </td>
                                <td className="py-2 px-3 font-mono text-[#891A23]">
                                  {(block.shotIds || []).join(', ') || '—'}
                                </td>
                                <td className="py-2 px-3 text-[#5A5A66]">
                                  {block.notes || '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Setups Breakdown */}
                  <div className="space-y-2 pt-1">
                    <div className="text-[11px] font-bold text-[#111114] uppercase tracking-wider">
                      Lighting &amp; Camera Setups Detail
                    </div>
                    <div className="space-y-2">
                      {day.setups.map((st, idx) => (
                        <div
                          key={idx}
                          className="print-avoid-break text-xs space-y-1 bg-[#FAFAFB] border border-[#E8E8EE] rounded p-3"
                        >
                          <div className="font-bold text-[#111114] flex flex-wrap items-center justify-between gap-2">
                            <span className="break-words">
                              {st.setupName} — <span className="font-mono text-[#891A23]">Shots: {st.shotIds.join(', ')}</span>
                            </span>
                            <span className="font-mono text-[#5A5A66] tabular-nums shrink-0">{st.estimatedMinutes} mins</span>
                          </div>
                          <p className="text-[#3A3A44] leading-relaxed">{st.lightingNotes}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Equipment & Crew */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <div className="print-avoid-break border border-[#DCDCE2] rounded-md p-5 space-y-3 bg-white">
            <h3 className="text-xs font-bold tracking-wider text-[#891A23] uppercase flex items-center gap-2 border-b border-[#ECECF0] pb-2">
              <Wrench className="w-4 h-4 text-[#C6202F]" />
              Required Equipment ({plan.equipment.length})
            </h3>
            {plan.equipment.length === 0 ? (
              <p className="text-xs text-[#5A5A66] italic">No equipment listed.</p>
            ) : (
              <ul className="list-disc pl-4 space-y-1.5 text-xs text-[#2E2E36]">
                {plan.equipment.map((eq, i) => (
                  <li key={i} className="break-words">{eq}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="print-avoid-break border border-[#DCDCE2] rounded-md p-5 space-y-3 bg-white">
            <h3 className="text-xs font-bold tracking-wider text-[#891A23] uppercase flex items-center gap-2 border-b border-[#ECECF0] pb-2">
              <Users className="w-4 h-4 text-[#C6202F]" />
              Crew &amp; Roles ({plan.crew.length})
            </h3>
            {plan.crew.length === 0 ? (
              <p className="text-xs text-[#5A5A66] italic">No crew listed.</p>
            ) : (
              <ul className="list-disc pl-4 space-y-1.5 text-xs text-[#2E2E36]">
                {plan.crew.map((c, i) => (
                  <li key={i} className="break-words">{c}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Props & Product Units */}
        {plan.propsAndUnits.length > 0 && (
          <div className="print-avoid-break border border-[#DCDCE2] rounded-md p-5 space-y-3 bg-white">
            <h3 className="text-xs font-bold tracking-wider text-[#891A23] uppercase flex items-center gap-2 border-b border-[#ECECF0] pb-2">
              <Package className="w-4 h-4 text-[#C6202F]" />
              Props &amp; Product Units ({plan.propsAndUnits.length})
            </h3>
            <ul className="space-y-2 text-xs text-[#2E2E36]">
              {plan.propsAndUnits.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F2F2F5] pb-1.5">
                  <div className="break-words">
                    <strong>{p.item}</strong> — Qty: {p.quantity}
                  </div>
                  <div className="font-mono text-[#5A5A66] text-[11px] shrink-0">
                    Supplied by: {p.suppliedBy}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Client Questions & Risks */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {plan.clientQuestions.length > 0 && (
            <div className="print-avoid-break border border-[#EABAC0] bg-[#FDF4F5] rounded-md p-5 space-y-3">
              <h3 className="text-xs font-bold tracking-wider text-[#891A23] uppercase flex items-center gap-2 border-b border-[#EABAC0]/60 pb-2">
                <HelpCircle className="w-4 h-4 text-[#C6202F]" />
                Open Client Questions ({plan.clientQuestions.length})
              </h3>
              <ul className="list-disc pl-4 space-y-1.5 text-xs text-[#2E2E36]">
                {plan.clientQuestions.map((q, i) => (
                  <li key={i} className="break-words">{q}</li>
                ))}
              </ul>
            </div>
          )}

          {plan.risks.length > 0 && (
            <div className="print-avoid-break border border-rose-300 bg-rose-50/50 rounded-md p-5 space-y-3">
              <h3 className="text-xs font-bold tracking-wider text-rose-900 uppercase flex items-center gap-2 border-b border-rose-200 pb-2">
                <ShieldAlert className="w-4 h-4 text-rose-700" />
                Production Risks &amp; Mitigations ({plan.risks.length})
              </h3>
              <ul className="list-disc pl-4 space-y-1.5 text-xs text-rose-950">
                {plan.risks.map((r, i) => (
                  <li key={i} className="break-words">{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
