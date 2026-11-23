import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  FolderSync,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle2,
  Image as ImageIcon,
  Film,
  Music,
  FileText,
  ExternalLink,
  Plus,
  Trash2,
  LogOut,
  Check,
  Link2,
  Folder,
  FolderPlus,
  ArrowLeft,
  ChevronRight,
  HardDrive,
  Users,
  Building2,
  Copy,
} from 'lucide-react';
import {
  DriveExplorerItem,
  DriveFileItem,
  ImportedDriveAsset,
  SharedDriveItem,
  createDriveFolderOnDrive,
  extractDriveFileId,
  extractDriveFolderId,
  getDriveFileMetadata,
  getFirebaseAuthorizedDomainsInfo,
  getGoogleDriveAccessToken,
  getGoogleDriveUser,
  importDriveFilesToProject,
  initDriveAuth,
  listDriveExplorerItems,
  listGoogleDriveFolderFiles,
  listSharedDrives,
  logoutGoogleDrive,
  signInWithGoogleDrive,
} from '../../utils/googleDriveSync';

export type DriveMediaFilter = 'image' | 'video' | 'audio' | 'image_video' | 'pdf_and_docs' | 'all';
export type DriveExplorerTab = 'my_drive' | 'shared_drives' | 'shared_with_me' | 'search' | 'direct_link';
export type DrivePickerMode =
  | 'pick_assets'
  | 'pick_reference_files'
  | 'select_destination_folder'
  | 'select_source_folder';

interface DriveAssetPickerModalProps {
  isOpen: boolean;
  projectId: string;
  initialFolderUrls?: string[];
  mediaFilter?: DriveMediaFilter;
  multiple?: boolean;
  prefix?: string;
  uploadToFal?: boolean;
  title?: string;
  subtitle?: string;
  pickerMode?: DrivePickerMode;
  onClose: () => void;
  onImported?: (assets: ImportedDriveAsset[]) => void | Promise<void>;
  onSelectDriveFiles?: (files: DriveFileItem[]) => void | Promise<void>;
  onFoldersChange?: (urls: string[]) => void;
  onSelectDestinationFolder?: (folder: { id: string; name: string; url: string }) => void | Promise<void>;
  onSelectSourceFolder?: (folder: { id: string; name: string; url: string }) => void | Promise<void>;
  onSelectFolder?: (folder: { id: string; name: string; url: string }) => void | Promise<void>;
}

function classifyDriveItem(item: { mimeType?: string; name?: string }): 'folder' | 'image' | 'video' | 'audio' | 'pdf_doc' | 'other' {
  const mime = (item.mimeType || '').toLowerCase();
  const name = (item.name || '').toLowerCase();
  if (mime === 'application/vnd.google-apps.folder') return 'folder';
  if (
    mime.startsWith('image/') ||
    mime === 'application/vnd.google-apps.drawing' ||
    /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(name)
  ) {
    return 'image';
  }
  if (mime.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(name)) {
    return 'video';
  }
  if (mime.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(name)) {
    return 'audio';
  }
  if (
    mime === 'application/pdf' ||
    mime === 'application/vnd.google-apps.document' ||
    mime === 'application/vnd.google-apps.presentation' ||
    mime === 'application/vnd.google-apps.spreadsheet' ||
    mime.includes('wordprocessingml') ||
    mime.includes('presentationml') ||
    /\.(pdf|docx?|pptx?|txt|md|rtf)$/i.test(name)
  ) {
    return 'pdf_doc';
  }
  return 'other';
}

function formatFileSize(sizeStr?: string): string {
  const bytes = Number(sizeStr);
  if (!bytes || Number.isNaN(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const DriveAssetPickerModal: React.FC<DriveAssetPickerModalProps> = ({
  isOpen,
  projectId,
  initialFolderUrls = [],
  mediaFilter = 'all',
  multiple = false,
  prefix = 'drive',
  uploadToFal = false,
  title,
  subtitle,
  pickerMode = 'pick_assets',
  onClose,
  onImported,
  onSelectDriveFiles,
  onFoldersChange,
  onSelectDestinationFolder,
  onSelectSourceFolder,
  onSelectFolder,
}) => {
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [driveUserEmail, setDriveUserEmail] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);

  // Tab & navigation state
  const [activeTab, setActiveTab] = useState<DriveExplorerTab>('my_drive');
  const [navStack, setNavStack] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [sharedDrives, setSharedDrives] = useState<SharedDriveItem[]>([]);
  const [selectedSharedDrive, setSelectedSharedDrive] = useState<SharedDriveItem | null>(null);

  // Explorer items (live from Google Drive)
  const [explorerItems, setExplorerItems] = useState<DriveExplorerItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [globalSearchInput, setGlobalSearchInput] = useState('');
  const [activeSearchQuery, setActiveSearchQuery] = useState('');

  // New folder creation state
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  // Legacy direct link / folder list state
  const [folderUrls, setFolderUrls] = useState<string[]>([]);
  const [quickLinkInput, setQuickLinkInput] = useState('');
  const [showFolderEditor, setShowFolderEditor] = useState(false);

  // Asset selection state
  const [activeFilter, setActiveFilter] = useState<DriveMediaFilter>(mediaFilter);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [failedThumbs, setFailedThumbs] = useState<Record<string, boolean>>({});
  const [isImporting, setIsImporting] = useState(false);

  // Status & error messages
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const currentFolder = navStack[navStack.length - 1];

  // Initialize Auth & Tokens
  useEffect(() => {
    if (!isOpen) return;
    setActiveFilter(mediaFilter);
    setSelectedIds({});
    setFailedThumbs({});
    setErrorMsg(null);
    setStatusNote(null);
    setGlobalSearchInput('');
    setActiveSearchQuery('');
    setShowNewFolderModal(false);
    setNewFolderName('');

    const cleaned = initialFolderUrls.map((u) => u.trim()).filter(Boolean);
    setFolderUrls(cleaned);
    setShowFolderEditor(false);

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
  }, [isOpen, mediaFilter, initialFolderUrls.join('|')]);

  // Load explorer items from Google Drive whenever folder / tab / search updates
  const loadExplorer = async (token: string, tab: DriveExplorerTab, folderId: string, search: string) => {
    setErrorMsg(null);
    setIsLoadingItems(true);
    try {
      if (tab === 'shared_drives' && !selectedSharedDrive) {
        const drives = await listSharedDrives(token);
        setSharedDrives(drives);
        setExplorerItems([]);
        return;
      }

      const items = await listDriveExplorerItems({
        accessToken: token,
        folderId: tab === 'search' ? undefined : folderId,
        sharedWithMe: tab === 'shared_with_me',
        sharedDriveId: tab === 'shared_drives' ? selectedSharedDrive?.id : undefined,
        searchQuery: tab === 'search' ? search : undefined,
      });

      setExplorerItems(items);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not load files from Google Drive.';
      setErrorMsg(msg);
      if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('permission')) {
        setDriveToken(null);
      }
    } finally {
      setIsLoadingItems(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !driveToken) return;
    if (activeTab === 'direct_link') return;
    void loadExplorer(driveToken, activeTab, currentFolder.id, activeSearchQuery);
  }, [isOpen, driveToken, activeTab, currentFolder.id, selectedSharedDrive?.id, activeSearchQuery]);

  const handleConnect = async (forceConsent = false) => {
    setErrorMsg(null);
    setIsConnecting(true);
    try {
      const res = await signInWithGoogleDrive(forceConsent);
      setDriveToken(res.accessToken);
      setDriveUserEmail(res.user.email || null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not sign in with Google.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await logoutGoogleDrive();
    setDriveToken(null);
    setDriveUserEmail(null);
    setExplorerItems([]);
    setSelectedIds({});
  };

  // Folder navigation
  const navigateIntoFolder = (folder: { id: string; name: string }) => {
    setErrorMsg(null);
    setSelectedIds({});
    setNavStack((prev) => [...prev, folder]);
  };

  const navigateToBreadcrumb = (index: number) => {
    setErrorMsg(null);
    setSelectedIds({});
    setNavStack((prev) => prev.slice(0, index + 1));
  };

  const navigateUp = () => {
    if (navStack.length > 1) {
      setErrorMsg(null);
      setSelectedIds({});
      setNavStack((prev) => prev.slice(0, prev.length - 1));
    }
  };

  // Change active tab
  const handleSwitchTab = (tab: DriveExplorerTab) => {
    setActiveTab(tab);
    setErrorMsg(null);
    setSelectedIds({});
    if (tab === 'my_drive') {
      setSelectedSharedDrive(null);
      setNavStack([{ id: 'root', name: 'My Drive' }]);
    } else if (tab === 'shared_with_me') {
      setSelectedSharedDrive(null);
      setNavStack([{ id: 'shared_with_me', name: 'Shared with Me' }]);
    } else if (tab === 'shared_drives') {
      setSelectedSharedDrive(null);
      setNavStack([{ id: 'shared_drives', name: 'Shared Drives' }]);
    } else if (tab === 'search') {
      setNavStack([{ id: 'search', name: 'Search Results' }]);
    }
  };

  // Search execution
  const handleExecuteSearch = () => {
    const q = globalSearchInput.trim();
    if (!q) return;
    setActiveSearchQuery(q);
    setActiveTab('search');
    setNavStack([{ id: 'search', name: `Search: "${q}"` }]);
  };

  // Create folder inside current active folder
  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name || !driveToken) return;
    setErrorMsg(null);
    setIsCreatingFolder(true);
    try {
      const parentId = currentFolder.id !== 'search' && currentFolder.id !== 'shared_with_me' ? currentFolder.id : undefined;
      const created = await createDriveFolderOnDrive({
        accessToken: driveToken,
        name,
        parentFolderId: parentId,
      });

      setStatusNote(`Created folder "${created.name}" on Google Drive.`);
      setShowNewFolderModal(false);
      setNewFolderName('');

      // Refresh explorer & navigate into the newly created folder
      await loadExplorer(driveToken, activeTab, currentFolder.id, activeSearchQuery);
      navigateIntoFolder({ id: created.id, name: created.name });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not create Google Drive folder.');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  // Selection toggles
  const toggleSelect = (item: DriveExplorerItem) => {
    if (item.isFolder) {
      navigateIntoFolder({ id: item.id, name: item.name });
      return;
    }
    setSelectedIds((prev) => {
      if (multiple) {
        return { ...prev, [item.id]: !prev[item.id] };
      }
      return prev[item.id] ? {} : { [item.id]: true };
    });
  };

  // Filter items in current view
  const displayItems = useMemo(() => {
    return explorerItems.filter((item) => {
      if (item.isFolder) return true; // always show folders for navigation
      const kind = classifyDriveItem(item);
      if (activeFilter === 'image' && kind !== 'image') return false;
      if (activeFilter === 'video' && kind !== 'video') return false;
      if (activeFilter === 'audio' && kind !== 'audio') return false;
      if (activeFilter === 'image_video' && kind !== 'image' && kind !== 'video') return false;
      if (activeFilter === 'pdf_and_docs' && kind !== 'pdf_doc' && kind !== 'image') return false;
      return true;
    });
  }, [explorerItems, activeFilter]);

  const selectedItems = useMemo(
    () => explorerItems.filter((f) => !f.isFolder && selectedIds[f.id]),
    [explorerItems, selectedIds]
  );

  // Actions for Destination Folder Selection
  const handleConfirmDestinationFolder = async (folder: { id: string; name: string }) => {
    const url = `https://drive.google.com/drive/folders/${folder.id}`;
    const cb = onSelectDestinationFolder || onSelectFolder;
    if (cb) {
      await cb({ id: folder.id, name: folder.name, url });
    }
    onClose();
  };

  // Action for Source Folder Selection
  const handleConfirmSourceFolder = async (folder: { id: string; name: string }) => {
    const url = `https://drive.google.com/drive/folders/${folder.id}`;
    const cb = onSelectSourceFolder || onSelectFolder;
    if (cb) {
      await cb({ id: folder.id, name: folder.name, url });
    }
    if (onFoldersChange) {
      const next = folderUrls.includes(url) ? folderUrls : [...folderUrls, url];
      onFoldersChange(next);
    }
    onClose();
  };

  // Import selected assets
  const handleImportSelected = async () => {
    if (selectedItems.length === 0) return;
    setErrorMsg(null);
    let token = driveToken;
    if (!token) {
      try {
        const res = await signInWithGoogleDrive(true);
        token = res.accessToken;
        setDriveToken(token);
        setDriveUserEmail(res.user.email || null);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Sign in with Google first.');
        return;
      }
    }

    setIsImporting(true);
    try {
      const driveFileItems: DriveFileItem[] = selectedItems.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        webViewLink: f.webViewLink,
        thumbnailLink: f.thumbnailLink,
        iconLink: f.iconLink,
        size: f.size,
        modifiedTime: f.modifiedTime,
      }));

      if (pickerMode === 'pick_reference_files' && onSelectDriveFiles) {
        await onSelectDriveFiles(driveFileItems);
        onClose();
        return;
      }

      const result = await importDriveFilesToProject({
        projectId,
        files: driveFileItems,
        prefix,
        uploadToFal,
        accessToken: token,
      });

      if (onImported) {
        await onImported(result.assets);
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not import selected Drive files.';
      setErrorMsg(msg);
      if (msg.toLowerCase().includes('expired') || msg.toLowerCase().includes('sign in')) {
        setDriveToken(null);
      }
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) return null;

  const modalTitle =
    title ||
    (pickerMode === 'select_destination_folder'
      ? 'Choose Google Drive Save Destination'
      : pickerMode === 'select_source_folder'
        ? 'Select Project Source Folder'
        : pickerMode === 'pick_reference_files'
          ? 'Lock & Analyze Drive Reference Files'
          : 'Company Google Drive Explorer');

  const modalSubtitle =
    subtitle ||
    (pickerMode === 'select_destination_folder'
      ? 'Browse and choose the exact Google Drive folder where all project backups, PDFs, and assets will be saved.'
      : pickerMode === 'select_source_folder'
        ? 'Browse and select company Google Drive folders containing client style guides, creative briefs, or assets.'
        : pickerMode === 'pick_reference_files'
          ? 'Select Google Docs, Sheets, Slides, PDFs, or images to lock as reference files and auto-populate intake.'
          : 'Browse your company Google Drive directly within the studio. Click folders to open, or select files to import.');

  return (
    <div
      className="fixed inset-0 z-[75] bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
    >
      <div className="bg-white border border-[#E2E2E6] brand-corner w-full max-w-[1020px] h-[88vh] flex flex-col overflow-hidden shadow-2xl text-[#111114]">
        {/* Header Bar */}
        <div className="px-5 py-3.5 bg-[#111114] border-b-2 border-[#C6202F] flex items-center justify-between gap-3 text-white shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/brand/logo-badge-burgundy.png"
              alt="52Launch"
              className="h-10 w-auto object-contain shrink-0"
            />
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-white truncate flex items-center gap-2">
                <FolderSync className="w-4 h-4 text-[#F39CA4]" />
                {modalTitle}
              </h2>
              <p className="text-[11px] text-white/75 truncate">{modalSubtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!driveToken ? (
              <button
                type="button"
                disabled={isConnecting}
                onClick={() => void handleConnect()}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-[#1F1F1F] bg-white hover:bg-[#F2F2F5] disabled:opacity-50 brand-corner-sm cursor-pointer shadow-sm transition-colors"
              >
                {isConnecting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#4A4A55]" />
                ) : (
                  <svg viewBox="0 0 48 48" className="w-3.5 h-3.5 shrink-0">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                  </svg>
                )}
                <span>{isConnecting ? 'Signing in...' : 'Sign in with Google'}</span>
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-emerald-200 bg-emerald-950/60 border border-emerald-600/40 rounded-md">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span className="max-w-[170px] truncate">{driveUserEmail || 'Google Drive'}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void handleDisconnect()}
                  title="Disconnect Google Drive"
                  className="p-1.5 text-white/70 hover:text-white bg-white/10 hover:bg-white/20 rounded-md cursor-pointer transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={isImporting}
              onClick={onClose}
              className="p-1.5 text-white/70 hover:text-white rounded-md cursor-pointer disabled:opacity-40"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Explorer Tabs & Top Command Bar */}
        <div className="px-5 py-2.5 bg-[#F8F8FA] border-b border-[#E2E2E6] flex flex-wrap items-center justify-between gap-3 shrink-0">
          {/* Main Drive Tabs */}
          <div className="flex items-center gap-1 bg-[#EFEFF2] p-1 brand-corner-sm">
            <button
              type="button"
              onClick={() => handleSwitchTab('my_drive')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                activeTab === 'my_drive'
                  ? 'bg-white text-[#C6202F] shadow-xs'
                  : 'text-[#5A5A66] hover:text-[#111114]'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              My Drive
            </button>

            <button
              type="button"
              onClick={() => handleSwitchTab('shared_drives')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                activeTab === 'shared_drives'
                  ? 'bg-white text-[#C6202F] shadow-xs'
                  : 'text-[#5A5A66] hover:text-[#111114]'
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              Shared Drives
            </button>

            <button
              type="button"
              onClick={() => handleSwitchTab('shared_with_me')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                activeTab === 'shared_with_me'
                  ? 'bg-white text-[#C6202F] shadow-xs'
                  : 'text-[#5A5A66] hover:text-[#111114]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Shared with Me
            </button>

            <button
              type="button"
              onClick={() => handleSwitchTab('direct_link')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                activeTab === 'direct_link'
                  ? 'bg-white text-[#C6202F] shadow-xs'
                  : 'text-[#5A5A66] hover:text-[#111114]'
              }`}
            >
              <Link2 className="w-3.5 h-3.5" />
              Paste Link
            </button>
          </div>

          {/* Search Input across company Drive */}
          <div className="flex items-center gap-2">
            <div className="relative w-56 sm:w-64">
              <Search className="w-3.5 h-3.5 text-[#6E6E7A] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={globalSearchInput}
                onChange={(e) => setGlobalSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleExecuteSearch();
                  }
                }}
                placeholder="Search entire company Drive..."
                className="w-full bg-white border border-[#D8D8DF] rounded-md pl-8 pr-2.5 py-1 text-xs text-[#111114] placeholder:text-[#8A8A96] focus:outline-none focus:border-[#C6202F]"
              />
            </div>
            <button
              type="button"
              disabled={!globalSearchInput.trim() || isLoadingItems}
              onClick={handleExecuteSearch}
              className="px-2.5 py-1 text-xs font-semibold text-white bg-[#111114] hover:bg-[#2A2A34] disabled:opacity-40 rounded-md cursor-pointer transition-colors"
            >
              Search
            </button>
          </div>
        </div>

        {/* Breadcrumb Path & Folder Controls */}
        {activeTab !== 'direct_link' && (
          <div className="px-5 py-2.5 bg-white border-b border-[#E2E2E6] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
            {/* Breadcrumb Trail */}
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              {navStack.length > 1 && (
                <button
                  type="button"
                  onClick={navigateUp}
                  title="Up to parent folder"
                  className="p-1 rounded bg-[#F6F6F7] text-[#5A5A66] hover:text-[#111114] border border-[#E2E2E6] cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
              )}

              {navStack.map((crumb, idx) => {
                const isLast = idx === navStack.length - 1;
                return (
                  <React.Fragment key={crumb.id || idx}>
                    {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-[#A0A0AC] shrink-0" />}
                    <button
                      type="button"
                      disabled={isLast}
                      onClick={() => navigateToBreadcrumb(idx)}
                      className={`font-medium truncate max-w-[180px] cursor-pointer ${
                        isLast
                          ? 'font-bold text-[#111114] cursor-default'
                          : 'text-[#891A23] hover:underline'
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Folder Actions */}
            <div className="flex items-center gap-2 shrink-0">
              {driveToken && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowNewFolderModal(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#111114] bg-[#F6F6F7] hover:bg-[#EFEFF2] border border-[#D8D8DF] rounded-md cursor-pointer transition-colors"
                  >
                    <FolderPlus className="w-3.5 h-3.5 text-[#C6202F]" />
                    New Folder
                  </button>

                  <button
                    type="button"
                    disabled={isLoadingItems}
                    onClick={() => void loadExplorer(driveToken, activeTab, currentFolder.id, activeSearchQuery)}
                    title="Refresh folder contents"
                    className="p-1.5 text-[#5A5A66] hover:text-[#111114] bg-[#F6F6F7] border border-[#D8D8DF] rounded-md cursor-pointer transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingItems ? 'animate-spin text-[#C6202F]' : ''}`} />
                  </button>
                </>
              )}

              {(pickerMode === 'pick_assets' || pickerMode === 'pick_reference_files') && (
                <div className="flex items-center gap-1 bg-[#F6F6F7] p-0.5 rounded border border-[#E2E2E6]">
                  {(['all', 'image', 'video', 'audio', 'pdf_and_docs'] as DriveMediaFilter[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setActiveFilter(m)}
                      className={`px-2 py-0.5 text-[11px] font-semibold rounded cursor-pointer capitalize ${
                        activeFilter === m
                          ? 'bg-[#C6202F] text-white'
                          : 'text-[#5A5A66] hover:text-[#111114]'
                      }`}
                    >
                      {m === 'pdf_and_docs' ? 'PDF & Docs' : m}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Save Destination Selected Folder Banner (when in Destination Picker Mode) */}
        {pickerMode === 'select_destination_folder' && activeTab !== 'direct_link' && (
          <div className="px-5 py-2.5 bg-[#FDF4F5] border-b border-[#EABAC0] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex items-center gap-2">
              <Folder className="w-4 h-4 text-[#C6202F] shrink-0" />
              <div>
                <span className="text-[#5A5A66]">Active Folder: </span>
                <strong className="text-[#111114]">{currentFolder.name}</strong>
                <span className="text-[11px] text-[#6E6E7A] ml-2">
                  (Project JSON, Shotlist PDF, Call Sheet PDF, frames &amp; book will save here)
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleConfirmDestinationFolder(currentFolder)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] brand-corner-sm cursor-pointer shadow-xs transition-colors"
            >
              <Check className="w-3.5 h-3.5" />
              Use "{currentFolder.name}" as Save Destination
            </button>
          </div>
        )}

        {/* Source Folder Selection Banner */}
        {pickerMode === 'select_source_folder' && activeTab !== 'direct_link' && (
          <div className="px-5 py-2.5 bg-[#F6F6F7] border-b border-[#E2E2E6] flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex items-center gap-2">
              <Folder className="w-4 h-4 text-[#891A23] shrink-0" />
              <div>
                <span className="text-[#5A5A66]">Active Folder: </span>
                <strong className="text-[#111114]">{currentFolder.name}</strong>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleConfirmSourceFolder(currentFolder)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#891A23] hover:bg-[#6E141C] brand-corner-sm cursor-pointer transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add "{currentFolder.name}" to Project Asset Sources
            </button>
          </div>
        )}

        {/* Main Explorer View */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-white">
          {errorMsg && (() => {
            const isUnauthorizedDomain = errorMsg.includes('auth/unauthorized-domain');
            const authInfo = isUnauthorizedDomain ? getFirebaseAuthorizedDomainsInfo() : null;
            return (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-300 text-xs text-[#891A23] flex flex-wrap items-center justify-between gap-2">
                <span className="flex-1 min-w-[220px]">{errorMsg}</span>
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  {authInfo?.hostname && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(authInfo.hostname);
                          setStatusNote(`Copied "${authInfo.hostname}" to clipboard.`);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#891A23] bg-white border border-rose-300 hover:bg-rose-100 rounded cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        Copy Domain
                      </button>
                      <a
                        href={authInfo.consoleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#891A23] bg-white border border-rose-300 hover:bg-rose-100 rounded"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Open Firebase Auth Settings
                      </a>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={isConnecting}
                    onClick={() => void handleConnect(true)}
                    className="px-2.5 py-1 text-[11px] font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] rounded cursor-pointer shrink-0"
                  >
                    {isConnecting ? 'Reconnecting...' : isUnauthorizedDomain ? 'Retry Sign In' : 'Grant Drive Read Access'}
                  </button>
                </div>
              </div>
            );
          })()}

          {statusNote && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-300 text-xs text-emerald-900">
              {statusNote}
            </div>
          )}

          {!driveToken ? (
            <div className="py-16 text-center space-y-3">
              <FolderSync className="w-10 h-10 text-[#C6202F] mx-auto" />
              <div className="text-base font-bold text-[#111114]">
                Connect your Google Drive account
              </div>
              <p className="text-xs text-[#5A5A66] max-w-md mx-auto leading-relaxed">
                Browse My Drive, Shared Drives, and team files directly inside this studio. Pick product photos, logos, select save destination folders, or lock key reference docs.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  disabled={isConnecting}
                  onClick={() => void handleConnect(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-50 brand-corner-sm cursor-pointer shadow-xs"
                >
                  {isConnecting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FolderSync className="w-4 h-4" />
                  )}
                  {isConnecting ? 'Signing in...' : 'Sign in with Google Drive'}
                </button>
              </div>
            </div>
          ) : isLoadingItems ? (
            <div className="py-20 flex flex-col items-center justify-center gap-2.5 text-xs text-[#5A5A66]">
              <Loader2 className="w-6 h-6 animate-spin text-[#C6202F]" />
              Loading contents from Google Drive...
            </div>
          ) : activeTab === 'direct_link' ? (
            /* Direct Link Fallback / Advanced Editor */
            <div className="space-y-4 max-w-xl mx-auto py-6">
              <div className="space-y-1 text-center">
                <h3 className="text-sm font-bold text-[#111114]">Paste Direct Google Drive Link</h3>
                <p className="text-xs text-[#5A5A66]">
                  Paste any folder URL or file URL from Google Drive to inspect or load immediately.
                </p>
              </div>

              <div className="flex gap-2">
                <input
                  type="url"
                  value={quickLinkInput}
                  onChange={(e) => setQuickLinkInput(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/... or /file/d/..."
                  className="flex-1 bg-[#F6F6F7] border border-[#D8D8DF] rounded-md px-3 py-2 text-xs font-mono text-[#111114] focus:outline-none focus:border-[#C6202F]"
                />
                <button
                  type="button"
                  disabled={!quickLinkInput.trim()}
                  onClick={async () => {
                    const raw = quickLinkInput.trim();
                    const folderId = extractDriveFolderId(raw);
                    if (folderId) {
                      navigateIntoFolder({ id: folderId, name: `Folder (${folderId.slice(0, 8)}...)` });
                      setActiveTab('my_drive');
                      setQuickLinkInput('');
                      return;
                    }
                    const fileId = extractDriveFileId(raw);
                    if (fileId && driveToken) {
                      try {
                        const fileMeta = await getDriveFileMetadata(fileId, driveToken);
                        setExplorerItems([
                          {
                            id: fileMeta.id,
                            name: fileMeta.name,
                            mimeType: fileMeta.mimeType,
                            isFolder: false,
                            webViewLink: fileMeta.webViewLink,
                            thumbnailLink: fileMeta.thumbnailLink,
                            iconLink: fileMeta.iconLink,
                            size: fileMeta.size,
                            modifiedTime: fileMeta.modifiedTime,
                          },
                        ]);
                        setSelectedIds({ [fileMeta.id]: true });
                        setActiveTab('my_drive');
                        setQuickLinkInput('');
                        setStatusNote(`Loaded "${fileMeta.name}" directly.`);
                      } catch (err) {
                        setErrorMsg(err instanceof Error ? err.message : 'Could not load that file.');
                      }
                      return;
                    }
                    setErrorMsg('Please paste a valid Google Drive folder or file link.');
                  }}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 brand-corner-sm cursor-pointer"
                >
                  Load
                </button>
              </div>
            </div>
          ) : activeTab === 'shared_drives' && !selectedSharedDrive ? (
            /* Shared Drives Root Directory */
            <div className="space-y-3">
              <div className="text-xs font-semibold text-[#5A5A66]">Company Shared Drives ({sharedDrives.length})</div>
              {sharedDrives.length === 0 ? (
                <div className="py-12 text-center text-xs text-[#5A5A66]">
                  No Shared Drives found in your company Google account.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {sharedDrives.map((sd) => (
                    <div
                      key={sd.id}
                      onClick={() => {
                        setSelectedSharedDrive(sd);
                        setNavStack([{ id: sd.id, name: sd.name }]);
                      }}
                      className="p-3.5 bg-[#F8F8FA] hover:bg-white border border-[#E2E2E6] hover:border-[#C6202F] brand-corner-sm cursor-pointer transition-colors flex items-center justify-between gap-3 shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Building2 className="w-5 h-5 text-[#C6202F] shrink-0" />
                        <span className="text-xs font-bold text-[#111114] truncate">{sd.name}</span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#A0A0AC] shrink-0" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : displayItems.length === 0 ? (
            <div className="py-16 text-center space-y-2 text-xs text-[#5A5A66]">
              <Folder className="w-8 h-8 text-[#A0A0AC] mx-auto mb-1" />
              <p>This folder is empty.</p>
              {pickerMode === 'select_destination_folder' && (
                <p className="text-[#111114] font-medium">
                  You can use this empty folder as your Save Destination or create subfolders here!
                </p>
              )}
            </div>
          ) : (
            /* Explorer Grid of Folders and Files */
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {displayItems.map((item) => {
                const isSelected = Boolean(selectedIds[item.id]);
                const kind = classifyDriveItem(item);
                const sizeText = formatFileSize(item.size);

                if (item.isFolder) {
                  return (
                    <div
                      key={item.id}
                      onClick={() => navigateIntoFolder({ id: item.id, name: item.name })}
                      className="group bg-[#F8F8FA] hover:bg-white border border-[#E2E2E6] hover:border-[#C6202F] brand-corner-sm p-3 flex flex-col justify-between cursor-pointer transition-colors shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Folder className="w-7 h-7 text-[#C6202F] shrink-0 group-hover:scale-105 transition-transform" />
                        {pickerMode === 'select_destination_folder' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleConfirmDestinationFolder({ id: item.id, name: item.name });
                            }}
                            title="Set this folder as Save Destination"
                            className="px-1.5 py-0.5 text-[10px] font-semibold text-[#891A23] bg-[#FDF4F5] hover:bg-[#FCE8EA] border border-[#EABAC0] rounded"
                          >
                            Select
                          </button>
                        )}
                        {pickerMode === 'select_source_folder' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleConfirmSourceFolder({ id: item.id, name: item.name });
                            }}
                            title="Add this folder to sources"
                            className="px-1.5 py-0.5 text-[10px] font-semibold text-[#891A23] bg-[#FDF4F5] hover:bg-[#FCE8EA] border border-[#EABAC0] rounded"
                          >
                            Add
                          </button>
                        )}
                      </div>
                      <div className="mt-2 min-w-0">
                        <div className="text-xs font-bold text-[#111114] truncate" title={item.name}>
                          {item.name}
                        </div>
                        <div className="text-[10px] text-[#6E6E7A] mt-0.5">Folder · Click to open</div>
                      </div>
                    </div>
                  );
                }

                // File Card
                const showThumb = Boolean(item.thumbnailLink) && !failedThumbs[item.id];
                return (
                  <div
                    key={item.id}
                    onClick={() => toggleSelect(item)}
                    className={`group rounded-xl border overflow-hidden cursor-pointer transition-all flex flex-col bg-[#F8F8FA] ${
                      isSelected
                        ? 'border-[#C6202F] ring-2 ring-[#C6202F]/30 bg-white'
                        : 'border-[#E2E2E6] hover:border-[#891A23]'
                    }`}
                  >
                    <div className="aspect-video bg-black relative flex items-center justify-center overflow-hidden">
                      {showThumb ? (
                        <img
                          src={item.thumbnailLink}
                          alt={item.name}
                          referrerPolicy="no-referrer"
                          onError={() => setFailedThumbs((prev) => ({ ...prev, [item.id]: true }))}
                          className="w-full h-full object-cover"
                        />
                      ) : kind === 'image' ? (
                        <ImageIcon className="w-7 h-7 text-[#891A23]/75" />
                      ) : kind === 'video' ? (
                        <Film className="w-7 h-7 text-[#891A23]/75" />
                      ) : kind === 'audio' ? (
                        <Music className="w-7 h-7 text-emerald-700/80" />
                      ) : (
                        <FileText className="w-7 h-7 text-[#6E6E7A]" />
                      )}

                      {(pickerMode === 'pick_assets' || pickerMode === 'pick_reference_files') && (
                        <span
                          className={`absolute top-2 left-2 w-5 h-5 rounded-md flex items-center justify-center border ${
                            isSelected
                              ? 'bg-[#C6202F] border-[#EABAC0] text-white'
                              : 'bg-black/75 border-white/20 text-transparent group-hover:border-white/50'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </span>
                      )}

                      <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-mono uppercase text-white">
                        {kind === 'pdf_doc' ? 'PDF / Doc' : kind}
                      </span>

                      {item.webViewLink && (
                        <a
                          href={item.webViewLink}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Open in Google Drive"
                          className="absolute top-2 right-2 p-1 rounded bg-black/75 text-white/80 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    <div className="p-2 space-y-0.5 flex-1 min-w-0">
                      <div className="text-xs font-semibold text-[#111114] truncate" title={item.name}>
                        {item.name}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-[#6E6E7A] gap-1">
                        <span className="truncate">{kind === 'pdf_doc' ? 'PDF / DOC' : kind.toUpperCase()}</span>
                        {sizeText && <span className="font-mono shrink-0">{sizeText}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Create Folder Inline Modal */}
        {showNewFolderModal && (
          <div className="px-5 py-3 bg-[#FDF4F5] border-t border-[#EABAC0] flex flex-wrap items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <FolderPlus className="w-4 h-4 text-[#C6202F] shrink-0" />
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCreateFolder();
                  }
                }}
                placeholder="New Folder Name (e.g., 52Launch Deliverables)..."
                className="flex-1 bg-white border border-[#D8D8DF] rounded-md px-3 py-1.5 text-xs text-[#111114] focus:outline-none focus:border-[#C6202F]"
                autoFocus
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowNewFolderModal(false)}
                className="px-3 py-1.5 text-xs text-[#5A5A66] hover:text-[#111114] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newFolderName.trim() || isCreatingFolder}
                onClick={() => void handleCreateFolder()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 brand-corner-sm cursor-pointer"
              >
                {isCreatingFolder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                Create Folder
              </button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="px-5 py-3.5 bg-[#F8F8FA] border-t border-[#E2E2E6] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="text-xs text-[#5A5A66]">
            {pickerMode === 'select_destination_folder' ? (
              <span>
                Selected Destination: <strong>{currentFolder.name}</strong>
              </span>
            ) : pickerMode === 'select_source_folder' ? (
              <span>
                Select a folder to link as project source.
              </span>
            ) : selectedItems.length > 0 ? (
              `${selectedItems.length} file${selectedItems.length > 1 ? 's' : ''} selected`
            ) : (
              'Click folders to browse, click files to select for import.'
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isImporting}
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium text-[#3A3A44] bg-white border border-[#D8D8DF] hover:border-[#111114] rounded-md cursor-pointer transition-colors"
            >
              Cancel
            </button>

            {pickerMode === 'select_destination_folder' ? (
              <button
                type="button"
                onClick={() => void handleConfirmDestinationFolder(currentFolder)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] brand-corner-sm cursor-pointer shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
                Set Current Folder as Save Destination
              </button>
            ) : pickerMode === 'select_source_folder' ? (
              <button
                type="button"
                onClick={() => void handleConfirmSourceFolder(currentFolder)}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-[#891A23] hover:bg-[#6E141C] brand-corner-sm cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Current Folder to Sources
              </button>
            ) : (
              <button
                type="button"
                disabled={selectedItems.length === 0 || isImporting}
                onClick={() => void handleImportSelected()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-[#C6202F] hover:bg-[#AD1A27] disabled:opacity-40 brand-corner-sm cursor-pointer shadow-xs"
              >
                {isImporting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {pickerMode === 'pick_reference_files' ? 'Locking & Loading...' : 'Importing Assets...'}
                  </>
                ) : (
                  <>
                    <FolderSync className="w-3.5 h-3.5" />
                    {pickerMode === 'pick_reference_files'
                      ? `Lock & Analyze Selected (${selectedItems.length})`
                      : `Import Selected (${selectedItems.length})`}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
