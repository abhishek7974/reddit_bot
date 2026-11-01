'use client';

import type { DashboardSummary } from '@careerconnect/shared';
import { Card, DataSourceBadge, ErrorState, Loading, PageHeader, StatTile, StatusBadge } from '@/components/ui';
import { formatDate, formatNumber, formatPercent, formatUsd } from '@/lib/format';
import { useApi } from '@/lib/hooks';

export default function OverviewPage() {
  const { data, error, loading, reload } = useApi<DashboardSummary>('/dashboard/summary');

  return (
    <>
      <PageHeader title="Overview" description="What the assistant has discovered, drafted and published — and whether publishing is currently possible." />
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? <Summary data={data} /> : null}
    </>
  );
}

function Summary({ data }: { data: DashboardSummary }) {
  const { cost, publishing } = data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <span>Data sources:</span>
        {data.dataSources.length === 0 ? <span>none yet</span> : data.dataSources.map((s) => <DataSourceBadge key={s} source={s} />)}
      </div>

      <section aria-labelledby="pipeline-heading">
        <h2 id="pipeline-heading" className="mb-3 text-base font-semibold text-slate-900">
          Pipeline
        </h2>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Conversations discovered" value={formatNumber(data.conversationsDiscovered)} />
          <StatTile label="Relevant conversations" value={formatNumber(data.relevantConversations)} />
          <StatTile label="Drafts generated" value={formatNumber(data.draftsGenerated)} />
          <StatTile label="Awaiting review" value={formatNumber(data.draftsAwaitingReview)} tone={data.draftsAwaitingReview > 0 ? 'warn' : undefined} />
          <StatTile
            label="Replies published"
            value={formatNumber(data.repliesPublished)}
            hint="Real comments posted to Reddit"
          />
          <StatTile
            label="Simulated publications"
            value={formatNumber(data.simulatedPublications)}
            hint="Demo / dry-run only — nothing was sent"
          />
          <StatTile
            label="Quality rejection rate"
            value={data.qualityRejectionRate === null ? 'No data' : formatPercent(data.qualityRejectionRate, 1)}
            hint={data.qualityRejectionRate === null ? 'No drafts assessed yet' : 'Share of drafts failing quality checks'}
          />
          <StatTile label="Negative feedback" value={formatNumber(data.negativeFeedback)} tone={data.negativeFeedback > 0 ? 'warn' : undefined} />
          <StatTile label="Policy incidents" value={formatNumber(data.policyIncidents)} tone={data.policyIncidents > 0 ? 'bad' : undefined} />
          <StatTile
            label={`LLM cost (last ${cost.windowDays} days)`}
            value={
              !cost.configured ? (
                <span className="text-base text-slate-700">Pricing not configured</span>
              ) : cost.estimatedUsd === null ? (
                <span className="text-base text-slate-700">No estimate available</span>
              ) : (
                formatUsd(cost.estimatedUsd)
              )
            }
            hint={`${formatNumber(cost.inputTokens)} input · ${formatNumber(cost.outputTokens)} output tokens`}
          />
        </dl>
      </section>

      <Card title="Publishing status">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-600">Mode</dt>
            <dd className="mt-1 font-semibold text-slate-900">{publishing.mode}</dd>
          </div>
          <div>
            <dt className="text-slate-600">Global kill switch</dt>
            <dd className="mt-1">
              {publishing.globalPause ? <StatusBadge value="BLOCKED" label="Paused" /> : <span className="font-semibold text-slate-900">Not paused</span>}
            </dd>
          </div>
          {publishing.globalPause ? (
            <div>
              <dt className="text-slate-600">Paused</dt>
              <dd className="mt-1 text-slate-900">
                {formatDate(publishing.pausedAt)}
                {publishing.pausedBy ? ` by ${publishing.pausedBy}` : ''}
                {publishing.pauseReason ? <span className="block text-slate-700">Reason: {publishing.pauseReason}</span> : null}
              </dd>
            </div>
          ) : null}
        </dl>
        {publishing.blockedReasons.length > 0 ? (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <p className="font-semibold">Publishing is not possible right now because:</p>
            <ul className="mt-1 list-disc pl-5">
              {publishing.blockedReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-700">No configuration blockers. Each reply is still evaluated by the policy engine before publishing.</p>
        )}
      </Card>
    </div>
  );
}
