'use client';

import { DRAFT_PUBLISH_STATUSES, REVIEW_STATUSES, type DraftSummary, type Paginated } from '@careerconnect/shared';
import { useState } from 'react';
import {
  DataSourceBadge,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Pagination,
  SelectField,
  StatusBadge,
  Table,
  Td,
  TextLink,
  Th,
  enumOptions,
} from '@/components/ui';
import { withQuery } from '@/lib/api';
import { formatDate, formatScore } from '@/lib/format';
import { useApi } from '@/lib/hooks';

const PAGE_SIZE = 25;

export default function DraftsPage() {
  const [reviewStatus, setReviewStatus] = useState<string>('PENDING_REVIEW');
  const [publishStatus, setPublishStatus] = useState<string>('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<Paginated<DraftSummary>>(
    withQuery('/drafts', { reviewStatus, publishStatus, page, pageSize: PAGE_SIZE }),
  );

  return (
    <>
      <PageHeader
        title="Review queue"
        description="Every AI draft is reviewed by a human before anything can be published. Publishing additionally requires the policy engine to allow it."
      />
      <div className="mb-4 grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2" role="group" aria-label="Filter drafts">
        <SelectField
          label="Review status"
          value={reviewStatus}
          onChange={(e) => {
            setReviewStatus(e.target.value);
            setPage(1);
          }}
          options={enumOptions(REVIEW_STATUSES, 'Any review status')}
        />
        <SelectField
          label="Publish status"
          value={publishStatus}
          onChange={(e) => {
            setPublishStatus(e.target.value);
            setPage(1);
          }}
          options={enumOptions(DRAFT_PUBLISH_STATUSES, 'Any publish status')}
        />
      </div>

      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        data.items.length === 0 ? (
          <EmptyState title="No drafts match these filters." />
        ) : (
          <>
            <div aria-busy={loading}>
              <Table caption="Drafts">
                <thead>
                  <tr>
                    <Th>Conversation</Th>
                    <Th>Source</Th>
                    <Th>Quality</Th>
                    <Th>Review</Th>
                    <Th>Publish</Th>
                    <Th>Policy</Th>
                    <Th>Disclosure</Th>
                    <Th>Updated</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((d) => (
                    <tr key={d.id}>
                      <Td className="min-w-[18rem] max-w-xl">
                        <TextLink href={`/drafts/${d.id}`}>{d.conversationTitle || '(untitled)'}</TextLink>
                        <p className="text-xs text-slate-600">r/{d.communityName}</p>
                        <p className="mt-1 line-clamp-2 break-words text-xs text-slate-600">{d.body}</p>
                      </Td>
                      <Td>
                        <DataSourceBadge source={d.dataSource} />
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
                      <Td>
                        <StatusBadge value={d.disclosureStatus} />
                      </Td>
                      <Td className="whitespace-nowrap">{formatDate(d.updatedAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </>
        )
      ) : null}
    </>
  );
}
