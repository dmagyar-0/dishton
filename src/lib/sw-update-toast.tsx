// Listens for SW updates emitted by vite-plugin-pwa and shows a refresh toast.
// The actual `useToast` hook lives in src/ui/primitives/Toast.

// vite-plugin-pwa exposes `useRegisterSW` only in /react. The import is
// virtual at build time.
// @ts-expect-error virtual module from vite-plugin-pwa
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEffect } from 'react';

export function ServiceWorkerUpdateToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedRefresh() {
      // toast surfacing handled by the JSX below
    },
    onOfflineReady() {
      /* noop — we have a static offline.html */
    },
  });

  useEffect(() => {
    if (!needRefresh) return undefined;
    return () => {};
  }, [needRefresh]);

  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 rounded-[var(--radius-md)] bg-aubergine text-paper px-4 py-3 shadow-press"
    >
      <span className="mr-3">A new version is ready.</span>
      <button
        type="button"
        className="underline underline-offset-2"
        onClick={() => updateServiceWorker(true)}
      >
        Refresh
      </button>
      <button
        type="button"
        className="ml-2 opacity-60"
        aria-label="Dismiss"
        onClick={() => setNeedRefresh(false)}
      >
        ×
      </button>
    </div>
  );
}
