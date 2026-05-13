"use client";

import { useState } from "react";

/** Lazy-load remote URL; hides itself if the browser fails to decode (broken link, CSP, etc.). */
export function SafeRemoteImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setOk(false)}
    />
  );
}
