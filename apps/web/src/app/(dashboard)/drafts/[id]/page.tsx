'use client';

import type { DetectorFinding, DraftDetail, PublishResponse, QualityAssessment } from '@careerconnect/shared';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/Dialog';
import { PolicyEvaluationView } from '@/components/PolicyEvaluationView';
import { UnderstandingView } from '@/components/UnderstandingView';
import {
  ActionResult,
  Badge,
  Button,
  Card,
  DataSourceBadge,
  ErrorState,
  ExternalLink,
  Loading,
  PageHeader,
  PlainText,
  StatusBadge,
  Table,
  Td,
  TextAreaField,
  TextField,
  TextLink,
  Th,
  type Tone,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatScore, humanize, safeRedditUrl } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

const MAX_BODY = 5000;

export default function DraftReviewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { data, error, loading, reload, setData } = useApi<DraftDetail>(id ? `/drafts/${encodeURIComponent(id)}` : null);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  return <DraftReview draft={data} onUpdated={setData} reload={reload} />;
}

function DraftReview({ draft, onUpdated, reload }: { draft: DraftDetail; onUpdated: (d: DraftDetail) => void; reload: () => void }) {
  const { hasRole } = useSession();
  const canReview = hasRole('REVIEWER');
  const canPublish = hasRole('ADMIN');
  const action = useAction();

  const [body, setBody] = useState(draft.body);
  const [note, setNote] = useState('');
  const [rejectKind, setRejectKind] = useState<'reject' | 'skip' | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResponse | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  // Reset the editor when the server copy changes (after approve / reload).
  useEffect(() => setBody(draft.body), [draft.body]);

  const edited = body.trim() !== draft.body.trim();
  const bodyError = body.trim().length === 0 ? 'Reply cannot be empty.' : body.length > MAX_BODY ? `Maximum ${MAX_BODY} characters.` : undefined;
  const base = `/drafts/${encodeURIComponent(draft.id)}`;
  const permalink = safeRedditUrl(draft.conversation.permalink);

  const approve = async () => {
    if (bodyError) return;
    const payload: { body?: string; note?: string } = {};
    if (edited) payload.body = body.trim();
    if (note.trim()) payload.note = note.trim();
    const res = await action.run(
      () => api.post<DraftDetail>(`${base}/approve`, payload),
      edited ? 'Approved with your edits. Detectors and the policy engine were re-run.' : 'Draft approved.',
    );
    if (res) {
      onUpdated(res);
      setNote('');
    }
  };

  const reject = async (reason: string) => {
    const kind = rejectKind ?? 'reject';
    const res = await action.run(
      () => api.post<DraftDetail>(`${base}/reject`, { reason, kind }),
      kind === 'skip' ? 'Conversation skipped.' : 'Draft rejected.',
    );
    if (res) {
      onUpdated(res);
      setRejectKind(null);
    }
  };

  const openPublish = () => {
    // One key per publish intent: retries of the same intent reuse it so the API can de-duplicate.
    idempotencyKey.current ??= crypto.randomUUID();
    setPublishResult(null);
    setPublishOpen(true);
  };

  const publish = async () => {
    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;
    const res = await action.run(() => api.post<PublishResponse>(`${base}/publish`, undefined, { headers: { 'Idempotency-Key': key } }));
    setPublishOpen(false);
    if (res) {
      idempotencyKey.current = null;
      setPublishResult(res);
      action.setMessage({
        tone: res.queued ? 'success' : 'info',
        text: res.queued ? `Publication queued. ${res.message}` : `Publication blocked by policy (this is a normal outcome). ${res.message}`,
      });
      reload();
    }
  };

  return (
    <>
      <p className="mb-2 text-sm">
        <TextLink href="/drafts">← Back to review queue</TextLink>
      </p>
      <PageHeader
        title="Reply review"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>r/{draft.communityName}</span>
            <DataSourceBadge source={draft.dataSource} />
            <StatusBadge value={draft.reviewStatus} label="Review" />
            <StatusBadge value={draft.publishStatus} label="Publish" />
            <StatusBadge value={draft.policyDecision} label="Policy" />
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card title="Original question & context">
            <h3 className="text-sm font-semibold text-slate-900">{draft.conversation.title || draft.conversationTitle}</h3>
            <PlainText text={draft.conversation.excerpt} className="mt-2 rounded-md bg-slate-50 p-3" />
            <p className="mt-2 text-sm">
              {permalink ? <ExternalLink href={permalink}>View original post on Reddit</ExternalLink> : null}{' '}
              <TextLink href={`/conversations/${draft.conversation.id}`}>Conversation details</TextLink>
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-indigo-700">AI understanding of the question</summary>
              <div className="mt-2">
                <UnderstandingView understanding={draft.conversation.understanding} />
              </div>
            </details>
          </Card>

          <Card title="Proposed reply">
            <TextAreaField
              label="Reply body"
              rows={12}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              readOnly={!canReview}
              error={bodyError}
              hint={
                <>
                  {body.length.toLocaleString()} / {MAX_BODY.toLocaleString()} characters
                  {edited ? ' · edited — approving will save your version and re-run all checks' : ''}
                  {!canReview ? ' · read-only for your role' : ''}
                </>
              }
            />
            {edited ? (
              <Button variant="ghost" className="mt-2" onClick={() => setBody(draft.body)}>
                Discard my edits
              </Button>
            ) : null}
            {draft.originalBody !== draft.body ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-indigo-700">Original AI draft (before human edits)</summary>
                <PlainText text={draft.originalBody} className="mt-2 rounded-md bg-slate-50 p-3" />
              </details>
            ) : null}
            <p className="mt-3 text-xs text-slate-600">
              Model: {draft.model ?? '—'} · Created {formatDate(draft.createdAt)} · Updated {formatDate(draft.updatedAt)}
            </p>
          </Card>

          <Card title="Publish preview" actions={<StatusBadge value={draft.disclosureStatus} label="Disclosure" />}>
            <p className="mb-2 text-xs text-slate-600">Exactly what would be posted, including the disclosure footer.</p>
            {draft.publishPreview ? (
              <PlainText text={draft.publishPreview} className="rounded-md border border-slate-200 bg-slate-50 p-3" />
            ) : (
              <p className="text-sm text-slate-600">No preview available.</p>
            )}
          </Card>

          <Card title="Quality assessment">
            <QualityView quality={draft.quality} />
            <dl className="mt-4 space-y-2 text-sm">
              <AssessmentRow label="Brand relevance" value={draft.brandRelevance === null ? '—' : formatScore(draft.brandRelevance)} />
              <AssessmentRow label="Tone" value={draft.toneAssessment} />
              <AssessmentRow label="Factuality" value={draft.factualityAssessment} />
              <AssessmentRow label="Promotional content" value={draft.promotionalAssessment} />
            </dl>
          </Card>

          <Card title={`Detector findings (${draft.detectorFindings.length})`}>
            <FindingsView findings={draft.detectorFindings} />
          </Card>

          <Card title="Policy evaluation">
            <PolicyEvaluationView policy={draft.policy} />
          </Card>

          <Card title="Publish attempts">
            {draft.publishAttempts.length === 0 ? (
              <p className="text-sm text-slate-600">No publish attempts yet.</p>
            ) : (
              <Table caption="Publish attempts">
                <thead>
                  <tr>
                    <Th>Attempted</Th>
                    <Th>Status</Th>
                    <Th>Decision</Th>
                    <Th>Result</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {draft.publishAttempts.map((a) => (
                    <tr key={a.id}>
                      <Td className="whitespace-nowrap">
                        {formatDate(a.attemptedAt)}
                        {a.completedAt ? <span className="block text-xs text-slate-600">done {formatDate(a.completedAt)}</span> : null}
                      </Td>
                      <Td>
                        <span className="flex flex-wrap gap-1">
                          <StatusBadge value={a.status} />
                          {a.simulated ? <Badge tone="purple">Simulated</Badge> : null}
                        </span>
                      </Td>
                      <Td>
                        <StatusBadge value={a.authorizationDecision} />
                      </Td>
                      <Td className="max-w-sm break-words text-xs">
                        {a.externalCommentId ? <span className="block">Comment id: {a.externalCommentId}</span> : null}
                        {a.errorCategory ? <span className="block font-medium">{humanize(a.errorCategory)}</span> : null}
                        {a.errorMessage ? <span className="block text-slate-700">{a.errorMessage}</span> : null}
                        {!a.externalCommentId && !a.errorCategory && !a.errorMessage ? '—' : null}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start" aria-label="Review decision">
          <Card title="Decision">
            {draft.reviewedAt ? (
              <div className="mb-3 rounded-md bg-slate-50 p-2 text-xs text-slate-700">
                Last reviewed {formatDate(draft.reviewedAt)}
                {draft.reviewedBy ? ` by ${draft.reviewedBy}` : ''}
                {draft.reviewNote ? <span className="mt-1 block whitespace-pre-wrap">Note: {draft.reviewNote}</span> : null}
              </div>
            ) : null}
            {canReview ? (
              <div className="space-y-3">
                <TextField label="Review note (optional)" value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
                <Button className="w-full" onClick={() => void approve()} disabled={action.pending || Boolean(bodyError)}>
                  {edited ? 'Approve with edits' : 'Approve'}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setRejectKind('reject')} disabled={action.pending}>
                    Reject
                  </Button>
                  <Button variant="secondary" onClick={() => setRejectKind('skip')} disabled={action.pending}>
                    Skip
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-600">Your role can view drafts but not review them.</p>
            )}

            {canPublish ? (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={openPublish}
                  disabled={action.pending || draft.reviewStatus !== 'APPROVED' || draft.publishStatus === 'PUBLISHED' || draft.publishStatus === 'QUEUED'}
                >
                  Publish…
                </Button>
                <p className="mt-2 text-xs text-slate-600">
                  {draft.reviewStatus !== 'APPROVED'
                    ? 'Approve the draft before publishing.'
                    : 'The policy engine is re-evaluated at publish time. Publication only happens if every check passes.'}
                </p>
              </div>
            ) : null}
            <ActionResult message={action.message} />
          </Card>

          {publishResult ? (
            <Card title={publishResult.queued ? 'Publication queued' : 'Publication blocked'}>
              <p className="mb-3 text-sm text-slate-800">{publishResult.message}</p>
              {!publishResult.queued ? (
                <p className="mb-3 text-xs text-slate-600">
                  Blocking is the system working as designed: nothing is posted unless authorization, community policy, quality and the kill
                  switch all allow it.
                </p>
              ) : null}
              <PolicyEvaluationView policy={publishResult.policy} />
            </Card>
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        open={rejectKind !== null}
        onOpenChange={(o) => !o && setRejectKind(null)}
        title={rejectKind === 'skip' ? 'Skip this conversation?' : 'Reject this draft?'}
        description={
          rejectKind === 'skip'
            ? 'Marks the conversation as not worth answering. No reply will be published.'
            : 'Marks this draft as unsuitable. It will not be published.'
        }
        confirmLabel={rejectKind === 'skip' ? 'Skip conversation' : 'Reject draft'}
        danger={rejectKind === 'reject'}
        requireReason
        minReasonLength={1}
        pending={action.pending}
        onConfirm={reject}
      />

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title="Publish this reply?"
        description="The policy engine will re-check platform authorization, community rules, quality, disclosure and the global kill switch. If anything fails, publication is blocked and nothing is sent."
        confirmLabel="Request publication"
        pending={action.pending}
        onConfirm={publish}
      >
        <PlainText text={draft.publishPreview ?? draft.body} className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3" />
      </ConfirmDialog>
    </>
  );
}

const SCORES: { key: keyof QualityAssessment; label: string; inverted?: boolean }[] = [
  { key: 'relevance', label: 'Relevance' },
  { key: 'factualSupport', label: 'Factual support' },
  { key: 'specificity', label: 'Specificity' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'tone', label: 'Tone' },
  { key: 'repetitionRisk', label: 'Repetition risk (lower is better)', inverted: true },
];

const FLAGS: { key: keyof QualityAssessment; label: string }[] = [
  { key: 'promotionalContent', label: 'Promotional content' },
  { key: 'privacyRisk', label: 'Privacy risk' },
  { key: 'unsupportedPersonalExperience', label: 'Unsupported personal experience' },
  { key: 'potentiallyHarmfulAdvice', label: 'Potentially harmful advice' },
];

function QualityView({ quality }: { quality: QualityAssessment | null }) {
  if (!quality) return <p className="text-sm text-slate-600">No quality assessment recorded.</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Overall {formatScore(quality.overallScore)}</span>
        <Badge tone={quality.passed ? 'green' : 'red'}>{quality.passed ? 'Passed quality gate' : 'Failed quality gate'}</Badge>
      </div>
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SCORES.map(({ key, label, inverted }) => {
          const v = quality[key] as number;
          const bad = inverted ? v > 0.5 : v < 0.5;
          return (
            <div key={key}>
              <dt className="flex justify-between text-xs text-slate-700">
                <span>{label}</span>
                <span className="font-semibold text-slate-900">{formatScore(v)}</span>
              </dt>
              <dd className="mt-1 h-2 rounded-full bg-slate-200" aria-hidden="true">
                <div className={`h-2 rounded-full ${bad ? 'bg-amber-500' : 'bg-emerald-600'}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, v)) * 100)}%` }} />
              </dd>
            </div>
          );
        })}
      </dl>
      <ul className="flex flex-wrap gap-2" aria-label="Risk flags">
        {FLAGS.map(({ key, label }) => {
          const on = quality[key] as boolean;
          return (
            <li key={key}>
              <Badge tone={on ? 'red' : 'green'}>
                {label}: {on ? 'Yes' : 'No'}
              </Badge>
            </li>
          );
        })}
      </ul>
      {quality.notes.length > 0 ? (
        <ul className="list-disc pl-5 text-sm text-slate-800">
          {quality.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const SEVERITY_TONE: Record<DetectorFinding['severity'], Tone> = { block: 'red', review: 'amber', info: 'gray' };

function FindingsView({ findings }: { findings: DetectorFinding[] }) {
  if (findings.length === 0) return <p className="text-sm text-slate-600">No detector findings.</p>;
  return (
    <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
      {findings.map((f, i) => (
        <li key={i} className="px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity.toUpperCase()}</Badge>
            <span className="text-sm font-medium text-slate-900">{humanize(f.detector)}</span>
          </div>
          <p className="mt-1 text-sm text-slate-800">{f.message}</p>
          {f.excerpt ? <p className="mt-1 whitespace-pre-wrap break-words rounded bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700">{f.excerpt}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function AssessmentRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-600">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-slate-900">{value ?? '—'}</dd>
    </div>
  );
}
