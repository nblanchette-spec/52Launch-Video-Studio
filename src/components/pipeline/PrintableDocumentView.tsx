import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Loader2,
  Printer,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Presentation,
  FileText,
  Image as ImageIcon,
  Package,
  Film,
  Mic2,
  Clock,
  MapPin,
  Wrench,
  Users,
  ShieldAlert,
  HelpCircle,
} from 'lucide-react';
import {
  PipelineProject,
  PipelineShot,
  ShotRoute,
} from '../../types/pipeline';
import {
  downloadMasterPdf,
  MASTER_PDF_SECTIONS,
  MasterPdfDriveStatus,
  MasterPdfSectionId,
} from '../../utils/pdfExporter';

export type PrintableTarget =
  | { kind: 'section'; sectionId: MasterPdfSectionId }
  | { kind: 'combined'; sections: MasterPdfSectionId[] }
  | { kind: 'slideshow'; sections: MasterPdfSectionId[] };

interface PrintableDocumentViewProps {
  project: PipelineProject;
  initialTarget: PrintableTarget;
  backLabel?: string;
  onBack: () => void;
}

function extractHexSwatches(text: string): string[] {
  const matches = (text || '').match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const valid = matches.filter((h) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h));
  return Array.from(new Set(valid.map((h) => h.toUpperCase()))).slice(0, 8);
}

function getAllBrandGraphics(project: PipelineProject): Array<{ url: string; caption: string }> {
  const b = project.brandBible;
  const list: Array<{ url: string; caption: string }> = [];
  const seen = new Set<string>();
  if (b?.brandLogoUrl) {
    seen.add(b.brandLogoUrl);
    list.push({
      url: b.brandLogoUrl,
      caption: b.brandLogoCaption || 'Primary Brand Logo',
    });
  }
  for (const g of b?.brandGraphics || []) {
    if (g.url && !seen.has(g.url)) {
      seen.add(g.url);
      list.push({ url: g.url, caption: g.caption || 'Brand Graphic' });
    }
  }
  return list;
}

function getRouteBadgeLabel(route: ShotRoute): string {
  if (route === 'live') return 'LIVE SHOOT';
  if (route === 'hybrid') return 'HYBRID';
  return 'AI';
}

function getRouteBadgeStyle(route: ShotRoute): string {
  if (route === 'live') return 'bg-emerald-50 text-emerald-900 border-emerald-300';
  if (route === 'hybrid') return 'bg-[#FDF2F3] text-[#891A23] border-[#EABAC0]';
  return 'bg-[#EFEFF2] text-[#111114] border-[#D8D8DF]';
}

function formatModelLabel(model: PipelineShot['model']): string {
  switch (model) {
    case 'flux3':
      return 'FLUX 3';
    case 'veo':
      return 'Google Veo 3.1';
    case 'omni':
      return 'Gemini Omni Flash';
    case 'kling':
      return 'Kling 4.0';
    case 'wan':
      return 'Wan 3.0 Prime';
    case 'luma':
      return 'Luma Ray 3.2';
    case 'none':
      return 'Live Camera';
    default:
      return 'Seedance';
  }
}

export const PrintableDocumentView: React.FC<PrintableDocumentViewProps> = ({
  project,
  initialTarget,
  backLabel = 'Back',
  onBack,
}) => {
  const [target, setTarget] = useState<PrintableTarget>(initialTarget);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [driveStatus, setDriveStatus] = useState<MasterPdfDriveStatus | null>(null);

  const selectedDeckSections = useMemo<MasterPdfSectionId[]>(() => {
    if (target.kind === 'combined' || target.kind === 'slideshow') {
      return target.sections;
    }
    return initialTarget.kind !== 'section'
      ? initialTarget.sections
      : MASTER_PDF_SECTIONS.map((s) => s.id);
  }, [target, initialTarget]);

  const activeSectionsToRender: MasterPdfSectionId[] = useMemo(() => {
    if (target.kind === 'section') return [target.sectionId];
    return target.sections;
  }, [target]);

  const currentMeta = useMemo(() => {
    if (target.kind === 'section') {
      return MASTER_PDF_SECTIONS.find((m) => m.id === target.sectionId);
    }
    return null;
  }, [target]);

  const totalSec = useMemo(
    () => project.shots.reduce((sum, s) => sum + (Number(s.durationSec) || 0), 0),
    [project.shots]
  );

  const handleDownloadPdf = async () => {
    setDownloadError(null);
    setDriveStatus(null);
    setIsDownloading(true);
    try {
      let result;
      if (target.kind === 'section') {
        result = await downloadMasterPdf(project, [target.sectionId], 'individual');
      } else if (target.kind === 'slideshow') {
        result = await downloadMasterPdf(project, target.sections, 'slideshow');
      } else {
        result = await downloadMasterPdf(project, target.sections, 'combined');
      }
      if (result.driveStatus.status === 'saved' || result.driveStatus.status === 'failed') {
        setDriveStatus(result.driveStatus);
      }
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Could not generate PDF.');
    } finally {
      setIsDownloading(false);
    }
  };

  const docTitle =
    target.kind === 'slideshow'
      ? '16:9 Presentation Slideshow Deck'
      : target.kind === 'combined'
        ? `Master Production Book (${target.sections.length} Deliverables)`
        : currentMeta?.label || 'Production Deliverable';

  const downloadButtonLabel = isDownloading
    ? 'Generating PDF...'
    : target.kind === 'slideshow'
      ? 'Download 16:9 Slideshow PDF'
      : target.kind === 'combined'
        ? 'Download Master Book PDF'
        : `Download ${currentMeta?.label || ''} PDF`;

  // Renderers for each section in Portrait Document mode
  const renderSectionContent = (sectionId: MasterPdfSectionId) => {
    switch (sectionId) {
      case 'brandBible': {
        const b = project.brandBible;
        const graphics = getAllBrandGraphics(project);
        const swatches = extractHexSwatches(b.visualStyle?.palette || '');
        if (!b.hasGenerated && !b.positioning) {
          return (
            <p className="text-xs text-[#5A5A66] italic">
              Brand Bible has not been generated yet for this project.
            </p>
          );
        }
        return (
          <div className="space-y-5">
            {(graphics.length > 0 || project.product.photos.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#FAFAFB] border border-[#E2E2E6] rounded-md p-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#5A5A66] mb-2">
                    Brand Logos &amp; Graphics ({graphics.length})
                  </div>
                  {graphics.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2.5">
                      {graphics.slice(0, 4).map((g, i) => (
                        <div key={i} className="bg-white border border-[#E2E2E6] rounded p-2 text-center">
                          <img
                            src={g.url}
                            alt={g.caption}
                            className="h-20 w-full object-contain mx-auto"
                          />
                          <div className="text-[10px] text-[#5A5A66] mt-1 truncate">{g.caption}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-[#71717E] italic">No logo attached</div>
                  )}
                </div>

                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[#5A5A66] mb-2">
                    Product Reference Photos ({project.product.photos.length})
                  </div>
                  {project.product.photos.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2.5">
                      {project.product.photos.slice(0, 4).map((p) => (
                        <div key={p.id} className="bg-white border border-[#E2E2E6] rounded p-2 text-center">
                          <img
                            src={p.url}
                            alt={p.caption}
                            className="h-20 w-full object-contain mx-auto"
                          />
                          <div className="text-[10px] text-[#5A5A66] mt-1 truncate">{p.caption || 'Product'}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-[#71717E] italic">No product photos attached</div>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-[#DCDCE2] rounded-md p-4 space-y-1.5 bg-white">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                  Brand Positioning
                </div>
                <p className="text-xs text-[#2E2E36] leading-relaxed whitespace-pre-line">
                  {b.positioning || '—'}
                </p>
              </div>
              <div className="border border-[#DCDCE2] rounded-md p-4 space-y-1.5 bg-white">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                  Target Audience
                </div>
                <p className="text-xs text-[#2E2E36] leading-relaxed whitespace-pre-line">
                  {b.audience || '—'}
                </p>
              </div>
            </div>

            <div className="border border-[#E2C2C6] bg-[#FAF6F7] rounded-md p-4 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                Tone of Voice
              </div>
              <div className="text-xs font-semibold text-[#111114]">
                Adjectives: {b.toneOfVoice.adjectives.join('  |  ') || 'Not specified'}
              </div>
              <p className="text-xs text-[#3A3A44] leading-relaxed">{b.toneOfVoice.guidance || '—'}</p>
            </div>

            <div className="border border-[#DCDCE2] rounded-md p-4 space-y-3 bg-white">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                Visual Style, Palette &amp; Typography
              </div>
              {swatches.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {swatches.map((hex) => (
                    <div
                      key={hex}
                      className="inline-flex items-center gap-2 px-2.5 py-1 rounded border border-[#E2E2E6] bg-[#FAFAFB] text-[11px] font-mono font-bold text-[#111114]"
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-xs border border-black/15 shrink-0"
                        style={{ backgroundColor: hex }}
                      />
                      {hex}
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="font-semibold text-[#111114]">Color Palette: </span>
                  <span className="text-[#3A3A44]">{b.visualStyle.palette || '—'}</span>
                </div>
                <div>
                  <span className="font-semibold text-[#111114]">Typography: </span>
                  <span className="text-[#3A3A44]">{b.visualStyle.typography || '—'}</span>
                </div>
                <div>
                  <span className="font-semibold text-[#111114]">Lighting: </span>
                  <span className="text-[#3A3A44]">{b.visualStyle.lighting || '—'}</span>
                </div>
                <div>
                  <span className="font-semibold text-[#111114]">Lens &amp; Framing: </span>
                  <span className="text-[#3A3A44]">{b.visualStyle.lensAndFraming || '—'}</span>
                </div>
                <div className="sm:col-span-2">
                  <span className="font-semibold text-[#111114]">Color Grade: </span>
                  <span className="text-[#3A3A44]">{b.visualStyle.grade || '—'}</span>
                </div>
              </div>
            </div>

            {b.characters.length > 0 && (
              <div className="border border-[#DCDCE2] rounded-md p-4 space-y-2 bg-white">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                  Recurring Characters ({b.characters.length})
                </div>
                <ul className="space-y-1.5 text-xs text-[#2E2E36]">
                  {b.characters.map((c) => (
                    <li key={c.id}>
                      <strong>{c.name}:</strong> {c.fixedDescriptor}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="border border-[#DCDCE2] rounded-md p-4 space-y-1.5 bg-white">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                Product Fidelity Rules
              </div>
              <p className="text-xs text-[#2E2E36] leading-relaxed whitespace-pre-line">
                {b.productRules || '—'}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-emerald-200 bg-emerald-50/50 rounded-md p-4 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                  Claims Allowed ({b.claimsAllowed.length})
                </div>
                <ul className="list-disc pl-4 space-y-1 text-xs text-emerald-950">
                  {b.claimsAllowed.length > 0 ? (
                    b.claimsAllowed.map((c, i) => <li key={i}>{c}</li>)
                  ) : (
                    <li className="italic">None listed</li>
                  )}
                </ul>
              </div>
              <div className="border border-amber-200 bg-amber-50/50 rounded-md p-4 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-900">
                  Claims Flagged ({b.claimsToFlag.length})
                </div>
                <ul className="list-disc pl-4 space-y-1 text-xs text-amber-950">
                  {b.claimsToFlag.length > 0 ? (
                    b.claimsToFlag.map((c, i) => <li key={i}>{c}</li>)
                  ) : (
                    <li className="italic">None flagged</li>
                  )}
                </ul>
              </div>
              <div className="border border-rose-200 bg-rose-50/50 rounded-md p-4 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-rose-900">
                  Banned List ({b.bannedList.length})
                </div>
                <ul className="list-disc pl-4 space-y-1 text-xs text-rose-950">
                  {b.bannedList.length > 0 ? (
                    b.bannedList.map((c, i) => <li key={i}>{c}</li>)
                  ) : (
                    <li className="italic">None specified</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        );
      }

      case 'creativeBrief': {
        const br = project.creativeBrief;
        if (!br.hasGenerated && !br.objective) {
          return (
            <p className="text-xs text-[#5A5A66] italic">
              Creative Brief has not been generated yet for this project.
            </p>
          );
        }
        return (
          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-[#DCDCE2] rounded-md p-4 space-y-1.5 bg-white">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                  Campaign Objective
                </div>
                <p className="text-xs text-[#2E2E36] leading-relaxed">{br.objective || '—'}</p>
              </div>
              <div className="border border-[#DCDCE2] rounded-md p-4 space-y-1.5 bg-white">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                  Core Key Message
                </div>
                <p className="text-xs font-semibold text-[#111114] leading-relaxed">
                  {br.keyMessage || '—'}
                </p>
              </div>
            </div>

            <div className="border border-[#EABAC0] bg-[#FDF4F5] rounded-md p-4 space-y-1.5">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                Recommended Creative Concept
              </div>
              <div className="text-sm font-bold text-[#111114]">
                {br.recommendedConcept.title || '—'}
              </div>
              <p className="text-xs text-[#3A3A44] leading-relaxed">
                {br.recommendedConcept.reason || '—'}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="border border-[#DCDCE2] rounded-md p-4 space-y-1.5 bg-white">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                  Deliverables ({br.deliverables.length})
                </div>
                <ul className="list-disc pl-4 space-y-1 text-xs text-[#2E2E36]">
                  {br.deliverables.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
              <div className="border border-[#E2C2C6] bg-[#FAF6F7] rounded-md p-4 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                  Voiceover Direction
                </div>
                <div className="text-xs text-[#2E2E36] space-y-1">
                  <div>
                    <strong>Speaker:</strong> {br.voDirection.speaker || '—'}
                  </div>
                  <div>
                    <strong>Pace:</strong> {br.voDirection.pace || '—'}
                  </div>
                  <div>
                    <strong>Emotional Arc:</strong> {br.voDirection.emotionalArc || '—'}
                  </div>
                </div>
              </div>
              <div className="border border-emerald-200 bg-emerald-50/50 rounded-md p-4 space-y-1.5">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-900">
                  Claims Verification
                </div>
                <p className="text-xs text-emerald-950 leading-relaxed">
                  {br.claimsCheck || '—'}
                </p>
              </div>
            </div>

            {br.concepts.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[#891A23]">
                  Explored Creative Concepts ({br.concepts.length})
                </div>
                <div className="overflow-x-auto rounded border border-[#E2E2E6]">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="bg-[#111114] text-white text-[10px] uppercase font-bold tracking-wider">
                        <th className="py-2 px-3">Concept</th>
                        <th className="py-2 px-3">Logline</th>
                        <th className="py-2 px-3">Why It Works</th>
                        <th className="py-2 px-3">Risks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E2E6]">
                      {br.concepts.map((c, idx) => (
                        <tr key={c.id} className={idx % 2 === 1 ? 'bg-[#FAFBFD]' : 'bg-white'}>
                          <td className="py-2 px-3 font-semibold text-[#111114]">{c.title}</td>
                          <td className="py-2 px-3 text-[#2E2E36]">{c.logline}</td>
                          <td className="py-2 px-3 text-[#2E2E36]">{c.whyItWorks}</td>
                          <td className="py-2 px-3 text-[#5A5A66]">{c.risks}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'shotListAndStoryboard': {
        if (project.shots.length === 0) {
          return <p className="text-xs text-[#5A5A66] italic">No shots defined yet.</p>;
        }
        return (
          <div className="space-y-5">
            <div className="overflow-x-auto rounded border border-[#E2E2E6]">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[#111114] text-white text-[10px] uppercase font-bold tracking-wider">
                    <th className="py-2 px-3">Shot</th>
                    <th className="py-2 px-3">Route</th>
                    <th className="py-2 px-3">Engine</th>
                    <th className="py-2 px-3">Dur</th>
                    <th className="py-2 px-3">Deliverable</th>
                    <th className="py-2 px-3">Scene Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E2E6]">
                  {project.shots.map((shot, idx) => (
                    <tr key={shot.id} className={idx % 2 === 1 ? 'bg-[#FAFBFD]' : 'bg-white'}>
                      <td className="py-2 px-3 font-mono font-bold text-[#111114]">{shot.id}</td>
                      <td className="py-2 px-3">{getRouteBadgeLabel(shot.route)}</td>
                      <td className="py-2 px-3">{formatModelLabel(shot.model)}</td>
                      <td className="py-2 px-3 font-mono tabular-nums">{shot.durationSec}s</td>
                      <td className="py-2 px-3">{shot.deliverable}</td>
                      <td className="py-2 px-3 text-[#2E2E36]">{shot.scene}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-4">
              {project.shots.map((shot) => (
                <div
                  key={shot.id}
                  className="print-avoid-break border border-[#DCDCE2] rounded-md overflow-hidden bg-white"
                >
                  <div className="px-4 py-2 bg-[#F6F6F7] border-b border-[#E2E2E6] flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono font-bold text-[#111114] text-sm">{shot.id}</span>
                      <span
                        className={`px-2 py-0.5 rounded border text-[11px] font-bold ${getRouteBadgeStyle(shot.route)}`}
                      >
                        {getRouteBadgeLabel(shot.route)}
                      </span>
                      <span className="text-[#4A4A55] font-medium">{formatModelLabel(shot.model)}</span>
                      <span className="text-[#5A5A66]">· {shot.deliverable}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      {shot.productInFrame && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#FDF2F3] border border-[#EABAC0] text-[#891A23] text-[10px] font-bold">
                          <Package className="w-3 h-3" />
                          PRODUCT IN FRAME
                        </span>
                      )}
                      <span className="font-mono font-semibold text-[#111114] tabular-nums">
                        {shot.durationSec}s
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-[300px_1fr]">
                    <div className="aspect-video bg-[#111114] border-b md:border-b-0 md:border-r border-[#E2E2E6] flex items-center justify-center overflow-hidden">
                      {shot.frameImageUrl ? (
                        <img
                          src={shot.frameImageUrl}
                          alt={`Shot ${shot.id}`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center text-white/60 p-4 space-y-1">
                          <ImageIcon className="w-5 h-5 mx-auto" />
                          <div className="text-[11px]">Frame pending</div>
                        </div>
                      )}
                    </div>
                    <div className="p-4 space-y-2 text-xs">
                      <div>
                        <span className="font-bold text-[#111114]">Scene: </span>
                        <span className="text-[#2E2E36]">{shot.scene || '—'}</span>
                      </div>
                      {shot.framePrompt && (
                        <div>
                          <span className="font-bold text-[#5A5A66]">Frame Prompt: </span>
                          <span className="text-[#3A3A44]">{shot.framePrompt}</span>
                        </div>
                      )}
                      {shot.shootDirection && (
                        <div>
                          <span className="font-bold text-emerald-900">Shoot Direction: </span>
                          <span className="text-[#3A3A44]">{shot.shootDirection}</span>
                        </div>
                      )}
                      {shot.voLine && (
                        <div>
                          <span className="font-bold text-[#891A23]">VO Line: </span>
                          <span className="italic text-[#111114]">&ldquo;{shot.voLine}&rdquo;</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      }

      case 'frameSuggestions': {
        const checkedOrFramed = project.shots.filter(
          (s) => Boolean(s.frameCheck) || Boolean(s.frameImageUrl)
        );
        if (checkedOrFramed.length === 0) {
          return (
            <p className="text-xs text-[#5A5A66] italic">
              No frames or Vision QA reviews available yet.
            </p>
          );
        }
        return (
          <div className="space-y-4">
            {checkedOrFramed.map((shot) => {
              const fc = shot.frameCheck;
              return (
                <div
                  key={shot.id}
                  className="print-avoid-break border border-[#DCDCE2] rounded-md overflow-hidden bg-white grid grid-cols-1 md:grid-cols-[260px_1fr]"
                >
                  <div className="aspect-video bg-[#111114] border-b md:border-b-0 md:border-r border-[#E2E2E6] flex items-center justify-center overflow-hidden">
                    {shot.frameImageUrl ? (
                      <img
                        src={shot.frameImageUrl}
                        alt={`Shot ${shot.id}`}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-white/60">No frame uploaded</span>
                    )}
                  </div>
                  <div className="p-4 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-mono font-bold text-sm text-[#111114]">{shot.id}</span>
                      {fc ? (
                        <span
                          className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                            fc.passed
                              ? 'bg-emerald-100 text-emerald-900'
                              : 'bg-amber-100 text-amber-900'
                          }`}
                        >
                          {fc.passed ? 'QA PASSED' : 'NEEDS REVISION'}
                        </span>
                      ) : (
                        <span className="text-[#71717E]">Not QA checked yet</span>
                      )}
                    </div>
                    {fc && (
                      <>
                        <div className="flex flex-wrap gap-3 font-mono text-[11px] text-[#3A3A44]">
                          <span>Character: {fc.scores.characterMatch}/10</span>
                          <span>Style: {fc.scores.styleMatch}/10</span>
                          <span>Composition: {fc.scores.compositionMatch}/10</span>
                          <span>Artifacts: {fc.scores.artifacts}/10</span>
                          {fc.scores.productFidelity !== null && (
                            <span>Product Fidelity: {fc.scores.productFidelity}/10</span>
                          )}
                        </div>
                        {fc.problems.length > 0 && (
                          <div>
                            <div className="font-bold text-[#891A23]">Detected Issues:</div>
                            <ul className="list-disc pl-4 text-[#2E2E36]">
                              {fc.problems.map((p, idx) => (
                                <li key={idx}>{p}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {fc.improvedFramePrompt && (
                          <div className="bg-[#FAF6F7] border border-[#EABAC0] rounded p-2.5">
                            <div className="font-bold text-[#891A23] text-[11px]">
                              Suggested Improved Prompt:
                            </div>
                            <div className="text-[#111114] mt-0.5">{fc.improvedFramePrompt}</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      }

      case 'videoPromptsAndVideo': {
        const aiShots = project.shots.filter((s) => s.route !== 'live');
        if (aiShots.length === 0) {
          return (
            <p className="text-xs text-[#5A5A66] italic">
              No AI or Hybrid video shots configured in this project.
            </p>
          );
        }
        return (
          <div className="space-y-4">
            {aiShots.map((shot) => (
              <div
                key={shot.id}
                className="print-avoid-break border border-[#DCDCE2] rounded-md overflow-hidden bg-white grid grid-cols-1 md:grid-cols-[240px_1fr]"
              >
                <div className="aspect-video bg-[#111114] border-b md:border-b-0 md:border-r border-[#E2E2E6] flex items-center justify-center overflow-hidden">
                  {shot.frameImageUrl ? (
                    <img
                      src={shot.frameImageUrl}
                      alt={`Shot ${shot.id}`}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Film className="w-6 h-6 text-white/50" />
                  )}
                </div>
                <div className="p-4 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-[#111114]">{shot.id}</span>
                      <span className="text-[#5A5A66] font-medium">
                        {formatModelLabel(shot.model)} · {shot.durationSec}s
                      </span>
                    </div>
                    {shot.videoSeed !== null && (
                      <span className="font-mono text-[11px] text-[#5A5A66]">
                        Seed: {shot.videoSeed}
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="font-bold text-[#111114]">Motion Prompt</div>
                    <p className="text-[#2E2E36] mt-0.5">{shot.videoPrompt || 'Not written yet.'}</p>
                  </div>
                  {shot.negativePrompt && (
                    <div>
                      <span className="font-bold text-[#5A5A66]">Negative Prompt: </span>
                      <span className="text-[#5A5A66]">{shot.negativePrompt}</span>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] font-mono">
                    <span>
                      Rendered Clip:{' '}
                      <strong className={shot.videoUrl ? 'text-emerald-700' : 'text-[#71717E]'}>
                        {shot.videoUrl ? 'Ready' : 'Not rendered'}
                      </strong>
                    </span>
                    {shot.upscaledVideoUrl && (
                      <span className="text-[#891A23] font-bold">
                        Topaz Upscaled ({shot.upscaledResolution || '4K'})
                      </span>
                    )}
                    {shot.videoHistory && shot.videoHistory.length > 0 && (
                      <span className="text-[#5A5A66]">
                        Takes saved: {shot.videoHistory.length}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      }

      case 'voScript': {
        if (project.voScript.length === 0) {
          return (
            <p className="text-xs text-[#5A5A66] italic">
              Voiceover script has not been written yet.
            </p>
          );
        }
        return (
          <div className="space-y-4">
            {project.voSettings && (
              <div className="border border-[#E2C2C6] bg-[#FAF6F7] rounded-md p-4 flex flex-wrap items-center gap-4 text-xs">
                <span className="inline-flex items-center gap-1.5 font-bold text-[#891A23]">
                  <Mic2 className="w-4 h-4" />
                  Voice Cast: {project.voSettings.voiceName}
                </span>
                <span>Tone: <strong>{project.voSettings.emotionalTone}</strong></span>
                <span>Speed: <strong>{project.voSettings.speed}x</strong></span>
                <span>Language: <strong>{project.voSettings.language}</strong></span>
              </div>
            )}
            <div className="overflow-x-auto rounded border border-[#E2E2E6]">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="bg-[#111114] text-white text-[10px] uppercase font-bold tracking-wider">
                    <th className="py-2 px-3">Shot</th>
                    <th className="py-2 px-3">Speaker</th>
                    <th className="py-2 px-3">Spoken Script Line</th>
                    <th className="py-2 px-3">Delivery &amp; Audio Tags</th>
                    <th className="py-2 px-3">Est</th>
                    <th className="py-2 px-3">Audio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E2E6]">
                  {project.voScript.map((line, idx) => (
                    <tr key={line.id} className={idx % 2 === 1 ? 'bg-[#FAFBFD]' : 'bg-white'}>
                      <td className="py-2.5 px-3 font-mono font-bold text-[#891A23]">
                        {line.shotId}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-[#111114]">{line.speaker}</td>
                      <td className="py-2.5 px-3 text-[#111114]">&ldquo;{line.line}&rdquo;</td>
                      <td className="py-2.5 px-3 text-[#5A5A66]">
                        {line.direction}
                        {line.audioTags ? ` · [${line.audioTags}]` : ''}
                      </td>
                      <td className="py-2.5 px-3 font-mono tabular-nums whitespace-nowrap">
                        {line.durationSec ? `${line.durationSec}s` : '—'}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {line.audioUrl ? 'Synthesized' : 'Draft'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case 'shootPlan': {
        const plan = project.shootPlan;
        if (!plan?.hasGenerated && plan.shootDays.length === 0) {
          return (
            <p className="text-xs text-[#5A5A66] italic">
              Shoot Plan &amp; Call Sheet have not been generated yet.
            </p>
          );
        }
        return (
          <div className="space-y-5">
            {plan.shootDays.map((day) => (
              <div
                key={day.id}
                className="print-avoid-break border border-[#DCDCE2] rounded-md p-4 space-y-3 bg-white"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ECECF0] pb-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-[#111114]">{day.dayLabel}</span>
                    <span className="inline-flex items-center gap-1 text-[#3A3A44]">
                      <MapPin className="w-3.5 h-3.5 text-[#891A23]" />
                      {day.location}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] tabular-nums">
                    <span className="bg-[#F6F6F7] px-2 py-0.5 rounded border border-[#E2E2E6]">
                      Call: <strong>{day.callTime}</strong>
                    </span>
                    <span className="bg-[#FDF4F5] px-2 py-0.5 rounded border border-[#EABAC0] text-[#891A23]">
                      Lunch: <strong>{day.lunchTime || '12:30 PM'}</strong>
                    </span>
                    <span className="bg-[#F6F6F7] px-2 py-0.5 rounded border border-[#E2E2E6]">
                      Wrap: <strong>{day.wrapTime}</strong>
                    </span>
                  </div>
                </div>

                {day.scheduleBreakdown && day.scheduleBreakdown.length > 0 && (
                  <div className="overflow-x-auto rounded border border-[#E2E2E6]">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="bg-[#111114] text-white text-[10px] uppercase font-bold tracking-wider">
                          <th className="py-2 px-3">Time</th>
                          <th className="py-2 px-3">Activity</th>
                          <th className="py-2 px-3">Shots</th>
                          <th className="py-2 px-3">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E2E2E6]">
                        {day.scheduleBreakdown.map((blk, i) => (
                          <tr
                            key={i}
                            className={
                              blk.category === 'meal'
                                ? 'bg-[#FDF4F5] font-semibold text-[#891A23]'
                                : i % 2 === 1
                                  ? 'bg-[#FAFBFD]'
                                  : 'bg-white'
                            }
                          >
                            <td className="py-2 px-3 font-mono whitespace-nowrap">{blk.timeSlot}</td>
                            <td className="py-2 px-3">{blk.activity}</td>
                            <td className="py-2 px-3 font-mono">{(blk.shotIds || []).join(', ') || '—'}</td>
                            <td className="py-2 px-3 text-[#5A5A66]">{blk.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {day.setups.length > 0 && (
                  <div className="space-y-1.5">
                    {day.setups.map((st, sIdx) => (
                      <div
                        key={sIdx}
                        className="text-xs bg-[#FAFAFB] border border-[#E8E8EE] rounded p-2.5"
                      >
                        <div className="font-bold text-[#111114] flex items-center justify-between">
                          <span>
                            {st.setupName} — <span className="font-mono text-[#891A23]">{st.shotIds.join(', ')}</span>
                          </span>
                          <span className="font-mono text-[#5A5A66]">{st.estimatedMinutes}m</span>
                        </div>
                        <p className="text-[#3A3A44] mt-0.5">{st.lightingNotes}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-[#DCDCE2] rounded-md p-4 space-y-2 bg-white">
                <div className="text-xs font-bold uppercase tracking-wider text-[#891A23] flex items-center gap-1.5">
                  <Wrench className="w-3.5 h-3.5" />
                  Equipment ({plan.equipment.length})
                </div>
                <ul className="list-disc pl-4 space-y-1 text-xs text-[#2E2E36]">
                  {plan.equipment.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
              <div className="border border-[#DCDCE2] rounded-md p-4 space-y-2 bg-white">
                <div className="text-xs font-bold uppercase tracking-wider text-[#891A23] flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  Crew ({plan.crew.length})
                </div>
                <ul className="list-disc pl-4 space-y-1 text-xs text-[#2E2E36]">
                  {plan.crew.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>

            {plan.propsAndUnits.length > 0 && (
              <div className="border border-[#DCDCE2] rounded-md p-4 space-y-2 bg-white">
                <div className="text-xs font-bold uppercase tracking-wider text-[#891A23]">
                  Props &amp; Product Units ({plan.propsAndUnits.length})
                </div>
                <ul className="space-y-1.5 text-xs text-[#2E2E36]">
                  {plan.propsAndUnits.map((p, i) => (
                    <li key={i} className="flex items-center justify-between border-b border-[#F2F2F5] pb-1">
                      <span><strong>{p.item}</strong> — Qty: {p.quantity}</span>
                      <span className="font-mono text-[#5A5A66]">{p.suppliedBy}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(plan.clientQuestions.length > 0 || plan.risks.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {plan.clientQuestions.length > 0 && (
                  <div className="border border-[#EABAC0] bg-[#FDF4F5] rounded-md p-4 space-y-1.5">
                    <div className="text-xs font-bold uppercase tracking-wider text-[#891A23] flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5" />
                      Client Questions
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-xs text-[#2E2E36]">
                      {plan.clientQuestions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {plan.risks.length > 0 && (
                  <div className="border border-rose-300 bg-rose-50/50 rounded-md p-4 space-y-1.5">
                    <div className="text-xs font-bold uppercase tracking-wider text-rose-900 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Production Risks
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-xs text-rose-950">
                      {plan.risks.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }
    }
  };

  return (
    <div className="max-w-[1100px] mx-auto px-6 py-7 space-y-5 print-only-full">
      {/* Screen Toolbar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#E2E2E6]">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[#891A23] uppercase tracking-wider">
            Printable Preview · {docTitle}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1 truncate">
            {project.client} — {project.product.name}
          </h1>
          <p className="text-xs text-[#5A5A66] mt-1">
            Review layout, visual assets, and copy before downloading PDF or saving to Google Drive.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-white border border-[#D8D8DF] hover:border-[#891A23] rounded-md transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {backLabel}
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#111114] bg-white border border-[#D8D8DF] hover:border-[#891A23] rounded-md transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-[#891A23]" />
            Print
          </button>

          <button
            type="button"
            disabled={isDownloading}
            onClick={() => void handleDownloadPdf()}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-50 brand-corner-sm transition-colors cursor-pointer shadow-xs"
          >
            {isDownloading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {downloadButtonLabel}
          </button>
        </div>
      </div>

      {/* Quick Preview Mode / Deliverable Switcher */}
      <div className="no-print flex flex-wrap items-center gap-1.5 bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg p-2">
        {MASTER_PDF_SECTIONS.map((sec) => {
          const isActive = target.kind === 'section' && target.sectionId === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => {
                setDownloadError(null);
                setDriveStatus(null);
                setTarget({ kind: 'section', sectionId: sec.id });
              }}
              className={`px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#111114] text-white font-semibold'
                  : 'bg-white text-[#3A3A44] border border-[#E2E2E6] hover:border-[#891A23]'
              }`}
            >
              {sec.label}
            </button>
          );
        })}

        <span className="h-4 w-[1px] bg-[#D8D8DF] mx-1" aria-hidden="true" />

        <button
          type="button"
          onClick={() => {
            setDownloadError(null);
            setDriveStatus(null);
            setTarget({ kind: 'combined', sections: selectedDeckSections });
          }}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
            target.kind === 'combined'
              ? 'bg-[#C6202F] text-white'
              : 'bg-white text-[#891A23] border border-[#EABAC0] hover:border-[#C6202F]'
          }`}
        >
          <FileText className="w-3 h-3" />
          Master Book
        </button>

        <button
          type="button"
          onClick={() => {
            setDownloadError(null);
            setDriveStatus(null);
            setTarget({ kind: 'slideshow', sections: selectedDeckSections });
          }}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
            target.kind === 'slideshow'
              ? 'bg-[#111114] text-white'
              : 'bg-white text-[#111114] border border-[#D8D8DF] hover:border-[#111114]'
          }`}
        >
          <Presentation className="w-3 h-3 text-[#C6202F]" />
          16:9 Slideshow
        </button>
      </div>

      {downloadError && (
        <div className="no-print p-3 rounded-md bg-[#FDF2F3] border border-[#C6202F]/50 text-xs text-[#891A23] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{downloadError}</span>
        </div>
      )}

      {driveStatus && driveStatus.status === 'saved' && (
        <div className="no-print p-3 rounded-md bg-emerald-50 border border-emerald-300 text-xs text-emerald-900 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="font-semibold">Saved PDF copy to Google Drive</span>
          </div>
          {driveStatus.folderUrl && (
            <a
              href={driveStatus.folderUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-emerald-800 hover:underline"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open on Drive
            </a>
          )}
        </div>
      )}

      {driveStatus && driveStatus.status === 'failed' && (
        <div className="no-print p-3 rounded-md bg-amber-50 border border-amber-300 text-xs text-amber-950 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span>{driveStatus.message}</span>
        </div>
      )}

      {/* Printable Preview Canvas */}
      {target.kind === 'slideshow' ? (
        <div className="space-y-6">
          {/* Hero 16:9 Title Slide */}
          <div className="aspect-[16/9] bg-[#111114] text-white border border-[#24242C] brand-corner p-8 md:p-10 flex flex-col justify-between shadow-sm">
            <div className="flex items-center justify-between border-b border-white/15 pb-4">
              <img src="/brand/logo-badge-burgundy.png" alt="52Launch" className="h-11 w-auto object-contain" />
              <span className="text-[11px] font-mono uppercase tracking-widest text-[#F39CA4]">
                Slide 01 · 16:9 Presentation Deck
              </span>
            </div>
            <div className="space-y-3 my-auto">
              <div className="text-xs font-bold uppercase tracking-widest text-[#F39CA4]">
                52Launch Production Studio · Concept to Reality
              </div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                {project.client} — {project.product.name}
              </h2>
              <p className="text-sm text-white/75 max-w-2xl">
                {project.creativeBrief.objective || project.product.description || 'Production presentation deck'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-white/15 pt-4 text-xs font-mono text-white/75">
              <span>{project.shots.length} Shots · {totalSec}s Total Runtime</span>
              <span>{project.voScript.length} VO Lines · {project.shootPlan?.shootDays.length || 0} Shoot Day(s)</span>
            </div>
          </div>

          {activeSectionsToRender.map((secId, idx) => {
            const secMeta = MASTER_PDF_SECTIONS.find((m) => m.id === secId);
            return (
              <div
                key={secId}
                className="print-avoid-break bg-white text-[#111114] border border-[#DCDCE2] brand-corner p-6 md:p-8 space-y-5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-4 border-b-2 border-[#C6202F] pb-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-[#891A23]">
                      Slide {String(idx + 2).padStart(2, '0')} · {secMeta?.label || secId}
                    </div>
                    <h3 className="text-xl font-bold text-[#111114] mt-0.5">
                      {secMeta?.description || secMeta?.label}
                    </h3>
                  </div>
                  <img src="/brand/logo-primary.png" alt="52Launch" className="h-9 w-auto object-contain shrink-0" />
                </div>
                {renderSectionContent(secId)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white text-[#111114] border border-[#E2E2E6] brand-corner p-7 md:p-8 space-y-7 shadow-sm print:border-0 print:shadow-none print:p-0">
          {/* Light-Mode Document Cover Header */}
          <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-[#C6202F] pb-4">
            <div className="flex items-center gap-4 min-w-0">
              <img
                src="/brand/logo-primary.png"
                alt="52Launch"
                className="h-12 w-auto object-contain shrink-0"
              />
              <div className="min-w-0">
                <div className="text-[11px] font-bold tracking-wider text-[#891A23] uppercase">
                  52Launch Production Studio · {docTitle}
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
            <div className="text-right text-xs font-mono text-[#3A3A44] tabular-nums shrink-0">
              <div>{project.shots.length} Shots · {totalSec}s Runtime</div>
              <div>{new Date().toLocaleDateString()}</div>
            </div>
          </div>

          {/* Combined Packet KPIs & Table of Contents */}
          {target.kind === 'combined' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-[#F8F8FA] border border-[#DEDEE4] rounded p-3">
                  <div className="text-[10px] font-bold uppercase text-[#6A6A76]">Shots &amp; Runtime</div>
                  <div className="text-sm font-bold text-[#111114] mt-0.5 font-mono tabular-nums">
                    {project.shots.length} Shots · {totalSec}s
                  </div>
                </div>
                <div className="bg-[#F8F8FA] border border-[#DEDEE4] rounded p-3">
                  <div className="text-[10px] font-bold uppercase text-[#6A6A76]">VO Lines</div>
                  <div className="text-sm font-bold text-[#111114] mt-0.5 font-mono tabular-nums">
                    {project.voScript.length} Lines
                  </div>
                </div>
                <div className="bg-[#F8F8FA] border border-[#DEDEE4] rounded p-3">
                  <div className="text-[10px] font-bold uppercase text-[#6A6A76]">Shoot Days</div>
                  <div className="text-sm font-bold text-[#111114] mt-0.5 font-mono tabular-nums">
                    {project.shootPlan?.shootDays.length ?? 0} Day(s)
                  </div>
                </div>
                <div className="bg-[#F8F8FA] border border-[#DEDEE4] rounded p-3">
                  <div className="text-[10px] font-bold uppercase text-[#6A6A76]">Included Sections</div>
                  <div className="text-sm font-bold text-[#111114] mt-0.5 font-mono tabular-nums">
                    {target.sections.length} Deliverables
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded border border-[#E2E2E6]">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="bg-[#111114] text-white text-[10px] uppercase font-bold tracking-wider">
                      <th className="py-2 px-3 w-12 text-center">#</th>
                      <th className="py-2 px-3">Deliverable Section</th>
                      <th className="py-2 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E2E2E6]">
                    {target.sections.map((id, i) => {
                      const secMeta = MASTER_PDF_SECTIONS.find((m) => m.id === id);
                      return (
                        <tr key={id} className={i % 2 === 1 ? 'bg-[#FAFBFD]' : 'bg-white'}>
                          <td className="py-2 px-3 text-center font-mono font-bold text-[#891A23]">
                            {String(i + 1).padStart(2, '0')}
                          </td>
                          <td className="py-2 px-3 font-semibold text-[#111114]">{secMeta?.label || id}</td>
                          <td className="py-2 px-3 text-[#5A5A66]">
                            {secMeta ? secMeta.getStatus(project).detail : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Render Each Deliverable Section */}
          {activeSectionsToRender.map((secId, sIdx) => {
            const secMeta = MASTER_PDF_SECTIONS.find((m) => m.id === secId);
            return (
              <div
                key={secId}
                className={sIdx > 0 ? 'pt-6 border-t-2 border-[#EAEAEF] space-y-4' : 'space-y-4'}
              >
                <div className="flex items-center gap-2.5 bg-[#F1F1F5] border border-[#DEDEE4] rounded px-3.5 py-2.5">
                  <span className="px-2 py-0.5 rounded bg-[#C6202F] text-white font-mono text-[10px] font-bold uppercase tracking-wider">
                    {secMeta?.label || secId}
                  </span>
                  <span className="text-xs font-semibold text-[#111114]">
                    {secMeta?.description}
                  </span>
                </div>
                {renderSectionContent(secId)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
