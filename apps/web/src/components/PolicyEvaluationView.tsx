import type { PolicyEvaluation } from '@careerconnect/shared';
import { formatDate } from '@/lib/format';
import { OutcomeBadge, StatusBadge } from './ui';

export function PolicyEvaluationView({ policy }: { policy: PolicyEvaluation | null }) {
  if (!policy) return <p className="text-sm text-slate-600">No policy evaluation recorded yet.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-slate-800">Decision:</span>
        <StatusBadge value={policy.decision} />
        <span className="text-xs text-slate-600">
          Policy v{policy.policyVersion} · evaluated {formatDate(policy.evaluatedAt)}
        </span>
      </div>
      {policy.reasons.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-950">Reasons</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-950">
            {policy.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <ul className="divide-y divide-slate-200 rounded-md border border-slate-200" aria-label="Policy checks">
        {policy.checks.map((c) => (
          <li key={c.id} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-start sm:gap-3">
            <span className="w-20 shrink-0">
              <OutcomeBadge outcome={c.outcome} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-slate-900">{c.label}</span>
              <span className="block break-words text-xs text-slate-600">{c.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
