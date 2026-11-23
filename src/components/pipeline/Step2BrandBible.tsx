import React, { useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  Plus,
  Trash2,
  AlertTriangle,
  ArrowRight,
  Upload,
  FolderSync,
  Image as ImageIcon,
  Type as TypeIcon,
  FileText,
  Palette,
  ExternalLink,
  Award,
  Eye,
} from 'lucide-react';
import { BrandBible, PipelineProject, ProductPhoto } from '../../types/pipeline';
import { readAndOptimizeLocalImage } from '../../utils/imageUtils';
import { ImportedDriveAsset } from '../../utils/googleDriveSync';
import { parseJsonResponse } from '../../utils/safeFetch';
import { DriveAssetPickerModal } from './DriveAssetPickerModal';

function extractHexSwatches(text: string): string[] {
  const matches = (text || '').match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  const valid = matches.filter((h) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h));
  return Array.from(new Set(valid.map((h) => h.toUpperCase()))).slice(0, 8);
}

interface Step2BrandBibleProps {
  project: PipelineProject;
  onUpdateProject: (updated: PipelineProject) => Promise<void>;
  onGenerateBible: () => Promise<void>;
  onApproveBible: () => Promise<void>;
  onGoToBrief: () => void;
  onPreviewPdf?: () => void;
}

export const Step2BrandBible: React.FC<Step2BrandBibleProps> = ({
  project,
  onUpdateProject,
  onGenerateBible,
  onApproveBible,
  onGoToBrief,
  onPreviewPdf,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingProduct, setIsUploadingProduct] = useState(false);
  const [drivePickerTarget, setDrivePickerTarget] = useState<'logo' | 'product' | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const productInputRef = useRef<HTMLInputElement>(null);

  const bible = project.brandBible;
  const paletteSwatches = useMemo(
    () => extractHexSwatches(bible.visualStyle?.palette || ''),
    [bible.visualStyle?.palette]
  );

  const brandGraphicsList: ProductPhoto[] = useMemo(() => {
    const list = [...(bible.brandGraphics || [])];
    if (bible.brandLogoUrl && !list.some((g) => g.url === bible.brandLogoUrl)) {
      list.unshift({
        id: 'primary-logo',
        url: bible.brandLogoUrl,
        caption: bible.brandLogoCaption || 'Primary Brand Logo',
      });
    }
    return list;
  }, [bible.brandGraphics, bible.brandLogoUrl, bible.brandLogoCaption]);

  const handleLocalLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setIsUploadingLogo(true);
    try {
      const additions: ProductPhoto[] = [];
      for (let i = 0; i < files.length; i++) {
        const dataUrl = await readAndOptimizeLocalImage(files[i], 1200);
        const resp = await fetch(`/api/projects/${project.id}/assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, prefix: 'logo' }),
        });
        const data = await parseJsonResponse<{ url: string; error?: string }>(
          resp,
          'Could not upload brand logo or graphic.'
        );
        additions.push({
          id: `logo-${Date.now()}-${i}`,
          url: data.url,
          caption: files[i].name,
        });
      }
      const nextGraphics = [...brandGraphicsList, ...additions];
      const nextPrimary = bible.brandLogoUrl || additions[0]?.url || null;
      await onUpdateProject({
        ...project,
        brandBible: {
          ...bible,
          brandLogoUrl: nextPrimary,
          brandLogoCaption:
            bible.brandLogoCaption || additions[0]?.caption || 'Brand Logo',
          brandGraphics: nextGraphics,
          manuallyEdited: true,
        },
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not upload brand logo.');
    } finally {
      setIsUploadingLogo(false);
      e.target.value = '';
    }
  };

  const handleLocalProductUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setIsUploadingProduct(true);
    try {
      const nextPhotos: ProductPhoto[] = [...project.product.photos];
      for (let i = 0; i < files.length; i++) {
        const dataUrl = await readAndOptimizeLocalImage(files[i], 1400);
        const resp = await fetch(`/api/projects/${project.id}/assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, prefix: 'product' }),
        });
        const data = await parseJsonResponse<{ url: string; error?: string }>(
          resp,
          'Could not upload product photo.'
        );
        nextPhotos.push({
          id: `photo-${Date.now()}-${i}`,
          url: data.url,
          caption: files[i].name,
        });
      }
      await onUpdateProject({
        ...project,
        product: {
          ...project.product,
          photos: nextPhotos,
        },
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not upload product photo.');
    } finally {
      setIsUploadingProduct(false);
      e.target.value = '';
    }
  };

  const handleDriveAssetsImported = async (assets: ImportedDriveAsset[]) => {
    if (assets.length === 0) return;
    if (drivePickerTarget === 'logo') {
      const additions: ProductPhoto[] = assets
        .filter((a) => Boolean(a.url))
        .map((a, idx) => ({
          id: `logo-drive-${Date.now()}-${idx}`,
          url: a.url!,
          caption: a.name,
        }));
      if (additions.length > 0) {
        const nextGraphics = [...brandGraphicsList, ...additions];
        await onUpdateProject({
          ...project,
          brandBible: {
            ...bible,
            brandLogoUrl: bible.brandLogoUrl || additions[0].url,
            brandLogoCaption: bible.brandLogoCaption || additions[0].caption,
            brandGraphics: nextGraphics,
            manuallyEdited: true,
          },
        });
      }
      return;
    }

    if (drivePickerTarget === 'product') {
      const additions: ProductPhoto[] = assets
        .filter((a) => Boolean(a.url))
        .map((a, idx) => ({
          id: `photo-drive-${Date.now()}-${idx}`,
          url: a.url!,
          caption: a.name,
        }));
      if (additions.length > 0) {
        await onUpdateProject({
          ...project,
          product: {
            ...project.product,
            photos: [...project.product.photos, ...additions],
          },
        });
      }
    }
  };

  const updateBible = (patch: Partial<BrandBible>) => {
    const nextProject: PipelineProject = {
      ...project,
      brandBible: {
        ...bible,
        ...patch,
        manuallyEdited: true,
      },
      // Editing an approved step un-approves this step and every step after it
      approvals: {
        ...project.approvals,
        bibleApproved: false,
        briefApproved: false,
        shotListApproved: false,
        storyboardApproved: false,
        videoPromptsApproved: false,
        voApproved: false,
        shootPlanApproved: false,
      },
    };
    void onUpdateProject(nextProject);
  };

  const triggerGenerate = async (force = false) => {
    if (bible.hasGenerated && bible.manuallyEdited && !force) {
      setConfirmOverwrite(true);
      return;
    }
    setConfirmOverwrite(false);
    setErrorMsg(null);
    setIsGenerating(true);
    try {
      await onGenerateBible();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not generate Brand Bible.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="max-w-[1180px] mx-auto px-6 py-7 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-[#E2E2E6]">
        <div>
          <div className="text-xs font-medium text-[#C6202F]">
            Step 2 · Brand Bible
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
            Brand Strategy, Visual Rules & Claims Guardrails
          </h1>
          <p className="text-sm text-[#5A5A66] mt-1">
            Built directly from your intake and real product photos. Review or edit any field,
            then approve to unlock the Creative Brief.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => void triggerGenerate(false)}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-[#111114] bg-white border border-[#E2E2E6] hover:border-[#C6202F] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#C6202F]" />
            ) : (
              <Sparkles className="w-4 h-4 text-[#C6202F]" />
            )}
            {isGenerating
              ? 'Generating Brand Bible...'
              : bible.hasGenerated
                ? 'Re-run Brand Bible'
                : 'Generate Brand Bible'}
          </button>

          {onPreviewPdf && (bible.hasGenerated || bible.positioning.trim()) && (
            <button
              type="button"
              onClick={onPreviewPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-[#891A23]" />
              Preview PDF
            </button>
          )}

          {project.approvals.bibleApproved ? (
            <button
              type="button"
              onClick={onGoToBrief}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              Bible Approved · Open Creative Brief
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!bible.positioning.trim()}
              onClick={() => void onApproveBible()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              Approve bible
            </button>
          )}
        </div>
      </div>

      {/* Overwrite Confirmation Modal / Inline Prompt */}
      {confirmOverwrite && (
        <div className="p-4 rounded-xl bg-[#FDF4F5] border border-[#EABAC0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-[#891A23]">
            You have made manual edits to this Brand Bible. Re-running Gemini will replace your
            current text. Do you want to continue?
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setConfirmOverwrite(false)}
              className="px-3 py-1.5 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] rounded-lg cursor-pointer"
            >
              Keep my edits
            </button>
            <button
              type="button"
              onClick={() => void triggerGenerate(true)}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded-lg cursor-pointer"
            >
              Replace & re-run
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-300 text-xs text-[#891A23]">
          {errorMsg}
        </div>
      )}

      {((project.brandGuideDocuments && project.brandGuideDocuments.length > 0) ||
        project.extractedStyleGuide) && (
        <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-[#C6202F]" />
              <h2 className="text-sm font-semibold text-[#111114]">
                Extracted PDF Brand &amp; Style Guide Reference
              </h2>
              {project.brandGuideDocuments && project.brandGuideDocuments.length > 0 && (
                <span className="px-2 py-0.5 rounded bg-[#FDF4F5] border border-[#EABAC0] text-[10px] font-mono text-[#891A23]">
                  {project.brandGuideDocuments.length} PDF
                  {project.brandGuideDocuments.length > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {project.extractedStyleGuide && (
              <button
                type="button"
                onClick={() => {
                  const sg = project.extractedStyleGuide!;
                  const paletteText = [
                    sg.palette,
                    sg.paletteHexes.length > 0 ? `Hexes: ${sg.paletteHexes.join(', ')}` : '',
                  ]
                    .filter(Boolean)
                    .join(' — ');
                  updateBible({
                    visualStyle: {
                      ...bible.visualStyle,
                      palette: paletteText || bible.visualStyle.palette,
                      typography: sg.typography || bible.visualStyle.typography,
                      lighting: sg.lighting || bible.visualStyle.lighting,
                      lensAndFraming: sg.lensAndFraming || bible.visualStyle.lensAndFraming,
                      grade: sg.grade || bible.visualStyle.grade,
                    },
                    productRules: sg.productVisualRules || bible.productRules,
                    bannedList:
                      sg.bannedElements.length > 0
                        ? Array.from(new Set([...bible.bannedList, ...sg.bannedElements]))
                        : bible.bannedList,
                  });
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] hover:bg-[#FCE8EA] rounded-lg cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Apply Style Guide Rules to Brand Bible
              </button>
            )}
          </div>

          {project.brandGuideDocuments && project.brandGuideDocuments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {project.brandGuideDocuments.map((doc) => (
                <a
                  key={doc.id}
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#C6202F] text-xs text-[#111114]"
                >
                  <FileText className="w-3.5 h-3.5 text-[#C6202F]" />
                  <span className="font-medium truncate max-w-[220px]">{doc.name}</span>
                  {typeof doc.graphicCount === 'number' && doc.graphicCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-white border border-[#E2E2E6] text-[10px] font-mono text-[#5A5A66]">
                      {doc.graphicCount} graphic{doc.graphicCount === 1 ? '' : 's'}
                    </span>
                  )}
                  <ExternalLink className="w-3 h-3 text-[#6E6E7A]" />
                </a>
              ))}
            </div>
          )}

          {project.extractedStyleGuide && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs bg-[#FBFBFC] border border-[#E2E2E6] rounded-lg p-3.5">
              {project.extractedStyleGuide.summary && (
                <div className="md:col-span-2 text-[#24242B]">
                  <span className="font-semibold text-[#111114]">Guide Summary: </span>
                  {project.extractedStyleGuide.summary}
                </div>
              )}
              {project.extractedStyleGuide.paletteHexes.length > 0 && (
                <div className="md:col-span-2 flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-[#3A3A44]">Swatches:</span>
                  {project.extractedStyleGuide.paletteHexes.map((hex) => (
                    <span
                      key={hex}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white border border-[#E2E2E6] text-[10px] font-mono text-[#24242B]"
                    >
                      <span
                        className="w-3 h-3 rounded-sm border border-black/15 shrink-0"
                        style={{ backgroundColor: hex }}
                      />
                      {hex}
                    </span>
                  ))}
                </div>
              )}
              {project.extractedStyleGuide.typography && (
                <div>
                  <span className="font-semibold text-[#3A3A44]">Typography: </span>
                  <span className="text-[#5A5A66]">{project.extractedStyleGuide.typography}</span>
                </div>
              )}
              {project.extractedStyleGuide.lighting && (
                <div>
                  <span className="font-semibold text-[#3A3A44]">Lighting: </span>
                  <span className="text-[#5A5A66]">{project.extractedStyleGuide.lighting}</span>
                </div>
              )}
              {project.extractedStyleGuide.lensAndFraming && (
                <div>
                  <span className="font-semibold text-[#3A3A44]">Lens &amp; Framing: </span>
                  <span className="text-[#5A5A66]">{project.extractedStyleGuide.lensAndFraming}</span>
                </div>
              )}
              {project.extractedStyleGuide.brandLogoNotes && (
                <div>
                  <span className="font-semibold text-[#3A3A44]">Logo Rules: </span>
                  <span className="text-[#5A5A66]">{project.extractedStyleGuide.brandLogoNotes}</span>
                </div>
              )}
              {project.extractedStyleGuide.productVisualRules && (
                <div className="md:col-span-2">
                  <span className="font-semibold text-[#3A3A44]">Product Visual Rules: </span>
                  <span className="text-[#5A5A66]">{project.extractedStyleGuide.productVisualRules}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!bible.hasGenerated && !bible.positioning ? (
        <div className="bg-white border border-dashed border-[#E2E2E6] rounded-xl p-12 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-[#C6202F] mx-auto" />
          <div className="text-base font-semibold text-[#111114]">
            Ready to build the Brand Bible for {project.product.name}
          </div>
          <p className="text-xs text-[#5A5A66] max-w-md mx-auto">
            Click &ldquo;Generate Brand Bible&rdquo; to analyze your intake notes and product
            photos into positioning, visual rules, fixed character descriptors, and claims
            guardrails.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Flagged Claims Alert */}
          {bible.claimsToFlag.length > 0 && (
            <div className="bg-[#FDF4F5] border border-[#EABAC0] rounded-xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#891A23]">
                <AlertTriangle className="w-4 h-4" />
                Claims Flagged for Review (client ideas that may imply unproven claims)
              </div>
              <ul className="space-y-1 text-xs text-[#6E141C] list-disc pl-5">
                {bible.claimsToFlag.map((flag, i) => (
                  <li key={i}>{flag}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Positioning & Audience */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-2">
              <label className="block text-xs font-semibold text-[#3A3A44]">
                Positioning (one sentence)
              </label>
              <textarea
                rows={3}
                value={bible.positioning}
                onChange={(e) => updateBible({ positioning: e.target.value })}
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2.5 text-sm text-[#111114] focus:outline-none focus:border-[#C6202F]"
              />
            </div>

            <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-2">
              <label className="block text-xs font-semibold text-[#3A3A44]">
                Audience
              </label>
              <textarea
                rows={3}
                value={bible.audience}
                onChange={(e) => updateBible({ audience: e.target.value })}
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2.5 text-sm text-[#111114] focus:outline-none focus:border-[#C6202F]"
              />
            </div>
          </div>

          {/* Tone of Voice & Visual Style */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[#111114]">Tone of Voice</h2>
              <div>
                <label className="block text-xs text-[#5A5A66] mb-1">
                  Key adjectives (comma-separated)
                </label>
                <input
                  type="text"
                  value={bible.toneOfVoice.adjectives.join(', ')}
                  onChange={(e) =>
                    updateBible({
                      toneOfVoice: {
                        ...bible.toneOfVoice,
                        adjectives: e.target.value
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                      },
                    })
                  }
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-sm text-[#111114] focus:outline-none focus:border-[#C6202F]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#5A5A66] mb-1">Guidance</label>
                <textarea
                  rows={3}
                  value={bible.toneOfVoice.guidance}
                  onChange={(e) =>
                    updateBible({
                      toneOfVoice: { ...bible.toneOfVoice, guidance: e.target.value },
                    })
                  }
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-sm text-[#111114] focus:outline-none focus:border-[#C6202F]"
                />
              </div>
            </div>

            <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[#111114]">
                  Visual Style &amp; Brand Style Guide
                </h2>
                <span className="text-[11px] text-[#5A5A66]">
                  Colors · Fonts · Lighting · Grade
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs text-[#5A5A66] mb-1">
                    Brand Color Palette (include #HEX codes for swatch previews)
                  </label>
                  <input
                    type="text"
                    value={bible.visualStyle.palette}
                    onChange={(e) =>
                      updateBible({
                        visualStyle: { ...bible.visualStyle, palette: e.target.value },
                      })
                    }
                    placeholder="e.g., Obsidian Black (#0F172A), Electric Amber (#F59E0B), Bone White (#F8FAFC)"
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                  {paletteSwatches.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      {paletteSwatches.map((hex) => (
                        <span
                          key={hex}
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#F6F6F7] border border-[#E2E2E6] text-[10px] font-mono text-[#3A3A44]"
                        >
                          <span
                            className="w-3 h-3 rounded-sm border border-white/20 shrink-0"
                            style={{ backgroundColor: hex }}
                          />
                          {hex}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="sm:col-span-2">
                  <label className="flex items-center gap-1.5 text-xs text-[#5A5A66] mb-1">
                    <TypeIcon className="w-3.5 h-3.5 text-[#C6202F]" />
                    Brand Fonts / Typography
                  </label>
                  <input
                    type="text"
                    value={bible.visualStyle.typography || ''}
                    onChange={(e) =>
                      updateBible({
                        visualStyle: { ...bible.visualStyle, typography: e.target.value },
                      })
                    }
                    placeholder="e.g., Display: Neue Haas Grotesk Bold · Body: Inter Regular · Mono: JetBrains Mono"
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                </div>

                <div>
                  <label className="block text-xs text-[#5A5A66] mb-1">Lighting</label>
                  <input
                    type="text"
                    value={bible.visualStyle.lighting}
                    onChange={(e) =>
                      updateBible({
                        visualStyle: { ...bible.visualStyle, lighting: e.target.value },
                      })
                    }
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#5A5A66] mb-1">Color Grade</label>
                  <input
                    type="text"
                    value={bible.visualStyle.grade}
                    onChange={(e) =>
                      updateBible({
                        visualStyle: { ...bible.visualStyle, grade: e.target.value },
                      })
                    }
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs text-[#5A5A66] mb-1">
                    Lens &amp; Framing
                  </label>
                  <input
                    type="text"
                    value={bible.visualStyle.lensAndFraming}
                    onChange={(e) =>
                      updateBible({
                        visualStyle: {
                          ...bible.visualStyle,
                          lensAndFraming: e.target.value,
                        },
                      })
                    }
                    className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Brand Logo & Reference Product Photos */}
          <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-[#111114]">
                  Brand Logo &amp; Product Reference Photos
                </h2>
                <p className="text-xs text-[#5A5A66] mt-0.5">
                  Included directly in the Brand Bible PDF and Master Presentation Slideshow alongside your brand colors and typography.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              {/* Brand Logos & Graphics (Multiple Variations) */}
              <div className="bg-[#F6F6F7] border border-[#E2E2E6] rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#24242B]">
                    Brand Logos &amp; Graphics ({brandGraphicsList.length})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDrivePickerTarget('logo')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] hover:bg-[#FCE8EA] rounded-lg cursor-pointer"
                    >
                      <FolderSync className="w-3.5 h-3.5" />
                      Add from Drive
                    </button>
                    <button
                      type="button"
                      disabled={isUploadingLogo}
                      onClick={() => logoInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
                    >
                      {isUploadingLogo ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6202F]" />
                      ) : (
                        <Upload className="w-3.5 h-3.5 text-[#C6202F]" />
                      )}
                      Upload Logos
                    </button>
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleLocalLogoUpload(e)}
                    />
                  </div>
                </div>

                {brandGraphicsList.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {brandGraphicsList.map((g, idx) => {
                      const isPrimary =
                        bible.brandLogoUrl === g.url || (!bible.brandLogoUrl && idx === 0);
                      return (
                        <div
                          key={g.id || idx}
                          className={`bg-white border rounded-lg overflow-hidden aspect-square relative group flex flex-col ${
                            isPrimary
                              ? 'border-[#C6202F] ring-2 ring-[#C6202F]/30'
                              : 'border-[#E2E2E6]'
                          }`}
                        >
                          <div className="flex-1 p-2 flex items-center justify-center overflow-hidden bg-white">
                            <img
                              src={g.url}
                              alt={g.caption || `${project.client} Logo ${idx + 1}`}
                              referrerPolicy="no-referrer"
                              className="max-h-full max-w-full object-contain"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              updateBible({
                                brandLogoUrl: g.url,
                                brandLogoCaption: g.caption || 'Primary Brand Logo',
                                brandGraphics: brandGraphicsList,
                              })
                            }
                            className={`absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold cursor-pointer ${
                              isPrimary
                                ? 'bg-[#C6202F] text-white'
                                : 'bg-black/75 text-white opacity-0 group-hover:opacity-100'
                            }`}
                          >
                            <Award className="w-3 h-3" />
                            {isPrimary ? 'Primary' : 'Set Primary'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const nextGraphics = brandGraphicsList.filter((_, i) => i !== idx);
                              const nextPrimary =
                                bible.brandLogoUrl === g.url
                                  ? nextGraphics[0]?.url || null
                                  : bible.brandLogoUrl;
                              updateBible({
                                brandLogoUrl: nextPrimary,
                                brandGraphics: nextGraphics,
                              });
                            }}
                            className="absolute top-1.5 right-1.5 p-1 bg-black/80 text-white/85 hover:text-[#FCA5A5] rounded opacity-0 group-hover:opacity-100 cursor-pointer"
                            title="Remove brand graphic"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                          {g.caption && (
                            <div className="bg-black/75 px-2 py-1 text-[10px] text-white truncate">
                              {g.caption}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="h-32 w-full rounded-lg border border-dashed border-[#E2E2E6] bg-[#FBFBFC] flex flex-col items-center justify-center text-center px-3">
                    <ImageIcon className="w-6 h-6 text-[#8A8A96] mb-1.5" />
                    <span className="text-[11px] text-[#5A5A66]">
                      No brand logos or graphics attached yet
                    </span>
                  </div>
                )}
              </div>

              {/* Product Photos (Multiple Angles) */}
              <div className="bg-[#F6F6F7] border border-[#E2E2E6] rounded-xl p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#24242B]">
                    Product Photos ({project.product.photos.length})
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDrivePickerTarget('product')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] hover:bg-[#FCE8EA] rounded-lg cursor-pointer"
                    >
                      <FolderSync className="w-3.5 h-3.5" />
                      Add from Drive
                    </button>
                    <button
                      type="button"
                      disabled={isUploadingProduct}
                      onClick={() => productInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
                    >
                      {isUploadingProduct ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6202F]" />
                      ) : (
                        <Upload className="w-3.5 h-3.5 text-[#C6202F]" />
                      )}
                      Upload Angles
                    </button>
                    <input
                      ref={productInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleLocalProductUpload(e)}
                    />
                  </div>
                </div>

                {project.product.photos.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {project.product.photos.map((photo, idx) => (
                      <div
                        key={photo.id || idx}
                        className="bg-white border border-[#E2E2E6] rounded-lg overflow-hidden aspect-square relative group"
                      >
                        <img
                          src={photo.url}
                          alt={photo.caption || `Product ${idx + 1}`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono text-white">
                          Angle {idx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = project.product.photos.filter((_, i) => i !== idx);
                            void onUpdateProject({
                              ...project,
                              product: { ...project.product, photos: next },
                            });
                          }}
                          className="absolute top-1.5 right-1.5 p-1 bg-black/80 text-white/85 hover:text-[#FCA5A5] rounded opacity-0 group-hover:opacity-100 cursor-pointer"
                          title="Remove product photo"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                        {photo.caption && (
                          <div className="absolute bottom-0 inset-x-0 bg-black/75 px-2 py-1 text-[10px] text-white truncate">
                            {photo.caption}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-32 rounded-lg border border-dashed border-[#E2E2E6] bg-[#FBFBFC] flex flex-col items-center justify-center text-center px-4">
                    <ImageIcon className="w-6 h-6 text-[#8A8A96] mb-1.5" />
                    <span className="text-[11px] text-[#5A5A66]">
                      No product photos attached yet. Add product reference images from Drive or local upload.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Characters (Fixed Descriptors) */}
          <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[#111114]">
                  Characters — Fixed Visual Descriptors
                </h2>
                <p className="text-xs text-[#5A5A66] mt-0.5">
                  Each descriptor is pasted word-for-word into every storyboard frame prompt to
                  maintain continuity.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  updateBible({
                    characters: [
                      ...bible.characters,
                      {
                        id: `char-${Date.now()}`,
                        name: 'New Character',
                        fixedDescriptor: '',
                      },
                    ],
                  })
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-[#C6202F] hover:text-[#891A23] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add character
              </button>
            </div>

            <div className="space-y-2.5">
              {bible.characters.map((char) => (
                <div
                  key={char.id}
                  className="grid grid-cols-1 md:grid-cols-[220px_1fr_auto] gap-3 items-start bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg p-3"
                >
                  <input
                    type="text"
                    value={char.name}
                    onChange={(e) =>
                      updateBible({
                        characters: bible.characters.map((c) =>
                          c.id === char.id ? { ...c, name: e.target.value } : c
                        ),
                      })
                    }
                    placeholder="Character name"
                    className="bg-white border border-[#E2E2E6] rounded px-2.5 py-1.5 text-xs font-semibold text-[#111114] focus:outline-none focus:border-[#C6202F]"
                  />
                  <textarea
                    rows={2}
                    value={char.fixedDescriptor}
                    onChange={(e) =>
                      updateBible({
                        characters: bible.characters.map((c) =>
                          c.id === char.id
                            ? { ...c, fixedDescriptor: e.target.value }
                            : c
                        ),
                      })
                    }
                    placeholder="Exact fixed visual descriptor (age, hair, clothing, accessories)..."
                    className="bg-white border border-[#E2E2E6] rounded px-2.5 py-1.5 text-xs text-[#24242B] focus:outline-none focus:border-[#C6202F]"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      updateBible({
                        characters: bible.characters.filter((c) => c.id !== char.id),
                      })
                    }
                    className="p-1.5 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Product Rules & Banned List */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-2">
              <label className="block text-sm font-semibold text-[#111114]">
                Product Rules (from real product photos & intake)
              </label>
              <textarea
                rows={4}
                value={bible.productRules}
                onChange={(e) => updateBible({ productRules: e.target.value })}
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2.5 text-xs text-[#111114] leading-relaxed focus:outline-none focus:border-[#C6202F]"
              />
            </div>

            <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-2">
              <label className="block text-sm font-semibold text-[#111114]">
                Banned List (one item per line)
              </label>
              <textarea
                rows={4}
                value={bible.bannedList.join('\n')}
                onChange={(e) =>
                  updateBible({
                    bannedList: e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2.5 text-xs text-[#111114] leading-relaxed focus:outline-none focus:border-[#C6202F]"
              />
            </div>
          </div>

          {/* Claims Allowed */}
          <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-2">
            <label className="block text-sm font-semibold text-[#111114]">
              Claims Allowed (one provable claim per line)
            </label>
            <textarea
              rows={3}
              value={bible.claimsAllowed.join('\n')}
              onChange={(e) =>
                updateBible({
                  claimsAllowed: e.target.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2.5 text-xs text-emerald-900 leading-relaxed focus:outline-none focus:border-[#C6202F]"
            />
          </div>
        </div>
      )}

      <DriveAssetPickerModal
        isOpen={drivePickerTarget !== null}
        projectId={project.id}
        initialFolderUrls={
          project.googleDriveFolderUrls?.length
            ? project.googleDriveFolderUrls
            : project.googleDriveFolderUrl
              ? [project.googleDriveFolderUrl]
              : ['']
        }
        mediaFilter="image"
        multiple={true}
        prefix={drivePickerTarget === 'logo' ? 'logo' : 'product'}
        title={
          drivePickerTarget === 'logo'
            ? 'Pick Brand Logos & Graphics from Google Drive'
            : 'Pick Product Photos from Google Drive'
        }
        subtitle={
          drivePickerTarget === 'logo'
            ? 'Select one or more brand logo variations and graphics from Google Drive.'
            : 'Select one or more product angle photos from Google Drive.'
        }
        onClose={() => setDrivePickerTarget(null)}
        onImported={handleDriveAssetsImported}
        onFoldersChange={(urls) => {
          void onUpdateProject({
            ...project,
            googleDriveFolderUrls: urls,
            googleDriveFolderUrl: urls[0] || undefined,
          });
        }}
      />
    </div>
  );
};
