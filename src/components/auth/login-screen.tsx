'use client';

/**
 * OMNIRA — Login screen
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 */

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, Loader2, LogIn, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { BrandMark, BrandWordmark } from '@/components/shared/brand';
import { ApiClientError } from '@/lib/client/api';

const HIGHLIGHTS = [
  'Point of sale that fits every business — retail, pharmacy, restaurant, fashion, services and more',
  'Multi-branch inventory with batch & expiry tracking where you need it',
  'Roles, permissions and an immutable audit trail for every workspace',
  'AI-powered insights on your real sales data',
];

export function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showSignup, setShowSignup] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError('Invalid email or password. Check your credentials and try again.');
        return;
      }
      onSuccess();
    } catch {
      setError(new ApiClientError(500, 'UNKNOWN', 'Network error').message === 'Network error'
        ? 'Could not reach the server. Please try again.'
        : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="grid flex-1 lg:grid-cols-2">
        {/* Left — brand panel */}
        <div className="relative hidden flex-col justify-between overflow-hidden bg-zinc-950 p-10 text-white lg:flex">
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              background:
                'radial-gradient(60% 50% at 20% 10%, rgba(20,184,166,0.35) 0%, transparent 60%), radial-gradient(50% 60% at 90% 90%, rgba(13,148,136,0.28) 0%, transparent 55%)',
            }}
            aria-hidden="true"
          />
          <div className="relative flex items-center gap-3">
            <BrandMark size={40} />
            <BrandWordmark tone="light" />
          </div>
          <div className="relative max-w-md space-y-6">
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-4xl font-bold leading-tight tracking-tight"
            >
              One platform.
              <br />
              Every business.
            </motion.h1>
            <ul className="space-y-3">
              {HIGHLIGHTS.map((h, i) => (
                <motion.li
                  key={h}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.1, duration: 0.4 }}
                  className="flex items-start gap-3 text-sm text-zinc-300"
                >
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-400" aria-hidden="true" />
                  {h}
                </motion.li>
              ))}
            </ul>
          </div>
          <p className="relative text-xs text-zinc-500">
            © 2026 KINGSTECH PLC · OMNIRA is a trademark of KINGSTECH PLC
          </p>
        </div>

        {/* Right — form */}
        <div className="flex items-center justify-center p-6 sm:p-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="w-full max-w-sm"
          >
            <div className="mb-8 flex items-center gap-3 lg:hidden">
              <BrandMark size={36} />
              <BrandWordmark />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Sign in to your workspace to open the register.
            </p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@business.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <LogIn className="size-4" aria-hidden="true" />
                )}
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <div className="mt-6 rounded-xl border bg-muted/40 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Store className="size-3.5" aria-hidden="true" /> New here? Start selling in minutes.
              </p>
              <Button
                type="button"
                variant="link"
                className="mt-1 h-auto p-0 text-primary"
                onClick={() => setShowSignup((v) => !v)}
              >
                Create your business workspace <ArrowRight className="size-3.5" aria-hidden="true" />
              </Button>
              {showSignup ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Sign in first is not needed — use the <strong>Sign up</strong> tab after signing out,
                  or ask the platform operator to provision your organization.
                </p>
              ) : null}
            </div>

            <p className="mt-8 text-center text-xs text-muted-foreground">
              <a
                href="#/signup"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Create a new organization →
              </a>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
