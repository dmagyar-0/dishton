import { useFeatureFlag } from '@/feature-flags';
import { type ImportUrlInput, ImportUrlSchema, detectImportSource } from '@/lib/forms/import';
import { supabase } from '@/lib/supabase';
import {
  bcImportInputValidated,
  bcImportRequestSent,
  bcImportResponseReceived,
  bcImportStart,
} from '@/observability/breadcrumbs';
import { Button } from '@/ui/primitives/Button';
import { Card } from '@/ui/primitives/Card';
import { Input } from '@/ui/primitives/Input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/Tabs';
import { useToast } from '@/ui/primitives/Toast';
import { ImportProgress } from '@/ui/recipe/ImportProgress';
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute } from '@tanstack/react-router';
import { Globe, Instagram } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { requireHousehold } from '../../_guards';

const IMPORT_URL_TIMEOUT_MS = 120_000;

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
  beforeLoad: requireHousehold,
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
  needs_review?: boolean;
  reason?: string;
  thumbnail_url?: string | null;
};

function UrlTab({ householdId }: { householdId: string }) {
  const { t } = useTranslation();
  const { push } = useToast();
  const [draft, setDraft] = useState<DraftResponse | null>(null);
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
          setDraft(null);
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
          if (payload?.needs_review) {
            push({
              variant: 'error',
              title: t('import.needs_review_title'),
              description: t('import.needs_review_body'),
            });
            setDraft(payload);
            return;
          }
          push({
            variant: 'success',
            title: t('import.success_title'),
            description: t('import.success_body'),
          });
          setDraft(payload);
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
      <AnimatePresence>
        {draft != null && !isSubmitting && (
          <motion.div
            key="draft-preview"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.32, ease: [0.2, 0.7, 0.1, 1.05] }}
            className="mt-4 space-y-3"
          >
            {draft.thumbnail_url && (
              <img
                src={draft.thumbnail_url}
                alt=""
                className="max-h-48 w-auto rounded-[var(--radius-md)] border border-cream-line"
              />
            )}
            <pre className="text-xs bg-paper border border-cream-line p-3 rounded-[var(--radius-md)] overflow-auto font-mono text-ink-soft">
              {JSON.stringify(draft, null, 2)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function PhotoTab({ householdId }: { householdId: string }) {
  void householdId;
  return <Card className="mt-4 p-6 text-ink-soft">Photo import — pick a JPEG up to 10 MB.</Card>;
}

function ManualTab() {
  return (
    <Card className="mt-4 p-6 text-ink-soft">
      Manual entry — full form lands in a follow-up PR.
    </Card>
  );
}
