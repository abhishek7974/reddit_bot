import { createHash } from 'node:crypto';
import type { DetectorFinding } from '@careerconnect/shared';

/**
 * Deterministic (non-LLM) content detectors. They run on every draft, and again after
 * any reviewer edit, so policy decisions never depend solely on a model's self-assessment.
 */

export interface BrandFacts {
  name: string;
  verifiedFacts: string[];
  prohibitedClaims: string[];
  approvedUrls: string[];
}

export interface PriorReply {
  id: string;
  body: string;
}

export interface DetectorOptions {
  brand: BrandFacts | null;
  priorReplies: PriorReply[];
  duplicateThreshold: number;
  maxLength?: number;
}

const URL_RE = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+|\b[a-z0-9-]+\.(?:com|io|ai|app|co|net|org|dev)\b(?:\/[^\s)]*)?/gi;

const CTA_PATTERNS = [
  /\b(sign up|signup|register now|try (it|us|our)|check (us|it) out|use (my|our) (code|link)|free trial|book a (demo|call)|dm me|message me|click (here|the link)|visit (our|my) (site|website|page)|download (our|the) app)\b/i,
  /\b(our (product|platform|tool|app|service)|we (offer|built|provide)|my (company|startup|product|course))\b/i,
  /\b(discount|promo code|coupon|limited time|% off)\b/i,
];

/** First-person claims of lived experience the assistant cannot have. */
const ANECDOTE_PATTERNS = [
  /\bwhen I (was|worked|got|applied|interviewed|hired|switched|landed|quit|negotiated)\b/i,
  /\bin my (experience|career|years|time) (as|at|in|working)\b/i,
  /\b(I|I've|I have) (been|worked) (as|at|in) (a |an )?(recruiter|hiring manager|engineer|developer|manager|HR|company)\b/i,
  /\bI (hired|interviewed|recruited|managed) (people|candidates|engineers|devs|developers|someone)\b/i,
  /\b(I|we) (got|landed) (a|the|my) (job|offer|raise|promotion)\b/i,
  /\bmy (former|old|current|previous) (boss|manager|company|employer|team|coworker|colleague)\b/i,
  /\bwhen I was (job hunting|job searching|looking for (a )?work)\b/i,
];

const CLAIMS_HUMAN_PATTERNS = [
  /\b(I'?m|I am) (a |an )?(human|real person|not a bot|not an AI)\b/i,
  /\bas a (real )?(human|person)\b/i,
];

const PII_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, label: 'email address' },
  { re: /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/, label: 'phone number' },
  { re: /\b\d{3}-\d{2}-\d{4}\b/, label: 'SSN-like number' },
  { re: /\b(?:\d[ -]?){13,16}\b/, label: 'card-like number' },
];

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function contentHash(text: string): string {
  return createHash('sha256').update(normalizeText(text)).digest('hex');
}

function shingles(text: string, size = 3): Set<string> {
  const words = normalizeText(text).split(' ').filter(Boolean);
  const out = new Set<string>();
  if (words.length < size) {
    if (words.length) out.add(words.join(' '));
    return out;
  }
  for (let i = 0; i <= words.length - size; i++) out.add(words.slice(i, i + size).join(' '));
  return out;
}

/** Jaccard similarity of word 3-shingles, 0..1. */
export function similarity(a: string, b: string): number {
  const sa = shingles(a);
  const sb = shingles(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const s of sa) if (sb.has(s)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function snippet(text: string, index: number, len = 80): string {
  const start = Math.max(0, index - 20);
  return text.slice(start, start + len).replace(/\s+/g, ' ').trim();
}

export function runDetectors(body: string, opts: DetectorOptions): DetectorFinding[] {
  const findings: DetectorFinding[] = [];

  // Length sanity
  const maxLength = opts.maxLength ?? 2500;
  if (!body.trim()) findings.push({ detector: 'length', severity: 'block', message: 'Reply is empty.' });
  else if (body.length > maxLength)
    findings.push({ detector: 'length', severity: 'review', message: `Reply is long (${body.length} chars).` });

  // URLs: any link needs review; links outside the approved list are flagged as promotion risk too.
  const approvedHosts = new Set((opts.brand?.approvedUrls ?? []).map(hostOf).filter((h): h is string => !!h));
  for (const m of body.matchAll(URL_RE)) {
    const host = hostOf(m[0]);
    const approved = host !== null && approvedHosts.has(host);
    findings.push({
      detector: 'url',
      severity: 'review',
      message: approved ? 'Contains a link to an approved brand URL.' : 'Contains a link; links require review.',
      excerpt: m[0],
    });
  }

  // Calls to action / sales language
  for (const re of CTA_PATTERNS) {
    const m = re.exec(body);
    if (m) {
      findings.push({ detector: 'promotion', severity: 'review', message: 'Promotional or call-to-action language.', excerpt: snippet(body, m.index) });
    }
  }

  // Brand mentions. Any mention is promotional; mention alongside capability claims not in verified facts blocks.
  const brand = opts.brand;
  if (brand?.name && brand.name.trim().length >= 3) {
    const nameRe = new RegExp(`\\b${escapeRegExp(brand.name.trim())}\\b`, 'i');
    const m = nameRe.exec(body);
    if (m) {
      findings.push({ detector: 'promotion', severity: 'review', message: `Mentions the brand "${brand.name}".`, excerpt: snippet(body, m.index) });
      const sentences = body.split(/(?<=[.!?])\s+/).filter((s) => nameRe.test(s));
      const facts = brand.verifiedFacts.map(normalizeText);
      for (const s of sentences) {
        const claimy = /\b(helps?|lets?|allows?|will|can|guarantees?|increases?|improves?|gets? you|proven|best|#1|leading)\b/i.test(s);
        const supported = facts.some((f) => f && similarity(f, s) >= 0.25);
        if (claimy && !supported) {
          findings.push({ detector: 'unverified_brand_claim', severity: 'block', message: 'Brand claim not supported by verified facts.', excerpt: s.slice(0, 160) });
        }
      }
    }
  }

  // Prohibited claims (configured by the brand owner)
  for (const claim of brand?.prohibitedClaims ?? []) {
    const norm = normalizeText(claim);
    if (norm && (normalizeText(body).includes(norm) || similarity(claim, body) > 0.5)) {
      findings.push({ detector: 'prohibited_claim', severity: 'block', message: `Contains a prohibited claim: "${claim}".` });
    }
  }

  // Fabricated personal experience
  for (const re of ANECDOTE_PATTERNS) {
    const m = re.exec(body);
    if (m) {
      findings.push({ detector: 'personal_anecdote', severity: 'block', message: 'Claims a personal experience the assistant cannot have.', excerpt: snippet(body, m.index) });
      break;
    }
  }
  for (const re of CLAIMS_HUMAN_PATTERNS) {
    const m = re.exec(body);
    if (m) {
      findings.push({ detector: 'claims_human', severity: 'block', message: 'Claims to be human.', excerpt: snippet(body, m.index) });
      break;
    }
  }

  // Personal data
  for (const { re, label } of PII_PATTERNS) {
    const m = re.exec(body);
    if (m) findings.push({ detector: 'pii', severity: 'block', message: `Contains a possible ${label}.` });
  }

  // Duplicates / near-duplicates against recent replies
  const hash = contentHash(body);
  let best: { id: string; score: number } | null = null;
  for (const prior of opts.priorReplies) {
    if (contentHash(prior.body) === hash) {
      best = { id: prior.id, score: 1 };
      break;
    }
    const score = similarity(body, prior.body);
    if (!best || score > best.score) best = { id: prior.id, score };
  }
  if (best && best.score >= opts.duplicateThreshold) {
    findings.push({
      detector: 'duplicate',
      severity: 'block',
      message: `Near-duplicate of reply ${best.id} (similarity ${best.score.toFixed(2)}).`,
    });
  } else if (best && best.score >= opts.duplicateThreshold * 0.6) {
    findings.push({
      detector: 'duplicate',
      severity: 'review',
      message: `Similar to reply ${best.id} (similarity ${best.score.toFixed(2)}).`,
    });
  }

  return findings;
}

/** Heuristic signals that a post is trying to instruct the AI. The post is still treated as data. */
const INJECTION_PATTERNS = [
  /\bignore (all |any )?(previous|prior|above) (instructions|prompts?)\b/i,
  /\b(system prompt|developer message|you are now|act as (an?|the) )/i,
  /\b(reveal|print|show) (your|the) (instructions|prompt|api key|secrets?)\b/i,
  /\b(if you are (an? )?(ai|bot|language model)|attention (ai|bots?|llm))\b/i,
];

export function detectPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(text));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
