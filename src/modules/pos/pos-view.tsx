'use client';

/**
 * OMNIRA — POS Terminal (the flagship register experience)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Two-pane keyboard-first register: product catalog on the left, cart on the
 * right (Sheet + sticky summary on mobile). Gated on an open cash session,
 * with split payments, an 80 mm thermal receipt preview and print support.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Banknote,
  CheckCircle2,
  CreditCard,
  HandCoins,
  Landmark,
  Loader2,
  Minus,
  Plus,
  Printer,
  ScanBarcode,
  Smartphone,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { PAYMENT_METHODS } from '@/lib/constants';
import { ApiClientError } from '@/lib/client/api';
import { formatCurrency, formatDateTime, formatTime, humanizeConstant, parseMoney } from '@/lib/client/format';
import { navigate } from '@/lib/client/router';
import {
  useAuthContext,
  useCheckout,
  useCreateCustomer,
  useOpenCashSession,
  usePosCatalog,
  usePosContext,
} from '@/lib/client/queries';
import { EmptyState, ErrorState, LoadingBlock } from '@/components/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type {
  CheckoutPaymentPayload,
  CheckoutResultDTO,
  PosCustomerDTO,
  PosProductDTO,
  ReceiptDTO,
} from '@/types/api';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Debounce a value for smoother querying; returns [debounced, flush]. */
function useDebouncedValue<T>(value: T, delay = 300): [T, () => void] {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, delay]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setDebounced(value);
  }, [value]);

  return [debounced, flush];
}

interface CartLine {
  product: PosProductDTO;
  /** Committed quantity (clamped, drives totals). */
  quantity: number;
  /** Raw input text so typing is never interrupted mid-edit. */
  qtyText: string;
}

interface PaymentDraft {
  method: string;
  amount: string;
  reference: string;
}

const PAYMENT_META: Record<string, { label: string; icon: LucideIcon; referenceLabel?: string }> = {
  CASH: { label: 'Cash', icon: Banknote },
  MOBILE_MONEY: { label: 'Mobile Money', icon: Smartphone, referenceLabel: 'Transaction ID / phone' },
  CARD: { label: 'Card', icon: CreditCard, referenceLabel: 'Auth code / last 4 digits' },
  BANK_TRANSFER: { label: 'Bank', icon: Landmark, referenceLabel: 'Transfer reference' },
  CREDIT: { label: 'Credit', icon: HandCoins },
};

const stockCap = (product: PosProductDTO) => (product.isService ? Number.MAX_SAFE_INTEGER : product.available);

const errorToast = (err: unknown) => toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong');

// ---------------------------------------------------------------------------
// Receipt — 80 mm thermal preview (print-ready via the .receipt-print class)
// ---------------------------------------------------------------------------

function ReceiptRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between', strong && 'font-bold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function ReceiptCard({ receipt }: { receipt: ReceiptDTO }) {
  const currency = receipt.currency;
  return (
    <div className="receipt-print w-80 shrink-0 rounded-lg border border-dashed border-foreground/25 bg-white p-4 font-mono text-xs text-zinc-900 shadow-sm">
      <div className="text-center">
        {receipt.receiptHeader ? (
          <p className="whitespace-pre-line text-[11px] font-semibold leading-snug">{receipt.receiptHeader}</p>
        ) : null}
        <p className="mt-1 text-sm font-bold uppercase tracking-widest">{receipt.organizationName}</p>
        <p className="mt-0.5 text-[10px] text-zinc-500">{formatDateTime(receipt.createdAt)}</p>
        <p className="text-[10px] text-zinc-500">Receipt {receipt.saleNumber}</p>
        {receipt.cashierName ? <p className="text-[10px] text-zinc-500">Served by {receipt.cashierName}</p> : null}
        {receipt.customerName ? <p className="text-[10px] text-zinc-500">Customer: {receipt.customerName}</p> : null}
      </div>

      <div className="my-2 border-t border-dashed border-zinc-400" aria-hidden="true" />

      <table className="w-full">
        <thead>
          <tr className="text-[10px] uppercase text-zinc-500">
            <th className="text-left font-medium">Item</th>
            <th className="w-8 text-center font-medium">Qty</th>
            <th className="w-16 text-right font-medium">Price</th>
            <th className="w-16 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {receipt.lines.map((line, i) => (
            <tr key={`${line.sku}-${i}`} className="align-top">
              <td className="py-0.5 pr-1">
                {line.name}
                <br />
                <span className="text-[9px] text-zinc-500">{line.sku}</span>
              </td>
              <td className="text-center tabular-nums">{line.quantity}</td>
              <td className="text-right tabular-nums">{formatCurrency(line.unitPrice, currency)}</td>
              <td className="text-right tabular-nums">{formatCurrency(line.lineTotal, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="my-2 border-t border-dashed border-zinc-400" aria-hidden="true" />

      <div className="space-y-0.5">
        <ReceiptRow label="Subtotal" value={formatCurrency(receipt.subtotal, currency)} />
        {receipt.discountTotal > 0 ? (
          <ReceiptRow label="Discount" value={`-${formatCurrency(receipt.discountTotal, currency)}`} />
        ) : null}
        {receipt.taxTotal > 0 ? <ReceiptRow label="Tax" value={formatCurrency(receipt.taxTotal, currency)} /> : null}
        <div className="mt-1 border-t border-dashed border-zinc-400 pt-1">
          <ReceiptRow label="TOTAL" value={formatCurrency(receipt.grandTotal, currency)} strong />
        </div>
      </div>

      <div className="my-2 border-t border-dashed border-zinc-400" aria-hidden="true" />

      <div className="space-y-0.5">
        {receipt.payments.map((p, i) => (
          <div key={i} className="flex justify-between">
            <span>
              {humanizeConstant(p.method)}
              {p.reference ? <span className="text-[9px] text-zinc-500"> · {p.reference}</span> : null}
            </span>
            <span className="tabular-nums">{formatCurrency(p.amount, currency)}</span>
          </div>
        ))}
        {receipt.changeDue > 0 ? (
          <ReceiptRow label="Change due" value={formatCurrency(receipt.changeDue, currency)} />
        ) : null}
        {receipt.loyaltyPointsEarned > 0 ? (
          <ReceiptRow label="Points earned" value={String(receipt.loyaltyPointsEarned)} />
        ) : null}
      </div>

      <div className="my-2 border-t border-dashed border-zinc-400" aria-hidden="true" />

      <p className="whitespace-pre-line text-center text-[10px] leading-snug text-zinc-600">
        {receipt.receiptFooter ?? 'Thank you for your patronage!'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cash session gate
// ---------------------------------------------------------------------------

function OpenSessionGate({ pending, onOpen }: { pending: boolean; onOpen: (openingFloat: number) => void }) {
  const [float, setFloat] = useState('0');
  const submit = () => onOpen(parseMoney(float));
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-1 items-center justify-center py-10"
    >
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-5 p-6 text-center sm:p-8">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Wallet className="size-7" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Open your cash drawer to start selling</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A cash session tracks everything rung on this register — cash taken, sales made and the closing count.
            </p>
          </div>
          <div className="w-full space-y-2 text-left">
            <Label htmlFor="opening-float">Opening float</Label>
            <Input
              id="opening-float"
              type="number"
              step="0.01"
              min="0"
              className="money-input h-10 text-base"
              value={float}
              onChange={(e) => setFloat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
            <p className="text-xs text-muted-foreground">
              Count the cash already in the drawer and enter the total. Leave 0 if it is empty.
            </p>
          </div>
          <Button size="lg" className="w-full" disabled={pending || parseMoney(float) < 0} onClick={submit}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Open session
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function StockChip({ product }: { product: PosProductDTO }) {
  if (product.isService) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-primary/25 bg-primary/10 px-1.5 py-0 text-[10px] font-medium text-primary"
      >
        Service
      </Badge>
    );
  }
  if (product.available <= 0) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-rose-500/25 bg-rose-500/10 px-1.5 py-0 text-[10px] font-medium text-rose-600 dark:text-rose-400"
      >
        Out of stock
      </Badge>
    );
  }
  if (product.available <= 5) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-amber-500/25 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium text-amber-600 dark:text-amber-400"
      >
        {product.available} left
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
    >
      {product.available} in stock
    </Badge>
  );
}

function ProductCard({
  product,
  currency,
  onAdd,
}: {
  product: PosProductDTO;
  currency: string;
  onAdd: () => void;
}) {
  const out = !product.isService && product.available <= 0;
  return (
    <motion.button
      type="button"
      whileTap={out ? undefined : { scale: 0.97 }}
      disabled={out}
      onClick={onAdd}
      aria-label={`Add ${product.name} to cart`}
      className={cn(
        'group flex h-full flex-col justify-between gap-2.5 rounded-xl border bg-card p-3 text-left shadow-xs transition-all',
        'hover:border-primary/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        out && 'pointer-events-none opacity-50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{product.name}</p>
        <StockChip product={product} />
      </div>
      <div>
        <p className="truncate text-xs text-muted-foreground">
          {[product.brand, product.unit].filter(Boolean).join(' · ') || product.sku}
        </p>
        <p className="mt-1 text-sm font-bold tabular-nums">
          {formatCurrency(product.retailPrice, currency)}
          <span className="sr-only"> per {product.unit}</span>
        </p>
      </div>
    </motion.button>
  );
}

function CatalogGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 pb-1 sm:grid-cols-3 xl:grid-cols-4">{children}</div>;
}

// ---------------------------------------------------------------------------
// Cart
// ---------------------------------------------------------------------------

function QuantityInput({
  text,
  name,
  onTextChange,
  onCommit,
}: {
  text: string;
  name: string;
  onTextChange: (text: string) => void;
  onCommit: () => void;
}) {
  return (
    <Input
      inputMode="numeric"
      className="h-8 w-14 px-1 text-center text-sm tabular-nums"
      value={text}
      aria-label={`Quantity of ${name}`}
      onChange={(e) => onTextChange(e.target.value.replace(/[^0-9]/g, ''))}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function CustomerPicker({
  customers,
  loyaltyEnabled,
  value,
  onChange,
  onNewCustomer,
}: {
  customers: PosCustomerDTO[];
  loyaltyEnabled: boolean;
  value: string;
  onChange: (customerId: string) => void;
  onNewCustomer: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = customers.find((c) => c.id === value) ?? null;

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9 w-full justify-start gap-2 font-normal" aria-label="Attach customer">
            <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {selected ? (
              <span className="truncate">{selected.name}</span>
            ) : (
              <span className="text-muted-foreground">Walk-in customer</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <Command>
            <CommandInput placeholder="Search customers…" />
            <CommandList>
              <CommandEmpty>No customers found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="walk-in customer"
                  onSelect={() => {
                    onChange('');
                    setOpen(false);
                  }}
                >
                  <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span>Walk-in customer</span>
                  {!selected ? <CheckCircle2 className="ml-auto size-4 text-primary" aria-hidden="true" /> : null}
                </CommandItem>
                {customers.map((customer) => (
                  <CommandItem
                    key={customer.id}
                    value={`${customer.name} ${customer.phone ?? ''}`}
                    onSelect={() => {
                      onChange(customer.id);
                      setOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{customer.name}</p>
                      {customer.phone ? <p className="text-xs text-muted-foreground">{customer.phone}</p> : null}
                    </div>
                    {loyaltyEnabled && customer.loyaltyPoints > 0 ? (
                      <Badge
                        variant="outline"
                        className="ml-2 shrink-0 gap-0.5 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400"
                      >
                        <Sparkles className="size-2.5" aria-hidden="true" />
                        {customer.loyaltyPoints}
                      </Badge>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <Button
        variant="outline"
        size="icon"
        className="size-9 shrink-0"
        onClick={onNewCustomer}
        aria-label="Create new customer"
      >
        <UserPlus className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

interface CartPanelProps {
  currency: string;
  lines: CartLine[];
  itemCount: number;
  subtotal: number;
  discount: number;
  taxTotal: number;
  taxEnabled: boolean;
  grandTotal: number;
  orderDiscount: string;
  customers: PosCustomerDTO[];
  loyaltyEnabled: boolean;
  customerId: string;
  onCustomerChange: (customerId: string) => void;
  onNewCustomer: () => void;
  onOrderDiscountChange: (value: string) => void;
  onOrderDiscountBlur: () => void;
  onQuantity: (productId: string, quantity: number) => void;
  onQtyText: (productId: string, text: string) => void;
  onCommitQty: (productId: string) => void;
  onRemove: (productId: string) => void;
  onClear: () => void;
  onCharge: () => void;
}

function CartPanel(props: CartPanelProps) {
  const {
    currency,
    lines,
    itemCount,
    subtotal,
    discount,
    taxTotal,
    taxEnabled,
    grandTotal,
    orderDiscount,
    customers,
    loyaltyEnabled,
    customerId,
    onCustomerChange,
    onNewCustomer,
    onOrderDiscountChange,
    onOrderDiscountBlur,
    onQuantity,
    onQtyText,
    onCommitQty,
    onRemove,
    onClear,
    onCharge,
  } = props;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          Cart
          <span className="ml-1.5 font-normal text-muted-foreground">
            {itemCount} item{itemCount === 1 ? '' : 's'}
          </span>
        </h2>
        {lines.length > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={onClear}
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            Clear
          </Button>
        ) : null}
      </div>

      {lines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <ScanBarcode className="size-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium">Cart is empty</p>
          <p className="max-w-52 text-xs text-muted-foreground">
            Tap a product or scan a barcode and press Enter to start a sale
          </p>
        </div>
      ) : (
        <>
          <ul className="custom-scrollbar -mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto px-1 py-0.5">
            {lines.map((line) => {
              const cap = stockCap(line.product);
              const atCap = line.quantity >= cap;
              return (
                <li key={line.product.id} className="rounded-lg border bg-card p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{line.product.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(line.product.retailPrice, currency)} / {line.product.unit}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-start gap-1.5">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatCurrency(line.product.retailPrice * line.quantity, currency)}
                      </p>
                      <button
                        type="button"
                        onClick={() => onRemove(line.product.id)}
                        aria-label={`Remove ${line.product.name} from cart`}
                        className="mt-0.5 rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                      >
                        <X className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() => onQuantity(line.product.id, line.quantity - 1)}
                        disabled={line.quantity <= 1}
                        aria-label={`Decrease quantity of ${line.product.name}`}
                      >
                        <Minus className="size-3.5" aria-hidden="true" />
                      </Button>
                      <QuantityInput
                        text={line.qtyText}
                        name={line.product.name}
                        onTextChange={(text) => onQtyText(line.product.id, text)}
                        onCommit={() => onCommitQty(line.product.id)}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className="size-7"
                        onClick={() => onQuantity(line.product.id, line.quantity + 1)}
                        disabled={atCap}
                        aria-label={`Increase quantity of ${line.product.name}`}
                      >
                        <Plus className="size-3.5" aria-hidden="true" />
                      </Button>
                    </div>
                    {atCap && !line.product.isService ? (
                      <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">Max stock</span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
            <CustomerPicker
              customers={customers}
              loyaltyEnabled={loyaltyEnabled}
              value={customerId}
              onChange={onCustomerChange}
              onNewCustomer={onNewCustomer}
            />
            <div className="space-y-1.5">
              <Label htmlFor="order-discount" className="text-xs">
                Order discount
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  −
                </span>
                <Input
                  id="order-discount"
                  type="number"
                  step="0.01"
                  min="0"
                  className="money-input h-8 pl-7"
                  value={orderDiscount}
                  onChange={(e) => onOrderDiscountChange(e.target.value)}
                  onBlur={onOrderDiscountBlur}
                  placeholder="0.00"
                />
              </div>
            </div>
            <Separator />
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="tabular-nums">{formatCurrency(subtotal, currency)}</span>
              </div>
              {discount > 0 ? (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Discount</span>
                  <span className="tabular-nums">−{formatCurrency(discount, currency)}</span>
                </div>
              ) : null}
              {taxEnabled ? (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tax</span>
                  <span className="tabular-nums">{formatCurrency(taxTotal, currency)}</span>
                </div>
              ) : null}
              <div className="flex justify-between pt-0.5 text-base font-bold">
                <span>Total</span>
                <span className="tabular-nums">{formatCurrency(grandTotal, currency)}</span>
              </div>
            </div>
            <Button size="lg" className="w-full" onClick={onCharge}>
              Charge {formatCurrency(grandTotal, currency)}
              <kbd className="pointer-events-none ml-1 hidden rounded border bg-background/60 px-1.5 py-0.5 text-[10px] font-medium lg:inline-block">
                F2
              </kbd>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment dialog — split payments, change due, idempotent checkout
// ---------------------------------------------------------------------------

function PaymentDialog({
  open,
  onOpenChange,
  currency,
  grandTotal,
  checkoutPending,
  onCharge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  grandTotal: number;
  checkoutPending: boolean;
  onCharge: (payments: CheckoutPaymentPayload[], clientRequestId: string) => void;
}) {
  // Radix unmounts closed dialogs, so the draft below mounts fresh each time
  // the dialog opens — every cart gets its payment rows reset and a new
  // idempotency key exactly once.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <PaymentForm
          currency={currency}
          grandTotal={grandTotal}
          checkoutPending={checkoutPending}
          onCharge={onCharge}
        />
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({
  currency,
  grandTotal,
  checkoutPending,
  onCharge,
}: {
  currency: string;
  grandTotal: number;
  checkoutPending: boolean;
  onCharge: (payments: CheckoutPaymentPayload[], clientRequestId: string) => void;
}) {
  const [payments, setPayments] = useState<PaymentDraft[]>(() => [
    { method: 'CASH', amount: grandTotal.toFixed(2), reference: '' },
  ]);
  // Generated once per cart, when the payment dialog opens.
  const [clientRequestId] = useState(() => crypto.randomUUID());

  const paid = round2(payments.reduce((sum, p) => sum + parseMoney(p.amount), 0));
  const remaining = round2(Math.max(0, grandTotal - paid));
  const change = round2(paid - grandTotal);
  const covered = paid >= grandTotal - 0.01;

  const updatePayment = (index: number, patch: Partial<PaymentDraft>) =>
    setPayments((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  const addSplit = () => {
    if (remaining <= 0.009) return;
    setPayments((prev) => [...prev, { method: 'CASH', amount: remaining.toFixed(2), reference: '' }]);
  };

  const charge = () => {
    if (!covered || checkoutPending) return;
    onCharge(
      payments.map((p) => ({
        method: p.method,
        amount: round2(parseMoney(p.amount)),
        ...(p.reference.trim() ? { reference: p.reference.trim() } : {}),
      })),
      clientRequestId,
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Take payment</DialogTitle>
        <DialogDescription>
          Amount due{' '}
          <span className="font-bold tabular-nums text-foreground">{formatCurrency(grandTotal, currency)}</span>
        </DialogDescription>
      </DialogHeader>

        <div className="space-y-3">
          {payments.map((payment, index) => {
            const meta = PAYMENT_META[payment.method] ?? PAYMENT_META.CASH;
            const needsReference = !!meta.referenceLabel;
            return (
              <div key={index} className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {payments.length > 1 ? `Payment ${index + 1}` : 'Payment method'}
                  </p>
                  {payments.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setPayments((prev) => prev.filter((_, i) => i !== index))}
                      aria-label={`Remove payment ${index + 1}`}
                      className="rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Payment method">
                  {PAYMENT_METHODS.map((method) => {
                    const m = PAYMENT_META[method];
                    const selected = payment.method === method;
                    return (
                      <button
                        key={method}
                        type="button"
                        onClick={() => updatePayment(index, { method })}
                        aria-pressed={selected}
                        className={cn(
                          'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                          selected
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground',
                        )}
                      >
                        <m.icon className="size-3.5" aria-hidden="true" />
                        {m.label}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`payment-amount-${index}`} className="text-xs">
                      Amount
                    </Label>
                    <Input
                      id={`payment-amount-${index}`}
                      type="number"
                      step="0.01"
                      min="0"
                      className="money-input h-9"
                      value={payment.amount}
                      onChange={(e) => updatePayment(index, { amount: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') charge();
                      }}
                    />
                  </div>
                  {needsReference ? (
                    <div className="space-y-1">
                      <Label htmlFor={`payment-reference-${index}`} className="text-xs">
                        {meta.referenceLabel}
                      </Label>
                      <Input
                        id={`payment-reference-${index}`}
                        className="h-9"
                        value={payment.reference}
                        onChange={(e) => updatePayment(index, { reference: e.target.value })}
                        placeholder="Optional"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2 rounded-xl border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Paid</span>
            <span className="font-semibold tabular-nums">{formatCurrency(paid, currency)}</span>
          </div>
          {!covered ? (
            <div className="flex justify-between text-amber-600 dark:text-amber-400">
              <span>Remaining</span>
              <span className="font-semibold tabular-nums">{formatCurrency(remaining, currency)}</span>
            </div>
          ) : null}
          {change > 0 ? (
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
              <span className="font-medium">Change</span>
              <span className="font-bold tabular-nums">{formatCurrency(change, currency)}</span>
            </div>
          ) : null}
          {remaining > 0.009 ? (
            <Button variant="outline" size="sm" className="w-full" onClick={addSplit}>
              <Plus className="size-3.5" aria-hidden="true" />
              Add split payment
            </Button>
          ) : null}
        </div>

        <DialogFooter>
          <Button size="lg" className="w-full" disabled={!covered || checkoutPending} onClick={charge}>
            {checkoutPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Charge {formatCurrency(grandTotal, currency)}
          </Button>
        </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// New customer dialog
// ---------------------------------------------------------------------------

function NewCustomerDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: PosCustomerDTO) => void;
}) {
  const createCustomer = useCreateCustomer();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const submit = () => {
    if (name.trim().length < 2 || createCustomer.isPending) return;
    createCustomer.mutate(
      { name: name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}) },
      {
        onSuccess: (customer) => {
          toast.success(`${customer.name} added`);
          onCreated({
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            loyaltyPoints: customer.loyaltyPoints,
          });
          onOpenChange(false);
        },
        onError: errorToast,
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName('');
          setPhone('');
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>Attach them to this sale to track their spend and loyalty points.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-customer-name">Name</Label>
            <Input
              id="new-customer-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="e.g. Ama Mensah"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-customer-phone">Phone (optional)</Label>
            <Input
              id="new-customer-phone"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder="e.g. 024 123 4567"
            />
          </div>
        </div>
        <DialogFooter>
          <Button className="w-full" disabled={name.trim().length < 2 || createCustomer.isPending} onClick={submit}>
            {createCustomer.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            Save customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// POS view
// ---------------------------------------------------------------------------

export default function PosView() {
  const { data: auth } = useAuthContext();
  const currency = auth?.organization?.currency ?? 'GHS';

  const posContext = usePosContext();
  const openCashSession = useOpenCashSession();
  const checkout = useCheckout();

  const ctx = posContext.data;
  const sessionOpen = !!ctx?.cashSession;

  const [warehouseChoice, setWarehouseChoice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, flushSearch] = useDebouncedValue(search, 300);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderDiscount, setOrderDiscount] = useState('0');
  const [customerId, setCustomerId] = useState('');
  const [extraCustomer, setExtraCustomer] = useState<PosCustomerDTO | null>(null);
  const [cartSheetOpen, setCartSheetOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [success, setSuccess] = useState<CheckoutResultDTO | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const pendingEnterRef = useRef(false);

  // The org's default warehouse until the cashier picks another one.
  const effectiveWarehouseId = warehouseChoice ?? ctx?.defaultWarehouseId ?? null;

  const catalog = usePosCatalog(effectiveWarehouseId ?? undefined, debouncedSearch.trim() || undefined);

  // ---- Cart helpers -------------------------------------------------------

  const addToCart = useCallback((product: PosProductDTO) => {
    if (!product.isService && product.available <= 0) return;
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        if (existing.quantity >= stockCap(product)) return prev;
        return prev.map((l) =>
          l.product.id === product.id
            ? { ...l, quantity: l.quantity + 1, qtyText: String(l.quantity + 1) }
            : l,
        );
      }
      return [...prev, { product, quantity: 1, qtyText: '1' }];
    });
  }, []);

  const setQuantity = (productId: string, quantity: number) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.product.id !== productId) return l;
        const next = Math.min(Math.max(1, Math.floor(quantity) || 1), stockCap(l.product));
        return { ...l, quantity: next, qtyText: String(next) };
      }),
    );
  };

  const setQtyText = (productId: string, text: string) => {
    setLines((prev) => prev.map((l) => (l.product.id === productId ? { ...l, qtyText: text } : l)));
  };

  const commitQtyText = (productId: string) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.product.id !== productId) return l;
        const parsed = Number.parseInt(l.qtyText, 10);
        const next = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 1, 1), stockCap(l.product));
        return { ...l, quantity: next, qtyText: String(next) };
      }),
    );
  };

  const removeLine = (productId: string) => setLines((prev) => prev.filter((l) => l.product.id !== productId));

  const clearCart = useCallback(() => {
    setLines([]);
    setOrderDiscount('0');
    setCustomerId('');
    setCartSheetOpen(false);
  }, []);

  // ---- Totals -------------------------------------------------------------

  const taxEnabled = ctx?.taxEnabled ?? false;
  const subtotal = round2(lines.reduce((sum, l) => sum + l.product.retailPrice * l.quantity, 0));
  const discount = Math.min(Math.max(0, parseMoney(orderDiscount)), subtotal);
  const taxTotal = taxEnabled
    ? round2(lines.reduce((sum, l) => sum + l.product.retailPrice * l.quantity * (l.product.taxRate / 100), 0))
    : 0;
  const grandTotal = round2(Math.max(0, subtotal - discount + taxTotal));
  const itemCount = lines.reduce((sum, l) => sum + l.quantity, 0);

  // ---- Keyboard: Enter adds the first match, F2 opens payment -------------

  const handleSearchEnter = () => {
    const query = search.trim();
    if (!query) return;
    if (debouncedSearch.trim() === query && catalog.data) {
      const first = catalog.data[0];
      if (first) {
        addToCart(first);
        setSearch('');
      } else {
        toast('No products match your search');
      }
      return;
    }
    // Search changed faster than the debounce (e.g. a barcode scan burst) —
    // flush and add the first result once it lands.
    pendingEnterRef.current = true;
    flushSearch();
  };

  useEffect(() => {
    if (!pendingEnterRef.current) return;
    if (catalog.isFetching || catalog.data === undefined) return;
    pendingEnterRef.current = false;
    const first = catalog.data[0];
    // Apply the deferred add in a task (not synchronously in the effect) so
    // the update lands with the fetched data without cascading renders.
    const timer = setTimeout(() => {
      if (first) {
        addToCart(first);
        setSearch('');
      } else {
        toast('No products match your search');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [catalog.data, catalog.isFetching, addToCart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        if (sessionOpen && lines.length > 0 && !paymentOpen) setPaymentOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionOpen, lines.length, paymentOpen]);

  // ---- Mutations ----------------------------------------------------------

  const openSession = (openingFloat: number) => {
    openCashSession.mutate(
      { openingFloat },
      {
        onSuccess: () => toast.success('Cash session opened — happy selling!'),
        onError: errorToast,
      },
    );
  };

  const handleCheckout = (payments: CheckoutPaymentPayload[], clientRequestId: string) => {
    if (!ctx || !effectiveWarehouseId || lines.length === 0) return;
    checkout.mutate(
      {
        warehouseId: effectiveWarehouseId,
        customerId: customerId || null,
        orderDiscount: round2(discount),
        clientRequestId,
        items: lines.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
        payments,
      },
      {
        onSuccess: (result) => {
          setPaymentOpen(false);
          setSuccess(result);
          clearCart();
          toast.success(`Sale ${result.saleNumber} completed`);
        },
        onError: errorToast,
      },
    );
  };

  // ---- Customers (POS context list + a just-created one for instant select)

  const customers = useMemo(() => {
    if (extraCustomer && !ctx?.customers.some((c) => c.id === extraCustomer.id)) {
      return [extraCustomer, ...(ctx?.customers ?? [])];
    }
    return ctx?.customers ?? [];
  }, [ctx?.customers, extraCustomer]);

  // ---- Render -------------------------------------------------------------

  if (posContext.isLoading) {
    return <LoadingBlock lines={6} className="py-10" />;
  }
  if (posContext.isError || !ctx) {
    return <ErrorState description="Could not load the register." onRetry={() => posContext.refetch()} />;
  }

  if (success) {
    return (
      <div className="flex flex-col items-center gap-6 py-4">
        <AnimatePresence>
          <motion.div
            key="sale-success"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex w-full flex-col items-center gap-5"
          >
            <div className="flex flex-col items-center gap-2 text-center">
              <motion.div
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', damping: 14, stiffness: 220 }}
                className="flex size-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                <CheckCircle2 className="size-9" aria-hidden="true" />
              </motion.div>
              <h2 className="text-xl font-bold">Sale {success.saleNumber} completed</h2>
              {success.changeDue > 0 ? (
                <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  Change due {formatCurrency(success.changeDue, currency)}
                </p>
              ) : null}
              {success.loyaltyPointsEarned > 0 ? (
                <Badge
                  variant="outline"
                  className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                >
                  <Sparkles className="size-3" aria-hidden="true" />
                  {success.loyaltyPointsEarned} loyalty points earned
                </Badge>
              ) : null}
            </div>
            <ReceiptCard receipt={success.receipt} />
            <div className="no-print flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="size-4" aria-hidden="true" />
                Print receipt
              </Button>
              <Button
                onClick={() => {
                  setSuccess(null);
                  searchRef.current?.focus();
                }}
              >
                <Plus className="size-4" aria-hidden="true" />
                New sale
              </Button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  if (!ctx.cashSession) {
    return <OpenSessionGate pending={openCashSession.isPending} onOpen={openSession} />;
  }

  const cartPanel = (
    <CartPanel
      currency={currency}
      lines={lines}
      itemCount={itemCount}
      subtotal={subtotal}
      discount={discount}
      taxTotal={taxTotal}
      taxEnabled={taxEnabled}
      grandTotal={grandTotal}
      orderDiscount={orderDiscount}
      customers={customers}
      loyaltyEnabled={ctx.loyaltyEnabled}
      customerId={customerId}
      onCustomerChange={setCustomerId}
      onNewCustomer={() => setNewCustomerOpen(true)}
      onOrderDiscountChange={setOrderDiscount}
      onOrderDiscountBlur={() => setOrderDiscount(Math.min(parseMoney(orderDiscount), subtotal).toFixed(2))}
      onQuantity={setQuantity}
      onQtyText={setQtyText}
      onCommitQty={commitQtyText}
      onRemove={removeLine}
      onClear={clearCart}
      onCharge={() => setPaymentOpen(true)}
    />
  );

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-8.5rem)]">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={effectiveWarehouseId ?? undefined} onValueChange={setWarehouseChoice}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Selling from warehouse">
            <SelectValue placeholder="Select warehouse" />
          </SelectTrigger>
          <SelectContent>
            {ctx.warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative min-w-0 flex-1">
          <ScanBarcode
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            ref={searchRef}
            autoFocus
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearchEnter();
            }}
            placeholder="Search products or scan barcode… (Enter to add first match)"
            aria-label="Search products or scan barcode"
          />
        </div>
        <Badge
          variant="outline"
          className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 font-normal text-emerald-600 dark:text-emerald-400"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
          {ctx.cashSession.sessionNumber} · since {formatTime(ctx.cashSession.openedAt)}
        </Badge>
      </div>

      {/* Two panes on lg, stacked on mobile */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <section aria-label="Product catalog" className="min-h-0 flex-1">
          <div className="custom-scrollbar h-full overflow-y-auto pr-1 lg:pr-2">
            {catalog.isLoading ? (
              <CatalogGrid>
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
              </CatalogGrid>
            ) : catalog.isError ? (
              <ErrorState description="Could not load the product catalog." onRetry={() => catalog.refetch()} />
            ) : catalog.data && catalog.data.length > 0 ? (
              <CatalogGrid>
                {catalog.data.map((product) => (
                  <ProductCard key={product.id} product={product} currency={currency} onAdd={() => addToCart(product)} />
                ))}
              </CatalogGrid>
            ) : (
              <EmptyState
                icon={ScanBarcode}
                title={debouncedSearch.trim() ? 'No products match your search' : 'No products yet'}
                description={
                  debouncedSearch.trim()
                    ? 'Try a different name, SKU or barcode — or check the warehouse you are selling from.'
                    : 'Add products to your catalog first, then come back to start selling.'
                }
                action={
                  debouncedSearch.trim() ? undefined : (
                    <Button variant="outline" onClick={() => navigate('/products')}>
                      <Plus className="size-4" aria-hidden="true" />
                      Go to products
                    </Button>
                  )
                }
              />
            )}
          </div>
        </section>

        <aside aria-label="Cart" className="hidden w-96 shrink-0 flex-col border-l pl-4 lg:flex dark:border-border/60">
          {cartPanel}
        </aside>
      </div>

      {/* Mobile sticky summary + cart sheet */}
      <div className="sticky bottom-3 z-30 lg:hidden">
        <Card className="rounded-xl border shadow-lg">
          <CardContent className="flex items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                {itemCount} item{itemCount === 1 ? '' : 's'}
              </p>
              <p className="truncate text-lg font-bold tabular-nums">{formatCurrency(grandTotal, currency)}</p>
            </div>
            <Button variant="outline" onClick={() => setCartSheetOpen(true)} disabled={lines.length === 0}>
              Cart
            </Button>
            <Button onClick={() => setPaymentOpen(true)} disabled={lines.length === 0}>
              Charge
            </Button>
          </CardContent>
        </Card>
      </div>

      <Sheet open={cartSheetOpen} onOpenChange={setCartSheetOpen}>
        <SheetContent side="bottom" className="flex max-h-[88vh] flex-col p-0">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-left text-base">Cart</SheetTitle>
            <SheetDescription className="text-left">
              {itemCount} item{itemCount === 1 ? '' : 's'} · {formatCurrency(grandTotal, currency)}
            </SheetDescription>
          </SheetHeader>
          <div className="custom-scrollbar flex-1 overflow-y-auto p-4">{cartPanel}</div>
        </SheetContent>
      </Sheet>

      <PaymentDialog
        open={paymentOpen}
        onOpenChange={setPaymentOpen}
        currency={currency}
        grandTotal={grandTotal}
        checkoutPending={checkout.isPending}
        onCharge={handleCheckout}
      />

      <NewCustomerDialog
        open={newCustomerOpen}
        onOpenChange={setNewCustomerOpen}
        onCreated={(customer) => {
          setExtraCustomer(customer);
          setCustomerId(customer.id);
        }}
      />
    </div>
  );
}
