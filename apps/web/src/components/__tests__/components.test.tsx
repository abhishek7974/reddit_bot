import type { PolicyEvaluation } from '@careerconnect/shared';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { BarChart } from '../BarChart';
import { ConfirmDialog } from '../Dialog';
import { ListEditor } from '../ListEditor';
import { ModeBanner } from '../ModeBanner';
import { PolicyEvaluationView } from '../PolicyEvaluationView';
import { DataSourceBadge, PlainText } from '../ui';

describe('ModeBanner', () => {
  it('shows the demo banner in DEMO mode', () => {
    render(<ModeBanner mode="DEMO" globalPause={false} />);
    expect(screen.getByText('Demo mode — synthetic data, nothing is sent to Reddit')).toBeInTheDocument();
    expect(screen.queryByText(/publishing paused/i)).not.toBeInTheDocument();
  });

  it('shows the draft-only banner', () => {
    render(<ModeBanner mode="DRAFT_ONLY" globalPause={false} />);
    expect(screen.getByText('Draft-only — publishing disabled')).toBeInTheDocument();
  });

  it('is neutral in LIVE mode but always shows the pause banner when paused', () => {
    const { container } = render(<ModeBanner mode="LIVE" globalPause={false} />);
    expect(container).toBeEmptyDOMElement();
    render(<ModeBanner mode="LIVE" globalPause pauseReason="Incident review" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/publishing paused/i);
    expect(alert).toHaveTextContent('Incident review');
  });
});

describe('DataSourceBadge', () => {
  it('labels synthetic data as demo data', () => {
    render(
      <>
        <DataSourceBadge source="SYNTHETIC" />
        <DataSourceBadge source="REDDIT" />
      </>,
    );
    expect(screen.getByText('Demo data')).toBeInTheDocument();
    expect(screen.getByText('Reddit')).toBeInTheDocument();
  });
});

describe('PlainText (untrusted content)', () => {
  it('renders markup and links as inert text', () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script> see https://evil.example';
    const { container } = render(<PlainText text={hostile} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent(hostile);
  });
});

describe('PolicyEvaluationView', () => {
  const policy: PolicyEvaluation = {
    decision: 'SKIP',
    checks: [
      { id: 'api_access_authorized', label: 'Reddit API access authorized', outcome: 'FAIL', detail: 'Status is UNKNOWN' },
      { id: 'quality_passed', label: 'Quality gate passed', outcome: 'PASS', detail: 'Score 0.82' },
      { id: 'community_rules', label: 'Community allows automation', outcome: 'UNKNOWN', detail: 'Rules not reviewed' },
    ],
    reasons: ['Platform authorization missing'],
    policyVersion: '3',
    evaluatedAt: '2026-10-01T10:00:00.000Z',
  };

  it('shows the decision, reasons and every check outcome', () => {
    render(<PolicyEvaluationView policy={policy} />);
    expect(screen.getByText('Skip')).toBeInTheDocument();
    expect(screen.getByText('Platform authorization missing')).toBeInTheDocument();
    const checks = within(screen.getByRole('list', { name: 'Policy checks' })).getAllByRole('listitem');
    expect(checks).toHaveLength(3);
    expect(checks[0]).toHaveTextContent('FAIL');
    expect(checks[1]).toHaveTextContent('PASS');
    expect(checks[2]).toHaveTextContent('UNKNOWN');
  });

  it('handles a missing evaluation', () => {
    render(<PolicyEvaluationView policy={null} />);
    expect(screen.getByText(/no policy evaluation/i)).toBeInTheDocument();
  });
});

describe('ListEditor', () => {
  function Harness({ initial }: { initial: string[] }) {
    const [values, setValues] = useState(initial);
    return <ListEditor label="Keywords" values={values} onChange={setValues} />;
  }

  it('adds (via Enter or button), de-duplicates and removes items', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['resume']} />);
    const input = screen.getByLabelText('Add to Keywords');
    await user.type(input, 'interview{Enter}');
    expect(screen.getByText('interview')).toBeInTheDocument();
    await user.type(input, 'resume');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getAllByText('resume')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Remove "resume" from Keywords' }));
    expect(screen.queryByText('resume')).not.toBeInTheDocument();
  });

  it('is read-only when disabled', () => {
    render(<ListEditor label="Facts" values={['a']} onChange={() => undefined} disabled />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Add to Facts')).not.toBeInTheDocument();
  });
});

describe('ConfirmDialog', () => {
  it('requires a reason before confirming', async () => {
    const user = userEvent.setup();
    const confirmed: string[] = [];
    render(
      <ConfirmDialog open onOpenChange={() => undefined} title="Pause all publishing?" confirmLabel="Pause publishing" requireReason onConfirm={(r) => {
        confirmed.push(r);
      }} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Pause all publishing?' });
    await user.click(within(dialog).getByRole('button', { name: 'Pause publishing' }));
    expect(confirmed).toEqual([]);
    expect(within(dialog).getByText(/please enter a reason/i)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Reason'), '  Incident 42  ');
    await user.click(within(dialog).getByRole('button', { name: 'Pause publishing' }));
    expect(confirmed).toEqual(['Incident 42']);
  });
});

describe('BarChart', () => {
  it('exposes an accessible summary and a data table fallback', () => {
    render(
      <BarChart
        title="Drafts generated"
        points={[
          { date: '2026-10-01', value: 2 },
          { date: '2026-10-02', value: 5 },
        ]}
      />,
    );
    expect(screen.getByRole('img', { name: /Drafts generated: 7 total over 2 days, peak 5 on 2026-10-02/ })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Drafts generated by day' })).toBeInTheDocument();
  });
});
