import { useAuth } from '@/lib/auth';
import { cn } from '@/ui/cn';
import { RoughFilterDefs } from '@/ui/search/ProduceGlyph';
import { ActiveImportsIndicator } from '@/ui/shell/ActiveImportsIndicator';
import { Link, Outlet, useMatchRoute } from '@tanstack/react-router';
import { Home, Settings, User, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const NAV_BASE = cn(
  'relative inline-flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-[var(--radius-pill)]',
  'text-sm transition-colors duration-[var(--duration-fast)]',
);
// Soft Contrast nav: the active route is marked by a small saffron dot under
// the item and saffron-tinted label, rather than a filled chip.
const navClass = (active: boolean) =>
  cn(NAV_BASE, active ? 'text-saffron' : 'text-ink hover:text-saffron');

/** The active-route marker: a small saffron dot centered under the nav item. */
function ActiveDot() {
  return (
    <span
      aria-hidden="true"
      className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-saffron"
    />
  );
}

/** Small cut-paper produce mark beside the wordmark (decorative). */
function BrandMark() {
  return (
    <span aria-hidden="true" className="relative inline-block" style={{ width: 26, height: 28 }}>
      <span
        className="absolute"
        style={{
          width: 24,
          height: 26,
          left: 0,
          top: 1,
          borderRadius: '54% 46% 58% 42%/56% 52% 48% 44%',
          background: 'var(--color-saffron)',
          filter: 'url(#rough)',
        }}
      />
      <span
        className="absolute"
        style={{
          width: 8,
          height: 13,
          left: 16,
          top: -3,
          borderRadius: '0 80% 0 80%',
          background: 'var(--color-soft-green)',
          filter: 'url(#rough)',
          transform: 'rotate(22deg)',
        }}
      />
    </span>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const matchRoute = useMatchRoute();
  const memberships = useAuth((s) => s.memberships);
  // Prefer the personal household for header links when the user has
  // multiple memberships — keeps the "Home" affordance pointing at the
  // user's own recipes rather than a shared household chosen by array
  // order. Single-membership users get the same household either way.
  const personalMembership = memberships.find((m) => m.is_personal);
  const householdId = (personalMembership ?? memberships[0])?.household_id;
  const isSolo = memberships.length === 1 && memberships[0]?.is_personal === true;

  const homeActive = householdId
    ? Boolean(matchRoute({ to: '/h/$householdId', params: { householdId } }))
    : false;
  const settingsActive = householdId
    ? Boolean(matchRoute({ to: '/h/$householdId/settings', params: { householdId } }))
    : false;
  const householdsActive = Boolean(matchRoute({ to: '/households' }));
  const profileActive = Boolean(matchRoute({ to: '/profile' }));

  return (
    <div className="min-h-dvh">
      {/* Shared #rough displacement filter for the brand mark + produce glyphs. */}
      <RoughFilterDefs />
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-cream-line">
        <nav className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <BrandMark />
            <span className="font-display text-xl md:text-2xl text-blueberry">{t('app.name')}</span>
          </Link>
          <ul className="flex items-center gap-0 md:gap-1">
            {householdId && (
              <li>
                <Link
                  to="/h/$householdId"
                  params={{ householdId }}
                  className={navClass(homeActive)}
                  aria-label={isSolo ? t('nav.my_recipes') : t('nav.home')}
                >
                  <Home size={16} strokeWidth={1.5} />
                  <span className="hidden md:inline">
                    {isSolo ? t('nav.my_recipes') : t('nav.home')}
                  </span>
                  {homeActive && <ActiveDot />}
                </Link>
              </li>
            )}
            <li>
              <Link
                to="/households"
                className={navClass(householdsActive)}
                aria-label={t('nav.households')}
              >
                <Users size={16} strokeWidth={1.5} />
                <span className="hidden md:inline">{t('nav.households')}</span>
                {householdsActive && <ActiveDot />}
              </Link>
            </li>
            {householdId && (
              <li>
                <Link
                  to="/h/$householdId/settings"
                  params={{ householdId }}
                  search={{ tab: 'general' }}
                  className={navClass(settingsActive)}
                  aria-label={t('nav.household_settings')}
                >
                  <Settings size={16} strokeWidth={1.5} />
                  <span className="hidden md:inline">{t('nav.household_settings')}</span>
                  {settingsActive && <ActiveDot />}
                </Link>
              </li>
            )}
            <li>
              <Link to="/profile" className={navClass(profileActive)} aria-label={t('nav.profile')}>
                <User size={16} strokeWidth={1.5} />
                <span className="hidden md:inline">{t('nav.profile')}</span>
                {profileActive && <ActiveDot />}
              </Link>
            </li>
            <li className="ml-1">
              <ActiveImportsIndicator />
            </li>
          </ul>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
