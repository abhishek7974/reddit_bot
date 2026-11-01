import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.ts';
import { Client, appFor, makeCtx, resetDb, seedBase, testDb } from '../helpers.ts';

describe('authentication, authorization and validation', () => {
  let app: App;

  beforeEach(async () => {
    await resetDb(testDb());
    await seedBase(testDb());
    app = await appFor(makeCtx());
  });
  afterAll(async () => {
    await app?.close();
  });

  it('health is public', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', mode: 'DEMO' });
  });

  it('rejects unauthenticated requests to protected endpoints', async () => {
    for (const url of ['/api/conversations', '/api/drafts', '/api/dashboard/summary', '/api/policies', '/api/audit']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
    const res = await app.inject({ method: 'POST', url: '/api/admin/publishing/resume', payload: { reason: 'hack' } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects bad credentials without revealing which part was wrong', async () => {
    const c = new Client(app);
    const a = await c.login('admin@test.local', 'wrong-password');
    const b = await c.login('nobody@test.local', 'wrong-password');
    expect(a.statusCode).toBe(401);
    expect(b.statusCode).toBe(401);
    expect(a.json().error.message).toBe(b.json().error.message);
  });

  it('issues an httpOnly, SameSite=Strict session cookie and never stores the raw token', async () => {
    const c = new Client(app);
    const res = await c.login('admin@test.local');
    expect(res.statusCode).toBe(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    const token = c.cookie.split('=')[1]!;
    const sessions = await testDb().session.findMany();
    expect(sessions.some((s) => s.tokenHash === token)).toBe(false);
    expect((await c.req('GET', '/api/auth/me')).json().user.role).toBe('ADMIN');
  });

  it('enforces role-based access', async () => {
    const viewer = new Client(app);
    await viewer.login('viewer@test.local');
    expect((await viewer.req('GET', '/api/conversations')).statusCode).toBe(200);
    expect((await viewer.req('POST', '/api/discovery/run')).statusCode).toBe(403);
    expect((await viewer.req('POST', '/api/admin/publishing/pause', { reason: 'test pause' })).statusCode).toBe(403);
    expect((await viewer.req('GET', '/api/audit')).statusCode).toBe(403);

    const reviewer = new Client(app);
    await reviewer.login('reviewer@test.local');
    expect((await reviewer.req('POST', '/api/discovery/run')).statusCode).toBe(200);
    expect((await reviewer.req('POST', '/api/admin/publishing/resume', { reason: 'not mine' })).statusCode).toBe(403);
    const policies = (await reviewer.req('GET', '/api/policies')).json();
    expect((await reviewer.req('PATCH', `/api/policies/${policies[0].id}`, { automationAllowed: true, reason: 'nope' })).statusCode).toBe(403);
  });

  it('requires a valid CSRF token on mutating requests', async () => {
    const c = new Client(app);
    await c.login('admin@test.local');
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/publishing/pause',
      payload: { reason: 'csrf test' },
      headers: { cookie: c.cookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('CSRF_INVALID');
    const bad = await c.req('POST', '/api/admin/publishing/pause', { reason: 'csrf test' }, { 'x-csrf-token': 'forged' });
    expect(bad.statusCode).toBe(403);
  });

  it('expires sessions and invalidates them on logout', async () => {
    const c = new Client(app);
    await c.login('admin@test.local');
    await c.req('POST', '/api/auth/logout');
    expect((await c.req('GET', '/api/auth/me')).statusCode).toBe(401);

    await c.login('admin@test.local');
    await testDb().session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await c.req('GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('validates input', async () => {
    const c = new Client(app);
    await c.login('admin@test.local');
    expect((await c.req('POST', '/api/admin/publishing/pause', {})).statusCode).toBe(400);
    expect((await c.req('GET', '/api/conversations/not-a-uuid')).statusCode).toBe(400);
    expect((await c.req('POST', '/api/policies', { communityName: 'r/bad name!' })).statusCode).toBe(400);
    expect((await c.req('PATCH', '/api/brand-profile', { approvedUrls: ['not a url'], reason: 'test' })).statusCode).toBe(400);
  });

  it('audits configuration changes with reasons', async () => {
    const c = new Client(app);
    await c.login('admin@test.local');
    const created = await c.req('POST', '/api/policies', { communityName: 'NewCommunity' });
    expect(created.statusCode).toBe(201);
    // New communities start fail-closed.
    expect(created.json()).toMatchObject({
      communityName: 'newcommunity',
      authorizationStatus: 'UNKNOWN',
      automationAllowed: false,
      promotionAllowed: false,
      discoveryEnabled: false,
    });
    expect(created.json().automationBlockers.length).toBeGreaterThan(0);
    const patched = await c.req('PATCH', `/api/policies/${created.json().id}`, { ruleSummary: 'Read the rules', markReviewed: true, reason: 'Reviewed sidebar' });
    expect(patched.json().policyVersion).toBe(2);
    expect(patched.json().lastReviewedAt).not.toBeNull();
    const events = await testDb().auditEvent.findMany({ where: { action: 'policy.updated' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.reason).toBe('Reviewed sidebar');
  });
});
