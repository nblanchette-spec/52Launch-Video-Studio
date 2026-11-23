import React, { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Upload,
  Loader2,
  ArrowRight,
  Image as ImageIcon,
  FolderSync,
  CheckCircle2,
  ExternalLink,
  Sparkles,
  X,
  LogOut,
  FileText,
  Folder,
  FolderPlus,
  HardDrive,
  Check,
  Palette,
  Award,
  BookOpen,
  Copy,
} from 'lucide-react';
import {
  BrandGuideDocument,
  ExtractedStyleGuide,
  PipelineProject,
  ProductPhoto,
} from '../../types/pipeline';
import { readAndOptimizeLocalImage } from '../../utils/imageUtils';
import { syncAllFormattedPdfsToDrive } from '../../utils/pdfExporter';
import {
  getFirebaseAuthorizedDomainsInfo,
  getGoogleDriveAccessToken,
  getGoogleDriveUser,
  initDriveAuth,
  signInWithGoogleDrive,
  logoutGoogleDrive,
  syncProjectToDriveServer,
  listGoogleDriveFolderFiles,
  parseGoogleDriveFolder,
  parseLocalStyleGuidePdfs,
  ParsedDriveIntakeResult,
  createDriveFolderOnDrive,
  DriveFileItem,
  ImportedDriveAsset,
} from '../../utils/googleDriveSync';
import { parseJsonResponse } from '../../utils/safeFetch';
import { DriveAssetPickerModal, DriveMediaFilter } from './DriveAssetPickerModal';

interface Step1NewProjectProps {
  existingProject: PipelineProject | null;
  isNewMode: boolean;
  onCreateProject: (payload: {
    client: string;
    product: {
      name: string;
      description: string;
      provableClaims: string[];
    };
    intake: {
      audience: string;
      tone: string;
      clientMarketingIdeas: string;
      videosWanted: string;
      shootLocationDatesBudgetNotes: string;
    };
    initialPhotoDataUrls: Array<{ dataUrl: string; caption: string }>;
    initialBrandGraphicsDataUrls?: Array<{ dataUrl: string; caption: string }>;
    extractedStyleGuide?: ExtractedStyleGuide | null;
    stagedGuidePdfs?: Array<{ name: string; dataUrl: string; graphicCount?: number }>;
    initialLogoDataUrl?: string | null;
    googleDriveFolderUrls?: string[];
    googleDriveDestinationFolderId?: string;
    googleDriveDestinationFolderUrl?: string;
    googleDriveDestinationFolderName?: string;
    lockedDriveReferences?: Array<{
      fileId: string;
      name: string;
      mimeType: string;
      webViewLink?: string;
      folderUrl?: string;
      selected: boolean;
    }>;
  }) => Promise<void>;
  onUpdateProject: (updated: PipelineProject) => Promise<void>;
  onProceedToBible: () => void;
}

export const Step1NewProject: React.FC<Step1NewProjectProps> = ({
  existingProject,
  isNewMode,
  onCreateProject,
  onUpdateProject,
  onProceedToBible,
}) => {
  const [client, setClient] = useState(isNewMode ? '' : existingProject?.client || '');
  const [productName, setProductName] = useState(
    isNewMode ? '' : existingProject?.product.name || ''
  );
  const [productDescription, setProductDescription] = useState(
    isNewMode ? '' : existingProject?.product.description || ''
  );
  const [claims, setClaims] = useState<string[]>(
    isNewMode
      ? ['']
      : existingProject?.product.provableClaims.length
        ? existingProject.product.provableClaims
        : ['']
  );

  const initialFolderUrls = isNewMode
    ? ['']
    : existingProject?.googleDriveFolderUrls?.length
      ? existingProject.googleDriveFolderUrls
      : existingProject?.googleDriveFolderUrl
        ? [existingProject.googleDriveFolderUrl]
        : [''];

  const [googleDriveFolderUrls, setGoogleDriveFolderUrls] =
    useState<string[]>(initialFolderUrls);

  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [driveUserEmail, setDriveUserEmail] = useState<string | null>(null);
  const [isConnectingDrive, setIsConnectingDrive] = useState(false);
  const [isSyncingDrive, setIsSyncingDrive] = useState(false);
  const [isParsingDrive, setIsParsingDrive] = useState(false);
  const [driveSyncStatus, setDriveSyncStatus] = useState<
    'idle' | 'syncing' | 'synced' | 'error'
  >(existingProject?.googleDriveSyncStatus || 'idle');
  const [backupFolderUrl, setBackupFolderUrl] = useState<string | undefined>(
    isNewMode ? undefined : existingProject?.googleDriveBackupFolderUrl
  );
  const [driveStatusNote, setDriveStatusNote] = useState<string | null>(null);
  const [driveErrorMsg, setDriveErrorMsg] = useState<string | null>(null);

  const [destinationFolderId, setDestinationFolderId] = useState<string | undefined>(
    isNewMode
      ? undefined
      : existingProject?.googleDriveDestinationFolderId || existingProject?.googleDriveBackupFolderId
  );
  const [destinationFolderUrl, setDestinationFolderUrl] = useState<string | undefined>(
    isNewMode
      ? undefined
      : existingProject?.googleDriveDestinationFolderUrl || existingProject?.googleDriveBackupFolderUrl
  );
  const [destinationFolderName, setDestinationFolderName] = useState<string | undefined>(
    isNewMode
      ? undefined
      : existingProject?.googleDriveDestinationFolderName ||
        (existingProject?.client && existingProject?.product.name
          ? `52Launch Studio — ${existingProject.client} (${existingProject.product.name})`
          : undefined)
  );

  const [destinationPickerOpen, setDestinationPickerOpen] = useState(false);
  const [sourceFolderPickerOpen, setSourceFolderPickerOpen] = useState(false);
  const [isCreatingDedicatedFolder, setIsCreatingDedicatedFolder] = useState(false);

  const isFakeLegacyFileId = (id: string) =>
    /^file-[123](-|$)/.test(id) || /^fallback-/.test(id);

  const [driveFiles, setDriveFiles] = useState<DriveFileItem[]>(() => {
    if (isNewMode || !existingProject?.lockedDriveReferences?.length) return [];
    return existingProject.lockedDriveReferences
      .filter((r) => r.selected && r.fileId && !isFakeLegacyFileId(r.fileId))
      .map((r) => ({
        id: r.fileId,
        name: r.name,
        mimeType: r.mimeType,
        webViewLink: r.webViewLink,
        folderUrl: r.folderUrl,
      }));
  });

  const [lockedFileIds, setLockedFileIds] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    if (!isNewMode && existingProject?.lockedDriveReferences) {
      existingProject.lockedDriveReferences.forEach((ref) => {
        if (ref.selected && ref.fileId && !isFakeLegacyFileId(ref.fileId)) {
          map[ref.fileId] = true;
        }
      });
    }
    return map;
  });

  // Staged vs existing product photos
  const [stagedPhotos, setStagedPhotos] = useState<
    Array<{ id: string; dataUrl: string; caption: string }>
  >([]);
  const [existingPhotos, setExistingPhotos] = useState<ProductPhoto[]>(
    isNewMode ? [] : existingProject?.product.photos || []
  );

  // Staged vs existing brand graphics / logo variations
  const [stagedBrandGraphics, setStagedBrandGraphics] = useState<
    Array<{ id: string; dataUrl: string; caption: string }>
  >([]);
  const [existingBrandGraphics, setExistingBrandGraphics] = useState<ProductPhoto[]>(() => {
    if (isNewMode || !existingProject) return [];
    const list = [...(existingProject.brandBible?.brandGraphics || [])];
    if (
      existingProject.brandBible?.brandLogoUrl &&
      !list.some((g) => g.url === existingProject.brandBible.brandLogoUrl)
    ) {
      list.unshift({
        id: 'primary-logo',
        url: existingProject.brandBible.brandLogoUrl,
        caption: existingProject.brandBible.brandLogoCaption || 'Primary Brand Logo',
      });
    }
    return list;
  });

  const displayedPhotos = isNewMode ? stagedPhotos : existingPhotos;
  const displayedBrandGraphics = isNewMode ? stagedBrandGraphics : existingBrandGraphics;

  const [audience, setAudience] = useState(
    isNewMode ? '' : existingProject?.intake.audience || ''
  );
  const [tone, setTone] = useState(isNewMode ? '' : existingProject?.intake.tone || '');
  const [clientMarketingIdeas, setClientMarketingIdeas] = useState(
    isNewMode ? '' : existingProject?.intake.clientMarketingIdeas || ''
  );
  const [videosWanted, setVideosWanted] = useState(
    isNewMode ? '' : existingProject?.intake.videosWanted || ''
  );
  const [shootNotes, setShootNotes] = useState(
    isNewMode ? '' : existingProject?.intake.shootLocationDatesBudgetNotes || ''
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isUploadingGraphic, setIsUploadingGraphic] = useState(false);
  const [photoPickerTarget, setPhotoPickerTarget] = useState<'product' | 'logo' | null>(null);
  const [refFilePickerOpen, setRefFilePickerOpen] = useState(false);
  const [refPickerFilter, setRefPickerFilter] = useState<DriveMediaFilter>('all');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const brandGraphicInputRef = useRef<HTMLInputElement>(null);

  // PDF Brand & Style Guide intake state
  const [brandGuideDocuments, setBrandGuideDocuments] = useState<BrandGuideDocument[]>(
    isNewMode ? [] : existingProject?.brandGuideDocuments || []
  );
  const [stagedGuidePdfs, setStagedGuidePdfs] = useState<
    Array<{ name: string; dataUrl: string; graphicCount?: number }>
  >([]);
  const [extractedStyleGuide, setExtractedStyleGuide] = useState<ExtractedStyleGuide | null>(
    isNewMode ? null : existingProject?.extractedStyleGuide || null
  );
  const [initialLogoDataUrl, setInitialLogoDataUrl] = useState<string | null>(null);
  const [existingLogoUrl, setExistingLogoUrl] = useState<string | null>(
    isNewMode ? null : existingProject?.brandBible?.brandLogoUrl || null
  );
  const [isParsingLocalGuide, setIsParsingLocalGuide] = useState(false);
  const [localGuideStatus, setLocalGuideStatus] = useState<string | null>(null);
  const [isDraggingGuidePdf, setIsDraggingGuidePdf] = useState(false);
  const guideFileInputRef = useRef<HTMLInputElement>(null);

  // Sync Firebase Auth listener & existing token on mount
  useEffect(() => {
    getGoogleDriveAccessToken().then((token) => {
      if (token) setDriveToken(token);
      const user = getGoogleDriveUser();
      if (user?.email) setDriveUserEmail(user.email);
    });

    const unsub = initDriveAuth(
      (user, token) => {
        setDriveToken(token);
        setDriveUserEmail(user.email || null);
      },
      () => {
        setDriveToken(null);
        setDriveUserEmail(null);
      }
    );
    return () => unsub();
  }, []);

  // Keep local backup and destination url synced when project updates
  useEffect(() => {
    if (!isNewMode && existingProject) {
      if (existingProject.googleDriveDestinationFolderUrl) {
        setDestinationFolderUrl(existingProject.googleDriveDestinationFolderUrl);
      }
      if (existingProject.googleDriveDestinationFolderId) {
        setDestinationFolderId(existingProject.googleDriveDestinationFolderId);
      }
      if (existingProject.googleDriveDestinationFolderName) {
        setDestinationFolderName(existingProject.googleDriveDestinationFolderName);
      }
      if (existingProject.googleDriveBackupFolderUrl) {
        setBackupFolderUrl(existingProject.googleDriveBackupFolderUrl);
      }
      if (existingProject.googleDriveSyncStatus) {
        setDriveSyncStatus(existingProject.googleDriveSyncStatus);
      }
      if (existingProject.brandGuideDocuments) {
        setBrandGuideDocuments(existingProject.brandGuideDocuments);
      }
      if (existingProject.extractedStyleGuide !== undefined) {
        setExtractedStyleGuide(existingProject.extractedStyleGuide || null);
      }
      if (existingProject.brandBible?.brandLogoUrl !== undefined) {
        setExistingLogoUrl(existingProject.brandBible.brandLogoUrl || null);
      }
      if (existingProject.brandBible?.brandGraphics) {
        setExistingBrandGraphics(existingProject.brandBible.brandGraphics);
      }
      if (existingProject.product?.photos) {
        setExistingPhotos(existingProject.product.photos);
      }
    }
  }, [
    isNewMode,
    existingProject?.googleDriveDestinationFolderUrl,
    existingProject?.googleDriveDestinationFolderId,
    existingProject?.googleDriveDestinationFolderName,
    existingProject?.googleDriveBackupFolderUrl,
    existingProject?.googleDriveSyncStatus,
    existingProject?.brandGuideDocuments,
    existingProject?.extractedStyleGuide,
    existingProject?.brandBible?.brandLogoUrl,
    existingProject?.brandBible?.brandGraphics,
    existingProject?.product?.photos,
  ]);

  // Persist googleDriveFolderUrls only when they genuinely differ from saved project
  useEffect(() => {
    if (isNewMode || !existingProject) return;
    const validUrls = googleDriveFolderUrls.map((u) => u.trim()).filter(Boolean);
    const savedUrls = existingProject.googleDriveFolderUrls || [];
    if (JSON.stringify(validUrls) !== JSON.stringify(savedUrls)) {
      void onUpdateProject({
        ...existingProject,
        googleDriveFolderUrls: validUrls,
        googleDriveFolderUrl: validUrls[0] || undefined,
      });
    }
  }, [googleDriveFolderUrls, isNewMode, existingProject?.id]);

  const handleConnectDrive = async (forceConsent = false) => {
    setErrorMsg(null);
    setDriveErrorMsg(null);
    setIsConnectingDrive(true);
    try {
      const res = await signInWithGoogleDrive(forceConsent);
      setDriveToken(res.accessToken);
      setDriveUserEmail(res.user.email || null);
    } catch (err) {
      setDriveErrorMsg(
        err instanceof Error ? err.message : 'Could not sign in with Google.'
      );
    } finally {
      setIsConnectingDrive(false);
    }
  };

  const handleDisconnectDrive = async () => {
    await logoutGoogleDrive();
    setDriveToken(null);
    setDriveUserEmail(null);
    setDriveStatusNote(null);
  };

  const applyParsedIntakeResult = async (
    result: ParsedDriveIntakeResult,
    sourceLabel: string,
    opts?: {
      validUrls?: string[];
      allFiles?: DriveFileItem[];
      lockedIds?: Record<string, boolean>;
    }
  ) => {
    const { parsed } = result;
    if (parsed.client) setClient(parsed.client);
    if (parsed.productName) setProductName(parsed.productName);
    if (parsed.productDescription) setProductDescription(parsed.productDescription);
    if (Array.isArray(parsed.provableClaims) && parsed.provableClaims.length > 0) {
      setClaims(parsed.provableClaims);
    }
    if (parsed.audience) setAudience(parsed.audience);
    if (parsed.tone) setTone(parsed.tone);
    if (parsed.clientMarketingIdeas) setClientMarketingIdeas(parsed.clientMarketingIdeas);
    if (parsed.videosWanted) setVideosWanted(parsed.videosWanted);
    if (parsed.shootLocationDatesBudgetNotes) setShootNotes(parsed.shootLocationDatesBudgetNotes);

    if (result.styleGuide) {
      setExtractedStyleGuide(result.styleGuide);
    }

    if (Array.isArray(result.stagedGuidePdfs) && result.stagedGuidePdfs.length > 0) {
      setStagedGuidePdfs((prev) => {
        const seen = new Set(prev.map((d) => d.name));
        const additions = result.stagedGuidePdfs!.filter((d) => !seen.has(d.name));
        return [...prev, ...additions];
      });
    }

    if (Array.isArray(result.brandGuideDocuments) && result.brandGuideDocuments.length > 0) {
      setBrandGuideDocuments((prev) => {
        const seen = new Set(prev.map((d) => d.url || d.name));
        const additions = result.brandGuideDocuments!.filter(
          (d) => !seen.has(d.url || d.name)
        );
        return [...prev, ...additions];
      });
    }

    let nextPhotos = existingPhotos;
    if (
      (isNewMode || !existingProject) &&
      Array.isArray(result.importedPhotoDataUrls) &&
      result.importedPhotoDataUrls.length > 0
    ) {
      setStagedPhotos((prev) => {
        const existingCaptions = new Set(prev.map((p) => p.caption));
        const additions = result
          .importedPhotoDataUrls!.filter((img) => !existingCaptions.has(img.caption))
          .map((img, idx) => ({
            id: `intake-staged-${Date.now()}-${idx}`,
            dataUrl: img.dataUrl,
            caption: img.caption,
          }));
        return [...prev, ...additions];
      });
    } else if (
      existingProject &&
      Array.isArray(result.importedPhotos) &&
      result.importedPhotos.length > 0
    ) {
      const seenUrls = new Set(existingPhotos.map((p) => p.url));
      const uniqueAdditions = result.importedPhotos.filter((p) => !seenUrls.has(p.url));
      if (uniqueAdditions.length > 0) {
        nextPhotos = [...existingPhotos, ...uniqueAdditions];
        setExistingPhotos(nextPhotos);
      }
    }

    let nextBrandGraphics = existingBrandGraphics;
    if (
      (isNewMode || !existingProject) &&
      Array.isArray(result.importedBrandGraphicsDataUrls) &&
      result.importedBrandGraphicsDataUrls.length > 0
    ) {
      setStagedBrandGraphics((prev) => {
        const existingCaptions = new Set(prev.map((p) => p.caption));
        const additions = result
          .importedBrandGraphicsDataUrls!.filter((img) => !existingCaptions.has(img.caption))
          .map((img, idx) => ({
            id: `intake-graphic-staged-${Date.now()}-${idx}`,
            dataUrl: img.dataUrl,
            caption: img.caption,
          }));
        return [...prev, ...additions];
      });
    } else if (
      existingProject &&
      Array.isArray(result.importedBrandGraphics) &&
      result.importedBrandGraphics.length > 0
    ) {
      const seenUrls = new Set(existingBrandGraphics.map((g) => g.url));
      const uniqueAdditions = result.importedBrandGraphics.filter((g) => !seenUrls.has(g.url));
      if (uniqueAdditions.length > 0) {
        nextBrandGraphics = [...existingBrandGraphics, ...uniqueAdditions];
        setExistingBrandGraphics(nextBrandGraphics);
      }
    }

    let nextLogoUrl = existingLogoUrl;
    if ((isNewMode || !existingProject) && result.suggestedLogoDataUrl && !initialLogoDataUrl) {
      setInitialLogoDataUrl(result.suggestedLogoDataUrl);
    } else if (existingProject && result.suggestedLogoUrl && !existingLogoUrl) {
      nextLogoUrl = result.suggestedLogoUrl;
      setExistingLogoUrl(result.suggestedLogoUrl);
    }

    if (existingProject) {
      const mergedDocs = (() => {
        const prev = existingProject.brandGuideDocuments || [];
        const add = result.brandGuideDocuments || [];
        const seen = new Set(prev.map((d) => d.url || d.name));
        return [...prev, ...add.filter((d) => !seen.has(d.url || d.name))];
      })();

      const mergedBrandBible = {
        ...existingProject.brandBible,
        brandLogoUrl: existingProject.brandBible.brandLogoUrl || nextLogoUrl || undefined,
        brandGraphics: nextBrandGraphics,
        positioning:
          existingProject.brandBible.positioning ||
          result.styleGuide?.summary ||
          existingProject.brandBible.positioning,
        visualStyle: {
          ...existingProject.brandBible.visualStyle,
          palette:
            existingProject.brandBible.visualStyle.palette ||
            result.styleGuide?.palette ||
            '',
          typography:
            existingProject.brandBible.visualStyle.typography ||
            result.styleGuide?.typography ||
            '',
          lighting:
            existingProject.brandBible.visualStyle.lighting ||
            result.styleGuide?.lighting ||
            '',
          lensAndFraming:
            existingProject.brandBible.visualStyle.lensAndFraming ||
            result.styleGuide?.lensAndFraming ||
            '',
          grade:
            existingProject.brandBible.visualStyle.grade ||
            result.styleGuide?.grade ||
            '',
        },
        productRules:
          existingProject.brandBible.productRules ||
          result.styleGuide?.productVisualRules ||
          '',
      };

      const lockedRefsPayload =
        opts?.allFiles && opts.allFiles.length > 0
          ? opts.allFiles.map((f) => ({
              fileId: f.id,
              name: f.name,
              mimeType: f.mimeType,
              webViewLink: f.webViewLink,
              folderUrl: f.folderUrl,
              selected: opts.lockedIds ? Boolean(opts.lockedIds[f.id]) : true,
            }))
          : existingProject.lockedDriveReferences;

      await onUpdateProject({
        ...existingProject,
        client: parsed.client || existingProject.client,
        product: {
          ...existingProject.product,
          name: parsed.productName || existingProject.product.name,
          description:
            parsed.productDescription || existingProject.product.description,
          provableClaims:
            parsed.provableClaims?.length
              ? parsed.provableClaims
              : existingProject.product.provableClaims,
          photos: nextPhotos,
        },
        intake: {
          audience: parsed.audience || existingProject.intake.audience,
          tone: parsed.tone || existingProject.intake.tone,
          clientMarketingIdeas:
            parsed.clientMarketingIdeas || existingProject.intake.clientMarketingIdeas,
          videosWanted: parsed.videosWanted || existingProject.intake.videosWanted,
          shootLocationDatesBudgetNotes:
            parsed.shootLocationDatesBudgetNotes ||
            existingProject.intake.shootLocationDatesBudgetNotes,
        },
        brandGuideDocuments: mergedDocs,
        extractedStyleGuide: result.styleGuide || existingProject.extractedStyleGuide || null,
        brandBible: mergedBrandBible,
        ...(opts?.validUrls
          ? {
              googleDriveFolderUrls: opts.validUrls,
              googleDriveFolderUrl: opts.validUrls[0],
            }
          : {}),
        lockedDriveReferences: lockedRefsPayload,
      });
    }

    const importedCount =
      (result.importedPhotos?.length || 0) +
      (result.importedPhotoDataUrls?.length || 0) +
      (result.importedBrandGraphics?.length || 0) +
      (result.importedBrandGraphicsDataUrls?.length || 0);
    const pdfCount = result.extractedGraphicCount ?? 0;
    const summaryText = `Analyzed ${result.analyzedFiles.length} ${sourceLabel} file(s)${
      importedCount > 0
        ? ` and imported ${importedCount} image(s)${pdfCount > 0 ? ` (${pdfCount} extracted from PDF graphics)` : ''}`
        : ''
    }.${result.warnings?.length ? ` Note: ${result.warnings.join(' ')}` : ''}`;

    return summaryText;
  };

  const handleSelectReferenceDriveFiles = async (picked: DriveFileItem[]) => {
    if (!picked || picked.length === 0) return;
    setDriveErrorMsg(null);
    setLocalGuideStatus(null);

    const nextFilesMap = new Map<string, DriveFileItem>();
    driveFiles.forEach((f) => nextFilesMap.set(f.id, f));
    picked.forEach((f) => nextFilesMap.set(f.id, f));
    const mergedFiles = Array.from(nextFilesMap.values());

    const nextLocked: Record<string, boolean> = { ...lockedFileIds };
    picked.forEach((f) => {
      nextLocked[f.id] = true;
    });

    setDriveFiles(mergedFiles);
    setLockedFileIds(nextLocked);

    // Immediately lock & parse selected files and populate intake
    setIsParsingDrive(true);
    try {
      let token = driveToken;
      if (!token) {
        const res = await signInWithGoogleDrive(true);
        token = res.accessToken;
        setDriveToken(token);
        setDriveUserEmail(res.user.email || null);
      }
      const validUrls = googleDriveFolderUrls.map((u) => u.trim()).filter(Boolean);
      const selectedFiles = mergedFiles.filter((f) => Boolean(nextLocked[f.id]));
      const result = await parseGoogleDriveFolder(
        existingProject?.id || 'new',
        validUrls,
        picked,
        token
      );
      const note = await applyParsedIntakeResult(result, 'Google Drive', {
        validUrls: validUrls.length ? validUrls : undefined,
        allFiles: selectedFiles,
        lockedIds: nextLocked,
      });
      setDriveStatusNote(note);
      setLocalGuideStatus(note);

      if (existingProject && (destinationFolderId || validUrls.length > 0)) {
        void triggerDriveAutoSave(existingProject.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not read selected Drive files.';
      setDriveErrorMsg(msg);
    } finally {
      setIsParsingDrive(false);
    }
  };

  const handleLocalGuideUpload = async (files: File[]) => {
    const pdfFiles = files.filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (pdfFiles.length === 0) {
      setErrorMsg('Please select at least one PDF brand/style guide file.');
      return;
    }

    setErrorMsg(null);
    setLocalGuideStatus(null);
    setIsParsingLocalGuide(true);

    try {
      const payloads = await Promise.all(
        pdfFiles.map(
          (file) =>
            new Promise<{ name: string; dataUrl: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({ name: file.name, dataUrl: String(reader.result || '') });
              reader.onerror = () =>
                reject(new Error(`Could not read PDF file: ${file.name}`));
              reader.readAsDataURL(file);
            })
        )
      );

      const result = await parseLocalStyleGuidePdfs(
        existingProject?.id || 'new',
        payloads
      );
      const summary = await applyParsedIntakeResult(result, 'PDF guide');
      setLocalGuideStatus(summary);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not extract information and graphics from PDF.'
      );
    } finally {
      setIsParsingLocalGuide(false);
    }
  };

  const handleAutoParseDrive = async () => {
    const validUrls = googleDriveFolderUrls.map((u) => u.trim()).filter(Boolean);
    const selectedFiles = driveFiles.filter((f) => Boolean(lockedFileIds[f.id]));

    if (validUrls.length === 0 && selectedFiles.length === 0) {
      setDriveErrorMsg('Enter at least one Google Drive folder URL or click "Browse & Pick Files" first.');
      return;
    }

    setErrorMsg(null);
    setDriveErrorMsg(null);
    setDriveStatusNote(null);
    setIsParsingDrive(true);

    try {
      let token = driveToken;
      if (!token) {
        const authRes = await signInWithGoogleDrive(true);
        token = authRes.accessToken;
        setDriveToken(token);
        setDriveUserEmail(authRes.user.email || null);
      }

      let filesToAnalyze: DriveFileItem[] = selectedFiles;
      if (filesToAnalyze.length === 0 && validUrls.length > 0) {
        filesToAnalyze = await listGoogleDriveFolderFiles(validUrls, token);
      }

      if (filesToAnalyze.length === 0) {
        setDriveErrorMsg(
          'No files were found in the linked Google Drive folder(s). Verify the folder URL(s) or browse Drive to pick files.'
        );
        return;
      }

      const result = await parseGoogleDriveFolder(
        existingProject?.id || 'new',
        validUrls,
        filesToAnalyze,
        token
      );

      const summaryNote = await applyParsedIntakeResult(result, 'Drive', {
        validUrls,
        allFiles: selectedFiles.length > 0 ? selectedFiles : filesToAnalyze,
        lockedIds: lockedFileIds,
      });
      setDriveStatusNote(summaryNote);
      if (existingProject && (destinationFolderId || validUrls.length > 0)) {
        void triggerDriveAutoSave(existingProject.id);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not analyze Google Drive files.';
      setDriveErrorMsg(msg);
      if (
        msg.toLowerCase().includes('sign in') ||
        msg.toLowerCase().includes('expired') ||
        msg.toLowerCase().includes('permission')
      ) {
        setDriveToken(null);
      }
    } finally {
      setIsParsingDrive(false);
    }
  };

  const handlePhotoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setIsUploadingPhoto(true);

    try {
      let runningExisting = [...existingPhotos];
      for (let i = 0; i < files.length; i++) {
        const dataUrl = await readAndOptimizeLocalImage(files[i], 1400);
        if (isNewMode || !existingProject) {
          setStagedPhotos((prev) => [
            ...prev,
            {
              id: `staged-${Date.now()}-${i}`,
              dataUrl,
              caption: files[i].name,
            },
          ]);
        } else {
          const resp = await fetch(`/api/projects/${existingProject.id}/assets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, prefix: 'product' }),
          });
          const data = await parseJsonResponse<{ url: string; error?: string }>(
            resp,
            'Could not upload photo.'
          );
          const nextPhoto: ProductPhoto = {
            id: `photo-${Date.now()}-${i}`,
            url: data.url,
            caption: files[i].name,
          };
          runningExisting = [...runningExisting, nextPhoto];
          setExistingPhotos(runningExisting);
        }
      }
      if (!isNewMode && existingProject && runningExisting.length > existingPhotos.length) {
        await onUpdateProject({
          ...existingProject,
          product: {
            ...existingProject.product,
            photos: runningExisting,
          },
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not add product photo.');
    } finally {
      setIsUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleBrandGraphicSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setIsUploadingGraphic(true);

    try {
      let runningExisting = [...existingBrandGraphics];
      let nextLogo = existingLogoUrl;
      for (let i = 0; i < files.length; i++) {
        const dataUrl = await readAndOptimizeLocalImage(files[i], 1400);
        if (isNewMode || !existingProject) {
          setStagedBrandGraphics((prev) => [
            ...prev,
            {
              id: `staged-graphic-${Date.now()}-${i}`,
              dataUrl,
              caption: files[i].name,
            },
          ]);
          if (i === 0 && !initialLogoDataUrl) {
            setInitialLogoDataUrl(dataUrl);
          }
        } else {
          const resp = await fetch(`/api/projects/${existingProject.id}/assets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, prefix: 'logo' }),
          });
          const data = await parseJsonResponse<{ url: string; error?: string }>(
            resp,
            'Could not upload brand graphic.'
          );
          const nextGraphic: ProductPhoto = {
            id: `logo-${Date.now()}-${i}`,
            url: data.url,
            caption: files[i].name,
          };
          runningExisting = [...runningExisting, nextGraphic];
          if (!nextLogo) nextLogo = data.url;
        }
      }
      if (!isNewMode && existingProject && runningExisting.length > existingBrandGraphics.length) {
        setExistingBrandGraphics(runningExisting);
        setExistingLogoUrl(nextLogo);
        await onUpdateProject({
          ...existingProject,
          brandBible: {
            ...existingProject.brandBible,
            brandLogoUrl: nextLogo,
            brandLogoCaption:
              existingProject.brandBible.brandLogoCaption || runningExisting[0]?.caption,
            brandGraphics: runningExisting,
          },
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not add brand logo or graphic.');
    } finally {
      setIsUploadingGraphic(false);
      e.target.value = '';
    }
  };

  const handleDriveAssetsImported = async (assets: ImportedDriveAsset[]) => {
    setErrorMsg(null);
    if (photoPickerTarget === 'logo') {
      if (isNewMode || !existingProject) {
        const additions = assets
          .filter((a) => Boolean(a.dataUrl))
          .map((a, idx) => ({
            id: `drive-graphic-${Date.now()}-${idx}`,
            dataUrl: a.dataUrl!,
            caption: a.name,
          }));
        if (additions.length > 0) {
          setStagedBrandGraphics((prev) => [...prev, ...additions]);
          if (!initialLogoDataUrl) {
            setInitialLogoDataUrl(additions[0].dataUrl);
          }
        }
      } else {
        const additions: ProductPhoto[] = assets
          .filter((a) => Boolean(a.url))
          .map((a, idx) => ({
            id: `logo-drive-${Date.now()}-${idx}`,
            url: a.url!,
            caption: a.name,
          }));
        if (additions.length > 0) {
          const nextGraphics = [...existingBrandGraphics, ...additions];
          const nextLogo = existingLogoUrl || additions[0].url;
          setExistingBrandGraphics(nextGraphics);
          setExistingLogoUrl(nextLogo);
          await onUpdateProject({
            ...existingProject,
            brandBible: {
              ...existingProject.brandBible,
              brandLogoUrl: nextLogo,
              brandLogoCaption:
                existingProject.brandBible.brandLogoCaption || additions[0].caption,
              brandGraphics: nextGraphics,
            },
          });
        }
      }
      return;
    }

    if (isNewMode || !existingProject) {
      const additions = assets
        .filter((a) => Boolean(a.dataUrl))
        .map((a, idx) => ({
          id: `drive-photo-${Date.now()}-${idx}`,
          dataUrl: a.dataUrl!,
          caption: a.name,
        }));
      if (additions.length > 0) {
        setStagedPhotos((prev) => [...prev, ...additions]);
      }
    } else {
      const additions: ProductPhoto[] = assets
        .filter((a) => Boolean(a.url))
        .map((a, idx) => ({
          id: `photo-drive-${Date.now()}-${idx}`,
          url: a.url!,
          caption: a.name,
        }));
      if (additions.length > 0) {
        const nextPhotos = [...existingPhotos, ...additions];
        setExistingPhotos(nextPhotos);
        await onUpdateProject({
          ...existingProject,
          product: {
            ...existingProject.product,
            photos: nextPhotos,
          },
        });
      }
    }
  };

  const handleSelectDestinationFolder = (folder: { id: string; name: string; url: string }) => {
    setDestinationFolderId(folder.id);
    setDestinationFolderName(folder.name);
    setDestinationFolderUrl(folder.url);
    setBackupFolderUrl(folder.url);
    setDriveStatusNote(`Save destination set to "${folder.name}".`);
    if (!isNewMode && existingProject) {
      void onUpdateProject({
        ...existingProject,
        googleDriveDestinationFolderId: folder.id,
        googleDriveDestinationFolderName: folder.name,
        googleDriveDestinationFolderUrl: folder.url,
        googleDriveBackupFolderId: folder.id,
        googleDriveBackupFolderUrl: folder.url,
      });
    }
  };

  const handleCreateDedicatedDriveFolder = async () => {
    let token = driveToken;
    if (!token) {
      try {
        const res = await signInWithGoogleDrive(false);
        token = res.accessToken;
        setDriveToken(token);
        setDriveUserEmail(res.user.email || null);
      } catch (err) {
        setDriveErrorMsg(
          err instanceof Error ? err.message : 'Sign in with Google to create your Drive folder.'
        );
        return;
      }
    }

    setIsCreatingDedicatedFolder(true);
    setDriveErrorMsg(null);
    try {
      const folderName = `52Launch Studio — ${client.trim() || 'Client'} (${productName.trim() || 'Product'})`;
      const created = await createDriveFolderOnDrive({
        accessToken: token,
        name: folderName,
      });
      const url = created.webViewLink || `https://drive.google.com/drive/folders/${created.id}`;
      setDestinationFolderId(created.id);
      setDestinationFolderName(created.name);
      setDestinationFolderUrl(url);
      setBackupFolderUrl(url);
      setDriveStatusNote(`Created and linked dedicated folder "${created.name}" on Google Drive!`);
      if (!isNewMode && existingProject) {
        await onUpdateProject({
          ...existingProject,
          googleDriveDestinationFolderId: created.id,
          googleDriveDestinationFolderName: created.name,
          googleDriveDestinationFolderUrl: url,
          googleDriveBackupFolderId: created.id,
          googleDriveBackupFolderUrl: url,
        });
      }
    } catch (err) {
      setDriveErrorMsg(err instanceof Error ? err.message : 'Could not create Google Drive folder.');
    } finally {
      setIsCreatingDedicatedFolder(false);
    }
  };

  const triggerDriveAutoSave = async (projectId: string) => {
    const validUrls = googleDriveFolderUrls.map((u) => u.trim()).filter(Boolean);
    setDriveErrorMsg(null);
    let token = (await getGoogleDriveAccessToken()) || driveToken;
    if (!token) {
      try {
        const authRes = await signInWithGoogleDrive(true);
        token = authRes.accessToken;
        setDriveToken(token);
        setDriveUserEmail(authRes.user.email || null);
      } catch (err) {
        setDriveSyncStatus('error');
        setDriveErrorMsg(
          err instanceof Error ? err.message : 'Sign in with Google to save to Drive.'
        );
        return;
      }
    }

    setIsSyncingDrive(true);
    setDriveSyncStatus('syncing');
    try {
      const performSync = (activeToken: string) =>
        syncProjectToDriveServer(
          projectId,
          validUrls,
          activeToken,
          destinationFolderId,
          destinationFolderUrl,
          { skipPdfGeneration: true }
        );

      let syncRes;
      try {
        syncRes = await performSync(token);
      } catch (firstErr) {
        const firstMsg = firstErr instanceof Error ? firstErr.message.toLowerCase() : '';
        const isAuthFailure =
          firstMsg.includes('expired') ||
          firstMsg.includes('not connected') ||
          firstMsg.includes('reconnect') ||
          firstMsg.includes('permission') ||
          firstMsg.includes('sign in');

        if (!isAuthFailure) {
          throw firstErr;
        }

        // Token expired or lacked Drive write scopes — clear stale token, prompt fresh OAuth, and retry once
        setDriveToken(null);
        const refreshed = await signInWithGoogleDrive(true);
        token = refreshed.accessToken;
        setDriveToken(token);
        setDriveUserEmail(refreshed.user.email || null);
        syncRes = await performSync(token);
      }

      // Fetch latest project snapshot and upload richly formatted PDFs matching local downloads
      let projectForPdfs: PipelineProject | null = existingProject || null;
      try {
        const projResp = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
        if (projResp.ok) {
          const projData = (await projResp.json()) as { project?: PipelineProject };
          if (projData?.project) projectForPdfs = projData.project;
        }
      } catch {
        // Use existingProject snapshot fallback
      }

      let pdfUploaded: string[] = [];
      let pdfErrors: string[] = [];
      if (projectForPdfs) {
        const targetProj: PipelineProject = {
          ...projectForPdfs,
          googleDriveDestinationFolderId:
            destinationFolderId ||
            syncRes.backupFolderId ||
            projectForPdfs.googleDriveDestinationFolderId,
          googleDriveDestinationFolderUrl:
            destinationFolderUrl ||
            syncRes.backupFolderUrl ||
            projectForPdfs.googleDriveDestinationFolderUrl,
          googleDriveBackupFolderId:
            syncRes.backupFolderId || projectForPdfs.googleDriveBackupFolderId,
          googleDriveBackupFolderUrl:
            syncRes.backupFolderUrl || projectForPdfs.googleDriveBackupFolderUrl,
        };
        const pdfSyncRes = await syncAllFormattedPdfsToDrive(targetProj, {
          accessToken: token,
          onProgress: (msg) => setDriveStatusNote(msg),
        });
        pdfUploaded = pdfSyncRes.uploadedFiles;
        pdfErrors = pdfSyncRes.errors;
        if (pdfSyncRes.backupFolderUrl) {
          setBackupFolderUrl(pdfSyncRes.backupFolderUrl);
        }
      }

      const allUploaded = [...(syncRes.uploadedFiles || []), ...pdfUploaded];
      setDriveSyncStatus(pdfErrors.length > 0 && pdfUploaded.length === 0 ? 'error' : 'synced');
      if (syncRes.backupFolderUrl) {
        setBackupFolderUrl(syncRes.backupFolderUrl);
      }
      if (allUploaded.length > 0) {
        setDriveStatusNote(
          `Saved ${allUploaded.length} file(s) to Google Drive (${allUploaded.join(', ')}).`
        );
      }
      if (pdfErrors.length > 0) {
        setDriveErrorMsg(`Some PDFs failed to upload: ${pdfErrors[0]}`);
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not sync backup to Google Drive.';
      if (
        msg.toLowerCase().includes('expired') ||
        msg.toLowerCase().includes('not connected') ||
        msg.toLowerCase().includes('permission') ||
        msg.toLowerCase().includes('sign in')
      ) {
        setDriveToken(null);
      }
      setDriveSyncStatus('error');
      setDriveErrorMsg(msg);
    } finally {
      setIsSyncingDrive(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!client.trim() || !productName.trim()) {
      setErrorMsg('Please enter both a client name and a product name.');
      return;
    }

    const cleanedClaims = claims.map((c) => c.trim()).filter(Boolean);
    const validUrls = googleDriveFolderUrls.map((u) => u.trim()).filter(Boolean);
    const selectedOnly = driveFiles.filter((f) => Boolean(lockedFileIds[f.id]));
    const lockedReferences = selectedOnly.map((f) => ({
      fileId: f.id,
      name: f.name,
      mimeType: f.mimeType,
      webViewLink: f.webViewLink,
      folderUrl: f.folderUrl,
      selected: true,
    }));

    setIsSaving(true);
    try {
      if (isNewMode || !existingProject) {
        await onCreateProject({
          client: client.trim(),
          product: {
            name: productName.trim(),
            description: productDescription.trim(),
            provableClaims: cleanedClaims,
          },
          intake: {
            audience: audience.trim(),
            tone: tone.trim(),
            clientMarketingIdeas: clientMarketingIdeas.trim(),
            videosWanted: videosWanted.trim(),
            shootLocationDatesBudgetNotes: shootNotes.trim(),
          },
          initialPhotoDataUrls: stagedPhotos.map((p) => ({
            dataUrl: p.dataUrl,
            caption: p.caption,
          })),
          initialBrandGraphicsDataUrls: stagedBrandGraphics.map((g) => ({
            dataUrl: g.dataUrl,
            caption: g.caption,
          })),
          extractedStyleGuide,
          stagedGuidePdfs,
          initialLogoDataUrl:
            initialLogoDataUrl || stagedBrandGraphics[0]?.dataUrl || null,
          googleDriveFolderUrls: validUrls,
          googleDriveDestinationFolderId: destinationFolderId,
          googleDriveDestinationFolderUrl: destinationFolderUrl,
          googleDriveDestinationFolderName: destinationFolderName,
          lockedDriveReferences: lockedReferences,
        });
      } else {
        const updated: PipelineProject = {
          ...existingProject,
          client: client.trim(),
          product: {
            name: productName.trim(),
            description: productDescription.trim(),
            provableClaims: cleanedClaims,
            photos: existingPhotos,
          },
          intake: {
            audience: audience.trim(),
            tone: tone.trim(),
            clientMarketingIdeas: clientMarketingIdeas.trim(),
            videosWanted: videosWanted.trim(),
            shootLocationDatesBudgetNotes: shootNotes.trim(),
          },
          brandGuideDocuments,
          extractedStyleGuide,
          brandBible: {
            ...existingProject.brandBible,
            brandLogoUrl: existingLogoUrl ?? existingBrandGraphics[0]?.url ?? existingProject.brandBible.brandLogoUrl,
            brandGraphics: existingBrandGraphics,
          },
          googleDriveFolderUrls: validUrls,
          googleDriveFolderUrl: validUrls[0] || undefined,
          googleDriveDestinationFolderId: destinationFolderId || existingProject.googleDriveDestinationFolderId,
          googleDriveDestinationFolderUrl: destinationFolderUrl || existingProject.googleDriveDestinationFolderUrl,
          googleDriveDestinationFolderName: destinationFolderName || existingProject.googleDriveDestinationFolderName,
          lockedDriveReferences: lockedReferences,
          googleDriveSyncStatus: driveSyncStatus,
          approvals: {
            ...existingProject.approvals,
            intakeCompleted: true,
          },
        };

        await onUpdateProject(updated);
        onProceedToBible();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not save project.');
    } finally {
      setIsSaving(false);
    }
  };

  const selectedDriveFiles = driveFiles.filter((f) => Boolean(lockedFileIds[f.id]));

  const handleRemoveSelectedDriveFile = (fileId: string) => {
    setDriveFiles((prev) => prev.filter((f) => f.id !== fileId));
    setLockedFileIds((prev) => {
      const next = { ...prev };
      delete next[fileId];
      return next;
    });
  };

  return (
    <div className="max-w-[1120px] mx-auto px-6 py-7 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E2E2E6] pb-5">
        <div>
          <div className="text-xs font-medium text-[#C6202F]">
            Step 1 · Project &amp; Client Intake &amp; Google Drive Sync
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111114] mt-1">
            {isNewMode
              ? 'Start a New Client Product Project'
              : `${existingProject?.client} — ${existingProject?.product.name}`}
          </h1>
          <p className="text-sm text-[#5A5A66] mt-1">
            Link multiple Google Drive folders, lock key style guides &amp; product assets, and extract real intake details.
          </p>
        </div>

        {/* Google Drive Status Badge */}
        <div className="flex items-center gap-2.5">
          {backupFolderUrl && (
            <a
              href={backupFolderUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-300 text-xs text-emerald-800 hover:bg-emerald-100 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Drive Auto-Save
            </a>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-[#E2E2E6] text-xs">
            <FolderSync
              className={`w-4 h-4 ${
                driveSyncStatus === 'synced'
                  ? 'text-emerald-700'
                  : driveSyncStatus === 'syncing'
                    ? 'text-[#C6202F] animate-spin'
                    : driveSyncStatus === 'error'
                      ? 'text-[#C6202F]'
                      : 'text-[#5A5A66]'
              }`}
            />
            <span className="text-[#3A3A44]">
              {driveSyncStatus === 'synced'
                ? 'Drive Auto-Save: Synced'
                : driveSyncStatus === 'syncing'
                  ? 'Syncing to Drive...'
                  : driveSyncStatus === 'error'
                    ? 'Drive Sync Error'
                    : googleDriveFolderUrls.some((u) => u.trim())
                      ? 'Drive Linked'
                      : 'Drive Unlinked'}
            </span>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-300 text-xs text-[#891A23]">
          {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Google Drive Save Destination Section - Full User Control */}
        <section className="bg-white border-2 border-[#111114]/10 rounded-xl p-6 space-y-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-[#FDF4F5] border border-[#C6202F]/20 flex items-center justify-center shrink-0 mt-0.5">
                <HardDrive className="w-5 h-5 text-[#C6202F]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-[#111114]">
                    Save Destination on Google Drive
                  </h2>
                  <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase bg-[#C6202F]/10 text-[#C6202F] rounded">
                    Primary Output
                  </span>
                </div>
                <p className="text-xs text-[#5A5A66] mt-0.5 max-w-2xl">
                  Control exactly where all generated project deliverables, PDFs, storyboard frames, and backups are stored. No random folders or scattered files.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!driveToken ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={isConnectingDrive}
                    onClick={() => void handleConnectDrive()}
                    className="inline-flex items-center gap-2.5 px-3.5 py-2 text-xs font-semibold text-[#1F1F1F] bg-white border border-[#D5D5DC] hover:bg-[#F2F2F5] disabled:opacity-50 rounded-lg cursor-pointer transition-colors shadow-sm"
                  >
                    {isConnectingDrive ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[#4A4A55]" />
                    ) : (
                      <svg
                        version="1.1"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 48 48"
                        className="w-4 h-4 shrink-0"
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                      </svg>
                    )}
                    <span>{isConnectingDrive ? 'Signing in...' : 'Sign in with Google Drive'}</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    {driveUserEmail ? `Connected (${driveUserEmail})` : 'Drive Connected'}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleDisconnectDrive()}
                    title="Disconnect Google Drive"
                    className="p-1.5 text-[#5A5A66] hover:text-[#C6202F] bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Destination Folder Banner */}
          <div className="p-4 rounded-xl bg-[#FBFBFC] border border-[#E2E2E6] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#C6202F]/10 flex items-center justify-center text-[#C6202F]">
                  <Folder className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-[11px] font-semibold text-[#5A5A66] uppercase tracking-wider">
                    Current Save Target Folder
                  </div>
                  <div className="text-sm font-bold text-[#111114] flex items-center gap-2">
                    <span>
                      {destinationFolderName ||
                        (destinationFolderUrl
                          ? 'Linked Drive Target Folder'
                          : `52Launch Studio — ${client.trim() || 'Client'} (${productName.trim() || 'Product'}) [Default]`)}
                    </span>
                    {destinationFolderUrl && (
                      <a
                        href={destinationFolderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#C6202F] hover:underline"
                        title="Open folder directly on Google Drive"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Open on Drive
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDestinationPickerOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#111114] bg-white border border-[#D5D5DC] hover:border-[#C6202F] hover:text-[#C6202F] rounded-lg cursor-pointer transition-colors shadow-sm"
                >
                  <FolderSync className="w-3.5 h-3.5 text-[#C6202F]" />
                  Browse Google Drive
                </button>
                <button
                  type="button"
                  disabled={isCreatingDedicatedFolder}
                  onClick={() => void handleCreateDedicatedDriveFolder()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#C6202F] bg-[#FDF4F5] border border-[#C6202F]/30 hover:bg-[#FCE8EB] disabled:opacity-40 rounded-lg cursor-pointer transition-colors"
                >
                  {isCreatingDedicatedFolder ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <FolderPlus className="w-3.5 h-3.5" />
                  )}
                  Create Dedicated Project Folder
                </button>
              </div>
            </div>

            {!driveToken &&
              (Boolean(destinationFolderId || destinationFolderUrl || backupFolderUrl) ||
                googleDriveFolderUrls.some((u) => u.trim())) && (
                <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Google Drive is disconnected for this browser tab (Drive tokens clear on page reload or when expired). Reconnect to sync files or auto-save PDFs.
                  </span>
                  <button
                    type="button"
                    disabled={isConnectingDrive}
                    onClick={() => void handleConnectDrive(true)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-amber-950 bg-white border border-amber-300 hover:bg-amber-100 rounded-md cursor-pointer shrink-0"
                  >
                    {isConnectingDrive ? 'Connecting...' : 'Reconnect Google Drive'}
                  </button>
                </div>
              )}

            {driveErrorMsg && (() => {
              const isUnauthorizedDomain = driveErrorMsg.includes('auth/unauthorized-domain');
              const authInfo = isUnauthorizedDomain ? getFirebaseAuthorizedDomainsInfo() : null;
              return (
                <div className="px-3 py-2.5 rounded-lg bg-rose-50 border border-rose-300 text-xs text-[#891A23] flex flex-wrap items-center justify-between gap-2">
                  <span className="flex-1 min-w-[220px]">{driveErrorMsg}</span>
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {authInfo?.hostname && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard?.writeText(authInfo.hostname);
                            setDriveStatusNote(`Copied "${authInfo.hostname}" to clipboard.`);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#891A23] bg-white border border-rose-300 hover:bg-rose-100 rounded-md cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                          Copy Domain
                        </button>
                        <a
                          href={authInfo.consoleUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#891A23] bg-white border border-rose-300 hover:bg-rose-100 rounded-md"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open Firebase Auth Settings
                        </a>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={isConnectingDrive}
                      onClick={() => void handleConnectDrive(true)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-50 rounded-md cursor-pointer shrink-0"
                    >
                      {isConnectingDrive ? 'Connecting...' : 'Retry Sign In'}
                    </button>
                  </div>
                </div>
              );
            })()}

            {/* Deliverables Checklist */}
            <div className="pt-3 border-t border-[#EAEAEF]">
              <div className="text-[11px] font-semibold text-[#3A3A44] uppercase tracking-wider mb-2">
                All Deliverables &amp; Reference Files Automatically Saved Here:
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E2E2E6] text-xs text-[#3A3A44]">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-mono text-[11px] font-semibold text-[#111114]">brand-bible.pdf</span>
                  <span className="text-[10px] text-[#6E6E7A]">(Brand rules &amp; logos)</span>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E2E2E6] text-xs text-[#3A3A44]">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-mono text-[11px] font-semibold text-[#111114]">creative-brief.pdf</span>
                  <span className="text-[10px] text-[#6E6E7A]">(Concepts &amp; strategy)</span>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E2E2E6] text-xs text-[#3A3A44]">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-mono text-[11px] font-semibold text-[#111114]">shotlist-storyboard.pdf</span>
                  <span className="text-[10px] text-[#6E6E7A]">(Shots &amp; frames)</span>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E2E2E6] text-xs text-[#3A3A44]">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-mono text-[11px] font-semibold text-[#111114]">vo-script.pdf</span>
                  <span className="text-[10px] text-[#6E6E7A]">(Voiceover &amp; timing)</span>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E2E2E6] text-xs text-[#3A3A44]">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-mono text-[11px] font-semibold text-[#111114]">shoot-plan-call-sheet.pdf</span>
                  <span className="text-[10px] text-[#6E6E7A]">(Schedule &amp; crew)</span>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E2E2E6] text-xs text-[#3A3A44]">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-mono text-[11px] font-semibold text-[#111114]">master-production-book.pdf</span>
                  <span className="text-[10px] text-[#6E6E7A]">(Full book + 16:9 deck)</span>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E2E2E6] text-xs text-[#3A3A44]">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-mono text-[11px] font-semibold text-[#111114]">Reference Files/</span>
                  <span className="text-[10px] text-[#6E6E7A]">(Locked docs, photos &amp; logos)</span>
                </div>
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E2E2E6] text-xs text-[#3A3A44]">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="font-mono text-[11px] font-semibold text-[#111114]">Storyboards &amp; Frames/</span>
                  <span className="text-[10px] text-[#6E6E7A]">(Generated frames + JSON)</span>
                </div>
                {existingProject && (
                  <button
                    type="button"
                    disabled={isSyncingDrive}
                    onClick={() => void triggerDriveAutoSave(existingProject.id)}
                    className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#C6202F] text-white text-xs font-semibold hover:bg-[#AD1A27] disabled:opacity-50 cursor-pointer shadow-sm"
                  >
                    {isSyncingDrive ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <FolderSync className="w-3 h-3" />
                    )}
                    Sync All Files Now
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Unified Brand Assets, Style Guides & Intake Sources */}
        <section className="bg-white border border-[#E2E2E6] rounded-xl p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[#111114] flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-[#C6202F]" />
                Brand Assets, Style Guides &amp; Source Files
              </h2>
              <p className="text-xs text-[#5A5A66] mt-0.5">
                Link Google Drive folders or pick files, extract info &amp; graphics from PDF brand guides, and attach product photos.
              </p>
            </div>

            {(googleDriveFolderUrls.some((u) => u.trim()) || selectedDriveFiles.length > 0) && (
              <button
                type="button"
                disabled={isParsingDrive || isSyncingDrive}
                onClick={() => void handleAutoParseDrive()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 rounded-lg cursor-pointer transition-colors shadow"
              >
                {isParsingDrive ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                {isParsingDrive
                  ? 'Reading & Analyzing Files...'
                  : selectedDriveFiles.length > 0
                    ? `Auto-Fill from ${selectedDriveFiles.length} Selected File${selectedDriveFiles.length > 1 ? 's' : ''}`
                    : 'Auto-Fill Intake from Drive'}
              </button>
            )}
          </div>

          {driveErrorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-300 text-xs text-[#891A23] flex flex-wrap items-center justify-between gap-2">
              <span className="flex-1 min-w-[240px]">{driveErrorMsg}</span>
              <button
                type="button"
                disabled={isConnectingDrive}
                onClick={() => void handleConnectDrive(true)}
                className="px-3 py-1.5 text-[11px] font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-50 rounded-md cursor-pointer shrink-0"
              >
                {isConnectingDrive ? 'Connecting...' : 'Re-authorize Drive Read Access'}
              </button>
            </div>
          )}

          {driveStatusNote && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-300 text-xs text-emerald-900">
              {driveStatusNote}
            </div>
          )}

          {/* 1. Google Drive Reference Sources & Selected Files */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-[#111114] flex items-center gap-1.5">
                <FolderSync className="w-4 h-4 text-[#C6202F]" />
                Google Drive Sources
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isParsingDrive}
                  onClick={() => {
                    setRefPickerFilter('all');
                    setRefFilePickerOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#111114] bg-white hover:bg-[#FDF4F5] border border-[#D5D5DC] hover:border-[#C6202F] hover:text-[#C6202F] disabled:opacity-50 rounded-lg cursor-pointer transition-colors"
                >
                  <FileText className="w-3.5 h-3.5 text-[#C6202F]" />
                  Pick Reference Files from Drive
                </button>
                <button
                  type="button"
                  onClick={() => setSourceFolderPickerOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#111114] bg-[#F6F6F7] hover:bg-[#EAEAEF] border border-[#D5D5DC] rounded-lg cursor-pointer transition-colors"
                >
                  <FolderSync className="w-3.5 h-3.5 text-[#C6202F]" />
                  Browse Source Folders
                </button>
                <button
                  type="button"
                  onClick={() => setGoogleDriveFolderUrls((prev) => [...prev, ''])}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#C6202F] hover:text-[#891A23] cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add folder URL
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {googleDriveFolderUrls.map((url, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => {
                      const val = e.target.value;
                      setGoogleDriveFolderUrls((prev) =>
                        prev.map((item, i) => (i === idx ? val : item))
                      );
                    }}
                    placeholder={`https://drive.google.com/drive/folders/folder-${idx + 1}...`}
                    className="flex-1 bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2 text-xs text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F] font-mono"
                  />
                  {googleDriveFolderUrls.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setGoogleDriveFolderUrls((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="p-2 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                      aria-label="Remove folder URL"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {selectedDriveFiles.length > 0 && (
              <div className="pt-2 space-y-2">
                <div className="text-[11px] font-semibold text-[#5A5A66] uppercase tracking-wider">
                  Selected Reference Files ({selectedDriveFiles.length})
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedDriveFiles.map((file) => (
                    <div
                      key={file.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FDF4F5] border border-[#EABAC0] text-xs text-[#891A23]"
                    >
                      <FileText className="w-3.5 h-3.5 text-[#C6202F] shrink-0" />
                      <span className="font-medium max-w-[240px] truncate">{file.name}</span>
                      {file.webViewLink && (
                        <a
                          href={file.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#C6202F] hover:text-[#111114] ml-0.5"
                          title="Open in Google Drive"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveSelectedDriveFile(file.id)}
                        className="ml-0.5 text-[#891A23] hover:text-[#111114] cursor-pointer"
                        aria-label={`Remove ${file.name}`}
                        title="Remove selected file"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 2. Brand & Style Guide PDFs */}
          <div className="pt-5 border-t border-[#EAEAEF] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-[#111114] flex items-center gap-1.5">
                  <Palette className="w-4 h-4 text-[#C6202F]" />
                  Brand &amp; Style Guide PDFs
                </div>
                <p className="text-[11px] text-[#5A5A66] mt-0.5">
                  Extracts typography, hex swatches, lighting/lens rules, and embedded raster graphics into your asset library.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isParsingDrive}
                  onClick={() => {
                    setRefPickerFilter('pdf_and_docs');
                    setRefFilePickerOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] hover:bg-[#FCE8EA] disabled:opacity-50 rounded-lg cursor-pointer transition-colors"
                >
                  <FolderSync className="w-3.5 h-3.5" />
                  Pick PDFs from Drive
                </button>
                <button
                  type="button"
                  disabled={isParsingLocalGuide}
                  onClick={() => guideFileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#111114] hover:bg-[#24242B] disabled:opacity-50 rounded-lg cursor-pointer transition-colors"
                >
                  {isParsingLocalGuide ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" />
                  )}
                  {isParsingLocalGuide ? 'Extracting PDF...' : 'Upload PDF Guide(s)'}
                </button>
                <input
                  ref={guideFileInputRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []);
                    if (files.length > 0) void handleLocalGuideUpload(files);
                    e.target.value = '';
                  }}
                />
              </div>
            </div>

            <div
              onClick={() => !isParsingLocalGuide && guideFileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingGuidePdf(true);
              }}
              onDragLeave={() => setIsDraggingGuidePdf(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingGuidePdf(false);
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length > 0) void handleLocalGuideUpload(files);
              }}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                isDraggingGuidePdf
                  ? 'border-[#C6202F] bg-[#FDF4F5]'
                  : 'border-[#E2E2E6] hover:border-[#C6202F]/60 bg-[#FBFBFC]'
              }`}
            >
              {isParsingLocalGuide ? (
                <div className="flex items-center justify-center gap-2 text-xs text-[#891A23] font-medium">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Reading PDF structure, color codes, rules, and extracting embedded graphics...
                </div>
              ) : (
                <div className="text-xs text-[#5A5A66]">
                  <span className="font-semibold text-[#111114]">Drag &amp; drop PDF brand/style guide(s) here</span> or click to browse local PDFs
                </div>
              )}
            </div>

            {localGuideStatus && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-300 text-xs text-emerald-900">
                {localGuideStatus}
              </div>
            )}

            {(brandGuideDocuments.length > 0 || stagedGuidePdfs.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {brandGuideDocuments.map((doc) => (
                  <a
                    key={doc.id || doc.url}
                    href={doc.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#C6202F] text-xs text-[#111114]"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#C6202F]" />
                    <span className="font-medium">{doc.name}</span>
                    {typeof doc.graphicCount === 'number' && doc.graphicCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-white border border-[#E2E2E6] text-[10px] font-mono text-[#5A5A66]">
                        {doc.graphicCount} graphics
                      </span>
                    )}
                    <ExternalLink className="w-3 h-3 text-[#6E6E7A]" />
                  </a>
                ))}
                {stagedGuidePdfs.map((doc, idx) => (
                  <div
                    key={`${doc.name}-${idx}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#FDF4F5] border border-[#EABAC0] text-xs text-[#891A23]"
                  >
                    <FileText className="w-3.5 h-3.5 text-[#C6202F]" />
                    <span className="font-medium">{doc.name}</span>
                    {typeof doc.graphicCount === 'number' && doc.graphicCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-white border border-[#EABAC0] text-[10px] font-mono">
                        {doc.graphicCount} graphics
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        setStagedGuidePdfs((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="ml-1 text-[#891A23] hover:text-[#111114] cursor-pointer"
                      aria-label={`Remove ${doc.name}`}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {extractedStyleGuide && (
              <div className="p-4 rounded-xl bg-[#FBFBFC] border border-[#E2E2E6] space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-semibold text-[#111114] flex items-center gap-1.5">
                    <Palette className="w-4 h-4 text-[#C6202F]" />
                    Extracted Brand &amp; Style Guide Specifications
                  </div>
                  {extractedStyleGuide.sourceFileNames?.length > 0 && (
                    <span className="text-[11px] text-[#6E6E7A]">
                      Sources: {extractedStyleGuide.sourceFileNames.join(', ')}
                    </span>
                  )}
                </div>

                {extractedStyleGuide.summary && (
                  <p className="text-[#3A3A44] leading-relaxed">{extractedStyleGuide.summary}</p>
                )}

                {extractedStyleGuide.paletteHexes?.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold text-[#5A5A66]">Palette:</span>
                    {extractedStyleGuide.paletteHexes.map((hex) => (
                      <div
                        key={hex}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-white border border-[#E2E2E6] font-mono text-[11px]"
                      >
                        <span
                          className="w-3 h-3 rounded-sm border border-black/15 shrink-0"
                          style={{ backgroundColor: hex }}
                        />
                        <span>{hex}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  {extractedStyleGuide.typography && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6E7A]">
                        Typography
                      </div>
                      <div className="text-[#24242B] mt-0.5">{extractedStyleGuide.typography}</div>
                    </div>
                  )}
                  {extractedStyleGuide.lighting && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6E7A]">
                        Lighting Direction
                      </div>
                      <div className="text-[#24242B] mt-0.5">{extractedStyleGuide.lighting}</div>
                    </div>
                  )}
                  {extractedStyleGuide.lensAndFraming && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6E7A]">
                        Lens &amp; Framing
                      </div>
                      <div className="text-[#24242B] mt-0.5">{extractedStyleGuide.lensAndFraming}</div>
                    </div>
                  )}
                  {extractedStyleGuide.grade && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6E7A]">
                        Color Grade
                      </div>
                      <div className="text-[#24242B] mt-0.5">{extractedStyleGuide.grade}</div>
                    </div>
                  )}
                  {extractedStyleGuide.brandLogoNotes && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6E7A]">
                        Logo Guidelines
                      </div>
                      <div className="text-[#24242B] mt-0.5">{extractedStyleGuide.brandLogoNotes}</div>
                    </div>
                  )}
                  {extractedStyleGuide.productVisualRules && (
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6E6E7A]">
                        Product &amp; Brand Rules
                      </div>
                      <div className="text-[#24242B] mt-0.5">{extractedStyleGuide.productVisualRules}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 3. Product Photos (Multiple Angles) & Brand Graphics / Logos */}
          <div className="pt-5 border-t border-[#EAEAEF] grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 3A. Multiple Product Photos */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-[#111114] flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4 text-[#C6202F]" />
                    Product Photos (Multiple Angles)
                    {displayedPhotos.length > 0 && (
                      <span className="text-[11px] font-mono font-normal text-[#6E6E7A]">
                        ({displayedPhotos.length})
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#5A5A66] mt-0.5">
                    Add front, back, side, and in-hand angles of the product for consistent generation.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPhotoPickerTarget('product')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] hover:bg-[#FCE8EA] rounded-lg cursor-pointer transition-colors"
                  >
                    <FolderSync className="w-3.5 h-3.5" />
                    Pick from Drive
                  </button>
                  <button
                    type="button"
                    disabled={isUploadingPhoto}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#24242B] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
                  >
                    {isUploadingPhoto ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6202F]" />
                    ) : (
                      <Upload className="w-3.5 h-3.5 text-[#C6202F]" />
                    )}
                    {isUploadingPhoto ? 'Uploading...' : 'Upload Angles'}
                  </button>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void handlePhotoSelect(e)}
                />
              </div>

              {displayedPhotos.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {displayedPhotos.map((p, idx) => {
                    const imgSrc = (p as ProductPhoto).url || (p as { dataUrl: string }).dataUrl;
                    return (
                      <div
                        key={p.id || idx}
                        className="bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg overflow-hidden flex flex-col aspect-square relative group"
                      >
                        <img
                          src={imgSrc}
                          alt={p.caption || `Product Angle ${idx + 1}`}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono text-white">
                          Angle {idx + 1}
                        </span>
                        {p.caption && (
                          <div className="absolute bottom-0 inset-x-0 bg-black/75 px-2 py-1 text-[10px] text-white truncate">
                            {p.caption}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (isNewMode || !existingProject) {
                              setStagedPhotos((prev) => prev.filter((_, i) => i !== idx));
                            } else {
                              const next = existingPhotos.filter((_, i) => i !== idx);
                              setExistingPhotos(next);
                              void onUpdateProject({
                                ...existingProject,
                                product: { ...existingProject.product, photos: next },
                              });
                            }
                          }}
                          className="absolute top-2 right-2 p-1.5 bg-black/80 text-white/85 hover:text-[#FCA5A5] rounded-md opacity-0 group-hover:opacity-100 cursor-pointer"
                          title="Remove product photo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-[#E2E2E6] hover:border-[#C6202F]/70 bg-[#FBFBFC] rounded-xl p-6 text-center cursor-pointer transition-colors"
                >
                  <ImageIcon className="w-7 h-7 text-[#8A8A96] mx-auto mb-1.5" />
                  <div className="text-xs font-medium text-[#3A3A44]">
                    Upload multiple product angles (PNG, JPG or WEBP)
                  </div>
                </div>
              )}
            </div>

            {/* 3B. Multiple Brand Logos & Graphics */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-[#111114] flex items-center gap-1.5">
                    <Award className="w-4 h-4 text-[#C6202F]" />
                    Brand Logos &amp; Graphics (Variations)
                    {displayedBrandGraphics.length > 0 && (
                      <span className="text-[11px] font-mono font-normal text-[#6E6E7A]">
                        ({displayedBrandGraphics.length})
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#5A5A66] mt-0.5">
                    Add horizontal, stacked, icon, dark/light logo variations and brand graphics.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPhotoPickerTarget('logo')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#891A23] bg-[#FDF4F5] border border-[#EABAC0] hover:bg-[#FCE8EA] rounded-lg cursor-pointer transition-colors"
                  >
                    <FolderSync className="w-3.5 h-3.5" />
                    Pick from Drive
                  </button>
                  <button
                    type="button"
                    disabled={isUploadingGraphic}
                    onClick={() => brandGraphicInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#24242B] bg-[#F6F6F7] border border-[#E2E2E6] hover:border-[#891A23] rounded-lg cursor-pointer"
                  >
                    {isUploadingGraphic ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C6202F]" />
                    ) : (
                      <Upload className="w-3.5 h-3.5 text-[#C6202F]" />
                    )}
                    {isUploadingGraphic ? 'Uploading...' : 'Upload Logos'}
                  </button>
                </div>
                <input
                  ref={brandGraphicInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void handleBrandGraphicSelect(e)}
                />
              </div>

              {displayedBrandGraphics.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {displayedBrandGraphics.map((g, idx) => {
                    const imgSrc = (g as ProductPhoto).url || (g as { dataUrl: string }).dataUrl;
                    const isPrimaryLogo =
                      isNewMode || !existingProject
                        ? initialLogoDataUrl === imgSrc || (!initialLogoDataUrl && idx === 0)
                        : existingLogoUrl === imgSrc || (!existingLogoUrl && idx === 0);
                    return (
                      <div
                        key={g.id || idx}
                        className={`bg-white border rounded-lg overflow-hidden flex flex-col aspect-square relative group ${
                          isPrimaryLogo ? 'border-[#C6202F] ring-2 ring-[#C6202F]/30' : 'border-[#E2E2E6]'
                        }`}
                      >
                        <div className="flex-1 p-2 flex items-center justify-center overflow-hidden bg-white">
                          <img
                            src={imgSrc}
                            alt={g.caption || `Brand Graphic ${idx + 1}`}
                            referrerPolicy="no-referrer"
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (isNewMode || !existingProject) {
                              setInitialLogoDataUrl(imgSrc);
                            } else {
                              setExistingLogoUrl(imgSrc);
                              void onUpdateProject({
                                ...existingProject,
                                brandBible: {
                                  ...existingProject.brandBible,
                                  brandLogoUrl: imgSrc,
                                  brandLogoCaption: g.caption || 'Primary Brand Logo',
                                  brandGraphics: existingBrandGraphics,
                                },
                              });
                            }
                          }}
                          className={`absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold cursor-pointer transition-all ${
                            isPrimaryLogo
                              ? 'bg-[#C6202F] text-white shadow'
                              : 'bg-black/75 text-white/90 hover:bg-[#C6202F] opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <Award className="w-3 h-3" />
                          {isPrimaryLogo ? 'Primary Logo' : 'Set Primary'}
                        </button>
                        {g.caption && (
                          <div className="bg-black/75 px-2 py-1 text-[10px] text-white truncate">
                            {g.caption}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (isNewMode || !existingProject) {
                              const nextStaged = stagedBrandGraphics.filter((_, i) => i !== idx);
                              setStagedBrandGraphics(nextStaged);
                              if (initialLogoDataUrl === imgSrc) {
                                setInitialLogoDataUrl(nextStaged[0]?.dataUrl || null);
                              }
                            } else {
                              const next = existingBrandGraphics.filter((_, i) => i !== idx);
                              setExistingBrandGraphics(next);
                              const nextLogo =
                                existingLogoUrl === imgSrc ? next[0]?.url || null : existingLogoUrl;
                              setExistingLogoUrl(nextLogo);
                              void onUpdateProject({
                                ...existingProject,
                                brandBible: {
                                  ...existingProject.brandBible,
                                  brandLogoUrl: nextLogo,
                                  brandGraphics: next,
                                },
                              });
                            }
                          }}
                          className="absolute top-2 right-2 p-1.5 bg-black/80 text-white/85 hover:text-[#FCA5A5] rounded-md opacity-0 group-hover:opacity-100 cursor-pointer"
                          title="Remove brand graphic"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div
                  onClick={() => brandGraphicInputRef.current?.click()}
                  className="border-2 border-dashed border-[#E2E2E6] hover:border-[#C6202F]/70 bg-[#FBFBFC] rounded-xl p-6 text-center cursor-pointer transition-colors"
                >
                  <Award className="w-7 h-7 text-[#8A8A96] mx-auto mb-1.5" />
                  <div className="text-xs font-medium text-[#3A3A44]">
                    Upload logo variations &amp; brand graphics (horizontal, stacked, badges)
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Client & Product Core */}
        <section className="bg-white border border-[#E2E2E6] rounded-xl p-6 space-y-5">
          <h2 className="text-base font-semibold text-[#111114]">Client & Product</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#3A3A44] mb-1.5">
                Client name
              </label>
              <input
                type="text"
                required
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="e.g., Kinetix Bio Inc."
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2 text-sm text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#3A3A44] mb-1.5">
                Product name
              </label>
              <input
                type="text"
                required
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g., Kinetix Core Patch"
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2 text-sm text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#3A3A44] mb-1.5">
              Product description
            </label>
            <textarea
              rows={3}
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              placeholder="Explain what the product is, how it physically works, and what makes it genuinely different..."
              className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2.5 text-sm text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
            />
          </div>

          {/* Provable Claims */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#3A3A44]">
                Claims we can back up (used as strict truth guardrails across scripts)
              </label>
              <button
                type="button"
                onClick={() => setClaims((prev) => [...prev, ''])}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#C6202F] hover:text-[#891A23] cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Add claim
              </button>
            </div>

            <div className="space-y-2">
              {claims.map((claim, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={claim}
                    onChange={(e) =>
                      setClaims((prev) =>
                        prev.map((item, i) => (i === idx ? e.target.value : item))
                      )
                    }
                    placeholder="e.g., Tested to measure sweat sodium continuously in real time"
                    className="flex-1 bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2 text-sm text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
                  />
                  {claims.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setClaims((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="p-2 text-[#6E6E7A] hover:text-[#C6202F] cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Campaign Intake & Creative Direction */}
        <section className="bg-white border border-[#E2E2E6] rounded-xl p-6 space-y-5">
          <h2 className="text-base font-semibold text-[#111114]">Campaign Intake</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#3A3A44] mb-1.5">
                Target audience
              </label>
              <input
                type="text"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="e.g., Endurance athletes & marathon runners"
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2 text-sm text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#3A3A44] mb-1.5">
                Brand tone / vibe
              </label>
              <input
                type="text"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="e.g., High-tech, gritty, scientific yet visceral"
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2 text-sm text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#3A3A44] mb-1.5">
              Client marketing ideas &amp; requirements
            </label>
            <textarea
              rows={2}
              value={clientMarketingIdeas}
              onChange={(e) => setClientMarketingIdeas(e.target.value)}
              placeholder="Any specific hooks, visual metaphors, or key angles requested by the client..."
              className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2.5 text-sm text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#3A3A44] mb-1.5">
                Videos wanted (deliverables)
              </label>
              <input
                type="text"
                value={videosWanted}
                onChange={(e) => setVideosWanted(e.target.value)}
                placeholder="e.g., 30s TVC + 15s social cutdowns"
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2 text-sm text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#3A3A44] mb-1.5">
                Shoot location / dates / budget notes
              </label>
              <input
                type="text"
                value={shootNotes}
                onChange={(e) => setShootNotes(e.target.value)}
                placeholder="e.g., Studio shoot in LA, target budget $15k"
                className="w-full bg-[#F6F6F7] border border-[#E2E2E6] rounded-lg px-3.5 py-2 text-sm text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
              />
            </div>
          </div>
        </section>

        {/* Submit Bar */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            type="submit"
            disabled={isSaving}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 brand-corner-sm cursor-pointer transition-colors shadow-lg shadow-[#C6202F]/20"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ArrowRight className="w-4 h-4" />
            )}
            {isSaving
              ? 'Saving Project...'
              : isNewMode
                ? 'Create project & continue to Brand Bible'
                : 'Save intake & continue'}
          </button>
        </div>
      </form>

      <DriveAssetPickerModal
        isOpen={photoPickerTarget !== null}
        projectId={existingProject?.id || 'new'}
        initialFolderUrls={googleDriveFolderUrls}
        mediaFilter="image"
        multiple={true}
        prefix={photoPickerTarget === 'logo' ? 'logo' : 'product'}
        title={
          photoPickerTarget === 'logo'
            ? 'Pick Brand Logos & Graphics from Google Drive'
            : 'Pick Product Photos from Google Drive'
        }
        subtitle={
          photoPickerTarget === 'logo'
            ? 'Select one or more brand logo variations or graphics from Google Drive.'
            : 'Select one or more product angle photos from Google Drive.'
        }
        onClose={() => setPhotoPickerTarget(null)}
        onImported={handleDriveAssetsImported}
        onFoldersChange={(urls) => {
          setGoogleDriveFolderUrls(urls.length > 0 ? urls : ['']);
        }}
      />

      {/* Pick Reference Files Modal (Google Docs, Sheets, Slides, PDFs, Images) */}
      <DriveAssetPickerModal
        isOpen={refFilePickerOpen}
        projectId={existingProject?.id || 'new'}
        initialFolderUrls={googleDriveFolderUrls}
        pickerMode="pick_reference_files"
        mediaFilter={refPickerFilter}
        multiple={true}
        title="Pick Reference Docs, PDFs & Briefs from Google Drive"
        subtitle="Select content briefs, call sheets, brand guides, or logo/product files to lock, save to Reference Files/, and auto-populate intake."
        onClose={() => setRefFilePickerOpen(false)}
        onSelectDriveFiles={handleSelectReferenceDriveFiles}
        onFoldersChange={(urls) => {
          setGoogleDriveFolderUrls(urls.length > 0 ? urls : ['']);
        }}
      />

      {/* Select Destination Folder Modal */}
      <DriveAssetPickerModal
        isOpen={destinationPickerOpen}
        projectId={existingProject?.id || 'new'}
        pickerMode="select_destination_folder"
        title="Select Google Drive Save Destination"
        subtitle="Browse My Drive, Shared Drives, or Shared with Me to select the folder where project files, Reference Files, and generated PDFs will be stored."
        onClose={() => setDestinationPickerOpen(false)}
        onSelectFolder={handleSelectDestinationFolder}
      />

      {/* Select Source Folder Modal */}
      <DriveAssetPickerModal
        isOpen={sourceFolderPickerOpen}
        projectId={existingProject?.id || 'new'}
        pickerMode="select_source_folder"
        title="Browse Company Google Drive for Source Folder"
        subtitle="Browse your company Drive and select a folder to add as an intake reference source."
        onClose={() => setSourceFolderPickerOpen(false)}
        onSelectFolder={(folder: { id: string; name: string; url: string }) => {
          setGoogleDriveFolderUrls((prev) =>
            Array.from(new Set([...prev.filter(Boolean), folder.url]))
          );
          setDriveStatusNote(`Added source folder "${folder.name}".`);
        }}
      />
    </div>
  );
};
