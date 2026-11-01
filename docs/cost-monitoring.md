# Cost monitoring

## What is measured

Every LLM call writes an `LlmUsage` row with the provider, model, stage, input tokens and output tokens.
These show up in:

- **Overview → Cost estimate:** tokens over the last 30 days, converted to dollars **only if** you set
  `LLM_PRICE_INPUT_PER_MTOK` and `LLM_PRICE_OUTPUT_PER_MTOK`. Without prices the dashboard says "Pricing
  not configured". It never guesses.
- **System → Token usage:** the last 24 hours (calls, input and output tokens).

Set the price variables from your provider's current price list for the models in
`LLM_MODEL_CLASSIFY`, `LLM_MODEL_GENERATE` and `LLM_MODEL_EVALUATE`. If the stages use models with
different prices, the single blended price gives an approximation. Query per-model usage (below) for
exact numbers.

## Calls per conversation

| Stage | When | Typical size |
|-------|------|--------------|
| classify | every discovered conversation | small prompt, small output |
| generate | only relevant, eligible conversations | largest prompt (system prompt + context + brand) |
| evaluate | every generated draft | medium |

So the cost per conversation is roughly 1 call when it's skipped, and 3 when it's drafted. The cheapest
levers, in order:

1. **Discovery scope:** fewer communities, `keywords` and `exclusions`, and a lower `maxPostsPerRun`
   (Policies → Discovery settings).
2. **`minRelevanceForDraft`:** raising it skips more conversations after the cheap classify call.
3. **Model choice per stage:** use a small, fast model for classify and evaluate, and a stronger one
   only for generate. The Anthropic defaults are `claude-haiku-5-5` for classify and evaluate and
   `claude-sonnet-5-5` for generate.
4. **`LLM_MAX_OUTPUT_TOKENS`:** replies are short, so 800–1,200 is plenty.

## Hard budget

Set `LLM_DAILY_TOKEN_BUDGET` (input + output tokens over a rolling 24 hours). Once it's reached, new LLM
calls fail with `LLM_BUDGET_EXCEEDED` (HTTP 429 from generate-draft; analysis jobs fail and are marked
`FAILED`) until usage rolls off. Nothing is published as a side effect.

## Useful queries

```sql
-- Tokens per model and stage, last 7 days
SELECT model, stage, COUNT(*) calls, SUM("inputTokens") input, SUM("outputTokens") output
FROM "LlmUsage" WHERE "createdAt" > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY output DESC;

-- Cost per published reply (substitute your prices)
SELECT (SUM("inputTokens") * 3.0 + SUM("outputTokens") * 15.0) / 1e6
       / NULLIF((SELECT COUNT(*) FROM "PublishAttempt" WHERE status = 'SUCCEEDED'), 0) AS usd_per_reply
FROM "LlmUsage";
```

## Infrastructure

Main fixed costs: managed Postgres (small instance), managed Redis (small, with persistence), and three
small containers (api, worker, web). At low volume the LLM spend is usually the smallest line item.
Watch it if discovery covers many busy communities.

Reddit Data API pricing for commercial use is set in your agreement with Reddit. Track it separately.
