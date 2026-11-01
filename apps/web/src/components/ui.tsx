'use client';

import type { CheckOutcome, DataSource } from '@careerconnect/shared';
import Link from 'next/link';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import type { ApiClientError } from '@/lib/api';
import { humanize } from '@/lib/format';
import type { ActionMessage } from '@/lib/hooks';

export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

// ------------------------------------------------------------------ Buttons

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary: 'bg-indigo-700 text-white hover:bg-indigo-800 disabled:bg-indigo-300',
  secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300',
  ghost: 'text-slate-700 hover:bg-slate-100 disabled:text-slate-400',
};

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed',
        VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}

// ------------------------------------------------------------------- Badges

export type Tone = 'gray' | 'blue' | 'green' | 'amber' | 'red' | 'indigo' | 'purple';
const TONE: Record<Tone, string> = {
  gray: 'bg-slate-100 text-slate-800 ring-slate-300',
  blue: 'bg-sky-50 text-sky-900 ring-sky-300',
  green: 'bg-emerald-50 text-emerald-900 ring-emerald-300',
  amber: 'bg-amber-50 text-amber-900 ring-amber-300',
  red: 'bg-red-50 text-red-900 ring-red-300',
  indigo: 'bg-indigo-50 text-indigo-900 ring-indigo-300',
  purple: 'bg-fuchsia-50 text-fuchsia-900 ring-fuchsia-300',
};

export function Badge({ tone = 'gray', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONE[tone])}
    >
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  // eligibility / policy decision
  PENDING: 'gray',
  SKIP: 'gray',
  HOLD_FOR_REVIEW: 'amber',
  ELIGIBLE_FOR_AUTOMATION: 'green',
  // processing
  DISCOVERED: 'blue',
  ANALYZED: 'blue',
  DRAFTED: 'indigo',
  SKIPPED: 'gray',
  PUBLISHED: 'green',
  PURGED: 'gray',
  FAILED: 'red',
  // review
  PENDING_REVIEW: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
  // publish
  NOT_PUBLISHED: 'gray',
  QUEUED: 'blue',
  BLOCKED: 'red',
  // authorization
  UNKNOWN: 'gray',
  DENIED: 'red',
  // disclosure
  INCLUDED: 'green',
  MISSING: 'red',
  NOT_CONFIGURED: 'amber',
  // publish attempts
  SUCCEEDED: 'green',
  FAILED_TRANSIENT: 'amber',
  FAILED_PERMANENT: 'red',
  SIMULATED: 'purple',
};

/** Badge for any of the shared status enums; text always present so colour is never the only signal. */
export function StatusBadge({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return <Badge tone="gray">{label ? `${label}: —` : '—'}</Badge>;
  return (
    <Badge tone={STATUS_TONES[value] ?? 'gray'}>
      {label ? `${label}: ` : ''}
      {humanize(value)}
    </Badge>
  );
}

const OUTCOME_TONE: Record<CheckOutcome, Tone> = { PASS: 'green', FAIL: 'red', UNKNOWN: 'amber' };
export function OutcomeBadge({ outcome }: { outcome: CheckOutcome }) {
  return <Badge tone={OUTCOME_TONE[outcome]}>{outcome}</Badge>;
}

/** Every conversation/draft must show whether it is synthetic demo data or real Reddit data. */
export function DataSourceBadge({ source }: { source: DataSource }) {
  return source === 'SYNTHETIC' ? (
    <Badge tone="purple" title="Synthetic fixture — not real Reddit content">
      Demo data
    </Badge>
  ) : (
    <Badge tone="blue" title="Content retrieved from Reddit">
      Reddit
    </Badge>
  );
}

// ------------------------------------------------------------------- Layout

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-slate-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  children,
  actions,
  className,
  headingLevel = 2,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className={cx('rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:p-5', className)}>
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title ? <Heading className="text-base font-semibold text-slate-900">{title}</Heading> : <span />}
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'warn' | 'bad' }) {
  return (
    <div
      className={cx(
        'rounded-lg border bg-white p-4 shadow-sm',
        tone === 'bad' ? 'border-red-300' : tone === 'warn' ? 'border-amber-300' : 'border-slate-200',
      )}
    >
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold text-slate-900">{value}</dd>
      {hint ? <dd className="mt-1 text-xs text-slate-600">{hint}</dd> : null}
    </div>
  );
}

/** Untrusted (Reddit / LLM-derived) text: always plain text, whitespace preserved, never linkified. */
export function PlainText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return <p className={cx('text-sm italic text-slate-500', className)}>(empty)</p>;
  return <p className={cx('whitespace-pre-wrap break-words text-sm text-slate-800', className)}>{text}</p>;
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-700 underline hover:text-indigo-900">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-indigo-700 underline-offset-2 hover:underline">
      {children}
    </Link>
  );
}

// ------------------------------------------------------------- States

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 py-8 text-sm text-slate-600">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-700" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiClientError; onRetry?: () => void }) {
  if (error.isForbidden) {
    return (
      <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">Insufficient role</p>
        <p className="mt-1">Your account does not have permission to view this. Ask an administrator if you need access.</p>
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-950">
      <p className="font-semibold">Something went wrong</p>
      <p className="mt-1">
        {error.message} <span className="text-red-800">({error.code})</span>
      </p>
      {onRetry ? (
        <Button variant="secondary" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {children ? <div className="mt-1 text-sm text-slate-600">{children}</div> : null}
    </div>
  );
}

/** Always-mounted live region so screen readers announce action outcomes. */
export function ActionResult({ message }: { message: ActionMessage | null }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {message ? (
        <p
          className={cx(
            'mt-3 rounded-md border px-3 py-2 text-sm',
            message.tone === 'success' && 'border-emerald-300 bg-emerald-50 text-emerald-950',
            message.tone === 'error' && 'border-red-300 bg-red-50 text-red-950',
            message.tone === 'info' && 'border-sky-300 bg-sky-50 text-sky-950',
          )}
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

export function RoleNotice({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">{children}</p>;
}

// ------------------------------------------------------------------- Forms

const CONTROL =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 disabled:bg-slate-100 disabled:text-slate-600 aria-[invalid=true]:border-red-500';

interface FieldWrapProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
}

function FieldWrap({
  id,
  label,
  hint,
  error,
  className,
  children,
}: FieldWrapProps & { id: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-600">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: ReactNode, error?: string): string | undefined {
  const ids = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

export function TextField({
  label,
  hint,
  error,
  className,
  ...props
}: FieldWrapProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>) {
  const id = useId();
  return (
    <FieldWrap id={id} label={label} hint={hint} error={error} className={className}>
      <input id={id} className={CONTROL} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...props} />
    </FieldWrap>
  );
}

export function TextAreaField({
  label,
  hint,
  error,
  className,
  ...props
}: FieldWrapProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>) {
  const id = useId();
  return (
    <FieldWrap id={id} label={label} hint={hint} error={error} className={className}>
      <textarea id={id} className={CONTROL} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...props} />
    </FieldWrap>
  );
}

export function SelectField({
  label,
  hint,
  error,
  className,
  options,
  ...props
}: FieldWrapProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & { options: ReadonlyArray<{ value: string; label: string }> }) {
  const id = useId();
  return (
    <FieldWrap id={id} label={label} hint={hint} error={error} className={className}>
      <select id={id} className={CONTROL} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

export function CheckboxField({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-2">
      <input
        id={id}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-400 accent-indigo-700"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-slate-800">
          {label}
        </label>
        {hint ? (
          <p id={`${id}-hint`} className="text-xs text-slate-600">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Builds select options from an enum array with an optional "All" entry. */
export function enumOptions(values: readonly string[], allLabel?: string, labels?: Record<string, string>) {
  const opts = values.map((v) => ({ value: v, label: labels?.[v] ?? humanize(v) }));
  return allLabel ? [{ value: '', label: allLabel }, ...opts] : opts;
}

// --------------------------------------------------------------- Pagination

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-700">
      <p>
        Showing {from}–{to} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span aria-current="page">
          Page {page} of {pages}
        </span>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------- Tables

export function Table({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cx('whitespace-nowrap bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600', className)}>
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx('px-3 py-2 align-top text-slate-800', className)}>{children}</td>;
}
