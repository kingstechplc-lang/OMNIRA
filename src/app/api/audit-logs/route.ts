/**
 * OMNIRA — GET /api/audit-logs (org-scoped, permission: audit.view)
 * Paginated, filterable activity trail (search, action, date range).
 */

import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { validationError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/tenancy/context';
import type { AuditLogDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

function toMetadata(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'audit.view');

  const params = req.nextUrl.searchParams;
  const search = params.get('search')?.trim() ?? null;
  const action = params.get('action')?.trim() || null;

  const pageRaw = Number(params.get('page') ?? '1');
  const sizeRaw = Number(params.get('size') ?? '50');
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  const size = Number.isFinite(sizeRaw) && sizeRaw >= 1 ? Math.min(200, Math.floor(sizeRaw)) : 50;

  const fromRaw = params.get('from');
  const toRaw = params.get('to');
  let from: Date | undefined;
  let to: Date | undefined;
  if (fromRaw) {
    from = new Date(fromRaw);
    if (Number.isNaN(from.getTime())) throw validationError('Invalid "from" date — expected an ISO date');
  }
  if (toRaw) {
    to = new Date(toRaw);
    if (Number.isNaN(to.getTime())) throw validationError('Invalid "to" date — expected an ISO date');
  }

  const where: Prisma.AuditLogWhereInput = { organizationId: ctx.orgId };
  if (action) where.action = action;
  if (search) {
    where.OR = [
      { action: { contains: search } },
      { summary: { contains: search } },
      { actor: { email: { contains: search } } },
    ];
  }
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lte: to } : {}),
    };
  }

  const logs = await db.auditLog.findMany({
    where,
    include: { actor: true },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * size,
    take: size,
  });

  const items: AuditLogDTO[] = logs.map((log) => ({
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    summary: log.summary,
    metadata: toMetadata(log.metadata),
    ipAddress: log.ipAddress,
    createdAt: log.createdAt.toISOString(),
    actorName: log.actor?.fullName ?? null,
    actorEmail: log.actor?.email ?? null,
  }));

  return NextResponse.json(items);
});
