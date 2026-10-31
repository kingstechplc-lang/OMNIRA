'use client';

/**
 * OMNIRA — Expenses module view
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Operating expense ledger with category/date filters, range stats and a
 * shared create/edit dialog. Rows open the edit dialog on click.
 */

import { useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  Calculator,
  CalendarDays,
  Hourglass,
  Loader2,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiClientError } from '@/lib/client/api';
import { formatCurrency, formatDate, formatNumber, humanizeConstant, parseMoney } from '@/lib/client/format';
import {
  useAuthContext,
  useCreateExpense,
  useExpenses,
  useUpdateExpense,
} from '@/lib/client/queries';
import {
  ErrorState,
  PageHeader,
  StatCard,
  StatusBadge,
} from '@/components/shared';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { EXPENSE_CATEGORIES } from '@/lib/constants';
import type { ExpenseDTO } from '@/types/api';

// ---------------------------------------------------------------------------
// Category colours (no blue/indigo)
// ---------------------------------------------------------------------------

const CATEGORY_TONES: Record<string, string> = {
  RENT: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/25',
  UTILITIES: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
  SALARIES: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  TRANSPORT: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/25',
  SUPPLIES: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/25',
  MARKETING: 'bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/25',
  MAINTENANCE: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25',
  OTHER: 'bg-stone-500/10 text-stone-600 dark:text-stone-400 border-stone-500/25',
};

function CategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant="outline" className={CATEGORY_TONES[category] ?? CATEGORY_TONES.OTHER}>
      {humanizeConstant(category)}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface ExpenseFormState {
  category: string;
  description: string;
  amount: string;
  expenseDate: string;
  status: 'PENDING' | 'PAID';
}

const isoToday = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const CREATE_FORM: ExpenseFormState = {
  category: 'RENT',
  description: '',
  amount: '',
  expenseDate: isoToday(),
  status: 'PAID',
};

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function ExpensesView() {
  const { data: auth } = useAuthContext();
  const currency = auth?.organization?.currency ?? 'GHS';
  const can = (permission: string) =>
    !!auth && (auth.platformAdmin || auth.permissions.includes(permission));

  const [category, setCategory] = useState<string>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters = useMemo(
    () => ({
      category: category === 'all' ? undefined : category,
      from: from || undefined,
      to: to || undefined,
    }),
    [category, from, to],
  );

  const expensesQuery = useExpenses(filters);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseDTO | null>(null);
  const [form, setForm] = useState<ExpenseFormState>(CREATE_FORM);

  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const saving = createExpense.isPending || updateExpense.isPending;

  const rows = useMemo(() => expensesQuery.data ?? [], [expensesQuery.data]);

  const stats = useMemo(() => {
    const total = rows.reduce((sum, e) => sum + e.amount, 0);
    const now = new Date();
    const thisMonth = rows
      .filter((e) => {
        const d = new Date(e.expenseDate);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, e) => sum + e.amount, 0);
    const pending = rows.filter((e) => e.status === 'PENDING').length;

    // Range: explicit from/to, otherwise the span of the fetched rows.
    const times = rows.map((e) => new Date(e.expenseDate).getTime());
    const start = from ? new Date(from).getTime() : times.length ? Math.min(...times) : Date.now();
    const end = to ? new Date(to).getTime() : times.length ? Math.max(...times) : Date.now();
    const days = Math.max(1, Math.min(Math.round((end - start) / 86_400_000) + 1, 3_650));

    return { total, thisMonth, pending, days, avgPerDay: total / days };
  }, [rows, from, to]);

  const hasActiveFilters = category !== 'all' || !!from || !!to;

  const openCreate = () => {
    setEditing(null);
    setForm({ ...CREATE_FORM, expenseDate: isoToday() });
    setFormOpen(true);
  };

  const openEdit = (expense: ExpenseDTO) => {
    setEditing(expense);
    setForm({
      category: expense.category,
      description: expense.description,
      amount: String(expense.amount),
      expenseDate: expense.expenseDate.slice(0, 10),
      status: expense.status,
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  const handleError = (err: unknown) =>
    toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong');

  const submitForm = () => {
    const description = form.description.trim();
    if (description.length < 3) {
      toast.error('Description must be at least 3 characters');
      return;
    }
    const amount = parseMoney(form.amount);
    if (!Number.isFinite(amount) || amount < 0.01) {
      toast.error('Enter an amount of at least 0.01');
      return;
    }
    if (!EXPENSE_CATEGORIES.includes(form.category as (typeof EXPENSE_CATEGORIES)[number])) {
      toast.error('Pick an expense category');
      return;
    }

    const payload = {
      category: form.category,
      description,
      amount,
      status: form.status,
      expenseDate: form.expenseDate || isoToday(),
    };

    if (editing) {
      updateExpense.mutate(
        { id: editing.id, ...payload },
        {
          onSuccess: () => {
            toast.success('Expense updated');
            closeForm();
          },
          onError: handleError,
        },
      );
      return;
    }
    createExpense.mutate(payload, {
      onSuccess: () => {
        toast.success('Expense recorded');
        closeForm();
      },
      onError: handleError,
    });
  };

  const columns: DataTableColumn<ExpenseDTO>[] = [
    {
      key: 'date',
      header: 'Date',
      cell: (row) => (
        <span className="whitespace-nowrap">{formatDate(row.expenseDate)}</span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      cell: (row) => <CategoryBadge category={row.category} />,
    },
    {
      key: 'description',
      header: 'Description',
      cell: (row) => (
        <span className="block max-w-56 truncate" title={row.description}>
          {row.description}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      headerClassName: 'text-right',
      className: 'text-right',
      cell: (row) => (
        <span className="font-semibold tabular-nums">{formatCurrency(row.amount, currency)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'recordedBy',
      header: 'Recorded by',
      cell: (row) => (
        <span className="text-muted-foreground">{row.createdByName ?? '—'}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Track operating costs alongside your sales"
        icon={BadgeDollarSign}
        actions={
          can('expenses.manage') ? (
            <Button onClick={openCreate}>
              <Plus className="size-4" aria-hidden="true" />
              Record expense
            </Button>
          ) : undefined
        }
      />

      {/* Filters -------------------------------------------------------------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grid gap-2">
          <Label htmlFor="expense-category-filter" className="text-xs">
            Category
          </Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger id="expense-category-filter" className="w-full sm:w-44">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {EXPENSE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {humanizeConstant(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="expense-from" className="text-xs">
            From
          </Label>
          <Input
            id="expense-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full sm:w-40"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="expense-to" className="text-xs">
            To
          </Label>
          <Input
            id="expense-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full sm:w-40"
          />
        </div>
        {hasActiveFilters ? (
          <Button
            variant="ghost"
            size="sm"
            className="mb-0.5"
            onClick={() => {
              setCategory('all');
              setFrom('');
              setTo('');
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      {/* Stats ------------------------------------------------------------------ */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total in range"
          value={formatCurrency(stats.total, currency)}
          sub={`${formatNumber(rows.length)} ${rows.length === 1 ? 'entry' : 'entries'}`}
          icon={BadgeDollarSign}
        />
        <StatCard
          label="This month"
          value={formatCurrency(stats.thisMonth, currency)}
          icon={CalendarDays}
        />
        <StatCard
          label="Pending"
          value={formatNumber(stats.pending)}
          sub={stats.pending > 0 ? 'awaiting payment' : 'all settled'}
          icon={Hourglass}
        />
        <StatCard
          label="Avg per day"
          value={formatCurrency(stats.avgPerDay, currency)}
          sub={`over ${formatNumber(stats.days)} ${stats.days === 1 ? 'day' : 'days'}`}
          icon={Calculator}
        />
      </div>

      {/* Table ------------------------------------------------------------------ */}
      {expensesQuery.isError ? (
        <ErrorState
          title="Couldn't load expenses"
          description={
            expensesQuery.error instanceof ApiClientError ? expensesQuery.error.message : undefined
          }
          onRetry={() => expensesQuery.refetch()}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={expensesQuery.isLoading}
          emptyTitle="No expenses recorded"
          emptyDescription={
            hasActiveFilters
              ? 'Nothing matches these filters — try widening the date range.'
              : 'Record your first expense to see it here.'
          }
          onRowClick={can('expenses.manage') ? openEdit : undefined}
        />
      )}

      {/* Create / edit dialog ---------------------------------------------------- */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit expense' : 'Record expense'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Adjust the details — marking a pending expense paid stamps the payment date.'
                : 'Expenses feed straight into your net profit on reports and the dashboard.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="expense-category">
                Category <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.category}
                onValueChange={(value) => setForm((prev) => ({ ...prev, category: value }))}
              >
                <SelectTrigger id="expense-category" className="w-full">
                  <SelectValue placeholder="Pick a category" />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {humanizeConstant(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="expense-description">
                Description <span className="text-destructive">*</span>
              </Label>
              <Input
                id="expense-description"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="e.g. Electricity bill — March"
                maxLength={200}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="expense-amount">
                  Amount <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="expense-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="expense-date">Date</Label>
                <Input
                  id="expense-date"
                  type="date"
                  value={form.expenseDate}
                  onChange={(e) => setForm((prev) => ({ ...prev, expenseDate: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="expense-status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, status: value as ExpenseFormState['status'] }))
                }
              >
                <SelectTrigger id="expense-status" className="w-full">
                  <SelectValue placeholder="Pick a status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeForm} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {editing ? 'Save changes' : 'Record expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ExpensesView;
