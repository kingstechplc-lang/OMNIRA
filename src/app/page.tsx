'use client';

/**
 * OMNIRA — application root (single-page app at /)
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Public hash routes: #/ (login gate) and #/signup (org self-registration).
 * Everything else renders inside the authenticated AppShell.
 */

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/layout/app-shell';
import { LoginScreen } from '@/components/auth/login-screen';
import { SignupScreen } from '@/components/auth/signup-screen';
import { BrandMark, BrandWordmark } from '@/components/shared/brand';
import { useAuthContext } from '@/lib/client/queries';
import { navigate, onHashChange, readHash } from '@/lib/client/router';

function Splash() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background"
      role="status"
      aria-label="Loading OMNIRA"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center gap-4"
      >
        <BrandMark size={56} />
        <BrandWordmark />
      </motion.div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Preparing your workspace…
      </div>
    </div>
  );
}

function AppRoot() {
  const { data, isLoading, isError, refetch } = useAuthContext();

  // Public route: #/signup (organization self-registration).
  const [route, setRoute] = useState(() => readHash());
  useEffect(() => {
    const unsub = onHashChange((r) => setRoute(r));
    return unsub;
  }, []);

  if (route === '/signup') {
    return <SignupScreen />;
  }

  if (isLoading) return <Splash />;

  if (isError || !data) {
    // 401/unauthenticated → login; other errors also land here with a retry.
    return <LoginScreen onSuccess={() => void refetch()} />;
  }

  return <AppShell />;
}

export default function Home() {
  return (
    <Providers>
      <AppRoot />
    </Providers>
  );
}
