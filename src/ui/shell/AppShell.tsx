import { useFeatureFlag } from '@/feature-flags';
import { useAuth } from '@/lib/auth';
import { cn } from '@/ui/cn';
import { ActiveImportsIndicator } from '@/ui/shell/ActiveImportsIndicator';
import { Link, Outlet } from '@tanstack/react-router';
import { Home, Search, Settings, Sparkles, Upload, User, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Shared base classes for top-bar nav links (desktop).
// Note: text-ink is NOT here — it lives in TOP_NAV_INACTIVE_PROPS so it never
// competes with text-aubergine in the active state (cascade-order issue).
const TOP_NAV_CLASS = cn(
  'inline-flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-[var(--radius-pill)]',
  'text-sm hover:bg-paper-2 transition-colors duration-[var(--duration-fast)]',
);
const TOP_NAV_ACTIVE_CLASS = 'bg-paper-2 text-aubergine';
const TOP_NAV_INACTIVE_PROPS = { className: 'text-ink' };

// Bottom tab bar link classes (mobile).
// Note: text-ink is NOT here — it lives in TAB_INACTIVE_PROPS so active tabs
// always show text-aubergine without a later-declared text-ink overriding it.
const TAB_CLASS = cn(
  'flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-[var(--radius-pill)]',
  'text-xs hover:text-aubergine transition-colors duration-[var(--duration-fast)]',
);
const TAB_ACTIVE_CLASS = 'text-aubergine font-medium';
const TAB_INACTIVE_PROPS = { className: 'text-ink' };

// ---------------------------------------------------------------------------
// Shared nav item descriptors — avoids duplicating the five primary links.
// ---------------------------------------------------------------------------
type NavItem =
  | {
      kind: 'household';
      label: string;
      icon: React.ReactNode;
      to: '/h/$householdId' | '/h/$householdId/import' | '/h/$householdId/draft';
      params: { householdId: string };
      exact: boolean;
    }
  | {
      kind: 'simple';
      label: string;
      icon: React.ReactNode;
      to: '/search' | '/profile';
      exact: boolean;
    };

// Renders a single bottom-tab-bar link, handling the household/simple split so
// the caller doesn't need to repeat the full <Link> block twice.
function TabLink({ item }: { item: NavItem }) {
  return (
    <Link
      to={item.to}
      {...(item.kind === 'household' ? { params: item.params } : {})}
      className={TAB_CLASS}
      activeProps={{ className: TAB_ACTIVE_CLASS }}
      inactiveProps={TAB_INACTIVE_PROPS}
      activeOptions={{ exact: item.exact }}
      aria-label={item.label}
    >
      {item.icon}
      <span>{item.label}</span>
    </Link>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const memberships = useAuth((s) => s.memberships);
  // Prefer the personal household for header links when the user has
  // multiple memberships — keeps the "Home" affordance pointing at the
  // user's own recipes rather than a shared household chosen by array
  // order. Single-membership users get the same household either way.
  const personalMembership = memberships.find((m) => m.is_personal);
  const householdId = (personalMembership ?? memberships[0])?.household_id;
  const isSolo = memberships.length === 1 && memberships[0]?.is_personal === true;
  // FLAG: follows_enabled — only surface the Following nav entry when following
  // is turned on (off by default in MVP production per docs/15).
  const followsEnabled = useFeatureFlag('follows_enabled');

  // ---------------------------------------------------------------------------
  // Five primary destinations shared between top bar (desktop) and bottom tab
  // bar (mobile). Defined once here to avoid duplication.
  // ---------------------------------------------------------------------------
  const primaryItems: NavItem[] = [
    ...(householdId
      ? ([
          {
            kind: 'household',
            label: isSolo ? t('nav.my_recipes') : t('nav.home'),
            icon: <Home size={20} strokeWidth={1.5} />,
            to: '/h/$householdId',
            params: { householdId },
            exact: true,
          },
        ] as NavItem[])
      : []),
    {
      kind: 'simple',
      label: t('search.nav'),
      icon: <Search size={20} strokeWidth={1.5} />,
      to: '/search',
      exact: false,
    },
    ...(householdId
      ? ([
          {
            kind: 'household',
            label: t('nav.import'),
            icon: <Upload size={20} strokeWidth={1.5} />,
            to: '/h/$householdId/import',
            params: { householdId },
            exact: false,
          },
          {
            kind: 'household',
            label: t('chat.nav'),
            icon: <Sparkles size={20} strokeWidth={1.5} />,
            to: '/h/$householdId/draft',
            params: { householdId },
            exact: false,
          },
        ] as NavItem[])
      : []),
    {
      kind: 'simple',
      label: t('nav.profile'),
      icon: <User size={20} strokeWidth={1.5} />,
      to: '/profile',
      exact: false,
    },
  ];

  return (
    <div className="min-h-dvh">
      {/* ------------------------------------------------------------------ */}
      {/* Top header                                                           */}
      {/* ------------------------------------------------------------------ */}
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-cream-line">
        <nav
          aria-label={t('nav.main_nav_label')}
          className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2"
        >
          <Link to="/" className="font-display text-xl md:text-2xl text-aubergine shrink-0">
            {t('app.name')}
          </Link>
          <ul className="flex items-center gap-0 md:gap-1">
            {/* Primary destinations — hidden on mobile (moved to bottom tab bar). */}
            {householdId && (
              <li className="hidden md:flex">
                <Link
                  to="/h/$householdId"
                  params={{ householdId }}
                  className={TOP_NAV_CLASS}
                  activeProps={{ className: TOP_NAV_ACTIVE_CLASS }}
                  inactiveProps={TOP_NAV_INACTIVE_PROPS}
                  activeOptions={{ exact: true }}
                  aria-label={isSolo ? t('nav.my_recipes') : t('nav.home')}
                >
                  <Home size={16} strokeWidth={1.5} />
                  <span className="hidden md:inline">
                    {isSolo ? t('nav.my_recipes') : t('nav.home')}
                  </span>
                </Link>
              </li>
            )}
            <li className="hidden md:flex">
              <Link
                to="/search"
                className={TOP_NAV_CLASS}
                activeProps={{ className: TOP_NAV_ACTIVE_CLASS }}
                inactiveProps={TOP_NAV_INACTIVE_PROPS}
                aria-label={t('search.nav')}
              >
                <Search size={16} strokeWidth={1.5} />
                <span className="hidden md:inline">{t('search.nav')}</span>
              </Link>
            </li>
            {householdId && (
              <li className="hidden md:flex">
                <Link
                  to="/h/$householdId/import"
                  params={{ householdId }}
                  className={TOP_NAV_CLASS}
                  activeProps={{ className: TOP_NAV_ACTIVE_CLASS }}
                  inactiveProps={TOP_NAV_INACTIVE_PROPS}
                  aria-label={t('nav.import')}
                >
                  <Upload size={16} strokeWidth={1.5} />
                  <span className="hidden md:inline">{t('nav.import')}</span>
                </Link>
              </li>
            )}
            {householdId && (
              <li className="hidden md:flex">
                <Link
                  to="/h/$householdId/draft"
                  params={{ householdId }}
                  className={TOP_NAV_CLASS}
                  activeProps={{ className: TOP_NAV_ACTIVE_CLASS }}
                  inactiveProps={TOP_NAV_INACTIVE_PROPS}
                  aria-label={t('chat.nav')}
                >
                  <Sparkles size={16} strokeWidth={1.5} />
                  <span className="hidden md:inline">{t('chat.nav')}</span>
                </Link>
              </li>
            )}
            {/* Secondary / utility items — visible on all viewports. */}
            {followsEnabled && (
              <li>
                <Link
                  to="/following"
                  className={TOP_NAV_CLASS}
                  activeProps={{ className: TOP_NAV_ACTIVE_CLASS }}
                  inactiveProps={TOP_NAV_INACTIVE_PROPS}
                  aria-label={t('nav.following')}
                >
                  <Users size={16} strokeWidth={1.5} />
                  <span className="hidden md:inline">{t('nav.following')}</span>
                </Link>
              </li>
            )}
            {householdId && (
              <li>
                <Link
                  to="/h/$householdId/settings"
                  params={{ householdId }}
                  search={{ tab: 'general' }}
                  className={TOP_NAV_CLASS}
                  activeProps={{ className: TOP_NAV_ACTIVE_CLASS }}
                  inactiveProps={TOP_NAV_INACTIVE_PROPS}
                  aria-label={t('nav.household_settings')}
                >
                  <Settings size={16} strokeWidth={1.5} />
                  <span className="hidden md:inline">{t('nav.household_settings')}</span>
                </Link>
              </li>
            )}
            <li className="hidden md:flex">
              <Link
                to="/profile"
                className={TOP_NAV_CLASS}
                activeProps={{ className: TOP_NAV_ACTIVE_CLASS }}
                inactiveProps={TOP_NAV_INACTIVE_PROPS}
                aria-label={t('nav.profile')}
              >
                <User size={16} strokeWidth={1.5} />
                <span className="hidden md:inline">{t('nav.profile')}</span>
              </Link>
            </li>
            <li className="ml-1">
              <ActiveImportsIndicator />
            </li>
          </ul>
        </nav>
      </header>

      {/* ------------------------------------------------------------------ */}
      {/* Page content — extra bottom padding on mobile for the bottom tab bar */}
      {/* ------------------------------------------------------------------ */}
      <div className="pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-0">
        <Outlet />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Mobile bottom tab bar (hidden on md+)                               */}
      {/* ------------------------------------------------------------------ */}
      <nav
        aria-label={t('nav.tab_bar_label')}
        className={cn(
          'fixed bottom-0 left-0 right-0 z-30 md:hidden',
          'bg-paper/95 backdrop-blur border-t border-cream-line',
          'pb-[env(safe-area-inset-bottom,0px)]',
        )}
      >
        <ul className="flex items-stretch justify-around px-1 py-1">
          {primaryItems.map((item) => (
            <li key={item.to} className="flex-1">
              <TabLink item={item} />
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
