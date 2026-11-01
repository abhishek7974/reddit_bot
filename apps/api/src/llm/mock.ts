import { createHash } from 'node:crypto';
import type { CareerTopic } from '@careerconnect/shared';
import { detectPromptInjection } from '../policy/detectors.ts';
import type { LlmProvider, LlmRequest, LlmResult, LlmStage } from './provider.ts';
import type { EvaluationOutput, GenerationOutput, UnderstandingOutput } from './schemas.ts';

/**
 * Deterministic offline provider for DEMO mode, local development and CI.
 * It uses keyword heuristics and a small library of topic-specific advice — it is not an LLM,
 * and drafts it produces are labelled with model "mock-heuristic-1".
 */

const TOPIC_KEYWORDS: [CareerTopic, RegExp][] = [
  ['SALARY_NEGOTIATION', /\b(salary|negotiat|counter ?offer|compensation|raise|pay)\b/i],
  ['RESUME_FEEDBACK', /\b(resume|cv|bullet points?|ats)\b/i],
  ['INTERVIEW_PREP', /\b(interview|leetcode|behavio(u)?ral|system design|onsite|phone screen)\b/i],
  ['RECRUITER_COMMUNICATION', /\b(recruiter|ghost(ed)?|follow(ing)? up|hiring manager)\b/i],
  ['PORTFOLIO_FEEDBACK', /\b(portfolio|side project|github|projects? feedback)\b/i],
  ['CAREER_TRANSITION', /\b(career (change|switch|transition)|switch(ing)? (careers?|fields?)|pivot|bootcamp)\b/i],
  ['ENTRY_LEVEL', /\b(entry[- ]level|new grad|graduate|junior|first job|internship)\b/i],
  ['SOFTWARE_CAREERS', /\b(software|developer|engineer|programming|frontend|backend|devops)\b/i],
  ['JOB_APPLICATIONS', /\b(appl(y|ying|ication)s?|job (search|hunt)|cover letter|rejections?)\b/i],
  ['WORKPLACE_DEVELOPMENT', /\b(manager|promotion|coworker|workplace|burn ?out|feedback|performance review)\b/i],
];

const SENSITIVE = /\b(suicid|self[- ]harm|visa|immigration|lawsuit|discriminat|harass|pregnan|disabilit|diagnos)\w*/i;
const OFF_TOPIC = /\b(recipe|gaming|movie|crypto pump|giveaway|upvote)\b/i;

const ADVICE: Record<CareerTopic, string[]> = {
  SALARY_NEGOTIATION: [
    "Before you counter, pin down a number you can justify: look at a couple of salary sources for the same title, level and city, and note where your experience puts you in that range.\n\nThen reply in writing, thank them, restate your interest, and ask for a specific figure (\"Based on the scope of the role and market data, I'd be comfortable at X\"). If base salary is fixed, ask about sign-on, title level, or an earlier review date instead.\n\nIt's normal for them to come back with something in between, so decide your walk-away number before you send it.",
    "A counter is expected far more often than people think, so asking politely rarely costs an offer. Give one clear number rather than a range (ranges get anchored to the bottom) and tie it to the role's scope or market data rather than personal needs.\n\nIf they say the band is maxed out, it's worth asking what flexibility exists elsewhere: equity, sign-on bonus, remote days, or a written six-month compensation review.",
  ],
  RESUME_FEEDBACK: [
    "The biggest win is usually rewriting bullets from duties to outcomes: \"what I did → how → result\", with a number where you honestly have one (time saved, users, revenue, error rate).\n\nKeep it to one page unless you have 8+ years of relevant experience, put the most relevant section first, and mirror the exact wording of the job post for skills you genuinely have so keyword filters can match them.\n\nIf you share an anonymized version (remove name, contact info and employers), people here can give much more specific feedback.",
    "A quick test: read only the first line of each bullet. If it doesn't tell a recruiter what changed because of your work, tighten it.\n\nA few concrete fixes that usually help: drop the objective statement, move skills under a short \"Technical skills\" line, cut anything older than ~10 years that isn't relevant, and make sure every bullet starts with a strong verb rather than \"Responsible for\".",
  ],
  INTERVIEW_PREP: [
    "For behavioral rounds, write out 5–6 stories that each cover a different theme (conflict, failure, ownership, ambiguity, a project you're proud of) using situation → action → result. Most questions can be answered by adapting one of them.\n\nFor technical rounds, practice talking through your approach out loud before coding; interviewers are often grading communication as much as the final solution. A timed mock with a friend a few days before is worth more than another week of solo practice.",
    "It helps to split prep into the company and the role. For the company: read their recent product updates and be ready to say why this team specifically. For the role: get the job description and map each requirement to an example from your experience.\n\nAlso prepare two or three questions for them that you actually want answered — like how the team measures success in the first 90 days.",
  ],
  RECRUITER_COMMUNICATION: [
    "A short follow-up about a week after the last contact is completely normal. Something like: \"Hi, I wanted to check whether there's an update on the timeline for the X role. I'm still very interested.\" Keep it to two or three lines.\n\nIf you hear nothing after a second follow-up, it's reasonable to keep applying elsewhere and treat it as a soft no. Silence is very often about internal delays rather than you.",
  ],
  PORTFOLIO_FEEDBACK: [
    "Recruiters typically spend under a minute on a portfolio, so lead with your two strongest projects and make each one answer three things fast: what problem it solves, what you built, and how to see it (live link or a short GIF).\n\nA README with a screenshot, setup steps and a \"what I'd do next\" section signals more than a long list of small tutorial projects.",
  ],
  CAREER_TRANSITION: [
    "It usually helps to find the overlap between what you've already done and the new field, then build one or two small, concrete pieces of evidence there (a project, a certification that's actually requested in job posts, or a volunteer task).\n\nInformational chats with people already doing the job are underrated: ask what they'd learn first if they were starting today, and which entry roles are realistic for someone with your background.",
  ],
  ENTRY_LEVEL: [
    "For entry-level roles, volume alone tends to plateau. Tailoring the top third of your resume to each job family, and applying within the first few days of a posting going live, often matters more than sending another 100 applications.\n\nIf you can, track applications in a simple spreadsheet (date, source, response). After 30–40 you'll see whether the bottleneck is getting interviews (resume) or converting them (interview prep).",
  ],
  SOFTWARE_CAREERS: [
    "It depends a lot on what you enjoy day to day. A useful exercise is to look at 20 job posts for roles you'd want in two years and list the skills that keep repeating; that's a much better learning roadmap than any general list.\n\nBuilding one project end-to-end (with tests, deployment and a README) tends to teach more than several half-finished ones.",
  ],
  JOB_APPLICATIONS: [
    "A lot of rejections without interviews usually points to the resume or targeting rather than you as a candidate. Two things to check: are you applying to roles where you meet roughly 60–70% of the listed requirements, and does your resume use the same terms as those posts?\n\nReferrals also convert much better than cold applications, so it's worth messaging people at target companies with a specific, short question rather than a generic ask.",
  ],
  WORKPLACE_DEVELOPMENT: [
    "It can help to make the conversation with your manager concrete: ask what \"next level\" looks like in observable terms, then agree on one or two things you'll own over the next quarter that would demonstrate it.\n\nKeep a short running doc of outcomes as you go; it makes the review conversation much easier for both of you.",
  ],
  OTHER: [
    "I don't think there's enough detail here to give a specific answer. If you can share what role or industry you're in and what you've tried so far, people can give much more targeted advice.",
  ],
};

function hashIndex(text: string, mod: number): number {
  const h = createHash('sha1').update(text).digest();
  return h.readUInt32BE(0) % mod;
}

function extract(user: string, label: string): string {
  const m = new RegExp(`^${label}: (.*)$`, 'm').exec(user);
  return m?.[1]?.trim() ?? '';
}

function detectTopic(text: string): CareerTopic {
  for (const [topic, re] of TOPIC_KEYWORDS) if (re.test(text)) return topic;
  return 'OTHER';
}

const approxTokens = (s: string) => Math.ceil(s.length / 4);

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly configured = true;
  readonly models: Record<LlmStage, string> = {
    classify: 'mock-heuristic-1',
    generate: 'mock-heuristic-1',
    evaluate: 'mock-heuristic-1',
  };

  async completeJson<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const raw = this.produce(req);
    const data = req.schema.parse(raw);
    return {
      data,
      model: this.models[req.stage],
      usage: { inputTokens: approxTokens(req.system + req.user), outputTokens: approxTokens(JSON.stringify(raw)) },
    };
  }

  private produce(req: LlmRequest<unknown>): UnderstandingOutput | GenerationOutput | EvaluationOutput {
    const title = extract(req.user, 'Title');
    const body = extract(req.user, 'Body');
    const text = `${title}\n${body}`;
    const topic = detectTopic(text);
    const injection = detectPromptInjection(text);
    const sensitive = SENSITIVE.test(text);
    const offTopic = OFF_TOPIC.test(text) || topic === 'OTHER';
    const hasQuestion = /\?|\b(how|what|should|any advice|tips|help)\b/i.test(text);

    if (req.stage === 'classify') {
      const relevance = offTopic ? 0.15 : hasQuestion ? 0.85 : 0.55;
      return {
        main_question: title || 'Unclear question',
        user_goal: offTopic ? 'Not a career question' : `Get practical advice on ${topic.toLowerCase().replace(/_/g, ' ')}`,
        relevant_context: body.slice(0, 200),
        topic,
        emotional_tone: /\b(stress|anxious|worried|frustrat|lost|hopeless)\w*/i.test(text) ? 'anxious' : 'neutral',
        relevance_score: relevance,
        can_produce_useful_answer: !offTopic && hasQuestion,
        needs_sensitive_handling: sensitive,
        eligible_for_response: !offTopic && hasQuestion,
        prompt_injection_suspected: injection,
        reason: offTopic ? 'Off-topic or no answerable question.' : 'Career question with enough context.',
      };
    }

    if (req.stage === 'generate') {
      const topicFromPrompt = (/- Topic: ([A-Z_]+)/.exec(req.user)?.[1] as CareerTopic | undefined) ?? topic;
      const pool = ADVICE[topicFromPrompt] ?? ADVICE.OTHER;
      const reply = pool[hashIndex(title, pool.length)] ?? ADVICE.OTHER[0]!;
      const action = injection || sensitive ? 'HOLD_FOR_REVIEW' : offTopic ? 'SKIP' : 'REPLY';
      return {
        intent: `Advice on ${topicFromPrompt.toLowerCase().replace(/_/g, ' ')}`,
        relevance_score: offTopic ? 0.2 : 0.85,
        proposed_reply: action === 'SKIP' ? '' : reply,
        factual_support: 'General, widely-shared career guidance; no specific statistics claimed.',
        tone_assessment: 'Friendly, practical, not promotional.',
        promotional_content_detected: false,
        sensitive_topic_detected: sensitive,
        duplicate_risk: 'low',
        recommended_action: action,
        reason_for_skip_or_review: injection
          ? 'Post contains instructions aimed at AI systems.'
          : sensitive
            ? 'Sensitive topic needs a human.'
            : offTopic
              ? 'Not a career question.'
              : '',
        brand_relevance: offTopic ? 0 : 0.3,
      };
    }

    const reply = /<draft_reply>\n([\s\S]*?)\n<\/draft_reply>/.exec(req.user)?.[1] ?? '';
    const words = reply.split(/\s+/).filter(Boolean).length;
    const promo = /\b(sign up|our (product|platform)|free trial|https?:\/\/)\b/i.test(reply);
    const anecdote = /\bwhen I (was|worked|got)|\bin my experience as\b/i.test(reply);
    const generic = words < 25;
    return {
      relevance: offTopic ? 0.2 : 0.85,
      factual_support: 0.8,
      specificity: generic ? 0.4 : 0.8,
      clarity: 0.85,
      tone: promo ? 0.5 : 0.85,
      repetition_risk: generic ? 0.7 : 0.25,
      promotional_content: promo,
      privacy_risk: false,
      unsupported_personal_experience: anecdote,
      potentially_harmful_advice: false,
      notes: [
        ...(generic ? ['Reply is short and generic.'] : []),
        ...(promo ? ['Contains promotional language.'] : []),
        ...(anecdote ? ['Claims personal experience.'] : []),
      ],
    };
  }
}
