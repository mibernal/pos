import type { ReactNode } from 'react';

type BannerTone = 'info' | 'success' | 'error' | 'warning';

export function Banner({ children, tone }: { children: ReactNode; tone: BannerTone }) {
  return <div className={`banner banner-${tone}`}>{children}</div>;
}
