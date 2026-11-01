'use client';

import * as RadixDialog from '@radix-ui/react-dialog';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, TextAreaField } from './ui';

/** Accessible modal (focus trap, Esc to close, labelled) built on Radix Dialog. */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-slate-900/50" />
        <RadixDialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-5 shadow-xl ${
            wide ? 'max-w-2xl' : 'max-w-md'
          }`}
        >
          <RadixDialog.Title className="text-lg font-semibold text-slate-900">{title}</RadixDialog.Title>
          {description ? (
            <RadixDialog.Description className="mt-1 text-sm text-slate-600">{description}</RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/**
 * Confirmation dialog. When `requireReason` is set, a reason (min 3 chars, matching the
 * API's `reason` schemas) must be entered and is passed to onConfirm.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  requireReason,
  reasonLabel = 'Reason',
  minReasonLength = 3,
  pending,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  minReasonLength?: number;
  pending?: boolean;
  onConfirm: (reason: string) => void | Promise<void>;
  children?: ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setReason('');
      setError(undefined);
    }
    onOpenChange(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = reason.trim();
    if (requireReason && trimmed.length < minReasonLength) {
      setError(`Please enter a reason (at least ${minReasonLength} characters).`);
      return;
    }
    setError(undefined);
    await onConfirm(trimmed);
    setReason('');
  };

  return (
    <Modal open={open} onOpenChange={handleOpenChange} title={title} description={description}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {children}
        {requireReason ? (
          <TextAreaField
            label={reasonLabel}
            required
            rows={3}
            maxLength={1000}
            value={reason}
            error={error}
            onChange={(e) => setReason(e.target.value)}
          />
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={pending}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
