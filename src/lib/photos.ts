import imageCompression from 'browser-image-compression';
import { supabase } from '@/lib/supabase';

/** Public Supabase Storage bucket where housekeeping-issue photos live. */
const ISSUES_BUCKET = 'housekeeping-issues';

const COMPRESSION_OPTS = {
  maxSizeMB: 0.2, // ~200 KB ceiling per CLAUDE.md free-tier mitigation
  maxWidthOrHeight: 1280,
  useWebWorker: true,
} as const;

/**
 * Compress an image (~200 KB JPEG, max 1280px) and upload it to the
 * housekeeping-issues bucket. Returns the storage path that the caller
 * should persist in `housekeeping_issues.photo_paths`.
 */
export async function uploadIssuePhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Yalnızca görsel dosyaları yüklenebilir.');
  }
  const compressed = await imageCompression(file, COMPRESSION_OPTS);
  // Keep the original extension when possible (jpg/png/webp); fall back to jpg.
  const ext = (compressed.type.split('/')[1] ?? 'jpg').toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(ISSUES_BUCKET)
    .upload(path, compressed, {
      contentType: compressed.type,
      upsert: false,
    });
  if (error) throw new Error(`Fotoğraf yüklenemedi — ${error.message}`);
  return path;
}

/** Build a public URL for an issue photo by its stored path. */
export function issuePhotoUrl(path: string): string {
  const { data } = supabase.storage.from(ISSUES_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
