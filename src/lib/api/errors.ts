/**
 * OMNIRA — API error contract
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Single error type thrown by services and route handlers. `withApi`
 * (src/lib/api/handler.ts) serializes it to `{ error: { code, message, details? } }`.
 */

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'BAD_REQUEST'
  | 'PAYMENT_REQUIRED'
  | 'INTERNAL';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Convenience factories for the most common errors. */
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'UNAUTHORIZED', message);

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new ApiError(403, 'FORBIDDEN', message);

export const notFound = (message = 'Resource not found') =>
  new ApiError(404, 'NOT_FOUND', message);

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'BAD_REQUEST', message, details);

export const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);

export const validationError = (message: string, details?: unknown) =>
  new ApiError(422, 'VALIDATION', message, details);
