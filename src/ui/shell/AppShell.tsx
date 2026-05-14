import { useAuth } from '@/lib/auth';
import { cn } from '@/ui/cn';
import { Link, Outlet } from '@tanstack/react-router';
import { Home, Search, Settings, Upload, User, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const NAV_CLASS = cn(
  'inline-flex items-center gap-1.5 px-2 md:px-3 py-2 rounded-[var(--radius-pill)]',
  'text-sm text-ink hover:bg-paper-2 transition-colors duration-[var(--duration-fast)]',
);

export function AppShell() {
  const { t } = useTranslation();
  const memberships = useAuth((s) => s.memberships);
  const householdId = memberships[0]?.household_id;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-cream-line">
        <nav className="max-w-6xl mx-auto px-3 sm:px-4 py-3 flex items-center justify-between gap-2">
          <Link to="/" className="font-display text-xl md:text-2xl text-aubergine shrink-0">
            {t('app.name')}
          </Link>
          <ul className="flex items-center gap-0 md:gap-1">
            {householdId && (
              <li>
                <Link to="/h/$householdId" params={{ householdId }} className={NAV_CLASS}>
                  <Home size={16} strokeWidth={1.5} />
                  <span className="hidden md:inline">{t('nav.home')}</span>
                </Link>
              </li>
            )}
            <li>
              <Link to="/search" className={NAV_CLASS}>
                <Search size={16} strokeWidth={1.5} />
                <span className="hidden md:inline">Search</span>
              </Link>
            </li>
            {householdId && (
              <li>
                <Link to="/h/$householdId/import" params={{ householdId }} className={NAV_CLASS}>
                  <Upload size={16} strokeWidth={1.5} />
                  <span className="hidden md:inline">{t('nav.import')}</span>
                </Link>
              </li>
            )}
            <li>
              <Link to="/following" className={NAV_CLASS}>
                <Users size={16} strokeWidth={1.5} />
                <span className="hidden md:inline">{t('nav.following')}</span>
              </Link>
            </li>
            {householdId && (
              <li>
                <Link
                  to="/h/$householdId/settings"
                  params={{ householdId }}
                  search={{ tab: 'general' }}
                  className={NAV_CLASS}
                >
                  <Settings size={16} strokeWidth={1.5} />
                  <span className="hidden md:inline">{t('nav.household_settings')}</span>
                </Link>
              </li>
            )}
            <li>
              <Link to="/profile" className={NAV_CLASS}>
                <User size={16} strokeWidth={1.5} />
                <span className="hidden md:inline">{t('nav.profile')}</span>
              </Link>
            </li>
          </ul>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
