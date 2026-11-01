'use client';

import type { ReactNode } from 'react';
import { AppShell } from '@/components/AppShell';
import { SessionProvider } from '@/lib/session';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
