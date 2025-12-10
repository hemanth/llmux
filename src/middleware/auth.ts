import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Config } from '../types.js';
import { getLogger } from '../utils/logger.js';

// Extend FastifyRequest to include client label
declare module 'fastify' {
  interface FastifyRequest {
    clientLabel?: string;
  }
}

/**
 * Build a map of key -> label for fast lookup
 */
function buildKeyMap(config: Config): Map<string, string> {
  const keyMap = new Map<string, string>();

  // Add single key if configured (legacy mode)
  if (config.auth?.api_key) {
    keyMap.set(config.auth.api_key, 'default');
  }

  // Add multiple keys with labels
  if (config.auth?.api_keys) {
    for (const [label, key] of Object.entries(config.auth.api_keys)) {
      if (key) {
        keyMap.set(key, label);
      }
    }
  }

  return keyMap;
}

export function createAuthMiddleware(config: Config) {
  const keyMap = buildKeyMap(config);
  const authEnabled = keyMap.size > 0;

  const logger = getLogger();

  if (!authEnabled) {
    logger.warn('No API keys configured - authentication disabled');
  } else {
    logger.info({ keyCount: keyMap.size }, 'Authentication enabled');
  }

  return async function authMiddleware(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    // Skip auth if no keys configured
    if (!authEnabled) {
      return;
    }

    const authHeader = request.headers.authorization;

    if (!authHeader) {
      reply.status(401).send({
        error: {
          message: 'Missing Authorization header',
          type: 'authentication_error',
          code: 'missing_api_key',
        },
      });
      return;
    }

    // Support both "Bearer <key>" and just "<key>"
    const providedKey = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    const label = keyMap.get(providedKey);

    if (!label) {
      reply.status(401).send({
        error: {
          message: 'Invalid API key',
          type: 'authentication_error',
          code: 'invalid_api_key',
        },
      });
      return;
    }

    // Attach client label to request for logging
    request.clientLabel = label;
  };
}
