import { describe, expect, it } from 'vitest';
import { changedFields } from '../diff';
import { formatPercent, humanize, safeRedditUrl } from '../format';
import { safeNextPath } from '../redirect';
import { roleAtLeast } from '../roles';

describe('roleAtLeast', () => {
  it('orders VIEWER < REVIEWER < ADMIN', () => {
    expect(roleAtLeast('ADMIN', 'REVIEWER')).toBe(true);
    expect(roleAtLeast('REVIEWER', 'REVIEWER')).toBe(true);
    expect(roleAtLeast('VIEWER', 'REVIEWER')).toBe(false);
    expect(roleAtLeast('REVIEWER', 'ADMIN')).toBe(false);
    expect(roleAtLeast(null, 'VIEWER')).toBe(false);
  });
});

describe('safeRedditUrl', () => {
  it('allows only https reddit.com permalinks', () => {
    expect(safeRedditUrl('https://www.reddit.com/r/jobs/comments/abc/x/')).toBe('https://www.reddit.com/r/jobs/comments/abc/x/');
    expect(safeRedditUrl('/r/jobs/comments/abc/x/')).toBe('https://www.reddit.com/r/jobs/comments/abc/x/');
    expect(safeRedditUrl('javascript:alert(1)')).toBeNull();
    expect(safeRedditUrl('https://evil.example/reddit.com')).toBeNull();
    expect(safeRedditUrl('https://reddit.com.evil.example/')).toBeNull();
    expect(safeRedditUrl('http://www.reddit.com/r/jobs')).toBeNull();
    expect(safeRedditUrl(null)).toBeNull();
  });
});

describe('safeNextPath', () => {
  it('prevents open redirects', () => {
    expect(safeNextPath('/drafts/1')).toBe('/drafts/1');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});

describe('changedFields', () => {
  it('returns only changed keys, comparing arrays by value', () => {
    expect(changedFields({ a: 1, b: ['x'], c: 'y' }, { a: 1, b: ['x', 'z'], c: 'y' })).toEqual({ b: ['x', 'z'] });
    expect(changedFields({ a: 1 }, { a: 1 })).toEqual({});
  });
});

describe('format', () => {
  it('humanizes enum values and percentages', () => {
    expect(humanize('HOLD_FOR_REVIEW')).toBe('Hold for review');
    expect(humanize(null)).toBe('—');
    expect(formatPercent(0.125, 1)).toBe('12.5%');
    expect(formatPercent(null)).toBe('—');
  });
});
