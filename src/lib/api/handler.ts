/**
 * OMNIRA — Route handler wrapper
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * `withApi` wraps a Next.js route handler and guarantees:
 *   - ApiError → structured JSON `{ error: { code, message, details? } }`
 *   - ZodError → 422 VALIDATION with field details
 *   - anything else → 500 INTERNAL (logged, never leaks internals)
 */

import type { NextRequest, NextResponse } from 'next/server';
import { NextResponse as NR } from 'next/server';
import { ZodError } from 'zod';
import { ApiError } from '@/lib/api/errors';

type Handler<Ctx> = (req: NextRequest, ctx: Ctx) => Promise<NextResponse | Response>;

export function withApi<Ctx = unknown>(handler: Handler<Ctx>) {
  return async (req: NextRequest, ctx: Ctx): Promise<NextResponse | Response> => {
    try {
      return await handler(req, ctx);
    } catch (error) {
      if (error instanceof ApiError) {
        return NR.json(
          { error: { code: error.code, message: error.message, details: error.details ?? null } },
          { status: error.status },
        );
      }
      if (error instanceof ZodError) {
        return NR.json(
          {
            error: {
              code: 'VALIDATION',
              message: 'Request validation failed',
              details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            },
          },
          { status: 422 },
        );
      }
      console.error('[api] unhandled error:', error);
      return NR.json(
        { error: { code: 'INTERNAL', message: 'An unexpected error occurred', details: null } },
        { status: 500 },
      );
    }
  };
}

/** Parse a JSON body safely (empty body → {}). */
export async function readJson(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
