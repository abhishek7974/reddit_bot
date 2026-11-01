'use client';

import {
  CAREER_TOPICS,
  CAREER_TOPIC_LABELS,
  ELIGIBILITY_STATUSES,
  PROCESSING_STATUSES,
  type ConversationSummary,
  type Paginated,
  type SubredditPolicyDto,
} from '@careerconnect/shared';
import { useState, type FormEvent } from 'react';
import {
  Button,
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
  TextField,
  TextLink,
  Th,
  enumOptions,
} from '@/components/ui';
import { withQuery } from '@/lib/api';
import { formatDate, formatScore } from '@/lib/format';
import { useApi } from '@/lib/hooks';

interface Filters {
  community: string;
  topic: string;
  eligibilityStatus: string;
  processingStatus: string;
  search: string;
}

const EMPTY: Filters = { community: '', topic: '', eligibilityStatus: '', processingStatus: '', search: '' };
const PAGE_SIZE = 25;

export default function ConversationsPage() {
  const [form, setForm] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<Paginated<ConversationSummary>>(
    withQuery('/conversations', { ...applied, page, pageSize: PAGE_SIZE }),
  );
  const policies = useApi<SubredditPolicyDto[]>('/policies');

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setApplied({ ...form, community: form.community.replace(/^r\//i, '').trim(), search: form.search.trim() });
    setPage(1);
  };

  const reset = () => {
    setForm(EMPTY);
    setApplied(EMPTY);
    setPage(1);
  };

  const set = (key: keyof Filters) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <>
      <PageHeader
        title="Conversation explorer"
        description="Career discussions discovered in monitored communities. Post text is untrusted user content and is shown as plain text only."
      />

      <form onSubmit={apply} className="mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-label="Filter conversations">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <TextField label="Search" type="search" value={form.search} onChange={set('search')} placeholder="Title or excerpt" maxLength={200} />
          <TextField label="Community" value={form.community} onChange={set('community')} placeholder="e.g. cscareerquestions" list="community-options" maxLength={100} />
          <SelectField label="Topic" value={form.topic} onChange={set('topic')} options={enumOptions(CAREER_TOPICS, 'All topics', CAREER_TOPIC_LABELS)} />
          <SelectField label="Eligibility" value={form.eligibilityStatus} onChange={set('eligibilityStatus')} options={enumOptions(ELIGIBILITY_STATUSES, 'Any eligibility')} />
          <SelectField label="Processing status" value={form.processingStatus} onChange={set('processingStatus')} options={enumOptions(PROCESSING_STATUSES, 'Any status')} />
        </div>
        <datalist id="community-options">
          {policies.data?.map((p) => <option key={p.id} value={p.communityName} />)}
        </datalist>
        <div className="mt-3 flex gap-2">
          <Button type="submit">Apply filters</Button>
          <Button variant="secondary" onClick={reset}>
            Reset
          </Button>
        </div>
      </form>

      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        data.items.length === 0 ? (
          <EmptyState title="No conversations match these filters." />
        ) : (
          <>
            <div aria-busy={loading}>
              <Table caption="Conversations">
                <thead>
                  <tr>
                    <Th>Community</Th>
                    <Th>Conversation</Th>
                    <Th>Topic</Th>
                    <Th>Relevance</Th>
                    <Th>Eligibility</Th>
                    <Th>Processing</Th>
                    <Th>Source</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((c) => (
                    <tr key={c.id}>
                      <Td className="whitespace-nowrap">r/{c.communityName}</Td>
                      <Td className="min-w-[18rem] max-w-xl">
                        <TextLink href={`/conversations/${c.id}`}>{c.title || '(untitled)'}</TextLink>
                        <p className="mt-1 line-clamp-2 break-words text-xs text-slate-600">{c.excerpt}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Discovered {formatDate(c.discoveredAt)} · {c.draftCount} draft{c.draftCount === 1 ? '' : 's'}
                        </p>
                      </Td>
                      <Td className="whitespace-nowrap">{c.topic ? CAREER_TOPIC_LABELS[c.topic] : '—'}</Td>
                      <Td>{formatScore(c.relevanceScore)}</Td>
                      <Td>
                        <StatusBadge value={c.eligibilityStatus} />
                      </Td>
                      <Td>
                        <StatusBadge value={c.processingStatus} />
                      </Td>
                      <Td>
                        <DataSourceBadge source={c.dataSource} />
                      </Td>
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
