import React, { useState } from 'react';
import {
  Download,
  Loader2,
  ArrowLeft,
  Image as ImageIcon,
  Package,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import { PipelineProject, ShotRoute } from '../../types/pipeline';
import { downloadStoryboardPdf, DriveSaveResult } from '../../utils/pdfExporter';

interface PrintableStoryboardViewProps {
  project: PipelineProject;
  onBack: () => void;
}

function getRouteBadgeLabel(route: ShotRoute): string {
  if (route === 'live') return 'LIVE SHOOT';
  if (route === 'hybrid') return 'HYBRID';
  return 'AI';
}

function getRouteBadgeStyle(route: ShotRoute): string {
  if (route === 'live') {
    return 'bg-emerald-50 text-emerald-900 border-emerald-300';
  }
  if (route === 'hybrid') {
    return 'bg-[#FDF2F3] text-[#891A23] border-[#EABAC0]';
  }
  return 'bg-[#EFEFF2] text-[#111114] border-[#D8D8DF]';
}

export const PrintableStoryboardView: React.FC<PrintableStoryboardViewProps> = ({
  project,
  onBack,
}) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [driveSaveResult, setDriveSaveResult] = useState<DriveSaveResult | null>(null);

  const totalSec = project.shots.reduce(
    (sum, s) => sum + (Number(s.durationSec) || 0),
    0
  );

  const handleDownloadPdf = async () => {
    setDownloadError(null);
    setDriveSaveResult(null);
    setIsDownloading(true);
    try {
      const res = await downloadStoryboardPdf(project);
      setDriveSaveResult(res);
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : 'Could not generate storyboard PDF.'
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
            Printable Storyboard
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
            {project.client} — {project.product.name}
          </h1>
          <p className="text-sm text-[#5A5A66] mt-1">
            All shots in sequence with routes, shoot direction, VO lines, and product flags ready for PDF download.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-white border border-[#D8D8DF] hover:border-[#891A23] rounded-md transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Shot Board
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
            {isDownloading ? 'Generating PDF...' : 'Download Storyboard PDF'}
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
                ? 'Saved formatted Storyboard PDF to Google Drive.'
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
        {/* Storyboard Document Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-[#C6202F] pb-4">
          <div className="flex items-center gap-4">
            <img
              src="/brand/logo-primary.png"
              alt="52Launch"
              className="h-12 w-auto object-contain shrink-0"
            />
            <div>
              <div className="text-[11px] font-bold tracking-wider text-[#891A23] uppercase">
                52Launch Production Storyboard
              </div>
              <h2 className="text-2xl font-bold text-[#111114] mt-0.5">
                {project.client} — {project.product.name}
              </h2>
              {project.creativeBrief.recommendedConcept.title && (
                <div className="text-xs text-[#5A5A66] mt-0.5">
                  Concept: {project.creativeBrief.recommendedConcept.title}
                </div>
              )}
            </div>
          </div>
          <div className="text-right text-xs font-mono text-[#3A3A44] tabular-nums">
            <div>{project.shots.length} Shots</div>
            <div>{totalSec}s Total Runtime</div>
          </div>
        </div>

        {/* Ordered Shot Rows */}
        <div className="space-y-6">
          {project.shots.map((shot) => (
            <div
              key={shot.id}
              className="print-avoid-break border border-[#DCDCE2] rounded-md overflow-hidden bg-white"
            >
              {/* Shot Top Meta Strip */}
              <div className="px-4 py-2 bg-[#F6F6F7] border-b border-[#E2E2E6] flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-mono font-bold text-[#111114] text-sm">
                    {shot.id}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded border text-[11px] font-bold tracking-wide ${getRouteBadgeStyle(
                      shot.route
                    )}`}
                  >
                    {getRouteBadgeLabel(shot.route)}
                  </span>
                  {shot.route !== 'live' && (
                    <span className="text-[#4A4A55] font-medium">
                      Model:{' '}
                      {shot.model === 'flux3'
                        ? 'Flux 3'
                        : shot.model === 'kling'
                          ? 'Kling 4.0'
                          : shot.model === 'wan'
                            ? 'Wan 3.0 Prime'
                            : shot.model === 'luma'
                              ? 'Luma Ray 3.2'
                              : 'Seedance'}
                    </span>
                  )}
                  <span className="text-[#5A5A66]">· {shot.deliverable}</span>
                </div>

                <div className="flex items-center gap-3">
                  {shot.productInFrame && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FDF2F3] border border-[#EABAC0] text-[#891A23] text-[11px] font-bold">
                      <Package className="w-3 h-3" />
                      PRODUCT IN FRAME
                    </span>
                  )}
                  <span className="font-mono font-semibold text-[#111114] tabular-nums">
                    {shot.durationSec}s
                  </span>
                </div>
              </div>

              {/* Large Frame + Details */}
              <div className="grid grid-cols-1 md:grid-cols-[360px_1fr]">
                <div className="aspect-video bg-[#111114] border-b md:border-b-0 md:border-r border-[#E2E2E6] flex items-center justify-center overflow-hidden">
                  {shot.frameImageUrl ? (
                    <img
                      src={shot.frameImageUrl}
                      alt={`Shot ${shot.id} storyboard frame`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center text-white/60 p-4 space-y-1">
                      <ImageIcon className="w-6 h-6 mx-auto" />
                      <div className="text-xs">Frame pending upload</div>
                    </div>
                  )}
                </div>

                <div className="p-4 space-y-2.5 text-xs leading-relaxed">
                  <div>
                    <div className="font-bold text-[#111114]">Scene</div>
                    <p className="text-[#2E2E36] mt-0.5">
                      {shot.scene || 'No scene description entered.'}
                    </p>
                  </div>

                  {(shot.route === 'live' || shot.route === 'hybrid') && (
                    <div>
                      <div className="font-bold text-emerald-900">Shoot Direction</div>
                      <p className="text-[#3A3A44] mt-0.5">
                        {shot.shootDirection || 'No shoot direction entered yet.'}
                      </p>
                    </div>
                  )}

                  {shot.voLine && (
                    <div className="pt-1 border-t border-[#ECECF0]">
                      <span className="font-bold text-[#891A23]">VO Line: </span>
                      <span className="italic text-[#111114]">&ldquo;{shot.voLine}&rdquo;</span>
                    </div>
                  )}

                  {shot.continuityNotes && (
                    <div className="text-[11px] text-[#5A5A66]">
                      <span className="font-semibold text-[#111114]">Continuity:</span>{' '}
                      {shot.continuityNotes}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
