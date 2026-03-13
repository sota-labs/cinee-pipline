/** LLM configuration for each layer. */
import { settings } from "./settings.js";

export interface LLMInstance {
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature: number;
  maxTokens: number;
}

export function getBrainLlm(): LLMInstance {
  return {
    model: "gemini/gemini-2.0-flash",
    apiKey: settings.googleApiKey,
    temperature: 0.7,
    maxTokens: 4096,
  };
}

export function getExecutionLlm(): LLMInstance {
  return {
    model: "gemini/gemini-2.0-flash",
    apiKey: settings.googleApiKey,
    temperature: 0.8,
    maxTokens: 2048,
  };
}

export function getCommunityLlm(): LLMInstance {
  return {
    model: `openai/${settings.llm.communityModel}`,
    apiKey: settings.openaiApiKey,
    baseUrl: "https://api.llama-api.com/v1",
    temperature: 0.9,
    maxTokens: 1024,
  };
}
