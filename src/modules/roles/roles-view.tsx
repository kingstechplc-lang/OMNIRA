'use client';

/**
 * OMNIRA — Roles & Permissions administration
 * Copyright KINGSTECH PLC (evolved from PHARMORA)
 *
 * Role cards with a full permission matrix editor grouped by business module.
 * System roles are read-only; custom roles can be edited and deleted.
 */

import { useMemo, useState } from 'react';
import { KeyRound, Loader2, Pencil, Plus, ShieldCheck, Trash2, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ApiClientError } from '@/lib/client/api';
import { useAuthContext, useCreateRole, useDeleteRole, usePermissions, useRoles, useUpdateRole } from '@/lib/client/queries';
import type { RoleDTO } from '@/types/api';
import { MODULES } from '@/lib/permissions/catalog';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { ErrorState, LoadingBlock, PageHeader } from '@/components/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Role dialog (create + edit) with the permission matrix
// ---------------------------------------------------------------------------

function RoleDialog({
  role,
  readOnly,
  onClose,
}: {
  role: RoleDTO | null;
  readOnly: boolean;
  onClose: () => void;
}) {
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const { data: permissionData, isLoading: permissionsLoading } = usePermissions();
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(role?.permissions ?? []));
  const [nameError, setNameError] = useState<string | null>(null);
  const [permError, setPermError] = useState<string | null>(null);

  const permissions = permissionData?.permissions;
  const total = permissions?.length ?? 0;

  /** Group the live permission catalog under the module taxonomy (order preserved). */
  const grouped = useMemo(
    () =>
      MODULES.map((module) => ({
        module,
        perms: (permissions ?? []).filter((p) => p.module === module.module),
      })).filter((group) => group.perms.length > 0),
    [permissions],
  );

  const togglePermission = (key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleModule = (module: string, selectAll: boolean) => {
    const keys = grouped.find((g) => g.module.module === module)?.perms.map((p) => p.key) ?? [];
    setSelected((prev) => {
      const next = new Set(prev);
      keys.forEach((key) => (selectAll ? next.add(key) : next.delete(key)));
      return next;
    });
  };

  const submitting = createRole.isPending || updateRole.isPending;

  const submit = () => {
    if (name.trim().length < 2) {
      setNameError('Name must be at least 2 characters.');
      return;
    }
    setNameError(null);
    if (selected.size === 0) {
      setPermError('Select at least one permission.');
      return;
    }
    setPermError(null);

    const onError = (err: unknown) =>
      toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong');

    if (role) {
      updateRole.mutate(
        { id: role.id, name: name.trim(), description: description.trim() || null, permissions: [...selected] },
        {
          onSuccess: () => {
            toast.success(`Role "${name.trim()}" updated`);
            onClose();
          },
          onError,
        },
      );
    } else {
      createRole.mutate(
        { name: name.trim(), description: description.trim() || undefined, permissions: [...selected] },
        {
          onSuccess: () => {
            toast.success(`Role "${name.trim()}" created`);
            onClose();
          },
          onError,
        },
      );
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="custom-scrollbar max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{role ? 'Edit role' : 'New role'}</DialogTitle>
          <DialogDescription>
            {role ? 'Adjust the name, description or permission set.' : 'Define a reusable permission set for your team.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="role-name">Name *</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Head Cashier"
                disabled={readOnly || submitting}
                aria-invalid={Boolean(nameError)}
              />
              {nameError ? <p className="text-xs text-destructive">{nameError}</p> : null}
            </div>
            {role ? (
              <div className="grid gap-2">
                <Label htmlFor="role-key">Key</Label>
                <Input id="role-key" value={role.key} disabled className="font-mono text-xs" />
              </div>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="role-description">Description</Label>
            <Textarea
              id="role-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this role for?"
              rows={2}
              disabled={readOnly || submitting}
            />
          </div>

          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label>Permissions</Label>
                <p className="text-xs text-muted-foreground">
                  {selected.size} of {total} permissions selected
                </p>
              </div>
            </div>
            {permError ? <p className="text-xs text-destructive">{permError}</p> : null}

            {permissionsLoading ? (
              <LoadingBlock lines={6} />
            ) : (
              <div className="grid gap-3">
                {grouped.map(({ module, perms }) => {
                  const selectedCount = perms.filter((p) => selected.has(p.key)).length;
                  const allSelected = selectedCount === perms.length;
                  return (
                    <div key={module.module} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{module.label}</p>
                          <p className="truncate text-xs text-muted-foreground">{module.description}</p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          disabled={readOnly || submitting}
                          onClick={() => toggleModule(module.module, !allSelected)}
                        >
                          {allSelected ? 'Clear' : 'Select all'}
                        </Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                        {perms.map((p) => (
                          <label
                            key={p.key}
                            title={p.description}
                            className={cn(
                              'flex cursor-pointer items-center gap-1.5 text-sm',
                              (readOnly || submitting) && 'cursor-not-allowed opacity-60',
                            )}
                          >
                            <Checkbox
                              checked={selected.has(p.key)}
                              disabled={readOnly || submitting}
                              onCheckedChange={(v) => togglePermission(p.key, v === true)}
                              aria-label={`${module.label}: ${p.action}`}
                            />
                            <span className="capitalize">{p.action}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {!readOnly ? (
            <Button onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {role ? 'Save changes' : 'Create role'}
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

export default function RolesView() {
  const { data: auth } = useAuthContext();
  const can = (p: string) => Boolean(auth?.platformAdmin) || (auth?.permissions.includes(p) ?? false);
  const { data: roles, isLoading, isError, refetch } = useRoles();
  const deleteRole = useDeleteRole();
  const [dialog, setDialog] = useState<{ mode: 'create' } | { mode: 'edit'; role: RoleDTO } | null>(null);
  const [deleting, setDeleting] = useState<RoleDTO | null>(null);

  const canManage = can('roles.manage');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & Permissions"
        description="Control what each member of your team can see and do."
        icon={ShieldCheck}
        actions={
          canManage ? (
            <Button onClick={() => setDialog({ mode: 'create' })}>
              <Plus className="size-4" aria-hidden="true" />
              New role
            </Button>
          ) : null
        }
      />

      {isError ? (
        <ErrorState title="Couldn't load roles" description="The role list failed to load." onRetry={() => void refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-48 animate-pulse rounded-xl border bg-muted/40" aria-hidden="true" />
          ))}
        </div>
      ) : roles && roles.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.id} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{role.name}</CardTitle>
                    <code className="mt-1.5 inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {role.key}
                    </code>
                  </div>
                  {role.isSystem ? (
                    <Badge
                      variant="outline"
                      className="shrink-0 border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-400"
                    >
                      System
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <p className="min-h-10 text-sm text-muted-foreground">{role.description ?? 'No description'}</p>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <UsersIcon className="size-3" aria-hidden="true" />
                    {role.userCount ?? 0} {role.userCount === 1 ? 'user' : 'users'}
                  </Badge>
                  <Badge variant="secondary" className="gap-1 font-normal">
                    <KeyRound className="size-3" aria-hidden="true" />
                    {role.permissions.length} {role.permissions.length === 1 ? 'permission' : 'permissions'}
                  </Badge>
                </div>
                <div className="mt-auto flex items-center gap-2 pt-1">
                  {role.isEditable ? (
                    <Button variant="outline" size="sm" onClick={() => setDialog({ mode: 'edit', role })}>
                      <Pencil className="size-3.5" aria-hidden="true" />
                      Edit
                    </Button>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0} className="inline-flex">
                          <Button variant="outline" size="sm" disabled aria-label="System roles cannot be edited">
                            <Pencil className="size-3.5" aria-hidden="true" />
                            Edit
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>System roles cannot be edited</TooltipContent>
                    </Tooltip>
                  )}
                  {!role.isSystem && canManage ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleting(role)}
                      aria-label={`Delete role ${role.name}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Delete
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-semibold">No roles yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Create your first role to start assigning permissions.</p>
        </div>
      )}

      {dialog ? (
        <RoleDialog
          key={dialog.mode === 'edit' ? dialog.role.id : 'create'}
          role={dialog.mode === 'edit' ? dialog.role : null}
          readOnly={!canManage}
          onClose={() => setDialog(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete role"
        description={
          deleting
            ? `This permanently removes "${deleting.name}" from your organization. Roles currently assigned to users cannot be deleted.`
            : undefined
        }
        confirmLabel="Delete role"
        destructive
        loading={deleteRole.isPending}
        onConfirm={() => {
          if (!deleting) return;
          deleteRole.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(`Role "${deleting.name}" deleted`);
              setDeleting(null);
            },
            onError: (err) => toast.error(err instanceof ApiClientError ? err.message : 'Something went wrong'),
          });
        }}
      />
    </div>
  );
}
