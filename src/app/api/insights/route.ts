/**
 * OMNIRA — AI insights (list)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Stored AI-generated business digests for the active organization,
 * newest first. Bodies are markdown.
 */

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { withApi } from '@/lib/api/handler';
import { requirePermission } from '@/lib/tenancy/context';
import type { AiInsightDTO } from '@/types/api';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req) => {
  const ctx = await requirePermission(req, 'insights.view');

  const insights = await db.aiInsight.findMany({
    where: { organizationId: ctx.orgId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const dtos: AiInsightDTO[] = insights.map((i) => ({
    id: i.id,
    kind: i.kind,
    title: i.title,
    body: i.body,
    data: i.data ? (i.data as Record<string, unknown>) : null,
    model: i.model ?? null,
    createdAt: i.createdAt.toISOString(),
  }));

  return NextResponse.json(dtos);
});
