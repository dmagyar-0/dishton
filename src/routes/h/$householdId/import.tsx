import type { Recipe } from '@/domain/recipe';
import {
  type ImportPhotoInput,
  ImportPhotoSchema,
  type ImportUrlInput,
  ImportUrlSchema,
  detectImportSource,
} from '@/lib/forms/import';
import { blankManualRecipe } from '@/lib/forms/manual-recipe';
import { useActiveImports } from '@/lib/imports/ActiveImportsProvider';
import { resizeForUpload } from '@/lib/photo-resize';
import { useHouseholdAllowedTags } from '@/lib/queries/households';
import { supabase } from '@/lib/supabase';
import {
  bcImportInputValidated,
  bcImportRequestSent,
  bcImportResponseReceived,
  bcImportSaveFailed,
  bcImportStart,
} from '@/observability/breadcrumbs';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { Input } from '@/ui/primitives/Input';
import { Skeleton } from '@/ui/primitives/Skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/Tabs';
import { Textarea } from '@/ui/primitives/Textarea';
import { useToast } from '@/ui/primitives/Toast';
import { ImportProgress } from '@/ui/recipe/ImportProgress';
import { RecipeEditForm } from '@/ui/recipe/edit/RecipeEditForm';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Globe, Instagram } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../../_guards';

const IMPORT_URL_TIMEOUT_MS = 120_000;
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png'] as const;
const PHOTO_MAX_COUNT = 6;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKey(f: File): string {
  return `${f.name}|${f.size}|${f.lastModified}`;
}

const KNOWN_ERROR_KEYS = [
  'rate_limit',
  'too_many_imports',
  'fetch_failed',
  'invalid_url',
  'not_html',
  'source_too_large',
  'parse_failed',
  'schema_failed',
  'instagram_unavailable',
  'internal',
  'upstream',
  'network',
  'timeout',
  'object_not_found',
  'forbidden_path',
  'not_image',
  'photo_too_large',
] as const;
type ErrorKey = (typeof KNOWN_ERROR_KEYS)[number];

async function readErrorCode(error: unknown): Promise<ErrorKey> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const cloned = ctx.clone();
      const body = (await cloned.json()) as { error?: string };
      if (body.error && (KNOWN_ERROR_KEYS as readonly string[]).includes(body.error)) {
        return body.error as ErrorKey;
      }
      return 'internal';
    } catch {
      return 'internal';
    }
  }
  const name = (error as { name?: string } | null)?.name ?? '';
  if (name === 'AbortError' || name === 'TimeoutError') return 'timeout';
  if (name === 'FunctionsFetchError' || name === 'FunctionsRelayError') return 'network';
  return 'network';
}

export const Route = createFileRoute('/h/$householdId/import')({
  beforeLoad: requireAuth,
  component: ImportPage,
});

function ImportPage() {
  const { householdId } = Route.useParams();
  const { t } = useTranslation();

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-6">{t('nav.import')}</h1>
      <Tabs defaultValue="url">
        <TabsList>
          <TabsTrigger value="url">{t('import.tab_url')}</TabsTrigger>
          <TabsTrigger value="photo">{t('import.tab_photo')}</TabsTrigger>
          <TabsTrigger value="manual">{t('import.tab_manual')}</TabsTrigger>
        </TabsList>
        <TabsContent value="url">
          <UrlTab householdId={householdId} />
        </TabsContent>
        <TabsContent value="photo">
          <PhotoTab householdId={householdId} />
        </TabsContent>
        <TabsContent value="manual">
          <ManualTab householdId={householdId} />
        </TabsContent>
      </Tabs>
    </main>
  );
}

type DraftResponse = {
  job_id?: string;
  draft?: unknown | null;
  needs_review?: boolean;
  reason?: string;
  // Server returns this when an import detached into background after the
  // first-response timer fired. The SPA stops awaiting the draft directly
  // and lets the Realtime listener pick it up when the worker finishes.
  status?: 'running';
};

type ImportKindLocal = 'url' | 'instagram' | 'photo';

function UrlTab({ householdId }: { householdId: string }) {
  const { t } = useTranslation();
  const { push } = useToast();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { register: registerImport } = useActiveImports();
  // backgrounded ref distinguishes a user-initiated "Continue in background"
  // abort from a real network error: when set, AbortError is swallowed and
  // the Realtime listener takes over.
  const backgroundedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ImportUrlInput>({ resolver: zodResolver(ImportUrlSchema) });

  const dispatchToBackground = (): void => {
    if (backgroundedRef.current) return;
    backgroundedRef.current = true;
    abortRef.current?.abort();
    push({
      variant: 'info',
      title: t('import.background_toast_title'),
      description: t('import.background_toast_body'),
    });
    reset();
  };

  return (
    <Card className="mt-4 p-6">
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (values) => {
          const source = detectImportSource(values.url);
          const fnName = source === 'instagram' ? 'import-instagram' : 'import-url';
          const kind: ImportKindLocal = source === 'instagram' ? 'instagram' : 'url';
          bcImportStart(source);
          bcImportInputValidated({ url_length: values.url.length, source });
          const t0 = performance.now();
          bcImportRequestSent(fnName, '');
          backgroundedRef.current = false;
          const ac = new AbortController();
          abortRef.current = ac;
          const timer = setTimeout(() => ac.abort(), IMPORT_URL_TIMEOUT_MS);
          let invokeError: unknown = null;
          let data: unknown = null;
          try {
            const result = await supabase.functions.invoke(fnName, {
              body: { url: values.url, household_id: householdId },
              signal: ac.signal,
            });
            invokeError = result.error;
            data = result.data;
          } catch (e) {
            invokeError = e;
          } finally {
            clearTimeout(timer);
            abortRef.current = null;
          }
          bcImportResponseReceived(Math.round(performance.now() - t0), invokeError ? 500 : 200);
          // User clicked "Continue in background" mid-flight: the abort
          // surfaces here as an AbortError, which we swallow. The Realtime
          // listener handles auto-save once the worker finishes.
          if (backgroundedRef.current) return;
          if (invokeError) {
            const code = await readErrorCode(invokeError);
            push({
              variant: 'error',
              title: t('import.error_title'),
              description: t(`errors.${code}`),
            });
            return;
          }
          const payload = data as DraftResponse | null;
          // Server-side background detach: 202 response. Register the job
          // so the indicator can light up immediately; the Realtime listener
          // will auto-save once the worker completes.
          if (payload?.status === 'running' && payload.job_id) {
            registerImport({ jobId: payload.job_id, householdId, kind });
            push({
              variant: 'info',
              title: t('import.background_toast_title'),
              description: t('import.background_toast_body'),
            });
            reset();
            return;
          }
          if (payload?.needs_review || !payload?.draft) {
            push({
              variant: 'error',
              title: t('import.needs_review_title'),
              description: t('import.needs_review_body'),
            });
            return;
          }
          const { data: newId, error: saveErr } = await supabase.rpc('save_recipe', {
            p_household: householdId,
            p_draft: payload.draft as never,
          });
          if (saveErr || !newId) {
            const detail = saveErr?.message?.trim() || saveErr?.details?.trim() || null;
            bcImportSaveFailed({
              code: saveErr?.code ?? null,
              message: saveErr?.message ?? null,
              details: saveErr?.details ?? null,
              hint: saveErr?.hint ?? null,
            });
            push({
              variant: 'error',
              persist: detail !== null,
              title: t('import.error_title'),
              description: (
                <>
                  <p>{t('errors.internal')}</p>
                  {detail && (
                    <p className="mt-1 text-xs opacity-80 break-words">
                      <span className="font-medium">{t('import.error_detail_label')}:</span>{' '}
                      {detail}
                    </p>
                  )}
                </>
              ),
            });
            return;
          }
          // Patch the import_jobs row to reflect the saved recipe. Best-
          // effort: failure here just means the indicator stays empty, no
          // user-facing impact.
          if (payload.job_id) {
            void supabase
              .from('import_jobs')
              .update({ status: 'done', recipe_id: newId as string })
              .eq('id', payload.job_id);
          }
          await queryClient.invalidateQueries({ queryKey: ['recipes', householdId] });
          push({
            variant: 'success',
            title: t('import.success_title'),
            description: t('import.success_body'),
          });
          await navigate({
            to: '/h/$householdId/r/$recipeId',
            params: { householdId, recipeId: newId },
          });
        })}
      >
        <Input placeholder={t('import.url_placeholder')} {...register('url')} />
        {errors.url && <p className="text-pomegranate text-sm">{errors.url.message}</p>}
        <div
          className="flex items-center gap-2 text-ink-soft text-xs"
          aria-label={t('import.supported_sources_label')}
        >
          <span>{t('import.supported_sources_label')}</span>
          <Globe className="size-4" aria-hidden="true" />
          <Instagram className="size-4" aria-hidden="true" />
        </div>
        <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
          {t('import.submit')}
        </Button>
      </form>
      <ImportProgress active={isSubmitting} onBackground={dispatchToBackground} />
    </Card>
  );
}

function PhotoTab({ householdId }: { householdId: string }) {
  const { t } = useTranslation();
  const { push } = useToast();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { register: registerImport } = useActiveImports();
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const backgroundedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ImportPhotoInput>({
    resolver: zodResolver(ImportPhotoSchema),
    defaultValues: { comment: '' },
  });

  const dispatchToBackground = (): void => {
    if (backgroundedRef.current) return;
    backgroundedRef.current = true;
    abortRef.current?.abort();
    push({
      variant: 'info',
      title: t('import.background_toast_title'),
      description: t('import.background_toast_body'),
    });
    reset({ comment: '' });
    setFiles([]);
  };

  function addFiles(picked: FileList | null): void {
    setFileError(null);
    if (!picked || picked.length === 0) return;
    // Snapshot now: `picked` is a live FileList that empties when the input's
    // value is cleared below — the setFiles updater runs at commit time, so a
    // late Array.from() reads an empty list.
    const incoming = Array.from(picked);
    setFiles((prev) => {
      const seen = new Set(prev.map(fileKey));
      const next = [...prev];
      let wrongType = false;
      let tooLarge = false;
      let capped = false;
      for (const f of incoming) {
        if (!(PHOTO_ACCEPTED_TYPES as readonly string[]).includes(f.type)) {
          wrongType = true;
          continue;
        }
        if (f.size > PHOTO_MAX_BYTES) {
          tooLarge = true;
          continue;
        }
        const k = fileKey(f);
        if (seen.has(k)) continue;
        if (next.length >= PHOTO_MAX_COUNT) {
          capped = true;
          break;
        }
        seen.add(k);
        next.push(f);
      }
      if (wrongType) setFileError(t('errors.photo_wrong_type'));
      else if (tooLarge) setFileError(t('errors.photo_too_large'));
      else if (capped) setFileError(t('errors.photo_too_many', { max: PHOTO_MAX_COUNT }));
      return next;
    });
  }

  function removeFile(index: number): void {
    setFileError(null);
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <Card className="mt-4 p-6">
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (values) => {
          if (files.length === 0) {
            setFileError(t('errors.photo_wrong_type'));
            return;
          }
          bcImportStart('photo');
          const trimmedComment = values.comment?.trim() ?? '';
          bcImportInputValidated({
            file_count: files.length,
            file_size: files.reduce((s, f) => s + f.size, 0),
            comment_length: trimmedComment.length,
          });

          const { data: userData, error: userErr } = await supabase.auth.getUser();
          if (userErr || !userData.user) {
            push({
              variant: 'error',
              title: t('import.error_title'),
              description: t('errors.internal'),
            });
            return;
          }
          const userId = userData.user.id;
          // Shrink phone-camera photos before upload — cuts upload time and
          // the vision-input token bill. resizeForUpload returns the original
          // file on failure or when no resize is needed.
          const prepared = await Promise.all(files.map(resizeForUpload));
          const uploads = prepared.map((file) => {
            const ext = file.type === 'image/png' ? 'png' : 'jpg';
            const path = `${userId}/${crypto.randomUUID()}.${ext}`;
            return supabase.storage
              .from('imports')
              .upload(path, file, { contentType: file.type, upsert: false })
              .then((res) => ({ path, error: res.error }));
          });
          const uploadResults = await Promise.all(uploads);
          const uploadFailed = uploadResults.find((r) => r.error);
          if (uploadFailed) {
            push({
              variant: 'error',
              title: t('import.error_title'),
              description: t('errors.photo_upload_failed'),
            });
            return;
          }
          const paths = uploadResults.map((r) => r.path);

          const t0 = performance.now();
          bcImportRequestSent('import-photo', '');
          backgroundedRef.current = false;
          const ac = new AbortController();
          abortRef.current = ac;
          const timer = setTimeout(() => ac.abort(), IMPORT_URL_TIMEOUT_MS);
          let invokeError: unknown = null;
          let data: unknown = null;
          try {
            const result = await supabase.functions.invoke('import-photo', {
              body: {
                household_id: householdId,
                paths,
                ...(trimmedComment ? { comment: trimmedComment } : {}),
              },
              signal: ac.signal,
            });
            invokeError = result.error;
            data = result.data;
          } catch (e) {
            invokeError = e;
          } finally {
            clearTimeout(timer);
            abortRef.current = null;
          }
          bcImportResponseReceived(Math.round(performance.now() - t0), invokeError ? 500 : 200);
          if (backgroundedRef.current) return;
          if (invokeError) {
            const code = await readErrorCode(invokeError);
            push({
              variant: 'error',
              title: t('import.error_title'),
              description: t(`errors.${code}`),
            });
            return;
          }
          const payload = data as DraftResponse | null;
          if (payload?.status === 'running' && payload.job_id) {
            registerImport({ jobId: payload.job_id, householdId, kind: 'photo' });
            push({
              variant: 'info',
              title: t('import.background_toast_title'),
              description: t('import.background_toast_body'),
            });
            reset({ comment: '' });
            setFiles([]);
            return;
          }
          if (payload?.needs_review || !payload?.draft) {
            push({
              variant: 'error',
              title: t('import.needs_review_title'),
              description: t('import.needs_review_body'),
            });
            return;
          }
          const { data: newId, error: saveErr } = await supabase.rpc('save_recipe', {
            p_household: householdId,
            p_draft: payload.draft as never,
          });
          if (saveErr || !newId) {
            const detail = saveErr?.message?.trim() || saveErr?.details?.trim() || null;
            bcImportSaveFailed({
              code: saveErr?.code ?? null,
              message: saveErr?.message ?? null,
              details: saveErr?.details ?? null,
              hint: saveErr?.hint ?? null,
            });
            push({
              variant: 'error',
              persist: detail !== null,
              title: t('import.error_title'),
              description: (
                <>
                  <p>{t('errors.internal')}</p>
                  {detail && (
                    <p className="mt-1 text-xs opacity-80 break-words">
                      <span className="font-medium">{t('import.error_detail_label')}:</span>{' '}
                      {detail}
                    </p>
                  )}
                </>
              ),
            });
            return;
          }
          if (payload.job_id) {
            void supabase
              .from('import_jobs')
              .update({ status: 'done', recipe_id: newId as string })
              .eq('id', payload.job_id);
          }
          await queryClient.invalidateQueries({ queryKey: ['recipes', householdId] });
          push({
            variant: 'success',
            title: t('import.success_title'),
            description: t('import.success_body'),
          });
          reset({ comment: '' });
          setFiles([]);
          await navigate({
            to: '/h/$householdId/r/$recipeId',
            params: { householdId, recipeId: newId },
          });
        })}
      >
        <div className="space-y-1">
          <label className="block font-body text-sm text-ink-soft">
            {t('import.photo_pick_label')}
          </label>
          <input
            type="file"
            accept={PHOTO_ACCEPTED_TYPES.join(',')}
            multiple
            onChange={(e) => {
              addFiles(e.target.files);
              // Reset so re-picking the same file after removal still fires onChange.
              e.target.value = '';
            }}
            className="block w-full text-sm text-ink file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-saffron file:px-3 file:py-2 file:text-ink file:font-body hover:file:cursor-pointer disabled:opacity-60"
            disabled={isSubmitting || files.length >= PHOTO_MAX_COUNT}
          />
          <p className="text-xs text-ink-muted">
            {t('import.photo_hint', { max: PHOTO_MAX_COUNT })}
          </p>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li
                  key={fileKey(f)}
                  className="flex items-center justify-between rounded-[var(--radius-sm)] border border-ink/10 bg-paper px-2 py-1 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-ink-muted mr-2">{i + 1}.</span>
                    {f.name} <span className="text-ink-muted">({formatBytes(f.size)})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    disabled={isSubmitting}
                    className="ml-2 shrink-0 rounded px-2 py-0.5 text-xs text-pomegranate hover:underline disabled:opacity-60"
                    aria-label={t('import.photo_remove_aria', { name: f.name })}
                  >
                    {t('import.photo_remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {fileError && <p className="text-pomegranate text-sm">{fileError}</p>}
        </div>
        <div className="space-y-1">
          <label className="block font-body text-sm text-ink-soft" htmlFor="photo-comment">
            {t('import.photo_comment_label')}
          </label>
          <Textarea
            id="photo-comment"
            rows={3}
            placeholder={t('import.photo_comment_placeholder')}
            disabled={isSubmitting}
            {...register('comment')}
          />
          <p className="text-xs text-ink-muted">{t('import.photo_comment_hint')}</p>
          {errors.comment && <p className="text-pomegranate text-sm">{errors.comment.message}</p>}
        </div>
        <Button type="submit" loading={isSubmitting} disabled={isSubmitting || files.length === 0}>
          {t('import.submit')}
        </Button>
      </form>
      <ImportProgress active={isSubmitting} onBackground={dispatchToBackground} />
    </Card>
  );
}

function ManualTab({ householdId }: { householdId: string }) {
  const { t, i18n } = useTranslation();
  const { push } = useToast();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const { tags: allowedTags, isLoading: tagsLoading } = useHouseholdAllowedTags(householdId);
  const [isSaving, setIsSaving] = useState(false);
  const defaults = useMemo(() => blankManualRecipe(i18n.language), [i18n.language]);

  const handleSubmit = async (values: Recipe): Promise<void> => {
    setIsSaving(true);
    const { data: newId, error: saveErr } = await supabase.rpc('save_recipe', {
      p_household: householdId,
      p_draft: values as never,
    });
    if (saveErr || !newId) {
      setIsSaving(false);
      const detail = saveErr?.message?.trim() || saveErr?.details?.trim() || null;
      push({
        variant: 'error',
        persist: detail !== null,
        title: t('import.error_title'),
        description: (
          <>
            <p>{t('errors.internal')}</p>
            {detail && (
              <p className="mt-1 text-xs opacity-80 break-words">
                <span className="font-medium">{t('import.error_detail_label')}:</span> {detail}
              </p>
            )}
          </>
        ),
      });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['recipes', householdId] });
    push({
      variant: 'success',
      title: t('import.success_title'),
      description: t('import.success_body'),
    });
    await navigate({
      to: '/h/$householdId/r/$recipeId',
      params: { householdId, recipeId: newId },
    });
  };

  if (tagsLoading) {
    return (
      <div className="mt-4 space-y-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="mt-4">
      <RecipeEditForm
        defaultValues={defaults}
        allowedTags={allowedTags}
        onSubmit={handleSubmit}
        onCancel={() => navigate({ to: '/h/$householdId', params: { householdId } })}
        isSubmitting={isSaving}
        submitLabel={t('import.manual_submit')}
      />
    </div>
  );
}
