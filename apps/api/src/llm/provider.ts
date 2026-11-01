import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { z } from 'zod';
import type { AppConfig } from '../config.ts';
import { ProviderError, classifyHttpStatus } from '../lib/errors.ts';
import { MockLlmProvider } from './mock.ts';

export type LlmStage = 'classify' | 'generate' | 'evaluate';

export interface LlmRequest<T> {
  stage: LlmStage;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  schemaName: string;
}

export interface LlmResult<T> {
  data: T;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'openai' | 'mock';
  readonly configured: boolean;
  readonly models: Record<LlmStage, string>;
  completeJson<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

const ANTHROPIC_DEFAULTS: Record<LlmStage, string> = {
  classify: 'claude-haiku-5-5',
  generate: 'claude-sonnet-5-5',
  evaluate: 'claude-haiku-5-5',
};

function stageModels(cfg: AppConfig, defaults: Partial<Record<LlmStage, string>>): Record<LlmStage, string> {
  return {
    classify: cfg.LLM_MODEL_CLASSIFY ?? defaults.classify ?? '',
    generate: cfg.LLM_MODEL_GENERATE ?? defaults.generate ?? '',
    evaluate: cfg.LLM_MODEL_EVALUATE ?? defaults.evaluate ?? '',
  };
}

function toProviderError(err: unknown, vendor: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const status = (err as { status?: number }).status;
  if (typeof status === 'number') {
    const { category, retryable } = classifyHttpStatus(status);
    return new ProviderError(category, `${vendor} API error (${status})`, retryable);
  }
  const name = (err as Error)?.name ?? '';
  if (/timeout|connection|abort/i.test(name) || /ECONN|ETIMEDOUT|fetch failed/i.test(String((err as Error)?.message))) {
    return new ProviderError('NETWORK', `${vendor} network error`, true);
  }
  return new ProviderError('UNKNOWN', `${vendor} error: ${(err as Error)?.message ?? 'unknown'}`, false);
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly configured: boolean;
  readonly models: Record<LlmStage, string>;
  private client: Anthropic | null;

  constructor(private cfg: AppConfig) {
    this.models = stageModels(cfg, ANTHROPIC_DEFAULTS);
    this.configured = Boolean(cfg.ANTHROPIC_API_KEY);
    this.client = cfg.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, timeout: cfg.LLM_TIMEOUT_MS, maxRetries: 2 })
      : null;
  }

  async completeJson<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    if (!this.client) throw new ProviderError('AUTH', 'ANTHROPIC_API_KEY is not configured', false);
    const model = this.models[req.stage];
    try {
      const msg = await this.client.messages.parse({
        model,
        max_tokens: this.cfg.LLM_MAX_OUTPUT_TOKENS,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        output_config: { format: zodOutputFormat(req.schema as z.ZodType) },
      });
      if (msg.stop_reason === 'refusal') throw new ProviderError('POLICY', 'Model declined the request', false);
      if (msg.stop_reason === 'max_tokens') throw new ProviderError('VALIDATION', 'Model output truncated (max_tokens)', false);
      const parsed = req.schema.safeParse(msg.parsed_output);
      if (!parsed.success) throw new ProviderError('VALIDATION', 'Model output failed schema validation', false);
      return {
        data: parsed.data,
        model,
        usage: { inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens },
      };
    } catch (err) {
      throw toProviderError(err, 'Anthropic');
    }
  }
}

export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;
  readonly configured: boolean;
  readonly models: Record<LlmStage, string>;
  private client: OpenAI | null;

  constructor(private cfg: AppConfig) {
    // No defaults: OpenAI model names must be chosen explicitly by the operator.
    this.models = stageModels(cfg, {});
    this.configured = Boolean(cfg.OPENAI_API_KEY) && Object.values(this.models).every(Boolean);
    this.client = cfg.OPENAI_API_KEY
      ? new OpenAI({ apiKey: cfg.OPENAI_API_KEY, timeout: cfg.LLM_TIMEOUT_MS, maxRetries: 2 })
      : null;
  }

  async completeJson<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    if (!this.client) throw new ProviderError('AUTH', 'OPENAI_API_KEY is not configured', false);
    const model = this.models[req.stage];
    if (!model) throw new ProviderError('VALIDATION', `LLM model for stage "${req.stage}" is not configured`, false);
    try {
      const res = await this.client.chat.completions.parse({
        model,
        max_completion_tokens: this.cfg.LLM_MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        response_format: zodResponseFormat(req.schema as z.ZodType, req.schemaName),
      });
      const choice = res.choices[0];
      if (choice?.message.refusal) throw new ProviderError('POLICY', 'Model declined the request', false);
      const parsed = req.schema.safeParse(choice?.message.parsed);
      if (!parsed.success) throw new ProviderError('VALIDATION', 'Model output failed schema validation', false);
      return {
        data: parsed.data,
        model,
        usage: { inputTokens: res.usage?.prompt_tokens ?? 0, outputTokens: res.usage?.completion_tokens ?? 0 },
      };
    } catch (err) {
      throw toProviderError(err, 'OpenAI');
    }
  }
}

export function createLlmProvider(cfg: AppConfig): LlmProvider {
  switch (cfg.LLM_PROVIDER) {
    case 'anthropic':
      return new AnthropicProvider(cfg);
    case 'openai':
      return new OpenAiProvider(cfg);
    case 'mock':
      return new MockLlmProvider();
  }
}
