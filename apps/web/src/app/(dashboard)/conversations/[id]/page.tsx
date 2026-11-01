'use client';

import { CAREER_TOPIC_LABELS, type ConversationDetail, type DraftDetail } from '@careerconnect/shared';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/Dialog';
import { UnderstandingView } from '@/components/UnderstandingView';
import {
  ActionResult,
  Badge,
  Button,
  Card,
  DataSourceBadge,
  EmptyState,
  ErrorState,
  ExternalLink,
  Loading,
  PageHeader,
  PlainText,
  StatusBadge,
  Table,
  Td,
  TextLink,
  Th,
} from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate, formatScore, safeRedditUrl } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

export default function ConversationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { hasRole } = useSession();
  const { data, error, loading, reload } = useApi<ConversationDetail>(id ? `/conversations/${encodeURIComponent(id)}` : null);
  const action = useAction();
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [newDraftId, setNewDraftId] = useState<string | null>(null);

  const generate = async () => {
    setNewDraftId(null);
    const draft = await action.run(
      () => api.post<DraftDetail>(`/conversations/${encodeURIComponent(id)}/generate-draft`),
      'Draft generated. It is waiting for human review.',
    );
    if (draft) {
      setNewDraftId(draft.id);
      reload();
    }
  };

  const purge = async () => {
    const res = await action.run(
      () => api.post<{ purged: true }>(`/conversations/${encodeURIComponent(id)}/purge`),
      'Conversation content purged.',
    );
    setPurgeOpen(false);
    if (res) reload();
  };

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const permalink = safeRedditUrl(data.context.permalink);
  const purged = data.processingStatus === 'PURGED';

  return (
    <>
      <p className="mb-2 text-sm">
        <TextLink href="/conversations">← Back to conversations</TextLink>
      </p>
      <PageHeader
        title={data.context.title || data.title || '(untitled)'}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>r/{data.communityName}</span>
            <DataSourceBadge source={data.dataSource} />
            <StatusBadge value={data.eligibilityStatus} label="Eligibility" />
            <StatusBadge value={data.processingStatus} label="Status" />
            {data.topic ? <Badge tone="indigo">{CAREER_TOPIC_LABELS[data.topic]}</Badge> : null}
          </span>
        }
        actions={
          <>
            {hasRole('REVIEWER') ? (
              <Button onClick={() => void generate()} disabled={action.pending || purged}>
                {action.pending ? 'Working…' : 'Generate draft'}
              </Button>
            ) : null}
            {hasRole('ADMIN') ? (
              <Button variant="danger" onClick={() => setPurgeOpen(true)} disabled={action.pending || purged}>
                Purge content
              </Button>
            ) : null}
          </>
        }
      />
      <ActionResult message={action.message} />
      {newDraftId ? (
        <p className="mt-2 text-sm">
          <TextLink href={`/drafts/${newDraftId}`}>Open the new draft for review →</TextLink>
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Context">
          <dl className="mb-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div>
              <dt>Relevance score</dt>
              <dd className="font-medium text-slate-900">{formatScore(data.relevanceScore)}</dd>
            </div>
            <div>
              <dt>Discovered</dt>
              <dd className="font-medium text-slate-900">{formatDate(data.discoveredAt)}</dd>
            </div>
            <div>
              <dt>Processed</dt>
              <dd className="font-medium text-slate-900">{formatDate(data.processedAt)}</dd>
            </div>
            <div>
              <dt>Content retained until</dt>
              <dd className="font-medium text-slate-900">{formatDate(data.retentionExpiresAt)}</dd>
            </div>
          </dl>
          <h3 className="text-sm font-semibold text-slate-900">Post excerpt</h3>
          <PlainText text={data.context.excerpt} className="mt-1 rounded-md bg-slate-50 p-3" />
          {data.context.topComments.length > 0 ? (
            <>
              <h3 className="mt-4 text-sm font-semibold text-slate-900">Top comments</h3>
              <ul className="mt-1 space-y-2">
                {data.context.topComments.map((c, i) => (
                  <li key={i}>
                    <PlainText text={c} className="rounded-md bg-slate-50 p-2" />
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="mt-4 text-sm">
            {permalink ? (
              <ExternalLink href={permalink}>View original post on Reddit</ExternalLink>
            ) : data.context.permalink ? (
              <span className="break-all text-slate-600">Permalink (not a Reddit URL, not linked): {data.context.permalink}</span>
            ) : (
              <span className="text-slate-600">{data.dataSource === 'SYNTHETIC' ? 'Synthetic conversation — no Reddit permalink.' : 'No permalink available.'}</span>
            )}
          </p>
        </Card>

        <Card title="AI understanding">
          <UnderstandingView understanding={data.understanding} />
        </Card>
      </div>

      <Card title={`Drafts (${data.drafts.length})`} className="mt-4">
        {data.drafts.length === 0 ? (
          <EmptyState title="No drafts yet.">{hasRole('REVIEWER') ? 'Use “Generate draft” to create one for review.' : null}</EmptyState>
        ) : (
          <Table caption="Drafts for this conversation">
            <thead>
              <tr>
                <Th>Draft</Th>
                <Th>Quality</Th>
                <Th>Review</Th>
                <Th>Publish</Th>
                <Th>Policy</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.drafts.map((d) => (
                <tr key={d.id}>
                  <Td className="min-w-[16rem] max-w-md">
                    <TextLink href={`/drafts/${d.id}`}>Review draft</TextLink>
                    <p className="mt-1 line-clamp-2 break-words text-xs text-slate-600">{d.body}</p>
                  </Td>
                  <Td>{formatScore(d.qualityScore)}</Td>
                  <Td>
                    <StatusBadge value={d.reviewStatus} />
                  </Td>
                  <Td>
                    <StatusBadge value={d.publishStatus} />
                  </Td>
                  <Td>
                    <StatusBadge value={d.policyDecision} />
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(d.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title="Purge conversation content?"
        description="This permanently deletes the stored post text, comments and AI analysis for this conversation. Audit records are kept. This cannot be undone."
        confirmLabel="Purge content"
        danger
        pending={action.pending}
        onConfirm={purge}
      />
    </>
  );
}
