'use client';

import {
  AUTHORIZATION_STATUSES,
  CAREER_TOPICS,
  CAREER_TOPIC_LABELS,
  createPolicyBody,
  discoverySettingsBody,
  updatePolicyBody,
  type AuthorizationStatus,
  type CareerTopic,
  type DiscoveryRunResponse,
  type DiscoverySettingsDto,
  type SubredditPolicyDto,
  type UpdatePolicyBody,
} from '@careerconnect/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from '@/components/Dialog';
import { ListEditor } from '@/components/ListEditor';
import {
  ActionResult,
  Badge,
  Button,
  Card,
  CheckboxField,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  RoleNotice,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
  enumOptions,
} from '@/components/ui';
import { api } from '@/lib/api';
import { changedFields } from '@/lib/diff';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { fieldErrors } from '@/lib/validation';

export default function PoliciesPage() {
  const { hasRole } = useSession();
  const policies = useApi<SubredditPolicyDto[]>('/policies');
  const [editing, setEditing] = useState<SubredditPolicyDto | null>(null);
  const runAction = useAction();

  const runDiscovery = () =>
    void runAction.run(
      () => api.post<DiscoveryRunResponse>('/discovery/run'),
      (r) => (r.queued ? `Discovery queued${r.jobId ? ` (job ${r.jobId})` : ''}. ${r.message}` : r.message),
    );

  const replacePolicy = (p: SubredditPolicyDto) => {
    if (!policies.data) return;
    const exists = policies.data.some((x) => x.id === p.id);
    policies.setData(exists ? policies.data.map((x) => (x.id === p.id ? p : x)) : [...policies.data, p]);
  };

  return (
    <>
      <PageHeader
        title="Communities & discovery"
        description="Per-community rules and authorization. Automated publication is only possible where every requirement is met — blockers are listed for each community."
        actions={
          hasRole('REVIEWER') ? (
            <Button onClick={runDiscovery} disabled={runAction.pending}>
              {runAction.pending ? 'Starting…' : 'Run discovery now'}
            </Button>
          ) : null
        }
      />
      <ActionResult message={runAction.message} />

      <section aria-labelledby="communities-heading" className="mt-2">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="communities-heading" className="text-lg font-semibold text-slate-900">
            Community policies
          </h2>
          {hasRole('ADMIN') ? <AddCommunity onCreated={replacePolicy} /> : null}
        </div>
        {policies.error ? <ErrorState error={policies.error} onRetry={policies.reload} /> : null}
        {policies.loading && !policies.data ? <Loading /> : null}
        {policies.data ? (
          policies.data.length === 0 ? (
            <EmptyState title="No communities configured yet." />
          ) : (
            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {policies.data.map((p) => (
                <li key={p.id}>
                  <PolicyCard policy={p} canEdit={hasRole('ADMIN')} onEdit={() => setEditing(p)} />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      <DiscoverySettingsSection />

      {editing ? (
        <EditPolicyDialog
          policy={editing}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            replacePolicy(p);
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}

function YesNo({ label, value }: { label: string; value: boolean }) {
  return (
    <Badge tone={value ? 'green' : 'gray'}>
      {label}: {value ? 'Yes' : 'No'}
    </Badge>
  );
}

function PolicyCard({ policy: p, canEdit, onEdit }: { policy: SubredditPolicyDto; canEdit: boolean; onEdit: () => void }) {
  return (
    <Card
      headingLevel={3}
      title={`r/${p.communityName}`}
      actions={
        canEdit ? (
          <Button variant="secondary" onClick={onEdit} aria-label={`Edit policy for r/${p.communityName}`}>
            Edit
          </Button>
        ) : null
      }
      className="h-full"
    >
      <div className="flex flex-wrap gap-2">
        <StatusBadge value={p.authorizationStatus} label="Authorization" />
        <YesNo label="Automation allowed" value={p.automationAllowed} />
        <YesNo label="Promotion allowed" value={p.promotionAllowed} />
        <YesNo label="Discovery" value={p.discoveryEnabled} />
        {p.isStale ? <Badge tone="amber">Stale — review rules</Badge> : null}
      </div>

      {p.automationBlockers.length > 0 ? (
        <div className="mt-3 rounded-md border border-amber-400 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-950">Why automation is disabled</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-amber-950">
            {p.automationBlockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-950">
          No community-level blockers. Each reply is still checked by the policy engine.
        </p>
      )}

      {p.ruleSummary ? <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">{p.ruleSummary}</p> : null}
      {p.knownRestrictions.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Known restrictions</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-slate-800">
            {p.knownRestrictions.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-xs text-slate-600">
        Last reviewed {p.lastReviewedAt ? formatDate(p.lastReviewedAt) : 'never'} · policy v{p.policyVersion}
      </p>
    </Card>
  );
}

function AddCommunity({ onCreated }: { onCreated: (p: SubredditPolicyDto) => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createPolicyBody.safeParse({ communityName: name.replace(/^r\//i, '') });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid community name');
      return;
    }
    setError(undefined);
    const created = await action.run(
      () => api.post<SubredditPolicyDto>('/policies', parsed.data),
      (p) => `Added r/${p.communityName}. It starts with UNKNOWN authorization and automation disabled.`,
    );
    if (created) {
      onCreated(created);
      setName('');
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-start gap-2" aria-label="Add community" noValidate>
      <TextField label="Add community" placeholder="e.g. cscareerquestions" value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={23} />
      <Button type="submit" className="mt-6" disabled={action.pending || !name.trim()}>
        Add
      </Button>
      <div className="w-full">
        <ActionResult message={action.message} />
      </div>
    </form>
  );
}

interface PolicyForm {
  ruleSummary: string;
  knownRestrictions: string[];
  promotionAllowed: boolean;
  automationAllowed: boolean;
  authorizationStatus: AuthorizationStatus;
  discoveryEnabled: boolean;
}

function EditPolicyDialog({
  policy,
  onClose,
  onSaved,
}: {
  policy: SubredditPolicyDto;
  onClose: () => void;
  onSaved: (p: SubredditPolicyDto) => void;
}) {
  const initial: PolicyForm = {
    ruleSummary: policy.ruleSummary,
    knownRestrictions: policy.knownRestrictions,
    promotionAllowed: policy.promotionAllowed,
    automationAllowed: policy.automationAllowed,
    authorizationStatus: policy.authorizationStatus,
    discoveryEnabled: policy.discoveryEnabled,
  };
  const [form, setForm] = useState<PolicyForm>(initial);
  const [markReviewed, setMarkReviewed] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: UpdatePolicyBody = { ...changedFields(initial, form), reason };
    if (markReviewed) body.markReviewed = true;
    const parsed = updatePolicyBody.safeParse(body);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    const saved = await action.run(() => api.patch<SubredditPolicyDto>(`/policies/${encodeURIComponent(policy.id)}`, parsed.data));
    if (saved) onSaved(saved);
  };

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title={`Edit policy — r/${policy.communityName}`} wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <TextAreaField
          label="Rule summary"
          rows={4}
          maxLength={5000}
          value={form.ruleSummary}
          onChange={(e) => setForm((f) => ({ ...f, ruleSummary: e.target.value }))}
          error={errors.ruleSummary}
        />
        <ListEditor
          label="Known restrictions"
          values={form.knownRestrictions}
          onChange={(v) => setForm((f) => ({ ...f, knownRestrictions: v }))}
          maxItems={50}
          error={errors.knownRestrictions}
        />
        <SelectField
          label="Authorization status"
          value={form.authorizationStatus}
          onChange={(e) => setForm((f) => ({ ...f, authorizationStatus: e.target.value as AuthorizationStatus }))}
          options={enumOptions(AUTHORIZATION_STATUSES)}
          hint="Set APPROVED only with written permission from the community's moderators."
        />
        <div className="space-y-2">
          <CheckboxField label="Automation allowed" checked={form.automationAllowed} onChange={(v) => setForm((f) => ({ ...f, automationAllowed: v }))} />
          <CheckboxField label="Promotion allowed" checked={form.promotionAllowed} onChange={(v) => setForm((f) => ({ ...f, promotionAllowed: v }))} />
          <CheckboxField label="Discovery enabled" checked={form.discoveryEnabled} onChange={(v) => setForm((f) => ({ ...f, discoveryEnabled: v }))} />
          <CheckboxField
            label="Mark reviewed now"
            hint="Records that a human re-read this community's rules today."
            checked={markReviewed}
            onChange={setMarkReviewed}
          />
        </div>
        <TextAreaField
          label="Reason for change"
          required
          rows={2}
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={errors.reason}
          hint="Recorded in the audit log."
        />
        <ActionResult message={action.message} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={action.pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={action.pending}>
            {action.pending ? 'Saving…' : 'Save policy'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DiscoverySettingsSection() {
  const { hasRole } = useSession();
  const canEdit = hasRole('ADMIN');
  const { data, error, loading, reload, setData } = useApi<DiscoverySettingsDto>('/discovery/settings');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [topics, setTopics] = useState<CareerTopic[]>([]);
  const [maxPosts, setMaxPosts] = useState('25');
  const [minRelevance, setMinRelevance] = useState('0.6');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();

  useEffect(() => {
    if (!data) return;
    setKeywords(data.keywords);
    setExclusions(data.exclusions);
    setTopics(data.topics);
    setMaxPosts(String(data.maxPostsPerRun));
    setMinRelevance(String(data.minRelevanceForDraft));
  }, [data]);

  const toggleTopic = (t: CareerTopic, on: boolean) => setTopics((cur) => (on ? [...cur, t] : cur.filter((x) => x !== t)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = discoverySettingsBody.safeParse({
      keywords,
      exclusions,
      topics,
      maxPostsPerRun: Number(maxPosts),
      minRelevanceForDraft: Number(minRelevance),
      reason,
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    const saved = await action.run(() => api.put<DiscoverySettingsDto>('/discovery/settings', parsed.data), 'Discovery settings saved.');
    if (saved) {
      setData(saved);
      setReason('');
    }
  };

  return (
    <section aria-labelledby="discovery-heading" className="mt-8">
      <h2 id="discovery-heading" className="mb-3 text-lg font-semibold text-slate-900">
        Discovery settings
      </h2>
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? (
        <form onSubmit={submit} aria-label="Discovery settings" noValidate>
          <Card>
            {!canEdit ? <RoleNotice>Read-only: only administrators can change discovery settings.</RoleNotice> : null}
            <fieldset disabled={!canEdit} className="mt-3 space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <ListEditor label="Keywords" values={keywords} onChange={setKeywords} disabled={!canEdit} maxItems={100} error={errors.keywords} />
                <ListEditor label="Exclusions" values={exclusions} onChange={setExclusions} disabled={!canEdit} maxItems={100} error={errors.exclusions} />
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-slate-800">Topics</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {CAREER_TOPICS.map((t) => (
                    <CheckboxField key={t} label={CAREER_TOPIC_LABELS[t]} checked={topics.includes(t)} onChange={(on) => toggleTopic(t, on)} disabled={!canEdit} />
                  ))}
                </div>
                {errors.topics ? <p className="mt-1 text-xs font-medium text-red-700">{errors.topics}</p> : null}
              </fieldset>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <TextField
                  label="Max posts per run"
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={maxPosts}
                  onChange={(e) => setMaxPosts(e.target.value)}
                  error={errors.maxPostsPerRun}
                />
                <TextField
                  label="Minimum relevance for draft"
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={minRelevance}
                  onChange={(e) => setMinRelevance(e.target.value)}
                  error={errors.minRelevanceForDraft}
                  hint="0–1. Conversations below this score are not drafted."
                />
              </div>
              {canEdit ? (
                <>
                  <TextAreaField
                    label="Reason for change"
                    required
                    rows={2}
                    maxLength={1000}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    error={errors.reason}
                  />
                  <Button type="submit" disabled={action.pending}>
                    {action.pending ? 'Saving…' : 'Save discovery settings'}
                  </Button>
                </>
              ) : null}
            </fieldset>
            <p className="mt-3 text-xs text-slate-600">Last updated {formatDate(data.updatedAt)}</p>
            <ActionResult message={action.message} />
          </Card>
        </form>
      ) : null}
    </section>
  );
}
