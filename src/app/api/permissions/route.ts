/**
 * OMNIRA — GET /api/permissions
 * The permission catalog + module registry for the role editor UI.
 * Available to any authenticated org member.
 */

import { NextResponse } from 'next/server';
import { withApi } from '@/lib/api/handler';
import { requireUser } from '@/lib/tenancy/context';
import { MODULES, PERMISSION_CATALOG } from '@/lib/permissions/catalog';

export const dynamic = 'force-dynamic';

export const GET = withApi(async (req) => {
  await requireUser(req);
  return NextResponse.json({ permissions: PERMISSION_CATALOG, modules: MODULES });
});
