'use client';

import type { AuditEventDto, Paginated } from '@careerconnect/shared';
import { useState, type FormEvent } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Pagination,
  Table,
  Td,
  TextField,
  Th,
} from '@/components/ui';
import { withQuery } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';

const PAGE_SIZE = 50;

export default function AuditPage() {
  const { hasRole } = useSession();
  const isAdmin = hasRole('ADMIN');
  const [entityType, setEntityType] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [applied, setApplied] = useState({ entityType: '', action: '' });
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi<Paginated<AuditEventDto>>(
    isAdmin ? withQuery('/audit', { ...applied, page, pageSize: PAGE_SIZE }) : null,
  );

  const apply = (e: FormEvent) => {
    e.preventDefault();
    setApplied({ entityType: entityType.trim(), action: actionFilter.trim() });
    setPage(1);
  };

  return (
    <>
      <PageHeader title="Audit log" description="Every human and system decision: approvals, rejections, publish attempts, policy and configuration changes." />
      {!isAdmin ? (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Insufficient role</p>
          <p className="mt-1">The audit log is available to administrators only.</p>
        </div>
      ) : (
        <>
          <form onSubmit={apply} className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-label="Filter audit events">
            <TextField label="Entity type" value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="e.g. Draft" maxLength={50} />
            <TextField label="Action" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} placeholder="e.g. draft.approve" maxLength={100} />
            <Button type="submit">Apply</Button>
            <Button
              variant="secondary"
              onClick={() => {
                setEntityType('');
                setActionFilter('');
                setApplied({ entityType: '', action: '' });
                setPage(1);
              }}
            >
              Reset
            </Button>
          </form>
          {error ? <ErrorState error={error} onRetry={reload} /> : null}
          {loading && !data ? <Loading /> : null}
          {data ? (
            data.items.length === 0 ? (
              <EmptyState title="No audit events match these filters." />
            ) : (
              <>
                <div aria-busy={loading}>
                  <Table caption="Audit events">
                    <thead>
                      <tr>
                        <Th>When</Th>
                        <Th>Actor</Th>
                        <Th>Action</Th>
                        <Th>Entity</Th>
                        <Th>Reason</Th>
                        <Th>Policy</Th>
                        <Th>Details</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.items.map((ev) => (
                        <tr key={ev.id}>
                          <Td className="whitespace-nowrap">{formatDate(ev.createdAt)}</Td>
                          <Td className="whitespace-nowrap">{ev.actorEmail ?? (ev.actorId ? ev.actorId : 'system')}</Td>
                          <Td className="font-mono text-xs">{ev.action}</Td>
                          <Td>
                            {ev.entityType}
                            {ev.entityId ? <span className="block break-all font-mono text-xs text-slate-600">{ev.entityId}</span> : null}
                          </Td>
                          <Td className="max-w-xs whitespace-pre-wrap break-words">{ev.reason ?? '—'}</Td>
                          <Td>{ev.policyVersion ?? '—'}</Td>
                          <Td>
                            {ev.metadata === null || ev.metadata === undefined ? (
                              '—'
                            ) : (
                              <details>
                                <summary className="cursor-pointer text-indigo-700">View</summary>
                                <pre className="mt-1 max-h-60 max-w-md overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-xs">
                                  {JSON.stringify(ev.metadata, null, 2)}
                                </pre>
                              </details>
                            )}
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
      )}
    </>
  );
}
