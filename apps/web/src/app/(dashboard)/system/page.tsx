'use client';

import {
  AUTHORIZATION_STATUSES,
  updatePlatformAuthorizationBody,
  type AuthorizationStatus,
  type PlatformAuthorizationDto,
  type PublishingStateDto,
  type SystemHealth,
} from '@careerconnect/shared';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ConfirmDialog, Modal } from '@/components/Dialog';
import {
  ActionResult,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  SelectField,
  StatusBadge,
  Table,
  Td,
  TextAreaField,
  TextField,
  Th,
  enumOptions,
} from '@/components/ui';
import { api } from '@/lib/api';
import { changedFields } from '@/lib/diff';
import { formatDate, formatNumber } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { fieldErrors } from '@/lib/validation';

export default function SystemPage() {
  const health = useApi<SystemHealth>('/system/health');

  return (
    <>
      <PageHeader
        title="System health"
        description="Infrastructure status, background queues, platform authorization and the global publishing kill switch."
        actions={
          <Button variant="secondary" onClick={health.reload} disabled={health.loading}>
            Refresh
          </Button>
        }
      />
      <div className="space-y-6">
        <KillSwitchPanel />
        <PlatformAuthorizationPanel />
        {health.error ? <ErrorState error={health.error} onRetry={health.reload} /> : null}
        {health.loading && !health.data ? <Loading /> : null}
        {health.data ? <HealthView health={health.data} /> : null}
      </div>
    </>
  );
}

function Indicator({ ok, label }: { ok: boolean | null; label?: string }) {
  if (ok === null) return <Badge tone="gray">{label ?? 'Unknown'}</Badge>;
  return <Badge tone={ok ? 'green' : 'red'}>{label ?? (ok ? 'OK' : 'Down')}</Badge>;
}

function ServiceCard({ title, status, children }: { title: string; status: ReactNode; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {status}
      </div>
      <div className="mt-2 space-y-1 text-xs text-slate-700">{children}</div>
    </div>
  );
}

function HealthView({ health }: { health: SystemHealth }) {
  const { database, redis, reddit, llm } = health;
  return (
    <>
      <Card title="Services" actions={<Badge tone={health.status === 'ok' ? 'green' : 'amber'}>{health.status === 'ok' ? 'All systems OK' : 'Degraded'}</Badge>}>
        <p className="mb-3 text-xs text-slate-600">
          Mode <span className="font-semibold text-slate-900">{health.mode}</span> · version {health.version}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <ServiceCard title="Database" status={<Indicator ok={database.ok} />}>
            <p>Latency: {database.latencyMs === null ? '—' : `${database.latencyMs} ms`}</p>
            {database.error ? <p className="break-words text-red-800">{database.error}</p> : null}
          </ServiceCard>
          <ServiceCard title="Redis" status={<Indicator ok={redis.ok} />}>
            <p>Latency: {redis.latencyMs === null ? '—' : `${redis.latencyMs} ms`}</p>
            {redis.error ? <p className="break-words text-red-800">{redis.error}</p> : null}
          </ServiceCard>
          <ServiceCard
            title="Reddit"
            status={<Indicator ok={reddit.configured ? reddit.lastCheckOk : null} label={reddit.configured ? undefined : 'Not configured'} />}
          >
            <p>Client mode: {reddit.mode}</p>
            <p className="break-words">{reddit.detail}</p>
          </ServiceCard>
          <ServiceCard title="LLM" status={<Indicator ok={llm.configured} label={llm.configured ? 'Configured' : 'Not configured'} />}>
            <p>Provider: {llm.provider}</p>
            {Object.entries(llm.models).map(([purpose, model]) => (
              <p key={purpose}>
                {purpose}: {model}
              </p>
            ))}
          </ServiceCard>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-slate-600">LLM calls (24h)</dt>
            <dd className="font-semibold">{formatNumber(health.tokenUsage.last24h.calls)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Input tokens (24h)</dt>
            <dd className="font-semibold">{formatNumber(health.tokenUsage.last24h.inputTokens)}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Output tokens (24h)</dt>
            <dd className="font-semibold">{formatNumber(health.tokenUsage.last24h.outputTokens)}</dd>
          </div>
        </dl>
      </Card>

      <Card title="Queues">
        {health.queues.length === 0 ? (
          <EmptyState title="No queues reported." />
        ) : (
          <Table caption="Background job queues">
            <thead>
              <tr>
                <Th>Queue</Th>
                <Th className="text-right">Waiting</Th>
                <Th className="text-right">Active</Th>
                <Th className="text-right">Delayed</Th>
                <Th className="text-right">Failed</Th>
                <Th className="text-right">Completed</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {health.queues.map((q) => (
                <tr key={q.name}>
                  <Td className="font-medium">{q.name}</Td>
                  <Td className="text-right">{formatNumber(q.waiting)}</Td>
                  <Td className="text-right">{formatNumber(q.active)}</Td>
                  <Td className="text-right">{formatNumber(q.delayed)}</Td>
                  <Td className={q.failed > 0 ? 'text-right font-semibold text-red-800' : 'text-right'}>{formatNumber(q.failed)}</Td>
                  <Td className="text-right">{formatNumber(q.completed)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card title="Failed jobs">
        {health.failedJobs.length === 0 ? (
          <EmptyState title="No failed jobs." />
        ) : (
          <Table caption="Recently failed jobs">
            <thead>
              <tr>
                <Th>Queue</Th>
                <Th>Job</Th>
                <Th>Reason</Th>
                <Th>Finished</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {health.failedJobs.map((j) => (
                <tr key={`${j.queue}-${j.id}`}>
                  <Td>{j.queue}</Td>
                  <Td>
                    {j.name} <span className="text-xs text-slate-600">#{j.id}</span>
                  </Td>
                  <Td className="max-w-md break-words text-xs">{j.failedReason}</Td>
                  <Td className="whitespace-nowrap">{formatDate(j.finishedOn)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

function KillSwitchPanel() {
  const { hasRole, publishing, setPublishing, refreshPublishing } = useSession();
  const isAdmin = hasRole('ADMIN');
  const [dialog, setDialog] = useState<'pause' | 'resume' | null>(null);
  const action = useAction();

  const confirm = async (reason: string) => {
    const kind = dialog;
    if (!kind) return;
    const res = await action.run(() => api.post<PublishingStateDto>(`/admin/publishing/${kind}`, { reason }));
    setDialog(null);
    if (!res) return;
    setPublishing(res);
    if (kind === 'pause') {
      action.setMessage({
        tone: 'success',
        text: `Publishing paused.${res.removedJobs !== undefined ? ` ${res.removedJobs} queued publish job(s) removed.` : ''}`,
      });
    } else {
      action.setMessage(
        res.blockedReasons.length > 0
          ? { tone: 'info', text: 'Kill switch released, but publishing is still blocked by configuration (see below). Resuming never overrides missing authorization.' }
          : { tone: 'success', text: 'Publishing resumed. Each reply is still evaluated by the policy engine.' },
      );
    }
  };

  return (
    <Card
      title="Global kill switch"
      actions={
        <Button variant="secondary" onClick={refreshPublishing}>
          Refresh state
        </Button>
      }
    >
      {!publishing ? (
        <Loading label="Loading publishing state…" />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-700">Mode: <span className="font-semibold text-slate-900">{publishing.mode}</span></span>
            {publishing.globalPause ? <Badge tone="red">PUBLISHING PAUSED</Badge> : <Badge tone="green">Not paused</Badge>}
          </div>
          {publishing.globalPause ? (
            <p className="mt-2 text-sm text-slate-800">
              Paused {formatDate(publishing.pausedAt)}
              {publishing.pausedBy ? ` by ${publishing.pausedBy}` : ''}
              {publishing.pauseReason ? ` — “${publishing.pauseReason}”` : ''}
            </p>
          ) : null}
          {publishing.blockedReasons.length > 0 ? (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <p className="font-semibold">Publishing is blocked regardless of the kill switch:</p>
              <ul className="mt-1 list-disc pl-5">
                {publishing.blockedReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {isAdmin ? (
            <div className="mt-4">
              {publishing.globalPause ? (
                <Button onClick={() => setDialog('resume')} disabled={action.pending}>
                  Resume publishing…
                </Button>
              ) : (
                <Button variant="danger" onClick={() => setDialog('pause')} disabled={action.pending}>
                  Pause all publishing…
                </Button>
              )}
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-600">Only administrators can pause or resume publishing.</p>
          )}
        </>
      )}
      <ActionResult message={action.message} />
      <ConfirmDialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'pause' ? 'Pause all publishing?' : 'Resume publishing?'}
        description={
          dialog === 'pause'
            ? 'Immediately stops all publication and removes queued publish jobs. Drafting and review continue.'
            : 'Releases the global kill switch. Publication still requires platform authorization, community approval and passing every policy check.'
        }
        confirmLabel={dialog === 'pause' ? 'Pause publishing' : 'Resume publishing'}
        danger={dialog === 'pause'}
        requireReason
        pending={action.pending}
        onConfirm={confirm}
      />
    </Card>
  );
}

type AuthForm = {
  apiAccessAuthorized: AuthorizationStatus;
  commercialUseApproved: AuthorizationStatus;
  accountRegisteredAndLabeled: AuthorizationStatus;
  approvalReference: string;
  botAccountUsername: string;
  notes: string;
};

function toAuthForm(a: PlatformAuthorizationDto): AuthForm {
  return {
    apiAccessAuthorized: a.apiAccessAuthorized,
    commercialUseApproved: a.commercialUseApproved,
    accountRegisteredAndLabeled: a.accountRegisteredAndLabeled,
    approvalReference: a.approvalReference ?? '',
    botAccountUsername: a.botAccountUsername ?? '',
    notes: a.notes ?? '',
  };
}

function PlatformAuthorizationPanel() {
  const { hasRole, refreshPublishing } = useSession();
  const { data, error, loading, reload, setData } = useApi<PlatformAuthorizationDto>('/admin/platform-authorization');
  const [editing, setEditing] = useState(false);

  return (
    <Card
      title="Platform authorization"
      actions={
        hasRole('ADMIN') && data ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null
      }
    >
      <p className="mb-3 text-sm text-slate-600">Live publishing requires every item below to be APPROVED. These are recorded by an administrator from written approvals.</p>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-600">Reddit API access authorized</dt>
            <dd className="mt-1">
              <StatusBadge value={data.apiAccessAuthorized} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Commercial use approved</dt>
            <dd className="mt-1">
              <StatusBadge value={data.commercialUseApproved} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Bot account registered & labeled</dt>
            <dd className="mt-1">
              <StatusBadge value={data.accountRegisteredAndLabeled} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Approval reference</dt>
            <dd className="break-words">{data.approvalReference ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Bot account</dt>
            <dd className="break-words">{data.botAccountUsername ? `u/${data.botAccountUsername}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-600">Last reviewed</dt>
            <dd>
              {formatDate(data.reviewedAt)}
              {data.reviewedBy ? ` by ${data.reviewedBy}` : ''}
            </dd>
          </div>
          {data.notes ? (
            <div className="sm:col-span-3">
              <dt className="text-xs text-slate-600">Notes</dt>
              <dd className="whitespace-pre-wrap break-words">{data.notes}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {editing && data ? (
        <EditAuthorizationDialog
          current={data}
          onClose={() => setEditing(false)}
          onSaved={(a) => {
            setData(a);
            setEditing(false);
            refreshPublishing();
          }}
        />
      ) : null}
    </Card>
  );
}

function EditAuthorizationDialog({
  current,
  onClose,
  onSaved,
}: {
  current: PlatformAuthorizationDto;
  onClose: () => void;
  onSaved: (a: PlatformAuthorizationDto) => void;
}) {
  const initial = toAuthForm(current);
  const [form, setForm] = useState<AuthForm>(initial);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();
  const statusOptions = enumOptions(AUTHORIZATION_STATUSES);

  const setStatus = (key: 'apiAccessAuthorized' | 'commercialUseApproved' | 'accountRegisteredAndLabeled') => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value as AuthorizationStatus }));
  const setText = (key: 'approvalReference' | 'botAccountUsername' | 'notes') => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const diff = changedFields(initial, form);
    // Empty text fields clear the value (null), matching the DTO's nullable fields.
    const body: Record<string, unknown> = { reason };
    for (const [k, v] of Object.entries(diff)) body[k] = typeof v === 'string' && v.trim() === '' && k !== 'reason' ? null : v;
    const parsed = updatePlatformAuthorizationBody.safeParse(body);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    const saved = await action.run(() => api.patch<PlatformAuthorizationDto>('/admin/platform-authorization', parsed.data));
    if (saved) onSaved(saved);
  };

  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Edit platform authorization"
      description="Only mark items APPROVED when you hold written approval. This is recorded in the audit log."
      wide
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SelectField label="API access authorized" value={form.apiAccessAuthorized} onChange={setStatus('apiAccessAuthorized')} options={statusOptions} />
          <SelectField label="Commercial use approved" value={form.commercialUseApproved} onChange={setStatus('commercialUseApproved')} options={statusOptions} />
          <SelectField
            label="Account registered & labeled"
            value={form.accountRegisteredAndLabeled}
            onChange={setStatus('accountRegisteredAndLabeled')}
            options={statusOptions}
          />
        </div>
        <TextField label="Approval reference" value={form.approvalReference} onChange={setText('approvalReference')} maxLength={500} error={errors.approvalReference} />
        <TextField
          label="Bot account username"
          value={form.botAccountUsername}
          onChange={setText('botAccountUsername')}
          maxLength={50}
          hint="Without u/"
          error={errors.botAccountUsername}
        />
        <TextAreaField label="Notes" rows={3} value={form.notes} onChange={setText('notes')} maxLength={2000} error={errors.notes} />
        <TextAreaField label="Reason for change" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} error={errors.reason} />
        <ActionResult message={action.message} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={action.pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={action.pending}>
            {action.pending ? 'Saving…' : 'Save authorization'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
