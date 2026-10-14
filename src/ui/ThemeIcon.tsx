/** Stable vector icons keep theme controls independent of emoji/font coverage. */
export function ThemeIcon({ theme }: { theme: 'navy' | 'dark' | 'light' }) {
  return <svg data-theme-icon={theme} width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {theme === 'dark' ? <path fill="white" d="M20.2 15.5A9 9 0 0 1 8.5 3.8a9 9 0 1 0 11.7 11.7Z" />
      : theme === 'light' ? <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></g>
      : <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M2 7c3-4 7 4 10 0s7 4 10 0M2 12c3-4 7 4 10 0s7 4 10 0M2 17c3-4 7 4 10 0s7 4 10 0" /></g>}
  </svg>
}
