import { useFeatureFlag } from '@/feature-flags';
import {
  type ImportPhotoInput,
  ImportPhotoSchema,
  type ImportUrlInput,
  ImportUrlSchema,
  detectImportSource,
} from '@/lib/forms/import';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/Tabs';
import { Textarea } from '@/ui/primitives/Textarea';
import { useToast } from '@/ui/primitives/Toast';
import { ImportProgress } from '@/ui/recipe/ImportProgress';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Globe, Instagram } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { requireAuth } from '../../_guards';

const IMPORT_URL_TIMEOUT_MS = 120_000;
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png'] as const;

const KNOWN_ERROR_KEYS = [
  'rate_limit',
  'too_many_imports',
  'fetch_failed',
  'not_html',
  'source_too_large',
  'parse_failed',
  'schema_failed',
  'instagram_unavailable',
  'internal',
  'network',
  'timeout',
  'object_not_found',
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
  const photoEnabled = useFeatureFlag('photo_import');

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-6">{t('nav.import')}</h1>
      <Tabs defaultValue="url">
        <TabsList>
          <TabsTrigger value="url">{t('import.tab_url')}</TabsTrigger>
          {photoEnabled && <TabsTrigger value="photo">{t('import.tab_photo')}</TabsTrigger>}
          <TabsTrigger value="manual">{t('import.tab_manual')}</TabsTrigger>
        </TabsList>
        <TabsContent value="url">
          <UrlTab householdId={householdId} />
        </TabsContent>
        {photoEnabled && (
          <TabsContent value="photo">
            <PhotoTab householdId={householdId} />
          </TabsContent>
        )}
        <TabsContent value="manual">
          <ManualTab />
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
};

function UrlTab({ householdId }: { householdId: string }) {
  const { t } = useTranslation();
  const { push } = useToast();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ImportUrlInput>({ resolver: zodResolver(ImportUrlSchema) });

  return (
    <Card className="mt-4 p-6">
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (values) => {
          const source = detectImportSource(values.url);
          const fnName = source === 'instagram' ? 'import-instagram' : 'import-url';
          bcImportStart(source);
          bcImportInputValidated({ url_length: values.url.length, source });
          const t0 = performance.now();
          bcImportRequestSent(fnName, '');
          // Cap the wait so a hung NIM call (3 × 30 s server-side retry) can't
          // leave the form spinning indefinitely with no user feedback.
          const ac = new AbortController();
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
          }
          bcImportResponseReceived(Math.round(performance.now() - t0), invokeError ? 500 : 200);
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
      <ImportProgress active={isSubmitting} />
    </Card>
  );
}

function PhotoTab({ householdId }: { householdId: string }) {
  const { t } = useTranslation();
  const { push } = useToast();
  const navigate = useNavigate({ from: Route.fullPath });
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
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

  function pickFile(next: File | null): void {
    setFileError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (!(PHOTO_ACCEPTED_TYPES as readonly string[]).includes(next.type)) {
      setFile(null);
      setFileError(t('errors.photo_wrong_type'));
      return;
    }
    if (next.size > PHOTO_MAX_BYTES) {
      setFile(null);
      setFileError(t('errors.photo_too_large'));
      return;
    }
    setFile(next);
  }

  return (
    <Card className="mt-4 p-6">
      <form
        className="space-y-3"
        onSubmit={handleSubmit(async (values) => {
          if (!file) {
            setFileError(t('errors.photo_wrong_type'));
            return;
          }
          bcImportStart('photo');
          const trimmedComment = values.comment?.trim() ?? '';
          bcImportInputValidated({
            file_size: file.size,
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
          const ext = file.type === 'image/png' ? 'png' : 'jpg';
          const path = `${userData.user.id}/${crypto.randomUUID()}.${ext}`;

          const { error: uploadErr } = await supabase.storage
            .from('imports')
            .upload(path, file, { contentType: file.type, upsert: false });
          if (uploadErr) {
            push({
              variant: 'error',
              title: t('import.error_title'),
              description: t('errors.photo_upload_failed'),
            });
            return;
          }

          const t0 = performance.now();
          bcImportRequestSent('import-photo', '');
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), IMPORT_URL_TIMEOUT_MS);
          let invokeError: unknown = null;
          let data: unknown = null;
          try {
            const result = await supabase.functions.invoke('import-photo', {
              body: {
                household_id: householdId,
                path,
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
          bcImportResponseReceived(Math.round(performance.now() - t0), invokeError ? 500 : 200);
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
          await queryClient.invalidateQueries({ queryKey: ['recipes', householdId] });
          push({
            variant: 'success',
            title: t('import.success_title'),
            description: t('import.success_body'),
          });
          reset({ comment: '' });
          setFile(null);
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
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink file:mr-3 file:rounded-[var(--radius-sm)] file:border-0 file:bg-saffron file:px-3 file:py-2 file:text-ink file:font-body hover:file:cursor-pointer disabled:opacity-60"
            disabled={isSubmitting}
          />
          <p className="text-xs text-ink-muted">{t('import.photo_hint')}</p>
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
        <Button type="submit" loading={isSubmitting} disabled={isSubmitting || !file}>
          {t('import.submit')}
        </Button>
      </form>
      <ImportProgress active={isSubmitting} />
    </Card>
  );
}

function ManualTab() {
  return (
    <Card className="mt-4 p-6 text-ink-soft">
      Manual entry — full form lands in a follow-up PR.
    </Card>
  );
}
