import { CAREER_TOPIC_LABELS, type ConversationUnderstanding } from '@careerconnect/shared';

export function UnderstandingView({ understanding }: { understanding: ConversationUnderstanding | null }) {
  if (!understanding) return <p className="text-sm text-slate-600">Not analysed yet.</p>;
  const u = understanding;
  return (
    <div className="space-y-3">
      {u.promptInjectionSuspected ? (
        <p role="note" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-950">
          Possible prompt-injection detected in this post. Treat AI output with extra care.
        </p>
      ) : null}
      {u.needsSensitiveHandling ? (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Needs sensitive handling.
        </p>
      ) : null}
      <dl className="space-y-2 text-sm">
        <Row label="Main question" value={u.mainQuestion} />
        <Row label="User goal" value={u.userGoal} />
        <Row label="Relevant context" value={u.relevantContext} />
        <Row label="Topic" value={CAREER_TOPIC_LABELS[u.topic]} />
        <Row label="Emotional tone" value={u.emotionalTone} />
        <Row label="Can produce a useful answer" value={u.canProduceUsefulAnswer ? 'Yes' : 'No'} />
        <Row label="Eligible for response" value={u.eligibleForResponse ? 'Yes' : 'No'} />
        <Row label="Reason" value={u.reason} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-600">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-slate-900">{value || '—'}</dd>
    </div>
  );
}
