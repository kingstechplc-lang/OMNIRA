'use client';

/**
 * OMNIRA — Organization self-signup screen
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Public multi-tenant onboarding: pick a business type, name your store,
 * create the owner account. POST /api/auth/register provisions the tenant
 * (roles, branch, warehouses, starter categories, trial subscription).
 */

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, PartyPopper, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { BrandMark, BrandWordmark } from '@/components/shared/brand';
import { BUSINESS_TYPES } from '@/lib/constants';
import { post, ApiClientError } from '@/lib/client/api';
import { cn } from '@/lib/utils';

interface SignupState {
  step: 1 | 2;
  organizationName: string;
  businessType: string;
  fullName: string;
  email: string;
  password: string;
  country: string;
  currency: string;
}

export function SignupScreen(): React.JSX.Element {
  const [state, setState] = useState<SignupState>({
    step: 1,
    organizationName: '',
    businessType: 'SUPERMARKET',
    fullName: '',
    email: '',
    password: '',
    country: 'GH',
    currency: 'GHS',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const set = <K extends keyof SignupState>(key: K, value: SignupState[K]) =>
    setState((s) => ({ ...s, [key]: value }));

  const selectedPack = BUSINESS_TYPES.find((t) => t.value === state.businessType) ?? BUSINESS_TYPES[0]!;

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await post<{ organizationId: string }>('/api/auth/register', {
        fullName: state.fullName,
        email: state.email,
        password: state.password,
        organizationName: state.organizationName,
        businessType: state.businessType,
        country: state.country,
        currency: state.currency,
      });
      // Sign straight in
      const result = await signIn('credentials', {
        email: state.email,
        password: state.password,
        redirect: false,
      });
      if (result?.error) {
        setDone(true); // org created; ask them to sign in manually
        return;
      }
      window.location.hash = '#/dashboard';
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof ApiClientError ? err.message : 'Signup failed. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
              <PartyPopper className="size-7" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold">Your workspace is ready!</h1>
            <p className="text-sm text-muted-foreground">
              We created <strong>{state.organizationName}</strong> with starter categories, a main
              branch and stock locations. Sign in with your new account to start selling.
            </p>
            <Button asChild className="w-full">
              <a href="#/">Go to sign in <ArrowRight className="size-4" /></a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <BrandMark size={32} />
          <BrandWordmark className="text-lg" />
        </div>
        <Button asChild variant="ghost" size="sm">
          <a href="#/">
            <ArrowLeft className="size-4" aria-hidden="true" /> Back to sign in
          </a>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-6 py-10">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div className="mb-8 text-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Rocket className="size-6" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Create your business workspace</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Free 14-day Starter trial · no card required · your data stays isolated
            </p>
          </div>

          {/* Step indicator */}
          <div className="mb-8 flex items-center justify-center gap-2 text-xs font-medium">
            {['Business type', 'Owner account'].map((label, i) => {
              const step = i + 1;
              const active = state.step === step;
              const complete = state.step > step;
              return (
                <div key={label} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full border text-[11px]',
                      active && 'border-primary bg-primary text-primary-foreground',
                      complete && 'border-emerald-500 bg-emerald-500 text-white',
                      !active && !complete && 'border-border text-muted-foreground',
                    )}
                  >
                    {complete ? <CheckCircle2 className="size-3.5" /> : step}
                  </span>
                  <span className={cn(active ? 'text-foreground' : 'text-muted-foreground')}>{label}</span>
                  {i === 0 ? <span className="mx-2 h-px w-8 bg-border" /> : null}
                </div>
              );
            })}
          </div>

          <Card>
            <CardContent className="p-6 sm:p-8">
              {state.step === 1 ? (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <Label htmlFor="orgName">Business name</Label>
                    <Input
                      id="orgName"
                      placeholder="e.g. Kings Mart Supermarket"
                      value={state.organizationName}
                      onChange={(e) => set('organizationName', e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>What kind of business is this?</Label>
                    <div
                      className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto custom-scrollbar pr-1 sm:grid-cols-3"
                      role="radiogroup"
                      aria-label="Business type"
                    >
                      {BUSINESS_TYPES.map((type) => (
                        <button
                          key={type.value}
                          type="button"
                          role="radio"
                          aria-checked={state.businessType === type.value}
                          onClick={() => set('businessType', type.value)}
                          className={cn(
                            'rounded-xl border p-3 text-left transition-all hover:border-primary/50 hover:bg-accent',
                            state.businessType === type.value &&
                              'border-primary bg-primary/5 ring-1 ring-primary/40',
                          )}
                        >
                          <p className="text-sm font-semibold leading-tight">{type.label}</p>
                          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                            {type.tagline}
                          </p>
                        </button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Badge variant="secondary" className="text-[11px]">
                        Starter categories: {selectedPack.defaultCategories.slice(0, 3).join(', ')}
                        {selectedPack.defaultCategories.length > 3 ? '…' : ''}
                      </Badge>
                      {selectedPack.defaultTrackBatches ? (
                        <Badge variant="secondary" className="text-[11px]">Batch & expiry tracking on</Badge>
                      ) : null}
                      <Badge variant="secondary" className="text-[11px]">
                        Default tax {selectedPack.defaultTaxRate}%
                      </Badge>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="country">Country</Label>
                      <Input
                        id="country"
                        maxLength={2}
                        placeholder="GH"
                        value={state.country}
                        onChange={(e) => set('country', e.target.value.toUpperCase())}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="currency">Currency</Label>
                      <Input
                        id="currency"
                        maxLength={3}
                        placeholder="GHS"
                        value={state.currency}
                        onChange={(e) => set('currency', e.target.value.toUpperCase())}
                      />
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    disabled={state.organizationName.trim().length < 2}
                    onClick={() => setState((s) => ({ ...s, step: 2 }))}
                  >
                    Continue <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <form className="space-y-5" onSubmit={handleSignup}>
                  <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
                    <span className="font-medium">{state.organizationName || 'Your business'}</span>
                    <span className="text-muted-foreground"> · {selectedPack.label}</span>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Your full name</Label>
                    <Input
                      id="fullName"
                      placeholder="e.g. Kwame Mensah"
                      value={state.fullName}
                      onChange={(e) => set('fullName', e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Work email</Label>
                    <Input
                      id="email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@business.com"
                      value={state.email}
                      onChange={(e) => set('email', e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                      value={state.password}
                      onChange={(e) => set('password', e.target.value)}
                      required
                      minLength={8}
                    />
                  </div>
                  {error ? (
                    <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setState((s) => ({ ...s, step: 1 }))}
                    >
                      Back
                    </Button>
                    <Button type="submit" className="flex-1" disabled={loading}>
                      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Rocket className="size-4" aria-hidden="true" />}
                      {loading ? 'Creating workspace…' : 'Create workspace'}
                    </Button>
                  </div>
                  <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
                    By creating a workspace you agree to the OMNIRA terms of service.
                    Your organization gets a 14-day Starter trial.
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </main>

      <footer className="border-t px-6 py-4 text-center text-xs text-muted-foreground">
        © 2026 KINGSTECH PLC · OMNIRA — One Platform. Every Business.
      </footer>
    </div>
  );
}
