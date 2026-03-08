'use client';

import { ReactNode } from 'react';
import { Theme } from '@radix-ui/themes';

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  return <Theme appearance="dark">{children}</Theme>;
}
