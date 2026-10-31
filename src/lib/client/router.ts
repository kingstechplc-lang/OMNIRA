/**
 * OMNIRA — Hash router (single-page app at /)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * The whole workspace lives at the `/` route; views are selected by the
 * URL hash (`#/pos`, `#/products`, …). This keeps deep-linking, browser
 * back/forward and the command menu working without extra routes.
 */

'use client';

export function readHash(): string {
  if (typeof window === 'undefined') return '';
  const raw = window.location.hash;
  if (!raw || raw === '#' || raw === '#/') return '';
  return raw.startsWith('#/') ? raw.slice(1) : raw.slice(1);
}

export function navigate(path: string): void {
  if (typeof window === 'undefined') return;
  const target = path.startsWith('/') ? path : `/${path}`;
  if (window.location.hash === `#${target}`) return;
  window.location.hash = target;
}

/** Subscribe to hash changes. Returns an unsubscribe function. */
export function onHashChange(callback: (route: string) => void): () => void {
  const handler = () => callback(readHash());
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}

/** Parse a route like `/products/42/edit` into segments. */
export function routeSegments(route: string): string[] {
  return route.split('/').filter(Boolean);
}
