'use client';

/**
 * OMNIRA — AI Insights module view
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * AI-generated business digests. Bodies are rendered with a tiny built-in
 * markdown-lite renderer (headings, bullets, numbered lists, **bold**) —
 * no external markdown dependency.
 */

import { useMemo, type ReactNode } from 'react';
import { Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiClientError } from '@/lib/client/api';
import { formatDateTime } from '@/lib/client/format';
import { useAuthContext, useGenerateInsight, useInsights } from '@/lib/client/queries';
import { EmptyState, ErrorState, LoadingBlock, PageHeader } from '@/components/shared';
import type { AiInsightDTO } from '@/types/api';

// ---------------------------------------------------------------------------
// Markdown-lite renderer
// ---------------------------------------------------------------------------

/** Inline `**bold**` support inside a line of text. */
function renderInline(text: string, keyPrefix: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  if (parts.length === 1) return text;
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-b${index}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

interface ListLine {
  key: string;
  num: string | null;
  text: string;
}

/**
 * Renders insight bodies: `## heading` lines, `- ` / `* ` bullets,
 * `1.` numbered lines (flex rows with a marker) and plain paragraphs.
 */
function renderMarkdown(body: string): ReactNode {
  const lines = body.split('\n');
  const blocks: ReactNode[] = [];
  let listItems: ListLine[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const items = listItems;
    listItems = [];
    blocks.push(
      <ul key={`list-${blocks.length}`} className="my-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.key} className="flex gap-2.5 text-sm leading-relaxed">
            {item.num ? (
              <span
                className="w-4 shrink-0 text-right text-xs font-semibold leading-5 tabular-nums text-primary"
                aria-hidden="true"
              >
                {item.num}.
              </span>
            ) : (
              <span
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-primary/60"
                aria-hidden="true"
              />
            )}
            <span className="min-w-0">{renderInline(item.text, item.key)}</span>
          </li>
        ))}
      </ul>,
    );
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      return;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      listItems.push({ key: `b-${index}`, num: null, text: bullet[1] });
      return;
    }
    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      listItems.push({ key: `n-${index}`, num: numbered[1], text: numbered[2] });
      return;
    }

    flushList();

    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      blocks.push(
        <h3
          key={`h-${index}`}
          className="mb-1 mt-4 text-base font-semibold text-foreground first:mt-0"
        >
          {renderInline(heading[1], `h-${index}`)}
        </h3>,
      );
      return;
    }
    blocks.push(
      <p key={`p-${index}`} className="text-sm leading-relaxed">
        {renderInline(line, `p-${index}`)}
      </p>,
    );
  });
  flushList();

  return blocks;
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function InsightsView() {
  const { data: auth } = useAuthContext();
  const can = (permission: string) =>
    !!auth && (auth.platformAdmin || auth.permissions.includes(permission));

  const insightsQuery = useInsights();
  const generate = useGenerateInsight();

  // Newest first, capped at 20 cards.
  const insights = useMemo(
    () =>
      [...(insightsQuery.data ?? [])]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 20),
    [insightsQuery.data],
  );

  const handleGenerate = () =>
    generate.mutate(undefined, {
      onSuccess: () => toast.success('Digest ready'),
      onError: (err) =>
        toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong'),
    });

  const generateButton = (label?: string) => (
    <Button onClick={handleGenerate} disabled={generate.isPending}>
      {generate.isPending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <Sparkles className="size-4" aria-hidden="true" />
      )}
      {generate.isPending ? 'Analyzing your data…' : (label ?? 'Generate digest')}
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Insights"
        description="AI-generated business digests from your real sales data"
        icon={Sparkles}
        actions={can('insights.generate') ? generateButton() : undefined}
      />

      {insightsQuery.isError ? (
        <ErrorState
          title="Couldn't load insights"
          description={
            insightsQuery.error instanceof ApiClientError ? insightsQuery.error.message : undefined
          }
          onRetry={() => insightsQuery.refetch()}
        />
      ) : insightsQuery.isLoading ? (
        <LoadingBlock lines={3} />
      ) : insights.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No insights yet — generate your first digest"
          description="The AI reviews your last 30 days of sales, expenses and stock to surface trends, risks and opportunities."
          action={can('insights.generate') ? generateButton('Generate your first digest') : undefined}
        />
      ) : (
        <div className="space-y-4">
          {insights.map((insight: AiInsightDTO) => (
            <Card key={insight.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  >
                    {insight.kind || 'DIGEST'}
                  </Badge>
                  <CardTitle className="text-base">{insight.title}</CardTitle>
                  <span className="ml-auto flex items-center gap-2">
                    {insight.model ? (
                      <Badge variant="secondary" className="text-[11px] font-normal text-muted-foreground">
                        {insight.model}
                      </Badge>
                    ) : null}
                    <span className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(insight.createdAt)}
                    </span>
                  </span>
                </div>
              </CardHeader>
              <CardContent>{renderMarkdown(insight.body)}</CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="flex items-center justify-center gap-1.5 pt-2 text-center text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
        Insights are generated from your organization&rsquo;s data only.
      </p>
    </div>
  );
}

export default InsightsView;
