import type { ReactNode } from 'react';

export function AppShellLayout({
  children,
  header
}: {
  children: ReactNode;
  header: ReactNode;
}) {
  return (
    <main className="app-shell">
      {header}
      <section className="view-container">{children}</section>
    </main>
  );
}
