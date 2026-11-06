import type { ReactNode } from "react";

/** Renders a link only for a URL we built or validated; otherwise plain text. */
export function ExternalLink({ href, children, className }: { href?: string; children: ReactNode; className?: string }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
