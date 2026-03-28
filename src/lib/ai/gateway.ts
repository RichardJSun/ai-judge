import { createGateway } from 'ai';

const LEGACY_VERCEL_GATEWAY_PATHS = new Set(['/v1', '/v1/']);

export function resolveAiGatewayBaseUrl(rawBaseUrl: string | undefined) {
  if (!rawBaseUrl) {
    return undefined;
  }

  try {
    const url = new URL(rawBaseUrl);

    if (url.hostname === 'ai-gateway.vercel.sh' && LEGACY_VERCEL_GATEWAY_PATHS.has(url.pathname)) {
      url.pathname = '/v3/ai';
      url.search = '';
      url.hash = '';
      return url.toString();
    }
  } catch {
    return rawBaseUrl;
  }

  return rawBaseUrl;
}

export const gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: resolveAiGatewayBaseUrl(process.env.AI_GATEWAY_BASE_URL),
});
