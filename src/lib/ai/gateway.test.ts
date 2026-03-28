import { describe, expect, it } from 'bun:test';
import { resolveAiGatewayBaseUrl } from '@/lib/ai/gateway';

describe('resolveAiGatewayBaseUrl', () => {
  it('normalizes the legacy Vercel AI Gateway /v1 base URL for AI SDK 6', () => {
    expect(resolveAiGatewayBaseUrl('https://ai-gateway.vercel.sh/v1')).toBe(
      'https://ai-gateway.vercel.sh/v3/ai'
    );
    expect(resolveAiGatewayBaseUrl('https://ai-gateway.vercel.sh/v1/')).toBe(
      'https://ai-gateway.vercel.sh/v3/ai'
    );
  });

  it('keeps current AI Gateway URLs unchanged', () => {
    expect(resolveAiGatewayBaseUrl('https://ai-gateway.vercel.sh/v3/ai')).toBe(
      'https://ai-gateway.vercel.sh/v3/ai'
    );
  });

  it('does not rewrite non-Vercel custom gateway proxies', () => {
    expect(resolveAiGatewayBaseUrl('https://gateway.example.com/v1')).toBe(
      'https://gateway.example.com/v1'
    );
  });

  it('passes through invalid or missing values so upstream validation can handle them', () => {
    expect(resolveAiGatewayBaseUrl(undefined)).toBeUndefined();
    expect(resolveAiGatewayBaseUrl('not-a-url')).toBe('not-a-url');
  });
});
