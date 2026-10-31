/**
 * OMNIRA — Frontend API client
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 */

'use client';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });

  if (!res.ok) {
    let payload: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      payload = await res.json();
    } catch {
      // non-JSON error body
    }
    throw new ApiClientError(
      res.status,
      payload.error?.code ?? 'UNKNOWN',
      payload.error?.message ?? `Request failed (${res.status})`,
      payload.error?.details,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const get = <T>(path: string) => request<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body);
export const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body);
export const del = <T>(path: string) => request<T>('DELETE', path);
