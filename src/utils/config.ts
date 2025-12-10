import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';
import type { Config } from '../types.js';

const CONFIG_PATHS = [
  './config/config.yaml',
  './config/config.yml',
  './config.yaml',
  './config.yml',
];

/**
 * Interpolate environment variables in a string
 * Supports: ${VAR_NAME} and ${VAR_NAME:-default}
 */
function interpolateEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, expr: string) => {
    const [varName, defaultValue] = expr.split(':-');
    const envValue = process.env[varName.trim()];

    if (envValue !== undefined) {
      return envValue;
    }

    if (defaultValue !== undefined) {
      return defaultValue;
    }

    // Return empty string for undefined vars without defaults
    return '';
  });
}

/**
 * Recursively interpolate environment variables in config object
 */
function interpolateConfig<T>(obj: T): T {
  if (typeof obj === 'string') {
    return interpolateEnvVars(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => interpolateConfig(item)) as T;
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateConfig(value);
    }
    return result as T;
  }

  return obj;
}

/**
 * Load and parse configuration from YAML file
 */
export function loadConfig(configPath?: string): Config {
  let filePath = configPath;

  // Find config file
  if (!filePath) {
    for (const path of CONFIG_PATHS) {
      if (existsSync(path)) {
        filePath = path;
        break;
      }
    }
  }

  if (!filePath || !existsSync(filePath)) {
    throw new Error(
      `Configuration file not found. Searched: ${CONFIG_PATHS.join(', ')}. ` +
      `Copy config/config.example.yaml to config/config.yaml and configure it.`
    );
  }

  const content = readFileSync(filePath, 'utf-8');
  const rawConfig = parse(content);

  // Interpolate environment variables
  const config = interpolateConfig<Config>(rawConfig);

  // Validate required fields
  validateConfig(config);

  return config;
}

/**
 * Validate configuration
 */
function validateConfig(config: Config): void {
  if (!config.server?.port) {
    throw new Error('Configuration missing: server.port');
  }

  if (!config.providers || Object.keys(config.providers).length === 0) {
    throw new Error('Configuration missing: at least one provider must be configured');
  }

  // Check that at least one provider is enabled and has an API key
  const enabledProviders = Object.entries(config.providers)
    .filter(([_, provider]) => provider.enabled && provider.api_key);

  if (enabledProviders.length === 0) {
    throw new Error('No providers are enabled with valid API keys');
  }

  // Validate fallback chain references valid providers
  if (config.routing?.fallback_chain) {
    for (const providerName of config.routing.fallback_chain) {
      if (!config.providers[providerName]) {
        throw new Error(`Fallback chain references unknown provider: ${providerName}`);
      }
    }
  }
}

/**
 * Get enabled providers from config
 */
export function getEnabledProviders(config: Config): string[] {
  return Object.entries(config.providers)
    .filter(([_, provider]) => provider.enabled && provider.api_key)
    .map(([name]) => name);
}
