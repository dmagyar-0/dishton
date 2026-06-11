import type { Recipe } from '@/domain/recipe';
import {
  type ImportPhotoInput,
  ImportPhotoSchema,
  type ImportUrlInput,
  ImportUrlSchema,
  detectImportSource,
} from '@/lib/forms/import';
import { blankManualRecipe } from '@/lib/forms/manual-recipe';
import { type ActiveImport, useActiveImports } from '@/lib/imports/ActiveImportsProvider';
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
import { ImportQueue } from '@/ui/recipe/ImportQueue';
import { RecipeEditForm } from '@/ui/recipe/edit/RecipeEditForm';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Globe, Instagram } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../../_guards';

// Only the kickoff round-trip is awaited now (the worker runs in the
// background), so this guards a hung/cold-start invoke, not the whole import.
const IMPORT_KICKOFF_TIMEOUT_MS = 30_000;
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
      <ImportQueuePanel householdId={householdId} />
    </main>
  );
}

// Connects the in-memory active-imports state to the presentational queue,
// scoped to this household. Lives on the import page so progress is visible
// across the URL/Photo/Manual tabs.
function ImportQueuePanel({ householdId }: { householdId: string }) {
  const { items, dismiss } = useActiveImports();
  const navigate = useNavigate({ from: Route.fullPath });
  const householdItems = items.filter((it) => it.householdId === householdId);
  const onView = (item: ActiveImport): void => {
    if (!item.recipeId) return;
    void navigate({
      to: '/h/$householdId/r/$recipeId',
      params: { householdId, recipeId: item.recipeId },
    });
  };
  return <ImportQueue items={householdItems} onDismiss={dismiss} onView={onView} />;
}

type DraftResponse = {
  job_id?: string;
  status?: 'running';
};

type ImportKindLocal = 'url' | 'instagram' | 'photo';

function UrlTab({ householdId }: { householdId: string }) {
  const { t } = useTranslation();
  const { push } = useToast();
  const { register: registerImport } = useActiveImports();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ImportUrlInput>({ resolver: zodResolver(ImportUrlSchema) });

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
          // Only the kickoff is awaited; the worker finishes in the background
          // and the Realtime listener saves the draft.
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), IMPORT_KICKOFF_TIMEOUT_MS);
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
          }
          bcImportResponseReceived(Math.round(performance.now() - t0), invokeError ? 500 : 202);
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
          if (payload?.job_id) {
            registerImport({ jobId: payload.job_id, householdId, kind, sourceUrl: values.url });
          }
          push({
            variant: 'info',
            title: t('import.started_toast_title'),
            description: t('import.started_toast_body'),
          });
          reset();
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
    </Card>
  );
}

function PhotoTab({ householdId }: { householdId: string }) {
  const { t } = useTranslation();
  const { push } = useToast();
  const { register: registerImport } = useActiveImports();
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ImportPhotoInput>({
    resolver: zodResolver(ImportPhotoSchema),
    defaultValues: { comment: '' },
  });

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
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), IMPORT_KICKOFF_TIMEOUT_MS);
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
          }
          bcImportResponseReceived(Math.round(performance.now() - t0), invokeError ? 500 : 202);
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
          if (payload?.job_id) {
            registerImport({ jobId: payload.job_id, householdId, kind: 'photo' });
          }
          push({
            variant: 'info',
            title: t('import.started_toast_title'),
            description: t('import.started_toast_body'),
          });
          reset({ comment: '' });
          setFiles([]);
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
      // Raw PostgREST messages can embed constraint names and row values —
      // keep them in the Sentry breadcrumb for triage, never in the toast.
      bcImportSaveFailed({
        code: saveErr?.code ?? null,
        message: saveErr?.message ?? null,
        details: saveErr?.details ?? null,
        hint: saveErr?.hint ?? null,
      });
      push({
        variant: 'error',
        title: t('import.error_title'),
        description: t('errors.internal'),
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
