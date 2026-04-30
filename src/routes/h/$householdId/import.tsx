import { useFeatureFlag } from '@/feature-flags';
import { type ImportUrlInput, ImportUrlSchema } from '@/lib/forms/import';
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
import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { requireHousehold } from '../../_guards';

export const Route = createFileRoute('/h/$householdId/import')({
  beforeLoad: requireHousehold,
  component: ImportPage,
});

function ImportPage() {
  const { householdId } = Route.useParams();
  const { t } = useTranslation();
  const igEnabled = useFeatureFlag('instagram_import');
  const photoEnabled = useFeatureFlag('photo_import');

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="font-display text-3xl mb-6">{t('nav.import')}</h1>
      <Tabs defaultValue="url">
        <TabsList>
          <TabsTrigger value="url">{t('import.tab_url')}</TabsTrigger>
          {igEnabled && <TabsTrigger value="instagram">{t('import.tab_instagram')}</TabsTrigger>}
          {photoEnabled && <TabsTrigger value="photo">{t('import.tab_photo')}</TabsTrigger>}
          <TabsTrigger value="manual">{t('import.tab_manual')}</TabsTrigger>
        </TabsList>
        <TabsContent value="url">
          <UrlTab householdId={householdId} />
        </TabsContent>
        {igEnabled && (
          <TabsContent value="instagram">
            <InstagramTab householdId={householdId} />
          </TabsContent>
        )}
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

function UrlTab({ householdId }: { householdId: string }) {
  const { t } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
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
          setServerError(null);
          bcImportStart('url');
          bcImportInputValidated({ url_length: values.url.length });
          const t0 = performance.now();
          bcImportRequestSent('import-url', '');
          const { data, error } = await supabase.functions.invoke('import-url', {
            body: { url: values.url, household_id: householdId },
          });
          bcImportResponseReceived(Math.round(performance.now() - t0), error ? 500 : 200);
          if (error) {
            setServerError(error.message);
            return;
          }
          setDraft(data);
        })}
      >
        <Input placeholder={t('import.url_placeholder')} {...register('url')} />
        {errors.url && <p className="text-pomegranate text-sm">{errors.url.message}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {t('import.submit')}
        </Button>
        {serverError && <p className="text-pomegranate text-sm">{serverError}</p>}
      </form>
      {draft != null && (
        <pre className="mt-4 text-xs bg-paper-2 p-3 rounded overflow-auto">
          {JSON.stringify(draft, null, 2)}
        </pre>
      )}
    </Card>
  );
}

function InstagramTab({ householdId }: { householdId: string }) {
  void householdId;
  return (
    <Card className="mt-4 p-6 text-ink-soft">Instagram import — paste a public post URL.</Card>
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
