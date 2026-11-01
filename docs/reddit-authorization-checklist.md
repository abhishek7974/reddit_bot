# Reddit authorization checklist

Complete **every** item before setting `APP_MODE=LIVE`. A successful OAuth login proves only that
credentials work. It is **not** authorization for commercial use. The application fails closed: until an
administrator records each approval on the **System → Platform authorization** page, the policy engine
holds every publication.

> **Status of Reddit's API access (checked 2026-10-31; verify yourself)**
>
> - Reddit's **Responsible Builder Policy** (announced November 2025 on r/redditdev) reportedly requires
>   you to request access and receive **explicit approval before accessing Reddit data through the API**.
>   Self-service API keys are no longer enough.
> - Several third-party sources report that **new public Data API access requests close on
>   October 31, 2026**, and that remaining public access ends in March 2027. We could not confirm this on
>   a Reddit-owned page.
> - **Commercial use** reportedly requires a separate written agreement with Reddit.
> - Reddit points non-commercial bots and moderator tools to its **Developer Platform (Devvit)**.
>
> If you cannot get approval, run CareerConnect in `DEMO` or `DRAFT_ONLY` mode. Do **not** fall back to
> scraping, browser automation, shared credentials or another party's API key. The application has no
> such fallback by design.

Primary documents to read (current versions, on Reddit's own sites):

- Reddit Data API Terms: https://redditinc.com/policies/data-api-terms
- Reddit Developer Terms: https://redditinc.com/policies/developer-terms
- Responsible Builder Policy (linked from Reddit's developer help center and the r/redditdev announcement)
- Reddit Rules (including spam and bot rules): https://redditinc.com/policies/content-policy
- API wiki and OAuth documentation: https://github.com/reddit-archive/reddit/wiki/OAuth2

## 1. Platform-level approval

| # | Item | Evidence to keep | Where recorded |
|---|------|------------------|----------------|
| 1 | Read the current Data API Terms, Developer Terms, Responsible Builder Policy and Reddit Rules, and note their revision dates | PDF/snapshot + date | `notes` field |
| 2 | Submitted an API access request that describes this exact use case: discovering career questions, drafting AI replies, a human-review queue, a labeled bot account, the brand context, and which communities | Copy of request | `approvalReference` |
| 3 | Received **explicit API access approval** | Approval message | `apiAccessAuthorized = APPROVED` |
| 4 | Received **written commercial-use approval** (or a written determination that the use is non-commercial) and signed any required agreement | Signed agreement / email | `commercialUseApproved = APPROVED` |
| 5 | Confirmed whether approval covers **posting comments**, not just reading | Approval text | `notes` |
| 6 | Confirmed whether LLM processing of Reddit content is permitted, and that **no model training** on Reddit data takes place (the app never trains) | Approval text | `notes` |
| 7 | Recorded the approved rate limits and data-retention requirements | Approval text | env `PUBLISH_MAX_*`, `RETENTION_DAYS` |

## 2. Account and app registration

| # | Item |
|---|------|
| 8 | Created **one** dedicated account for the app, by hand (the app never creates accounts). No other accounts are used to upvote, reply to or amplify its comments |
| 9 | The account profile clearly states that it is an automated assistant, who operates it, and how to contact the operator |
| 10 | Used Reddit's bot or app labeling mechanism, if your approval includes one → `accountRegisteredAndLabeled = APPROVED` |
| 11 | Registered the OAuth app at https://www.reddit.com/prefs/apps under the operator's account, with an accurate name, description and redirect URI |
| 12 | Obtained a refresh token for the bot account via the OAuth consent flow, with the **minimum scopes** needed: `read`, `submit`, `identity`, `history` |
| 13 | Set `REDDIT_USER_AGENT` in Reddit's required format, for example `web:careerconnect:0.1.0 (by /u/youraccount)` |
| 14 | Stored credentials in a secrets manager, never in git or in images |

## 3. Community-level authorization (repeat per community)

For each community, record the decision on **Community Policies**. New communities start with
everything disabled.

| # | Item | Field |
|---|------|-------|
| 15 | Read the sidebar, rules and wiki and summarized them | `ruleSummary`, `knownRestrictions` |
| 16 | Confirmed that automated or app-assisted comments are allowed. **Ask the moderators** where the rules are silent, and keep their reply | `automationAllowed` |
| 17 | Confirmed whether any brand mention is allowed. The default is **no** | `promotionAllowed` (also requires the community to be listed in Brand → promotion communities) |
| 18 | Set the authorization status to APPROVED only with evidence | `authorizationStatus` |
| 19 | Clicked "mark reviewed" (reviews expire after `POLICY_MAX_AGE_DAYS`, default 30) | `lastReviewedAt` |
| 20 | Enabled discovery only for approved communities | `discoveryEnabled` |

## 4. Before switching to LIVE

- [ ] `BOT_DISCLOSURE_TEXT` names the operator and says the reply is automated
- [ ] `PUBLISH_MAX_PER_HOUR`, `PUBLISH_MAX_PER_DAY` and `PUBLISH_MAX_PER_COMMUNITY_PER_DAY` are set at or below your approved limits. Start very low, for example 1 per community per day
- [ ] Ran in `DRAFT_ONLY` with live reads for at least a week and reviewed every draft
- [ ] Brand profile contains only verified facts, and its prohibited-claims list is populated
- [ ] An administrator knows how to use the kill switch (System → Pause), and `PUBLISHING_HARD_DISABLED=true` is documented as the emergency override
- [ ] Monitoring for negative feedback, removals and moderator messages is assigned to a person

## 5. Ongoing

- Recheck the Reddit terms every quarter and whenever Reddit announces changes.
- Honor moderator requests immediately: set `automationAllowed=false` and record the reason.
- Honor deletion: the retention job purges content for posts that were deleted or removed upstream, and
  administrators can purge any conversation on request.
- Never send direct messages. The app has no DM capability; don't add one.
