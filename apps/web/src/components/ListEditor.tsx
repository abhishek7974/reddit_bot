'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import { Button } from './ui';

/** Editor for string arrays (keywords, verified facts, URLs, …). */
export function ListEditor({
  label,
  values,
  onChange,
  disabled,
  placeholder,
  hint,
  error,
  maxItems,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  hint?: string;
  error?: string;
  maxItems?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const full = maxItems !== undefined && values.length >= maxItems;

  const add = () => {
    const v = draft.trim();
    if (!v || values.includes(v) || full) return;
    onChange([...values, v]);
    setDraft('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  return (
    <fieldset className="min-w-0" aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-error` : ''].join(' ').trim() || undefined}>
      <legend className="mb-1 text-sm font-medium text-slate-800">{label}</legend>
      {values.length === 0 ? (
        <p className="text-sm italic text-slate-500">None</p>
      ) : (
        <ul className="space-y-1">
          {values.map((v, i) => (
            <li key={`${v}-${i}`} className="flex items-start justify-between gap-2 rounded-md bg-slate-50 px-2 py-1 text-sm">
              <span className="min-w-0 break-words text-slate-800">{v}</span>
              {disabled ? null : (
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-xs font-medium text-red-700 hover:bg-red-50"
                  onClick={() => onChange(values.filter((_, j) => j !== i))}
                  aria-label={`Remove "${v}" from ${label}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {disabled ? null : (
        <div className="mt-2 flex gap-2">
          <label htmlFor={`${id}-new`} className="sr-only">
            Add to {label}
          </label>
          <input
            id={`${id}-new`}
            className="block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm placeholder:text-slate-500"
            value={draft}
            placeholder={placeholder ?? 'Add an item'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={full}
          />
          <Button variant="secondary" onClick={add} disabled={!draft.trim() || full}>
            Add
          </Button>
        </div>
      )}
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
    </fieldset>
  );
}
