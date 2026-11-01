'use client';

import type { Role } from '@careerconnect/shared';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '@/lib/session';
import { ModeBanner } from './ModeBanner';
import { Badge, Button, cx } from './ui';

const NAV: { href: string; label: string; minRole?: Role }[] = [
  { href: '/', label: 'Overview' },
  { href: '/conversations', label: 'Conversations' },
  { href: '/drafts', label: 'Review queue' },
  { href: '/brand', label: 'Brand settings' },
  { href: '/policies', label: 'Communities & discovery' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/system', label: 'System health' },
  { href: '/audit', label: 'Audit log', minRole: 'ADMIN' },
];

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, hasRole, logout, publishing } = useSession();
  const pathname = usePathname() ?? '/';
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [pathname]);

  const items = NAV.filter((n) => !n.minRole || hasRole(n.minRole));

  return (
    <div className="min-h-screen bg-slate-50">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to main content
      </a>
      <ModeBanner mode={publishing?.mode} globalPause={publishing?.globalPause} pauseReason={publishing?.pauseReason} />
      <div className="flex">
        <aside
          id="sidebar"
          className={cx(
            'w-full shrink-0 border-r border-slate-200 bg-white md:sticky md:top-0 md:block md:h-screen md:w-60',
            menuOpen ? 'block' : 'hidden',
          )}
        >
          <div className="hidden px-5 py-5 md:block">
            <p className="text-base font-bold text-slate-900">CareerConnect AI</p>
            <p className="text-xs text-slate-600">Compliance-first reply assistant</p>
          </div>
          <nav aria-label="Main">
            <ul className="space-y-1 px-3 py-3 md:py-0">
              {items.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cx(
                        'block rounded-md px-3 py-2 text-sm font-medium',
                        active ? 'bg-indigo-50 text-indigo-800' : 'text-slate-700 hover:bg-slate-100',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>
        <div className="min-w-0 flex-1">
          <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="md:hidden"
                aria-expanded={menuOpen}
                aria-controls="sidebar"
                onClick={() => setMenuOpen((o) => !o)}
              >
                {menuOpen ? 'Close menu' : 'Menu'}
              </Button>
              <span className="text-sm font-bold text-slate-900 md:hidden">CareerConnect AI</span>
              {publishing ? (
                <span className="hidden text-xs text-slate-600 sm:inline">
                  Mode: <span className="font-semibold text-slate-800">{publishing.mode}</span>
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="max-w-[12rem] truncate text-sm text-slate-800 sm:max-w-none" title={user.email}>
                  {user.email}
                </p>
                <Badge tone={user.role === 'ADMIN' ? 'indigo' : user.role === 'REVIEWER' ? 'blue' : 'gray'}>
                  <span className="sr-only">Role: </span>
                  {user.role}
                </Badge>
              </div>
              <Button variant="secondary" onClick={() => void logout()}>
                Log out
              </Button>
            </div>
          </header>
          <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-6 focus:outline-none sm:px-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
