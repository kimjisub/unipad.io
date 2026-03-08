'use client';

import { type ReactNode } from 'react';

interface GradientTextProps {
  children: ReactNode;
  className?: string;
  /**
   * Animation duration in seconds. Default: 6s.
   * Slower = more subtle flowing feel.
   */
  duration?: number;
}

/**
 * Wraps children with a smoothly flowing gradient animation.
 * Gradient colors are driven by CSS variables (--accent, --mesh-color-*)
 * so they adapt automatically to the current theme/accent.
 *
 * @example
 *   <h1><GradientText>김지섭</GradientText></h1>
 */
export function GradientText({
  children,
  className = '',
  duration = 6,
}: GradientTextProps) {
  return (
    <span
      className={`animated-gradient-text ${className}`}
      style={{ animationDuration: `${duration}s` }}
    >
      {children}
    </span>
  );
}
