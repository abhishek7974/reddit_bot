'use client';

import { CAREER_TOPIC_LABELS, type MetricsResponse } from '@careerconnect/shared';
import { useState } from 'react';
import { BarChart } from '@/components/BarChart';
import { Card, EmptyState, ErrorState, Loading, PageHeader, SelectField, Table, Td, Th } from '@/components/ui';
import { withQuery } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { useApi } from '@/lib/hooks';

const WINDOWS = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
  { value: '365', label: 'Last 365 days' },
];

export default function AnalyticsPage() {
  const [days, setDays] = useState('30');
  const { data, error, loading, reload } = useApi<MetricsResponse>(withQuery('/metrics', { days }));

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Activity over time and where it happened. Engagement is only shown when real measurements exist — nothing is estimated."
        actions={<SelectField label="Time window" value={days} onChange={(e) => setDays(e.target.value)} options={WINDOWS} />}
      />
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? <Metrics data={data} /> : null}
    </>
  );
}

function Metrics({ data }: { data: MetricsResponse }) {
  const topicMax = Math.max(1, ...data.topicBreakdown.map((t) => t.count));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <BarChart title="Conversations discovered" points={data.series.conversationsDiscovered} color="#0369a1" />
        </Card>
        <Card>
          <BarChart title="Drafts generated" points={data.series.draftsGenerated} color="#4338ca" />
        </Card>
        <Card>
          <BarChart title="Replies published" points={data.series.repliesPublished} color="#047857" />
        </Card>
        <Card>
          <BarChart title="Quality rejections" points={data.series.qualityRejections} color="#b45309" />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Topics">
          {data.topicBreakdown.length === 0 ? (
            <EmptyState title="No topic data in this window." />
          ) : (
            <ul className="space-y-2">
              {[...data.topicBreakdown]
                .sort((a, b) => b.count - a.count)
                .map((t) => (
                  <li key={t.topic}>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-800">{CAREER_TOPIC_LABELS[t.topic]}</span>
                      <span className="font-semibold text-slate-900">{formatNumber(t.count)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-slate-100" aria-hidden="true">
                      <div className="h-2 rounded-full bg-indigo-600" style={{ width: `${(t.count / topicMax) * 100}%` }} />
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <Card title="Communities">
          {data.communityBreakdown.length === 0 ? (
            <EmptyState title="No community data in this window." />
          ) : (
            <Table caption="Conversations and published replies by community">
              <thead>
                <tr>
                  <Th>Community</Th>
                  <Th className="text-right">Conversations</Th>
                  <Th className="text-right">Published</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {[...data.communityBreakdown]
                  .sort((a, b) => b.count - a.count)
                  .map((c) => (
                    <tr key={c.communityName}>
                      <Td>r/{c.communityName}</Td>
                      <Td className="text-right">{formatNumber(c.count)}</Td>
                      <Td className="text-right">{formatNumber(c.published)}</Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card title="Engagement">
        {data.engagement.length === 0 ? (
          <EmptyState title="No engagement measurements recorded yet.">
            Engagement (upvotes, replies, clicks) appears here only once real measurements are recorded. We never estimate or simulate these numbers.
          </EmptyState>
        ) : (
          <Table caption="Recorded engagement metrics">
            <thead>
              <tr>
                <Th>Metric</Th>
                <Th className="text-right">Total</Th>
                <Th>Attribution method</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.engagement.map((m) => (
                <tr key={m.metricName}>
                  <Td>{m.metricName}</Td>
                  <Td className="text-right">{formatNumber(m.total)}</Td>
                  <Td>{m.attributionMethod}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
