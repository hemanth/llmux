import type { Env } from './types.js';

export interface AuthResult {
  valid: boolean;
  label?: string;
  error?: string;
}

/**
 * Build key -> label map from environment
 */
function buildKeyMap(env: Env): Map<string, string> {
  const keyMap = new Map<string, string>();

  // Single key (legacy)
  if (env.LLMUX_API_KEY) {
    keyMap.set(env.LLMUX_API_KEY, 'default');
  }

  // Multiple keys as JSON
  if (env.LLMUX_API_KEYS) {
    try {
      const keys = JSON.parse(env.LLMUX_API_KEYS) as Record<string, string>;
      for (const [label, key] of Object.entries(keys)) {
        if (key) {
          keyMap.set(key, label);
        }
      }
    } catch {
      console.error('Failed to parse LLMUX_API_KEYS JSON');
    }
  }

  return keyMap;
}

/**
 * Validate authorization header and return client label
 */
export function validateAuth(env: Env, authHeader: string | undefined): AuthResult {
  const keyMap = buildKeyMap(env);

  // Skip auth if no keys configured
  if (keyMap.size === 0) {
    return { valid: true, label: 'anonymous' };
  }

  if (!authHeader) {
    return { valid: false, error: 'Missing Authorization header' };
  }

  const providedKey = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : authHeader;

  const label = keyMap.get(providedKey);

  if (!label) {
    return { valid: false, error: 'Invalid API key' };
  }

  return { valid: true, label };
}
