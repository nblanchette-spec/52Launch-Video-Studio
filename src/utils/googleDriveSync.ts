import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { BrandGuideDocument, ExtractedStyleGuide } from '../types/pipeline';
import { parseJsonResponse } from './safeFetch';

export const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
];

export interface DriveUser {
  email: string | null;
  displayName?: string | null;
  photoURL?: string | null;
}

const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

const provider = new GoogleAuthProvider();
for (const scope of DRIVE_SCOPES) {
  provider.addScope(scope);
}

// In-memory token caching (never localStorage/sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;
let cachedUser: DriveUser | null = null;

type DriveAuthListener = {
  onSuccess?: (user: DriveUser, token: string) => void;
  onFailure?: () => void;
};
const authListeners = new Set<DriveAuthListener>();

function notifyAuthSuccess(user: DriveUser, token: string): void {
  for (const listener of authListeners) {
    listener.onSuccess?.(user, token);
  }
}

function notifyAuthFailure(): void {
  for (const listener of authListeners) {
    listener.onFailure?.();
  }
}

function invalidateCachedDriveSession(): void {
  cachedAccessToken = null;
  notifyAuthFailure();
}

function mapFirebaseUser(user: User): DriveUser {
  return {
    email: user.email || 'Google Drive Connected',
    displayName: user.displayName || 'Google User',
    photoURL: user.photoURL,
  };
}

export function initDriveAuth(
  onAuthSuccess?: (user: DriveUser, token: string) => void,
  onAuthFailure?: () => void
) {
  const listener: DriveAuthListener = {
    onSuccess: onAuthSuccess,
    onFailure: onAuthFailure,
  };
  authListeners.add(listener);

  if (cachedAccessToken && cachedUser) {
    onAuthSuccess?.(cachedUser, cachedAccessToken);
  }

  const unsubFirebase = onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      const mapped = mapFirebaseUser(user);
      cachedUser = mapped;
      if (cachedAccessToken) {
        onAuthSuccess?.(mapped, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    } else {
      cachedAccessToken = null;
      cachedUser = null;
      onAuthFailure?.();
    }
  });

  return () => {
    authListeners.delete(listener);
    unsubFirebase();
  };
}

export async function getGoogleDriveAccessToken(): Promise<string | null> {
  return cachedAccessToken;
}

export function getGoogleDriveUser(): DriveUser | null {
  return cachedUser;
}

export function clearGoogleDriveToken(): void {
  cachedAccessToken = null;
  cachedUser = null;
  notifyAuthFailure();
}

export function setCachedGoogleDriveAccessToken(token: string | null): void {
  cachedAccessToken = token;
  if (!token) {
    notifyAuthFailure();
  }
}

function shouldSkipPopupRetry(err: unknown): boolean {
  const code = (err as { code?: string })?.code || '';
  return (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/popup-blocked' ||
    code === 'auth/unauthorized-domain'
  );
}

function clearFirebaseOriginValidationCache(): void {
  try {
    const authInternal = auth as unknown as {
      _popupRedirectResolver?: {
        originValidationPromises?: Record<string, unknown>;
      };
    };
    const cache = authInternal?._popupRedirectResolver?.originValidationPromises;
    if (cache && typeof cache === 'object') {
      for (const key of Object.keys(cache)) {
        delete cache[key];
      }
    }
  } catch {
    // ignore internal SDK cache inspection errors
  }
}

function doesHostnameMatchDomain(hostname: string, expectedDomain: string): boolean {
  const cleanHost = hostname.toLowerCase();
  const cleanExpected = expectedDomain.trim().toLowerCase();
  if (!cleanHost || !cleanExpected) return false;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanExpected)) {
    return cleanHost === cleanExpected;
  }
  const escaped = cleanExpected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^(.+\\.${escaped}|${escaped})$`, 'i');
  return re.test(cleanHost);
}

async function fetchLiveAuthorizedDomains(): Promise<string[]> {
  try {
    const resp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(firebaseConfig.apiKey)}`
    );
    if (!resp.ok) return [];
    const data = (await resp.json()) as { authorizedDomains?: unknown };
    return Array.isArray(data.authorizedDomains)
      ? data.authorizedDomains.map((d) => String(d))
      : [];
  } catch {
    return [];
  }
}

export function getFirebaseAuthorizedDomainsInfo(): {
  hostname: string;
  projectId: string;
  consoleUrl: string;
} {
  const hostname =
    typeof window !== 'undefined' ? window.location.hostname : '';
  const projectId = firebaseConfig.projectId || '';
  return {
    hostname,
    projectId,
    consoleUrl: `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/authentication/settings`,
  };
}

async function formatUnauthorizedDomainError(): Promise<Error> {
  const currentHost =
    typeof window !== 'undefined' ? window.location.hostname : 'unknown-host';
  const authorizedDomains = await fetchLiveAuthorizedDomains();
  const hostAlreadyAuthorized = authorizedDomains.some((d) =>
    doesHostnameMatchDomain(currentHost, d)
  );

  if (hostAlreadyAuthorized) {
    return new Error(
      `Google Drive sign-in hit a stale browser session on "${currentHost}". Please hard-reload this page (Cmd/Ctrl+Shift+R) and try again.`
    );
  }

  return new Error(
    `This preview domain "${currentHost}" is not in Firebase's Authorized Domains for project "${firebaseConfig.projectId}" (auth/unauthorized-domain). Add "${currentHost}" under Authentication → Settings → Authorized domains, then click Retry.`
  );
}

export async function signInWithGoogleDrive(forceConsent = false): Promise<{
  user: DriveUser;
  accessToken: string;
}> {
  isSigningIn = true;
  try {
    clearFirebaseOriginValidationCache();

    provider.setCustomParameters({
      include_granted_scopes: 'true',
      prompt: forceConsent ? 'consent select_account' : 'select_account',
    });

    const runPopup = async () => {
      try {
        return await signInWithPopup(auth, provider);
      } catch (err) {
        const code = (err as { code?: string })?.code || '';
        if (code === 'auth/unauthorized-domain') {
          clearFirebaseOriginValidationCache();
          const currentHost =
            typeof window !== 'undefined' ? window.location.hostname : '';
          const authorizedDomains = await fetchLiveAuthorizedDomains();
          const hostIsAuthorized = authorizedDomains.some((d) =>
            doesHostnameMatchDomain(currentHost, d)
          );
          if (hostIsAuthorized) {
            try {
              return await signInWithPopup(auth, provider);
            } catch (retryErr) {
              const retryCode = (retryErr as { code?: string })?.code || '';
              if (retryCode === 'auth/unauthorized-domain') {
                clearFirebaseOriginValidationCache();
                throw await formatUnauthorizedDomainError();
              }
              throw retryErr;
            }
          }
          throw await formatUnauthorizedDomainError();
        }
        throw err;
      }
    };

    let result;
    try {
      result = await runPopup();
    } catch (firstErr) {
      if (forceConsent || shouldSkipPopupRetry(firstErr) || (firstErr instanceof Error && firstErr.message.includes('auth/unauthorized-domain'))) {
        throw firstErr;
      }
      provider.setCustomParameters({
        include_granted_scopes: 'true',
        prompt: 'consent select_account',
      });
      result = await runPopup();
    }

    const credential = GoogleAuthProvider.credentialFromResult(result);
    const tokenResponse = (result as unknown as { _tokenResponse?: { oauthAccessToken?: string } })._tokenResponse;
    let accessToken = credential?.accessToken || tokenResponse?.oauthAccessToken;

    if (!accessToken) {
      provider.setCustomParameters({
        include_granted_scopes: 'true',
        prompt: 'consent select_account',
      });
      const retryResult = await runPopup();
      const retryCredential = GoogleAuthProvider.credentialFromResult(retryResult);
      const retryTokenResponse = (retryResult as unknown as { _tokenResponse?: { oauthAccessToken?: string } })._tokenResponse;
      accessToken = retryCredential?.accessToken || retryTokenResponse?.oauthAccessToken || undefined;
      if (retryResult.user) result = retryResult;
    }

    if (!accessToken) {
      accessToken = cachedAccessToken || undefined;
    }

    if (!accessToken) {
      throw new Error('Could not obtain Google Drive access token. Please ensure Google Drive permissions are allowed and try again.');
    }

    const userInfo = mapFirebaseUser(result.user);
    cachedAccessToken = accessToken;
    cachedUser = userInfo;

    notifyAuthSuccess(userInfo, accessToken);

    return { user: userInfo, accessToken };
  } finally {
    isSigningIn = false;
  }
}

export async function logoutGoogleDrive(): Promise<void> {
  cachedAccessToken = null;
  cachedUser = null;
  try {
    await signOut(auth);
  } catch {
    // ignore signOut errors
  }
  notifyAuthFailure();
}

export function extractDriveFolderId(urlOrId?: string): string | null {
  if (!urlOrId) return null;
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;
  if (!trimmed.includes('/') && /^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match && match[1]) return match[1];
  const queryMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (queryMatch && queryMatch[1]) return queryMatch[1];
  return null;
}

export function extractDriveFileId(urlOrId?: string): string | null {
  if (!urlOrId) return null;
  const trimmed = urlOrId.trim();
  if (!trimmed) return null;
  if (/\/folders\//.test(trimmed)) return null;
  if (!trimmed.includes('/') && /^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }
  const fileMatch = trimmed.match(
    /\/(?:file|document|spreadsheets|presentation|drawings)\/d\/([a-zA-Z0-9_-]+)/
  );
  if (fileMatch && fileMatch[1]) return fileMatch[1];
  const openMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch && openMatch[1]) return openMatch[1];
  return null;
}

export interface DriveFileItem {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  thumbnailLink?: string;
  iconLink?: string;
  folderUrl?: string;
  folderPath?: string;
  size?: string;
  modifiedTime?: string;
}

interface RawDriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  thumbnailLink?: string;
  iconLink?: string;
  size?: string;
  modifiedTime?: string;
  shortcutDetails?: {
    targetId?: string;
    targetMimeType?: string;
  };
}

async function fetchFolderChildren(
  folderId: string,
  accessToken: string
): Promise<RawDriveFile[]> {
  const query = `'${folderId}' in parents and trashed = false`;
  const url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=files(id,name,mimeType,webViewLink,thumbnailLink,iconLink,size,modifiedTime,shortcutDetails(targetId,targetMimeType))` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=100`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google Drive session expired. Please sign in with Google again.');
  }

  if (!res.ok) {
    let apiMessage = `Google Drive returned HTTP ${res.status}.`;
    try {
      const errJson = await res.json();
      if (errJson?.error?.message) {
        apiMessage = errJson.error.message;
      }
    } catch {
      // ignore
    }
    throw new Error(`Could not access Google Drive folder (${folderId}): ${apiMessage}`);
  }

  const data = await res.json();
  return Array.isArray(data.files) ? data.files : [];
}

export async function listGoogleDriveFolderFiles(
  folderUrls: string[],
  accessToken: string
): Promise<DriveFileItem[]> {
  if (!accessToken) {
    throw new Error('Please sign in with Google first to read your Drive folders.');
  }

  const allFiles: DriveFileItem[] = [];
  const seenIds = new Set<string>();

  for (const rawUrl of folderUrls) {
    const url = rawUrl.trim();
    if (!url) continue;

    const rootFolderId = extractDriveFolderId(url);
    if (!rootFolderId) {
      throw new Error(
        `Invalid Google Drive folder URL: "${url}". Expected a link containing /folders/<ID>.`
      );
    }

    const queue: Array<{ id: string; pathPrefix: string; depth: number }> = [
      { id: rootFolderId, pathPrefix: '', depth: 0 },
    ];
    const visitedFolders = new Set<string>([rootFolderId]);

    while (queue.length > 0 && allFiles.length < 150) {
      const current = queue.shift()!;
      const children = await fetchFolderChildren(current.id, accessToken);

      for (const child of children) {
        let resolvedId = child.id;
        let resolvedMime = child.mimeType;

        if (
          child.mimeType === 'application/vnd.google-apps.shortcut' &&
          child.shortcutDetails?.targetId
        ) {
          resolvedId = child.shortcutDetails.targetId;
          if (child.shortcutDetails.targetMimeType) {
            resolvedMime = child.shortcutDetails.targetMimeType;
          }
        }

        if (resolvedMime === 'application/vnd.google-apps.folder') {
          if (current.depth < 3 && !visitedFolders.has(resolvedId)) {
            visitedFolders.add(resolvedId);
            queue.push({
              id: resolvedId,
              pathPrefix: current.pathPrefix
                ? `${current.pathPrefix} / ${child.name}`
                : child.name,
              depth: current.depth + 1,
            });
          }
          continue;
        }

        if (!seenIds.has(resolvedId)) {
          seenIds.add(resolvedId);
          allFiles.push({
            id: resolvedId,
            name: child.name,
            mimeType: resolvedMime,
            webViewLink: child.webViewLink,
            thumbnailLink: child.thumbnailLink,
            iconLink: child.iconLink,
            size: child.size,
            modifiedTime: child.modifiedTime,
            folderUrl: url,
            folderPath: current.pathPrefix || undefined,
          });
        }
      }
    }
  }

  return allFiles;
}

export async function getDriveFileMetadata(
  fileId: string,
  accessToken: string
): Promise<DriveFileItem> {
  if (!accessToken) {
    throw new Error('Please sign in with Google first.');
  }
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}` +
    `?fields=id,name,mimeType,webViewLink,thumbnailLink,iconLink,size,modifiedTime,shortcutDetails(targetId,targetMimeType)` +
    `&supportsAllDrives=true`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google Drive session expired. Please sign in with Google again.');
  }
  if (!res.ok) {
    let apiMessage = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err?.error?.message) apiMessage = err.error.message;
    } catch {
      // ignore
    }
    throw new Error(`Could not load Google Drive file (${fileId}): ${apiMessage}`);
  }
  const f = (await res.json()) as RawDriveFile;
  return {
    id: f.shortcutDetails?.targetId || f.id,
    name: f.name,
    mimeType: f.shortcutDetails?.targetMimeType || f.mimeType,
    webViewLink: f.webViewLink,
    thumbnailLink: f.thumbnailLink,
    iconLink: f.iconLink,
    size: f.size,
    modifiedTime: f.modifiedTime,
  };
}

export interface DriveExplorerItem {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  webViewLink?: string;
  thumbnailLink?: string;
  iconLink?: string;
  size?: string;
  modifiedTime?: string;
}

export interface SharedDriveItem {
  id: string;
  name: string;
}

export async function listSharedDrives(accessToken: string): Promise<SharedDriveItem[]> {
  if (!accessToken) return [];
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/drives?pageSize=50', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.drives)
      ? data.drives.map((d: { id: string; name: string }) => ({ id: d.id, name: d.name }))
      : [];
  } catch {
    return [];
  }
}

export async function listDriveExplorerItems(params: {
  accessToken: string;
  folderId?: string;
  sharedWithMe?: boolean;
  sharedDriveId?: string;
  searchQuery?: string;
}): Promise<DriveExplorerItem[]> {
  const { accessToken, folderId, sharedWithMe, sharedDriveId, searchQuery } = params;
  if (!accessToken) {
    throw new Error('Please sign in with Google first.');
  }

  let query = 'trashed = false';
  const cleanSearch = (searchQuery || '').trim().replace(/'/g, "\\'");

  if (cleanSearch) {
    query += ` and name contains '${cleanSearch}'`;
  } else if (sharedWithMe) {
    query += ' and sharedWithMe = true';
  } else if (sharedDriveId) {
    const target = folderId || sharedDriveId;
    query += ` and '${target}' in parents`;
  } else {
    const target = folderId && folderId !== 'root' ? folderId : 'root';
    query += ` and '${target}' in parents`;
  }

  let url =
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}` +
    `&fields=files(id,name,mimeType,webViewLink,thumbnailLink,iconLink,size,modifiedTime,shortcutDetails(targetId,targetMimeType))` +
    `&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true` +
    `&orderBy=folder,name_natural,modifiedTime desc`;

  if (sharedDriveId && !cleanSearch) {
    url += `&corpora=drive&driveId=${encodeURIComponent(sharedDriveId)}`;
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401) {
    cachedAccessToken = null;
    throw new Error('Google Drive session expired. Please sign in with Google again.');
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err?.error?.message) msg = err.error.message;
    } catch {}
    throw new Error(`Could not browse Google Drive: ${msg}`);
  }

  const data = await res.json();
  const rawFiles: RawDriveFile[] = Array.isArray(data.files) ? data.files : [];

  return rawFiles.map((f) => {
    let targetId = f.id;
    let targetMime = f.mimeType;
    if (f.mimeType === 'application/vnd.google-apps.shortcut' && f.shortcutDetails) {
      if (f.shortcutDetails.targetId) targetId = f.shortcutDetails.targetId;
      if (f.shortcutDetails.targetMimeType) targetMime = f.shortcutDetails.targetMimeType;
    }
    const isFolder = targetMime === 'application/vnd.google-apps.folder';
    return {
      id: targetId,
      name: f.name,
      mimeType: targetMime,
      isFolder,
      webViewLink: f.webViewLink,
      thumbnailLink: f.thumbnailLink,
      iconLink: f.iconLink,
      size: f.size,
      modifiedTime: f.modifiedTime,
    };
  });
}

export async function createDriveFolderOnDrive(params: {
  accessToken: string;
  name: string;
  parentFolderId?: string;
}): Promise<{ id: string; name: string; webViewLink?: string }> {
  const { accessToken, name, parentFolderId } = params;
  if (!accessToken) throw new Error('Sign in with Google required.');
  const metadata: Record<string, unknown> = {
    name: name.trim(),
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentFolderId && parentFolderId !== 'root') {
    metadata.parents = [parentFolderId];
  }
  const res = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(metadata),
    }
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err?.error?.message) msg = err.error.message;
    } catch {}
    throw new Error(`Could not create Drive folder: ${msg}`);
  }
  return res.json();
}

export async function getDriveFolderDetails(
  folderId: string,
  accessToken: string
): Promise<{ id: string; name: string; webViewLink?: string }> {
  if (!accessToken) throw new Error('Sign in with Google required.');
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,webViewLink,mimeType&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const err = await res.json();
      if (err?.error?.message) msg = err.error.message;
    } catch {}
    throw new Error(`Could not fetch Drive folder info: ${msg}`);
  }
  return res.json();
}

export async function syncProjectToDriveServer(
  projectId: string,
  googleDriveFolderUrls: string[],
  accessToken?: string | null,
  destinationFolderId?: string,
  destinationFolderUrl?: string,
  options?: { skipPdfGeneration?: boolean }
): Promise<{
  success: boolean;
  syncedAt: string;
  backupFolderUrl?: string;
  backupFolderId?: string;
  uploadedFiles?: string[];
  warning?: string;
}> {
  const token = accessToken ?? cachedAccessToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['X-Google-Drive-Token'] = token;
    headers['Authorization'] = `Bearer ${token}`;
  }

  const resp = await fetch('/api/pipeline/drive-sync', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId,
      googleDriveFolderUrls,
      destinationFolderId,
      destinationFolderUrl,
      skipPdfGeneration: Boolean(options?.skipPdfGeneration),
    }),
  });
  if (resp.status === 401) {
    invalidateCachedDriveSession();
  }
  const data = await parseJsonResponse<{
    syncedAt?: string;
    backupFolderUrl?: string;
    backupFolderId?: string;
    uploadedFiles?: string[];
    warning?: string;
    error?: string;
  }>(resp, 'Drive sync failed.');
  return {
    success: true,
    syncedAt: data.syncedAt || new Date().toISOString(),
    backupFolderUrl: data.backupFolderUrl,
    backupFolderId: data.backupFolderId,
    uploadedFiles: data.uploadedFiles,
    warning: data.warning,
  };
}

export async function uploadPdfToDriveServer(params: {
  projectId: string;
  filename: string;
  pdfBlob: Blob;
  destinationFolderId?: string;
  destinationFolderUrl?: string;
  accessToken?: string | null;
}): Promise<{
  success: boolean;
  backupFolderId?: string;
  backupFolderUrl?: string;
  filename?: string;
}> {
  const token = params.accessToken ?? cachedAccessToken;
  if (!token) {
    throw new Error('Sign in with Google Drive first to auto-save PDFs.');
  }

  let pdfBase64: string;
  if (typeof params.pdfBlob.arrayBuffer === 'function') {
    const arrayBuffer = await params.pdfBlob.arrayBuffer();
    if (typeof Buffer !== 'undefined') {
      pdfBase64 = `data:application/pdf;base64,${Buffer.from(arrayBuffer).toString('base64')}`;
    } else {
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      pdfBase64 = `data:application/pdf;base64,${btoa(binary)}`;
    }
  } else if (typeof FileReader !== 'undefined') {
    pdfBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not encode PDF for Drive upload.'));
      reader.readAsDataURL(params.pdfBlob);
    });
  } else {
    throw new Error('Could not encode PDF for Drive upload.');
  }

  const resp = await fetch('/api/pipeline/drive-upload-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Google-Drive-Token': token,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      projectId: params.projectId,
      filename: params.filename,
      pdfBase64,
      destinationFolderId: params.destinationFolderId,
      destinationFolderUrl: params.destinationFolderUrl,
    }),
  });
  if (resp.status === 401) {
    invalidateCachedDriveSession();
  }

  return parseJsonResponse<{
    success: boolean;
    backupFolderId?: string;
    backupFolderUrl?: string;
    filename?: string;
  }>(resp, 'Could not upload PDF to Google Drive.');
}

export type LlmRoutingMode = 'auto' | 'fal_gemini' | 'google_direct';

export interface LlmRoutingStatus {
  mode: LlmRoutingMode;
  geminiConfigured: boolean;
  falConfigured: boolean;
  geminiTextModel: string;
  falGeminiModel: string;
}

export async function getLlmRoutingStatus(): Promise<LlmRoutingStatus> {
  const resp = await fetch('/api/pipeline/llm-status');
  return parseJsonResponse<LlmRoutingStatus>(resp, 'Could not fetch AI routing status.');
}

export async function setLlmRoutingMode(mode: LlmRoutingMode): Promise<LlmRoutingStatus> {
  const resp = await fetch('/api/pipeline/llm-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  return parseJsonResponse<LlmRoutingStatus>(resp, 'Could not switch AI engine mode.');
}

export interface ParsedDriveIntakeResult {
  parsed: {
    client: string;
    productName: string;
    productDescription: string;
    provableClaims: string[];
    audience: string;
    tone: string;
    clientMarketingIdeas: string;
    videosWanted: string;
    shootLocationDatesBudgetNotes: string;
  };
  styleGuide?: ExtractedStyleGuide;
  brandGuideDocuments?: BrandGuideDocument[];
  stagedGuidePdfs?: Array<{ name: string; dataUrl: string; graphicCount?: number }>;
  suggestedLogoUrl?: string;
  suggestedLogoDataUrl?: string;
  importedBrandGraphics?: Array<{ id: string; url: string; caption: string }>;
  importedBrandGraphicsDataUrls?: Array<{ dataUrl: string; caption: string }>;
  extractedGraphicCount?: number;
  analyzedFiles: Array<{ name: string; status: string }>;
  importedPhotos?: Array<{ id: string; url: string; caption: string }>;
  importedPhotoDataUrls?: Array<{ dataUrl: string; caption: string }>;
  warnings?: string[];
}

export async function parseLocalStyleGuidePdfs(
  projectId: string,
  files: Array<{ name: string; dataUrl: string }>
): Promise<ParsedDriveIntakeResult> {
  const resp = await fetch('/api/pipeline/parse-local-guides', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, files }),
  });
  return parseJsonResponse<ParsedDriveIntakeResult>(
    resp,
    'Could not parse PDF style guide.'
  );
}

export async function parseGoogleDriveFolder(
  projectId: string,
  googleDriveFolderUrls: string[],
  filesToAnalyze: DriveFileItem[],
  accessToken: string
): Promise<ParsedDriveIntakeResult> {
  if (!accessToken) {
    throw new Error('Please sign in with Google first so the studio can read your Drive files.');
  }

  const resp = await fetch('/api/pipeline/drive-parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Google-Drive-Token': accessToken,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      projectId,
      googleDriveFolderUrls,
      filesToAnalyze,
    }),
  });
  if (resp.status === 401) {
    invalidateCachedDriveSession();
  }
  return parseJsonResponse<ParsedDriveIntakeResult>(resp, 'Drive parse failed.');
}

export interface ImportedDriveAsset {
  fileId: string;
  name: string;
  mimeType: string;
  url?: string;
  filename?: string;
  falUrl?: string | null;
  dataUrl?: string;
}

export async function importDriveFilesToProject(params: {
  projectId: string;
  files: DriveFileItem[];
  prefix?: string;
  uploadToFal?: boolean;
  accessToken: string;
}): Promise<{
  assets: ImportedDriveAsset[];
  warnings: string[];
}> {
  if (!params.accessToken) {
    throw new Error('Please sign in with Google first to import Drive assets.');
  }

  const resp = await fetch('/api/pipeline/drive-import-assets', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Google-Drive-Token': params.accessToken,
      Authorization: `Bearer ${params.accessToken}`,
    },
    body: JSON.stringify({
      projectId: params.projectId,
      files: params.files,
      prefix: params.prefix,
      uploadToFal: Boolean(params.uploadToFal),
    }),
  });
  if (resp.status === 401) {
    invalidateCachedDriveSession();
  }
  const data = await parseJsonResponse<{
    assets?: ImportedDriveAsset[];
    warnings?: string[];
  }>(resp, 'Could not import selected Drive files.');
  return {
    assets: Array.isArray(data.assets) ? data.assets : [],
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
}
