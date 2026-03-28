import { createGateway } from 'ai';

export const gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY,
  baseURL: process.env.AI_GATEWAY_BASE_URL,
});
