export interface InlineImagePayload {
  data: string;
  mimeType: string;
}

/**
 * Converts a data URI or an asset URL into raw base64 + mimeType
 * suitable for Gemini multimodal inlineData parts.
 */
export async function imageSrcToInlineData(src: string): Promise<InlineImagePayload | null> {
  if (!src) return null;

  if (src.startsWith('data:')) {
    const match = src.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return {
      mimeType: match[1],
      data: match[2],
    };
  }

  try {
    const response = await fetch(src);
    if (!response.ok) return null;
    const blob = await response.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return null;
    return {
      mimeType: match[1],
      data: match[2],
    };
  } catch {
    return null;
  }
}

/**
 * Reads an uploaded local image file and downscales oversized photos
 * so localStorage remains fast and reliable across large multi-brand sets.
 */
export function readAndOptimizeLocalImage(file: File, maxDim = 1280): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const result = String(reader.result);
      const img = new Image();
      img.onerror = () => resolve(result);
      img.onload = () => {
        const { width, height } = img;
        if (width <= maxDim && height <= maxDim) {
          resolve(result);
          return;
        }
        const scale = Math.min(maxDim / width, maxDim / height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(result);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  });
}
