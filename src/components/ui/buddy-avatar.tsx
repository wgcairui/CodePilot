'use client';

import { useState } from 'react';
import { SPECIES_IMAGE_URL, EGG_IMAGE_URL, SPECIES_EMOJI, type Species } from '@/lib/buddy';
import { cn } from '@/lib/utils';

interface BuddyAvatarProps {
  /** If undefined/null, shows egg. */
  species?: Species | null;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Renders the buddy/egg image with an emoji fallback when the image fails to load.
 * Images are served from /public/buddy/ as local static assets.
 */
export function BuddyAvatar({ species, size = 24, className, style }: BuddyAvatarProps) {
  // Track the src that errored, not a boolean, so a species change resets the error state.
  const [erroredSrc, setErroredSrc] = useState<string | null>(null);

  const src = species ? (SPECIES_IMAGE_URL[species] || '') : EGG_IMAGE_URL;
  const emoji = species ? (SPECIES_EMOJI[species] || '🥚') : '🥚';

  if (erroredSrc === src || !src) {
    return (
      <span
        className={cn('inline-flex items-center justify-center shrink-0 select-none', className)}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.72), lineHeight: 1, ...style }}
        aria-hidden
      >
        {emoji}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={className}
      style={style}
      onError={() => setErroredSrc(src)}
    />
  );
}
