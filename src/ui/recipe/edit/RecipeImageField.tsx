import { resizeForUpload } from '@/lib/photo-resize';
import { RECIPE_IMAGES_BUCKET } from '@/lib/queries/storage';
import { supabase } from '@/lib/supabase';
import { Button } from '@/ui/primitives/Button';
import { RecipeImage } from '@/ui/primitives/RecipeImage';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Mirror the photo limits the import flow enforces (src/routes/h/$householdId/import.tsx).
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png'] as const;

export type RecipeImageFieldProps = {
  // Current hero_image_path: a private-bucket object path, a remote http(s) URL
  // (imported), or null when there is no image.
  value: string | null;
  // Called with the new object path after a successful upload, or null on remove.
  onChange: (path: string | null) => void;
  disabled?: boolean;
};

export function RecipeImageField({ value, onChange, disabled }: RecipeImageFieldProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Instant local preview for a just-picked file, shown until the page is saved
  // (the persisted value renders through RecipeImage instead).
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  // Path of the blob we uploaded earlier in THIS edit session, if any. Lets us
  // free it when the user replaces/removes it again before saving — without
  // touching the originally-persisted image (still referenced until save).
  const sessionUploadRef = useRef<string | null>(null);

  // Revoke the object URL when it is replaced or the field unmounts.
  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  function openPicker() {
    setError(null);
    inputRef.current?.click();
  }

  async function freeSessionUpload() {
    const prev = sessionUploadRef.current;
    sessionUploadRef.current = null;
    if (!prev) return;
    try {
      await supabase.storage.from(RECIPE_IMAGES_BUCKET).remove([prev]);
    } catch {
      // best-effort — an orphaned blob is a cleanup concern, not a user error
    }
  }

  async function handleFile(file: File) {
    if (!(PHOTO_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
      setError(t('errors.photo_wrong_type'));
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      setError(t('errors.photo_too_large'));
      return;
    }
    setError(null);
    setUploading(true);
    setLocalPreview(URL.createObjectURL(file)); // effect revokes any previous

    try {
      const { data, error: userErr } = await supabase.auth.getUser();
      if (userErr || !data.user) {
        setError(t('errors.internal'));
        setLocalPreview(null);
        return;
      }
      // resizeForUpload returns the original file on failure or when no resize
      // is needed; it converts resized output to JPEG.
      const prepared = await resizeForUpload(file);
      const ext = prepared.type === 'image/png' ? 'png' : 'jpg';
      const path = `${data.user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from(RECIPE_IMAGES_BUCKET)
        .upload(path, prepared, { contentType: prepared.type, upsert: false });
      if (uploadErr) {
        setError(t('errors.photo_upload_failed'));
        setLocalPreview(null);
        return;
      }
      await freeSessionUpload();
      sessionUploadRef.current = path;
      onChange(path);
    } catch {
      setError(t('errors.photo_upload_failed'));
      setLocalPreview(null);
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setError(null);
    await freeSessionUpload();
    setLocalPreview(null);
    onChange(null);
  }

  const hasImage = Boolean(localPreview || value);

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_ACCEPTED_TYPES.join(',')}
        className="sr-only"
        disabled={disabled || uploading}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Reset so re-picking the same file fires change again.
          e.target.value = '';
          if (file) void handleFile(file);
        }}
      />

      <div className="relative aspect-[3/2] overflow-hidden rounded-[var(--radius-lg)] border border-cream-line bg-paper-2">
        {hasImage ? (
          localPreview ? (
            <img
              src={localPreview}
              alt={t('recipe.photo_alt')}
              className="h-full w-full object-cover"
            />
          ) : (
            <RecipeImage
              path={value}
              alt={t('recipe.photo_alt')}
              className="h-full w-full object-cover"
            />
          )
        ) : (
          <button
            type="button"
            onClick={openPicker}
            disabled={disabled || uploading}
            className="flex h-full w-full flex-col items-center justify-center gap-2 border-2 border-dashed border-cream-line text-ink-soft transition-colors hover:bg-paper hover:text-ink"
          >
            <ImagePlus size={28} strokeWidth={1.5} />
            <span className="font-body text-sm">{t('recipe.photo_add')}</span>
          </button>
        )}

        {uploading && (
          <div className="absolute inset-0 flex items-center justify-center bg-paper/70">
            <span className="font-body text-sm text-ink-soft">{t('recipe.photo_uploading')}</span>
          </div>
        )}
      </div>

      {hasImage && (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openPicker}
            disabled={disabled || uploading}
            leftIcon={<ImagePlus size={16} strokeWidth={1.5} />}
          >
            {t('recipe.photo_replace')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleRemove()}
            disabled={disabled || uploading}
            leftIcon={<Trash2 size={16} strokeWidth={1.5} />}
          >
            {t('recipe.photo_remove')}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-pomegranate">{error}</p>}
    </div>
  );
}
