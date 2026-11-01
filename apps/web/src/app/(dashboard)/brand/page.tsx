'use client';

import { updateBrandProfileBody, type BrandProfileDto, type UpdateBrandProfileBody } from '@careerconnect/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { ListEditor } from '@/components/ListEditor';
import { ActionResult, Button, Card, ErrorState, Loading, PageHeader, RoleNotice, TextAreaField, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { changedFields } from '@/lib/diff';
import { formatDate } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { fieldErrors } from '@/lib/validation';

type BrandForm = Omit<BrandProfileDto, 'id' | 'updatedAt'>;
type ListKey = 'capabilities' | 'verifiedFacts' | 'prohibitedClaims' | 'approvedUrls' | 'useCases' | 'promotionCommunities';
type TextKey = 'name' | 'description' | 'audience' | 'disclosureText';

function toForm(p: BrandProfileDto): BrandForm {
  const { id: _id, updatedAt: _u, ...rest } = p;
  return { ...rest };
}

export default function BrandPage() {
  const { data, error, loading, reload, setData } = useApi<BrandProfileDto>('/brand-profile');
  return (
    <>
      <PageHeader
        title="Brand settings"
        description="What the assistant may say about the product. Replies may only reference verified facts and approved URLs; prohibited claims are blocked by deterministic detectors."
      />
      {error ? <ErrorState error={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data ? <BrandEditor profile={data} onSaved={setData} /> : null}
    </>
  );
}

function BrandEditor({ profile, onSaved }: { profile: BrandProfileDto; onSaved: (p: BrandProfileDto) => void }) {
  const { hasRole } = useSession();
  const canEdit = hasRole('ADMIN');
  const [form, setForm] = useState<BrandForm>(() => toForm(profile));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useAction();

  useEffect(() => setForm(toForm(profile)), [profile]);

  const changes = changedFields(toForm(profile), form);
  const dirty = Object.keys(changes).length > 0;

  const setText = (key: TextKey) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setList = (key: ListKey) => (values: string[]) => setForm((f) => ({ ...f, [key]: values }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body: UpdateBrandProfileBody = { ...changes, reason };
    const parsed = updateBrandProfileBody.safeParse(body);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      action.setMessage({ tone: 'error', text: 'Please fix the highlighted fields.' });
      return;
    }
    setErrors({});
    const saved = await action.run(() => api.patch<BrandProfileDto>('/brand-profile', parsed.data), 'Brand profile saved.');
    if (saved) {
      onSaved(saved);
      setReason('');
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" aria-label="Brand profile" noValidate>
      {!canEdit ? <RoleNotice>Read-only: only administrators can change brand settings.</RoleNotice> : null}
      <p className="text-xs text-slate-600">Last updated {formatDate(profile.updatedAt)}</p>
      <fieldset disabled={!canEdit} className="space-y-4">
        <Card title="Identity">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <TextField label="Name" value={form.name} onChange={setText('name')} maxLength={100} required error={errors.name} />
            <TextField label="Audience" value={form.audience} onChange={setText('audience')} maxLength={1000} error={errors.audience} />
            <TextAreaField
              className="md:col-span-2"
              label="Description"
              rows={3}
              value={form.description}
              onChange={setText('description')}
              maxLength={2000}
              error={errors.description}
            />
            <TextAreaField
              className="md:col-span-2"
              label="Disclosure text"
              rows={2}
              value={form.disclosureText}
              onChange={setText('disclosureText')}
              maxLength={500}
              error={errors.disclosureText}
              hint="Appended to every published reply. Leaving it empty means disclosure is not configured, which blocks publishing."
            />
          </div>
        </Card>
        <Card title="Claims & content">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <ListEditor label="Capabilities" values={form.capabilities} onChange={setList('capabilities')} disabled={!canEdit} maxItems={50} error={errors.capabilities} />
            <ListEditor label="Use cases" values={form.useCases} onChange={setList('useCases')} disabled={!canEdit} maxItems={50} error={errors.useCases} />
            <ListEditor
              label="Verified facts"
              values={form.verifiedFacts}
              onChange={setList('verifiedFacts')}
              disabled={!canEdit}
              maxItems={100}
              hint="The only product facts replies may state."
              error={errors.verifiedFacts}
            />
            <ListEditor
              label="Prohibited claims"
              values={form.prohibitedClaims}
              onChange={setList('prohibitedClaims')}
              disabled={!canEdit}
              maxItems={100}
              hint="Drafts containing these are blocked."
              error={errors.prohibitedClaims}
            />
            <ListEditor
              label="Approved URLs"
              values={form.approvedUrls}
              onChange={setList('approvedUrls')}
              disabled={!canEdit}
              maxItems={50}
              placeholder="https://…"
              hint="Full URLs. Any other link in a draft is flagged."
              error={errors.approvedUrls}
            />
            <ListEditor
              label="Promotion communities"
              values={form.promotionCommunities}
              onChange={setList('promotionCommunities')}
              disabled={!canEdit}
              maxItems={50}
              placeholder="community name without r/"
              hint="Communities where mentioning the product may be allowed (still subject to community policy)."
              error={errors.promotionCommunities}
            />
          </div>
        </Card>
        {canEdit ? (
          <Card title="Save changes">
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
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="submit" disabled={action.pending || !dirty}>
                {action.pending ? 'Saving…' : 'Save brand profile'}
              </Button>
              <Button variant="secondary" disabled={action.pending || !dirty} onClick={() => setForm(toForm(profile))}>
                Discard changes
              </Button>
            </div>
            {!dirty ? <p className="mt-2 text-xs text-slate-600">No unsaved changes.</p> : null}
          </Card>
        ) : null}
      </fieldset>
      <ActionResult message={action.message} />
    </form>
  );
}
