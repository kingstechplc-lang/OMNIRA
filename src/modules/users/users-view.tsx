'use client';

/**
 * OMNIRA — Staff & Users administration
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * List, create and manage organization staff accounts: role assignment,
 * suspension and profile edits. Self-profile edits are permitted without
 * `users.update` (the server enforces the same rule).
 */

import { useState } from 'react';
import { Eye, EyeOff, Loader2, ShieldCheck, TriangleAlert, UserCheck, UserPlus, UserX, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ApiClientError } from '@/lib/client/api';
import { formatDateTime, timeAgo } from '@/lib/client/format';
import { useAuthContext, useCreateUser, useRoles, useUpdateUser, useUsers } from '@/lib/client/queries';
import type { UserListItemDTO } from '@/types/api';
import { ErrorState, LoadingBlock, PageHeader, StatCard, StatusBadge } from '@/components/shared';
import { DataTable, type DataTableColumn } from '@/components/shared/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Deterministic avatar tint per person — warm non-blue palette. */
const AVATAR_TONES = [
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
  'bg-orange-500/15 text-orange-700 dark:text-orange-300',
];

function avatarTone(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : '';
  return (parts[0].charAt(0) + last).toUpperCase();
}

function roleBadgeClass(key: string): string {
  return key === 'ORG_ADMIN'
    ? 'border-primary/30 bg-primary/10 text-primary'
    : 'border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400';
}

function fieldError(message: string | undefined) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null;
}

// ---------------------------------------------------------------------------
// Roles checklist (shared by both dialogs)
// ---------------------------------------------------------------------------

function RoleChecklist({
  selected,
  onToggle,
  disabled,
}: {
  selected: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
  disabled?: boolean;
}) {
  const { data: roles, isLoading } = useRoles();

  if (isLoading) return <LoadingBlock lines={2} className="mt-1" />;
  if (!roles || roles.length === 0) {
    return <p className="mt-1 text-xs text-muted-foreground">No roles are defined for this organization yet.</p>;
  }

  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {roles.map((role) => (
        <label
          key={role.id}
          className={cn(
            'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
            !disabled && 'hover:bg-muted/50',
            disabled && 'cursor-not-allowed opacity-60',
            selected.has(role.key) && 'border-primary/40 bg-primary/5',
          )}
        >
          <Checkbox
            className="mt-0.5"
            checked={selected.has(role.key)}
            disabled={disabled}
            onCheckedChange={(v) => onToggle(role.key, v === true)}
            aria-label={role.name}
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium leading-tight">{role.name}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {role.description ?? role.key}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const createUser = useCreateUser();
  const { data: roles } = useRoles();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(['CASHIER']));
  const [errors, setErrors] = useState<{ fullName?: string; email?: string; password?: string; roles?: string }>({});

  const toggleRole = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const submit = () => {
    const next: typeof errors = {};
    if (fullName.trim().length < 2) next.fullName = 'Full name must be at least 2 characters.';
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length < 8) next.password = 'Password must be at least 8 characters.';
    const roleIds = [...selected]
      .map((key) => roles?.find((r) => r.key === key)?.id)
      .filter((id): id is string => Boolean(id));
    if (roleIds.length === 0) next.roles = 'Select at least one role.';
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    createUser.mutate(
      {
        fullName: fullName.trim(),
        email: email.trim(),
        password,
        phone: phone.trim() || undefined,
        roleIds,
      },
      {
        onSuccess: (user) => {
          toast.success(`${user.fullName} was added to the team`);
          onClose();
        },
        onError: (err) => toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong'),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="custom-scrollbar max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>Create a staff account and choose what they can do.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="new-user-name">Full name *</Label>
            <Input
              id="new-user-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ama Mensah"
              autoComplete="off"
              aria-invalid={Boolean(errors.fullName)}
            />
            {fieldError(errors.fullName)}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="new-user-email">Email *</Label>
              <Input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ama@store.com"
                autoComplete="off"
                aria-invalid={Boolean(errors.email)}
              />
              {fieldError(errors.email)}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-user-phone">Phone</Label>
              <Input
                id="new-user-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+233 20 000 0000"
                autoComplete="tel"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="new-user-password">Password *</Label>
            <div className="relative">
              <Input
                id="new-user-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                autoComplete="new-password"
                className="pr-10"
                aria-invalid={Boolean(errors.password)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
              </button>
            </div>
            {fieldError(errors.password)}
          </div>

          <div className="grid gap-1">
            <Label>Roles *</Label>
            <p className="text-xs text-muted-foreground">Pick one or more roles — they can be changed later.</p>
            <RoleChecklist selected={selected} onToggle={toggleRole} />
            {fieldError(errors.roles)}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={createUser.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createUser.isPending}>
            {createUser.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <UserPlus className="size-4" aria-hidden="true" />}
            Add user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit dialog
// ---------------------------------------------------------------------------

function EditUserDialog({
  user,
  isSelf,
  canManage,
  onClose,
}: {
  user: UserListItemDTO;
  isSelf: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const updateUser = useUpdateUser();
  const { data: roles } = useRoles();
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone ?? '');
  const [status, setStatus] = useState<'ACTIVE' | 'SUSPENDED'>(user.status);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(user.roles.map((r) => r.key)));
  const [nameError, setNameError] = useState<string | null>(null);

  const canEditProfile = canManage || isSelf;
  const canAssign = canManage && !isSelf;

  const currentKeys = new Set(user.roles.map((r) => r.key));
  const rolesChanged =
    canAssign && (selected.size !== currentKeys.size || [...selected].some((key) => !currentKeys.has(key)));

  const toggleRole = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const submit = () => {
    if (fullName.trim().length < 2) {
      setNameError('Full name must be at least 2 characters.');
      return;
    }
    setNameError(null);

    const payload: { id: string } & Record<string, unknown> = {
      id: user.id,
      fullName: fullName.trim(),
      phone: phone.trim() || null,
    };
    if (canAssign) {
      payload.roleIds = [...selected]
        .map((key) => roles?.find((r) => r.key === key)?.id)
        .filter((id): id is string => Boolean(id));
      payload.status = status;
    }

    updateUser.mutate(payload, {
      onSuccess: () => {
        toast.success('User updated');
        onClose();
      },
      onError: (err) => toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong'),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="custom-scrollbar max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="edit-user-name">Full name</Label>
              <Input
                id="edit-user-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={!canEditProfile || updateUser.isPending}
                aria-invalid={Boolean(nameError)}
              />
              {fieldError(nameError ?? undefined)}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-user-phone">Phone</Label>
              <Input
                id="edit-user-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="—"
                disabled={!canEditProfile || updateUser.isPending}
              />
            </div>
          </div>

          {canAssign ? (
            <>
              <div className="grid gap-1">
                <Label>Roles</Label>
                <RoleChecklist selected={selected} onToggle={toggleRole} disabled={updateUser.isPending} />
                {rolesChanged ? (
                  <p className="mt-1 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                    Saving replaces this user&apos;s roles — the new permissions apply to their very next action.
                  </p>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div>
                  <p className="text-sm font-medium">Account status</p>
                  <p className="text-xs text-muted-foreground">
                    {status === 'ACTIVE' ? 'Active — this user can sign in.' : 'Suspended — sign-in is blocked.'}
                  </p>
                </div>
                <Switch
                  checked={status === 'ACTIVE'}
                  onCheckedChange={(v) => setStatus(v ? 'ACTIVE' : 'SUSPENDED')}
                  disabled={isSelf || updateUser.isPending}
                  aria-label="Toggle account status"
                />
              </div>
            </>
          ) : (
            <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
              {isSelf
                ? 'You can update your own name and phone. Roles and status can only be changed by an administrator.'
                : 'Only administrators can change roles and account status.'}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateUser.isPending}>
            Cancel
          </Button>
          {canEditProfile ? (
            <Button onClick={submit} disabled={updateUser.isPending}>
              {updateUser.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Save changes
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export default function UsersView() {
  const { data: auth } = useAuthContext();
  const can = (p: string) => Boolean(auth?.platformAdmin) || (auth?.permissions.includes(p) ?? false);
  const { data: users, isLoading, isError, refetch } = useUsers();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserListItemDTO | null>(null);

  const total = users?.length ?? 0;
  const active = users?.filter((u) => u.status === 'ACTIVE').length ?? 0;
  const suspended = users?.filter((u) => u.status === 'SUSPENDED').length ?? 0;
  const admins = users?.filter((u) => u.roles.some((r) => r.key === 'ORG_ADMIN')).length ?? 0;

  const columns: DataTableColumn<UserListItemDTO>[] = [
    {
      key: 'user',
      header: 'User',
      cell: (u) => (
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold', avatarTone(u.fullName))}
          >
            {initialsOf(u.fullName)}
          </span>
          <div className="min-w-0">
            <p className="truncate font-semibold">{u.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      cell: (u) =>
        u.roles.length === 0 ? (
          <span className="text-xs text-muted-foreground">No roles</span>
        ) : (
          <div className="flex max-w-56 flex-wrap gap-1">
            {u.roles.map((r) => (
              <Badge key={r.id} variant="outline" className={roleBadgeClass(r.key)}>
                {r.name}
              </Badge>
            ))}
          </div>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (u) => <StatusBadge status={u.status} />,
    },
    {
      key: 'lastLogin',
      header: 'Last login',
      cell: (u) =>
        u.lastLoginAt ? (
          <span className="text-muted-foreground" title={formatDateTime(u.lastLoginAt)}>
            {timeAgo(u.lastLoginAt)}
          </span>
        ) : (
          <span className="text-muted-foreground">Never</span>
        ),
    },
    {
      key: 'added',
      header: 'Added',
      cell: (u) => <span className="whitespace-nowrap text-muted-foreground">{formatDateTime(u.createdAt)}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff & Users"
        description="Manage who can sign in to your organization and what they can do."
        icon={UsersIcon}
        actions={
          can('users.create') ? (
            <Button onClick={() => setCreateOpen(true)}>
              <UserPlus className="size-4" aria-hidden="true" />
              Add user
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label="Total staff" value={String(total)} icon={UsersIcon} sub="in this organization" />
        <StatCard label="Active" value={String(active)} icon={UserCheck} sub="can sign in" />
        <StatCard label="Suspended" value={String(suspended)} icon={UserX} sub="access revoked" />
        <StatCard label="Admins" value={String(admins)} icon={ShieldCheck} sub="ORG_ADMIN role" />
      </div>

      {isError ? (
        <ErrorState title="Couldn't load staff" description="The user list failed to load." onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={users}
          loading={isLoading}
          onRowClick={setEditing}
          maxHeight="70vh"
          emptyTitle="No staff yet"
          emptyDescription="Add your first team member to start delegating work."
        />
      )}

      {createOpen ? <CreateUserDialog onClose={() => setCreateOpen(false)} /> : null}
      {editing ? (
        <EditUserDialog
          key={editing.id}
          user={editing}
          isSelf={auth?.user.id === editing.id}
          canManage={can('users.update')}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
