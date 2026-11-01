'use client';

import React, { useState } from 'react';
import { LOGO_DATA_URI } from '@/lib/logoData';

interface WebStudioLogoProps {
  className?: string;
  size?: number;
}

export function WebStudioLogo({ className = 'w-full h-full object-contain', size = 32 }: WebStudioLogoProps) {
  const [imgSrc, setImgSrc] = useState<string>(LOGO_DATA_URI);

  return (
    <img
      src={imgSrc}
      alt="WebStudio Logo"
      width={size}
      height={size}
      className={className}
      onError={() => {
        // Automatic fail-safe to embedded data URI
        if (imgSrc !== LOGO_DATA_URI) {
          setImgSrc(LOGO_DATA_URI);
        }
      }}
    />
  );
}
