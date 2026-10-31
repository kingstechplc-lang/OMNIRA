'use client';

/**
 * OMNIRA — Organization switcher + user menu + topbar
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 */

import { useState } from 'react';
import { useTheme } from 'next-themes';
import { signOut } from 'next-auth/react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Building2,
  Check,
  ChevronsUpDown,
  LifeBuoy,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Search,
  ShieldAlert,
  Sun,
  UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useSwitchOrganization, useLogout } from '@/lib/client/queries';
import { BusinessTypeIcon, businessTypeLabel } from '@/components/shared/business-type';
import { useUiStore } from '@/store/ui';
import { cn } from '@/lib/utils';
import type { AuthContextDTO } from '@/types/api';

// ---------------------------------------------------------------------------
// Organization switcher
// ---------------------------------------------------------------------------

export function OrgSwitcher({ auth }: { auth: AuthContextDTO }) {
  const [open, setOpen] = useState(false);
  const switchOrg = useSwitchOrganization();
  const currentId = auth.organization?.id ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 max-w-56 justify-between gap-2 font-medium"
          aria-label="Switch organization"
        >
          {auth.organization ? (
            <>
              <BusinessTypeIcon value={auth.organization.businessType} className="size-4 shrink-0 text-primary" />
              <span className="truncate">{auth.organization.name}</span>
            </>
          ) : (
            <>
              <Building2 className="size-4 shrink-0 text-primary" />
              <span className="truncate">Platform console</span>
            </>
          )}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Search organizations…" />
          <CommandList className="custom-scrollbar">
            <CommandEmpty>No organization matches.</CommandEmpty>
            {auth.platformAdmin ? (
              <CommandGroup heading="Platform">
                <CommandItem
                  value="platform-console"
                  onSelect={() => {
                    switchOrg.mutate(null);
                    setOpen(false);
                  }}
                >
                  <Building2 className="size-4" aria-hidden="true" />
                  <span className="flex-1">Platform console</span>
                  {currentId === null ? <Check className="size-4 text-primary" aria-hidden="true" /> : null}
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup heading={auth.platformAdmin ? 'Organizations' : 'Your workspaces'}>
              {auth.organizations.map((org) => (
                <CommandItem
                  key={org.id}
                  value={`${org.name} ${org.slug}`}
                  onSelect={() => {
                    if (org.organizationId !== currentId) {
                      switchOrg.mutate(org.organizationId);
                    }
                    setOpen(false);
                  }}
                >
                  <BusinessTypeIcon value={org.businessType} className="size-4" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{org.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {businessTypeLabel(org.businessType)}
                    </span>
                  </span>
                  {org.organizationId === currentId ? (
                    <Check className="size-4 text-primary" aria-hidden="true" />
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// User menu
// ---------------------------------------------------------------------------

export function UserMenu({ auth }: { auth: AuthContextDTO }) {
  const { theme, setTheme } = useTheme();
  const logout = useLogout();
  const initials = auth.user.fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-9 rounded-full bg-primary/10 text-sm font-bold text-primary"
          aria-label="Account menu"
        >
          {initials}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="truncate text-sm font-semibold">{auth.user.fullName}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">{auth.user.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {auth.platformAdmin ? (
          <DropdownMenuLabel className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
            <ShieldAlert className="size-3.5" aria-hidden="true" /> Platform administrator
          </DropdownMenuLabel>
        ) : null}
        <DropdownMenuItem onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor className="size-4" aria-hidden="true" /> System theme
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void signOut({ callbackUrl: '/' })}>
          <LogOut className="size-4" aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------

export function Topbar({ auth }: { auth: AuthContextDTO }) {
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const toggleCommandMenu = useUiStore((s) => s.toggleCommandMenu);
  const supportMode = auth.platformAdmin && auth.organization !== null;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:gap-3 sm:px-5">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={() => setSidebarOpen(true)}
        aria-label="Open menu"
      >
        <Menu className="size-5" />
      </Button>
      <OrgSwitcher auth={auth} />
      {supportMode ? (
        <span className="hidden items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400 sm:inline-flex">
          <LifeBuoy className="size-3" aria-hidden="true" /> Support mode
        </span>
      ) : null}
      <div className="flex-1" />
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-2 text-muted-foreground"
        onClick={toggleCommandMenu}
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 font-mono text-[10px] font-semibold sm:inline">
          Ctrl K
        </kbd>
      </Button>
      <UserMenu auth={auth} />
    </header>
  );
}

/** Support-mode banner shown while a platform admin is inside a tenant. */
export function SupportBanner({ auth, onExit }: { auth: AuthContextDTO; onExit: () => void }) {
  if (!auth.platformAdmin || !auth.organization) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: -30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className={cn(
          'flex items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-center text-xs font-medium text-amber-700 dark:text-amber-400',
        )}
      >
        <LifeBuoy className="size-3.5" aria-hidden="true" />
        You are inside <strong>{auth.organization.name}</strong> as platform support. All actions are audited.
        <button type="button" onClick={onExit} className="font-semibold underline underline-offset-2">
          Exit to platform
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
