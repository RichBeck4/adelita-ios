// Which addresses open inside the app and which go to Safari.
export const SITE = 'https://adelita-coach.netlify.app';

// Adelita itself, plus the sign-in pages for watch services she may connect from the app.
const IN_APP_HOSTS = [
  'adelita-coach.netlify.app',
  'adelitarun.com',
  'intervals.icu',
  'coros.com',
];

function hostOf(url: string): string | null {
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
}

function matches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith('.' + allowed);
}

export function isAdelitaPage(url: string): boolean {
  const host = hostOf(url);
  return !!host && (matches(host, 'adelita-coach.netlify.app') || matches(host, 'adelitarun.com'));
}

export function staysInApp(url: string): boolean {
  if (url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) return true;
  if (!url.startsWith('https://')) return false;
  const host = hostOf(url);
  return !!host && IN_APP_HOSTS.some((h) => matches(host, h));
}
