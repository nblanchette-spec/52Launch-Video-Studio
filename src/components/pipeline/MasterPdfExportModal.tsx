import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Download,
  FileText,
  Files,
  Loader2,
  CheckSquare,
  Square,
  CheckCircle2,
  AlertTriangle,
  Presentation,
  ExternalLink,
  Eye,
} from 'lucide-react';
import { PipelineProject } from '../../types/pipeline';
import {
  downloadMasterPdf,
  MASTER_PDF_SECTIONS,
  MasterPdfDriveStatus,
  MasterPdfSectionId,
} from '../../utils/pdfExporter';
import { PrintableDocumentView, PrintableTarget } from './PrintableDocumentView';

interface MasterPdfExportModalProps {
  isOpen: boolean;
  project: PipelineProject | null;
  onClose: () => void;
}

export const MasterPdfExportModal: React.FC<MasterPdfExportModalProps> = ({
  isOpen,
  project,
  onClose,
}) => {
  const [selected, setSelected] = useState<MasterPdfSectionId[]>(() =>
    MASTER_PDF_SECTIONS.map((s) => s.id)
  );
  const [exportingMode, setExportingMode] = useState<
    'combined' | 'individual' | 'slideshow' | null
  >(null);
  const [previewTarget, setPreviewTarget] = useState<PrintableTarget | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [driveStatus, setDriveStatus] = useState<MasterPdfDriveStatus | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);
      setDriveStatus(null);
      setPreviewTarget(null);
    }
  }, [isOpen]);

  const statuses = useMemo(() => {
    if (!project) return [];
    return MASTER_PDF_SECTIONS.map((meta) => ({
      ...meta,
      status: meta.getStatus(project),
    }));
  }, [project]);

  if (!isOpen || !project) return null;

  const orderedSelection = MASTER_PDF_SECTIONS.map((s) => s.id).filter((id) =>
    selected.includes(id)
  );

  if (previewTarget) {
    return (
      <div
        className="fixed inset-0 z-50 bg-[#F6F6F7] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-label="Printable PDF Preview"
      >
        <div className="sticky top-0 z-20 no-print bg-[#111114] text-white border-b-2 border-[#C6202F] px-6 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <img
              src="/brand/logo-badge-burgundy.png"
              alt="52Launch"
              className="h-7 w-auto object-contain"
            />
            <span className="text-xs font-semibold text-white/90">
              PDF Printable Preview · {project.client} — {project.product.name}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white/80 hover:text-white rounded border border-white/15 hover:border-white/35 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            Close
          </button>
        </div>

        <PrintableDocumentView
          project={project}
          initialTarget={previewTarget}
          backLabel="Back to Export Options"
          onBack={() => setPreviewTarget(null)}
        />
      </div>
    );
  }

  const toggleSection = (id: MasterPdfSectionId) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setDriveStatus(null);
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectAll = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setDriveStatus(null);
    setSelected(MASTER_PDF_SECTIONS.map((s) => s.id));
  };

  const selectReadyOnly = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setDriveStatus(null);
    const readyIds = statuses.filter((s) => s.status.ready).map((s) => s.id);
    setSelected(readyIds.length > 0 ? readyIds : MASTER_PDF_SECTIONS.map((s) => s.id));
  };

  const clearAll = () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setDriveStatus(null);
    setSelected([]);
  };

  const handleDownload = async (mode: 'combined' | 'individual' | 'slideshow') => {
    if (selected.length === 0) {
      setErrorMsg('Select at least one section to export.');
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setDriveStatus(null);
    setExportingMode(mode);
    try {
      const result = await downloadMasterPdf(project, orderedSelection, mode);
      setSuccessMsg(
        mode === 'slideshow'
          ? `Downloaded 16:9 Landscape Slideshow PDF (${orderedSelection.length} sections).`
          : mode === 'combined'
            ? `Downloaded combined Master Production PDF (${orderedSelection.length} deliverables).`
            : `Downloaded ${orderedSelection.length} individual PDF file${
                orderedSelection.length === 1 ? '' : 's'
              }.`
      );

      if (result.driveStatus.status === 'saved' || result.driveStatus.status === 'failed') {
        setDriveStatus(result.driveStatus);
      } else {
        setDriveStatus(null);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'PDF export failed.');
      setDriveStatus(null);
    } finally {
      setExportingMode(null);
    }
  };

  const handleOpenPacketPreview = (kind: 'combined' | 'slideshow') => {
    if (orderedSelection.length === 0) {
      setErrorMsg('Select at least one section to preview.');
      return;
    }
    setErrorMsg(null);
    setPreviewTarget({ kind, sections: orderedSelection });
  };

  const busy = exportingMode !== null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Master PDF Export"
    >
      <div className="bg-white border border-[#E2E2E6] brand-corner w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl text-[#111114]">
        {/* Header */}
        <div className="px-6 py-4 bg-[#111114] border-b-2 border-[#C6202F] flex items-center justify-between gap-4 shrink-0 text-white">
          <div className="flex items-center gap-3.5 min-w-0">
            <img
              src="/brand/logo-badge-burgundy.png"
              alt="52Launch"
              className="h-11 w-auto object-contain shrink-0"
            />
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-[#F39CA4] tracking-wide">
                Master Deliverable Export &amp; Print Preview
              </div>
              <h2 className="text-lg font-bold text-white mt-0.5 truncate">
                Preview &amp; Download Production PDF Packet
              </h2>
              <p className="text-xs text-white/75 mt-0.5 truncate">
                {project.client} — {project.product.name}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-white/75 hover:text-white rounded-md border border-white/10 hover:border-white/30 cursor-pointer shrink-0"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selection Toolbar */}
        <div className="px-6 py-3 bg-[#F6F6F7] border-b border-[#E2E2E6] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <span className="text-[#111114] font-semibold tabular-nums">
            {selected.length} of {MASTER_PDF_SECTIONS.length} sections selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={selectAll}
              className="px-2.5 py-1 rounded-md bg-white border border-[#D8D8DF] hover:border-[#891A23] text-[#111114] cursor-pointer"
            >
              Select all
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={selectReadyOnly}
              className="px-2.5 py-1 rounded-md bg-[#FDF2F3] border border-[#EABAC0] hover:border-[#C6202F] text-[#891A23] font-medium cursor-pointer"
            >
              Select completed
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={clearAll}
              className="px-2.5 py-1 rounded-md bg-white border border-[#D8D8DF] hover:border-[#111114] text-[#5A5A66] cursor-pointer"
            >
              Clear
            </button>
          </div>
        </div>

        {/* Selectable Checklist with Individual Row Previews */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2.5 bg-white">
          {statuses.map((sec) => {
            const isChecked = selected.includes(sec.id);
            return (
              <div
                key={sec.id}
                className={`p-3.5 brand-corner-sm border transition-colors flex items-start gap-3 ${
                  isChecked
                    ? 'bg-[#FDF4F5] border-[#C6202F]/60'
                    : 'bg-[#FAFAFB] border-[#E2E2E6] hover:border-[#891A23]/50'
                }`}
              >
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => toggleSection(sec.id)}
                  className="flex-1 text-left flex items-start gap-3 cursor-pointer min-w-0"
                >
                  <div className="pt-0.5 shrink-0">
                    {isChecked ? (
                      <CheckSquare className="w-4 h-4 text-[#C6202F]" />
                    ) : (
                      <Square className="w-4 h-4 text-[#9A9AA6]" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[#111114]">
                        {sec.label}
                      </span>
                      <span
                        className={`text-[11px] font-mono tabular-nums ${
                          sec.status.ready ? 'text-[#15803D] font-semibold' : 'text-[#71717E]'
                        }`}
                      >
                        {sec.status.detail}
                      </span>
                    </div>
                    <p className="text-xs text-[#5A5A66] mt-1 leading-relaxed">
                      {sec.description}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPreviewTarget({ kind: 'section', sectionId: sec.id })}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-[#111114] bg-white border border-[#D8D8DF] hover:border-[#891A23] hover:text-[#891A23] rounded-md transition-colors shrink-0 cursor-pointer"
                  title={`Preview ${sec.label}`}
                >
                  <Eye className="w-3.5 h-3.5 text-[#891A23]" />
                  Preview
                </button>
              </div>
            );
          })}

          {errorMsg && (
            <div className="p-3 rounded-md bg-[#FDF2F3] border border-[#C6202F]/50 text-xs text-[#891A23] flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-md bg-emerald-50 border border-emerald-300 text-xs text-emerald-900 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
              <span>{successMsg}</span>
            </div>
          )}

          {driveStatus && driveStatus.status === 'saved' && (
            <div className="p-3 rounded-md bg-emerald-50 border border-emerald-300 text-xs text-emerald-900 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
                <span className="font-semibold text-emerald-950">Saved to Drive</span>
              </div>
              {driveStatus.folderUrl && (
                <a
                  href={driveStatus.folderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 hover:underline shrink-0"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Open on Drive
                </a>
              )}
            </div>
          )}

          {driveStatus && driveStatus.status === 'failed' && (
            <div className="p-3 rounded-md bg-amber-50 border border-amber-300 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0 flex-1">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <span className="leading-relaxed font-medium">{driveStatus.message}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Action Bar */}
        <div className="px-6 py-4 bg-[#F6F6F7] border-t border-[#E2E2E6] space-y-2.5 shrink-0">
          {/* Preview Row */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#E2E2E6]">
            <span className="text-[11px] font-semibold text-[#5A5A66] uppercase tracking-wider">
              Preview Before Download
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || selected.length === 0}
                onClick={() => handleOpenPacketPreview('combined')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#111114] bg-white border border-[#D8D8DF] hover:border-[#C6202F] disabled:opacity-40 rounded-md transition-colors cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5 text-[#891A23]" />
                Preview Master Book
              </button>
              <button
                type="button"
                disabled={busy || selected.length === 0}
                onClick={() => handleOpenPacketPreview('slideshow')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#111114] bg-white border border-[#D8D8DF] hover:border-[#111114] disabled:opacity-40 rounded-md transition-colors cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5 text-[#C6202F]" />
                Preview 16:9 Slideshow
              </button>
            </div>
          </div>

          {/* Download Row */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium text-[#5A5A66] hover:text-[#111114] cursor-pointer"
            >
              Close
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy || selected.length === 0}
                onClick={() => void handleDownload('individual')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-white border border-[#D8D8DF] hover:border-[#891A23] disabled:opacity-40 rounded-md transition-colors cursor-pointer"
              >
                {exportingMode === 'individual' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#C6202F]" />
                ) : (
                  <Files className="w-4 h-4 text-[#891A23]" />
                )}
                {exportingMode === 'individual'
                  ? 'Exporting PDFs...'
                  : `Individual (${selected.length})`}
              </button>

              <button
                type="button"
                disabled={busy || selected.length === 0}
                onClick={() => void handleDownload('slideshow')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#111114] hover:bg-[#27272E] border border-[#111114] disabled:opacity-40 brand-corner-sm transition-colors cursor-pointer"
              >
                {exportingMode === 'slideshow' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#F39CA4]" />
                ) : (
                  <Presentation className="w-4 h-4 text-[#C6202F]" />
                )}
                {exportingMode === 'slideshow'
                  ? 'Building Slideshow...'
                  : 'Slideshow (16:9 Landscape)'}
              </button>

              <button
                type="button"
                disabled={busy || selected.length === 0}
                onClick={() => void handleDownload('combined')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 brand-corner-sm transition-colors cursor-pointer shadow-xs"
              >
                {exportingMode === 'combined' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
                {exportingMode === 'combined' ? (
                  'Building Master PDF...'
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    1 Master PDF
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
