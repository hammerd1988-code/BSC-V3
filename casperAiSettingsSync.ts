/**
 * Shape of a user's Casper AI Core configuration as served to the Casper CLI
 * (`casper setup --from-bsc`), so Local Coder can run the same model the web
 * Casper uses.
 *
 * The web resolves "no personal endpoint" to the platform provider, so the
 * effective model/endpoint are returned alongside where each came from. No
 * API key is ever included — neither the platform's nor the user's own
 * (`user_ai_credentials`); the CLI only learns whether one is stored.
 */
export type CliAiSettingsPayload = {
  model: string;
  endpoint: string;
  modelSource: 'user' | 'platform';
  endpointSource: 'user' | 'platform';
  hasApiKey: boolean;
};

type UserAiSettingsLike = {
  apiKey?: string | null;
  endpoint?: string | null;
  model?: string | null;
};

type PlatformAiConfigLike = {
  baseUrl: string;
  model: string;
};

export function summarizeAiSettingsForCli(
  user: UserAiSettingsLike,
  platform: PlatformAiConfigLike,
): CliAiSettingsPayload {
  const userModel = typeof user.model === 'string' ? user.model.trim() : '';
  const userEndpoint = typeof user.endpoint === 'string' ? user.endpoint.trim().replace(/\/+$/, '') : '';
  const userKey = typeof user.apiKey === 'string' ? user.apiKey.trim() : '';
  const hasUserModel = Boolean(userModel) && userModel !== 'platform_default';

  return {
    model: hasUserModel ? userModel : platform.model,
    endpoint: userEndpoint || platform.baseUrl.replace(/\/+$/, ''),
    modelSource: hasUserModel ? 'user' : 'platform',
    endpointSource: userEndpoint ? 'user' : 'platform',
    hasApiKey: Boolean(userKey),
  };
}
