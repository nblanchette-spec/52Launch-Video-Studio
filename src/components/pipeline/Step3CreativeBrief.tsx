import React, { useState } from 'react';
import { Sparkles, Loader2, CheckCircle2, ArrowRight, Plus, Trash2, Eye } from 'lucide-react';
import { CreativeBriefPipeline, PipelineProject } from '../../types/pipeline';

interface Step3CreativeBriefProps {
  project: PipelineProject;
  onUpdateProject: (updated: PipelineProject) => Promise<void>;
  onGenerateBrief: () => Promise<void>;
  onApproveBrief: () => Promise<void>;
  onGoToShotBoard: () => void;
  onPreviewPdf?: () => void;
}

export const Step3CreativeBrief: React.FC<Step3CreativeBriefProps> = ({
  project,
  onUpdateProject,
  onGenerateBrief,
  onApproveBrief,
  onGoToShotBoard,
  onPreviewPdf,
}) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const brief = project.creativeBrief;

  const updateBrief = (patch: Partial<CreativeBriefPipeline>) => {
    const nextProject: PipelineProject = {
      ...project,
      creativeBrief: {
        ...brief,
        ...patch,
        manuallyEdited: true,
      },
      approvals: {
        ...project.approvals,
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
    if (brief.hasGenerated && brief.manuallyEdited && !force) {
      setConfirmOverwrite(true);
      return;
    }
    setConfirmOverwrite(false);
    setErrorMsg(null);
    setIsGenerating(true);
    try {
      await onGenerateBrief();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not generate Creative Brief.');
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
            Step 3 · Creative Brief
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
            Creative Objective, Concepts & Voiceover Direction
          </h1>
          <p className="text-sm text-[#5A5A66] mt-1">
            Grounded in the approved Brand Bible and client ideas. Review or edit concepts,
            then approve to unlock the Shot List.
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
              ? 'Generating Brief...'
              : brief.hasGenerated
                ? 'Re-run Creative Brief'
                : 'Generate Creative Brief'}
          </button>

          {onPreviewPdf && (brief.hasGenerated || brief.objective.trim()) && (
            <button
              type="button"
              onClick={onPreviewPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#24242B] bg-white border border-[#E2E2E6] hover:border-[#891A23] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-[#891A23]" />
              Preview PDF
            </button>
          )}

          {project.approvals.briefApproved ? (
            <button
              type="button"
              onClick={onGoToShotBoard}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              Brief Approved · Open Shot List
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!brief.objective.trim()}
              onClick={() => void onApproveBrief()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              Approve brief
            </button>
          )}
        </div>
      </div>

      {confirmOverwrite && (
        <div className="p-4 rounded-xl bg-[#FDF4F5] border border-[#EABAC0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-[#891A23]">
            You have made manual edits to this Creative Brief. Re-running Gemini will replace
            your current text. Continue?
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

      {!brief.hasGenerated && !brief.objective ? (
        <div className="bg-white border border-dashed border-[#E2E2E6] rounded-xl p-12 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-[#C6202F] mx-auto" />
          <div className="text-base font-semibold text-[#111114]">
            Ready to write the Creative Brief
          </div>
          <p className="text-xs text-[#5A5A66] max-w-md mx-auto">
            Click &ldquo;Generate Creative Brief&rdquo; to craft tailored concepts building on
            your client’s ideas and allowed claims.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Objective & Key Message */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-2">
              <label className="block text-xs font-semibold text-[#3A3A44]">
                Objective (one sentence)
              </label>
              <textarea
                rows={3}
                value={brief.objective}
                onChange={(e) => updateBrief({ objective: e.target.value })}
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2.5 text-sm text-[#111114] focus:outline-none focus:border-[#C6202F]"
              />
            </div>

            <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-2">
              <label className="block text-xs font-semibold text-[#3A3A44]">
                Key Message (one sentence)
              </label>
              <textarea
                rows={3}
                value={brief.keyMessage}
                onChange={(e) => updateBrief({ keyMessage: e.target.value })}
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2.5 text-sm text-[#111114] focus:outline-none focus:border-[#C6202F]"
              />
            </div>
          </div>

          {/* Concepts */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#111114]">
                Creative Concepts (building on client’s marketing ideas)
              </h2>
              <button
                type="button"
                onClick={() =>
                  updateBrief({
                    concepts: [
                      ...brief.concepts,
                      {
                        id: `concept-${Date.now()}`,
                        title: 'New Concept',
                        logline: '',
                        whyItWorks: '',
                        risks: '',
                      },
                    ],
                  })
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-[#C6202F] hover:text-[#891A23] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add concept
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {brief.concepts.map((concept) => {
                const isRecommended =
                  brief.recommendedConcept.title.toLowerCase() ===
                  concept.title.toLowerCase();
                return (
                  <div
                    key={concept.id}
                    className={`bg-white border rounded-xl p-5 space-y-3 flex flex-col justify-between ${
                      isRecommended ? 'border-[#C6202F]/60' : 'border-[#E2E2E6]'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={concept.title}
                          onChange={(e) =>
                            updateBrief({
                              concepts: brief.concepts.map((c) =>
                                c.id === concept.id ? { ...c, title: e.target.value } : c
                              ),
                            })
                          }
                          className="bg-transparent text-base font-semibold text-[#111114] focus:outline-none border-b border-transparent focus:border-[#C6202F] w-full"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateBrief({
                              concepts: brief.concepts.filter((c) => c.id !== concept.id),
                            })
                          }
                          className="p-1 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div>
                        <label className="block text-[11px] text-[#5A5A66] mb-1">
                          Logline
                        </label>
                        <textarea
                          rows={3}
                          value={concept.logline}
                          onChange={(e) =>
                            updateBrief({
                              concepts: brief.concepts.map((c) =>
                                c.id === concept.id ? { ...c, logline: e.target.value } : c
                              ),
                            })
                          }
                          className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-[#5A5A66] mb-1">
                          Why it works
                        </label>
                        <textarea
                          rows={2}
                          value={concept.whyItWorks}
                          onChange={(e) =>
                            updateBrief({
                              concepts: brief.concepts.map((c) =>
                                c.id === concept.id
                                  ? { ...c, whyItWorks: e.target.value }
                                  : c
                              ),
                            })
                          }
                          className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#24242B] focus:outline-none focus:border-[#C6202F]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-[#5A5A66] mb-1">
                          Risks
                        </label>
                        <textarea
                          rows={2}
                          value={concept.risks}
                          onChange={(e) =>
                            updateBrief({
                              concepts: brief.concepts.map((c) =>
                                c.id === concept.id ? { ...c, risks: e.target.value } : c
                              ),
                            })
                          }
                          className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#3A3A44] focus:outline-none focus:border-[#C6202F]"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        updateBrief({
                          recommendedConcept: {
                            ...brief.recommendedConcept,
                            title: concept.title,
                          },
                        })
                      }
                      className={`w-full py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                        isRecommended
                          ? 'bg-[#FDF2F3] border-[#C6202F] text-[#891A23]'
                          : 'bg-[#F6F6F7] border-[#E2E2E6] text-[#5A5A66] hover:text-[#24242B]'
                      }`}
                    >
                      {isRecommended ? 'Recommended Concept' : 'Set as Recommended'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recommended Concept, Deliverables, VO Direction, Claims Check */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[#111114]">
                Recommended Concept & Reason
              </h2>
              <input
                type="text"
                value={brief.recommendedConcept.title}
                onChange={(e) =>
                  updateBrief({
                    recommendedConcept: {
                      ...brief.recommendedConcept,
                      title: e.target.value,
                    },
                  })
                }
                placeholder="Recommended concept title"
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-sm font-medium text-[#891A23] focus:outline-none focus:border-[#C6202F]"
              />
              <textarea
                rows={3}
                value={brief.recommendedConcept.reason}
                onChange={(e) =>
                  updateBrief({
                    recommendedConcept: {
                      ...brief.recommendedConcept,
                      reason: e.target.value,
                    },
                  })
                }
                placeholder="Why this direction wins..."
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#24242B] focus:outline-none focus:border-[#C6202F]"
              />
            </div>

            <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[#111114]">
                Deliverables & Claims Check
              </h2>
              <div>
                <label className="block text-xs text-[#5A5A66] mb-1">
                  Deliverables (one per line)
                </label>
                <textarea
                  rows={2}
                  value={brief.deliverables.join('\n')}
                  onChange={(e) =>
                    updateBrief({
                      deliverables: e.target.value
                        .split('\n')
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#5A5A66] mb-1">Claims check</label>
                <textarea
                  rows={2}
                  value={brief.claimsCheck}
                  onChange={(e) => updateBrief({ claimsCheck: e.target.value })}
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-emerald-900 focus:outline-none focus:border-[#C6202F]"
                />
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E2E2E6] rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-[#111114]">Voiceover Direction</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-[#5A5A66] mb-1">Who is speaking</label>
                <input
                  type="text"
                  value={brief.voDirection.speaker}
                  onChange={(e) =>
                    updateBrief({
                      voDirection: { ...brief.voDirection, speaker: e.target.value },
                    })
                  }
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#5A5A66] mb-1">Pace</label>
                <input
                  type="text"
                  value={brief.voDirection.pace}
                  onChange={(e) =>
                    updateBrief({
                      voDirection: { ...brief.voDirection, pace: e.target.value },
                    })
                  }
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#5A5A66] mb-1">Emotional arc</label>
                <input
                  type="text"
                  value={brief.voDirection.emotionalArc}
                  onChange={(e) =>
                    updateBrief({
                      voDirection: { ...brief.voDirection, emotionalArc: e.target.value },
                    })
                  }
                  className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3 py-2 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
