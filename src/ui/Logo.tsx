/** Original Mosaic mark: four offset rounded tiles on the accent palette. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <rect x="4" y="4" width="19" height="19" rx="5" fill="#6C5CE7" />
      <rect x="27" y="6" width="17" height="17" rx="5" fill="#A29BFE" />
      <rect x="6" y="27" width="17" height="17" rx="5" fill="#C7C1F8" />
      <rect x="27" y="27" width="17" height="17" rx="5" fill="#4B3FD1" />
    </svg>
  );
}
