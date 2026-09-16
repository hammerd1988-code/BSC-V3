/**
 * Shape of a user's Casper AI Core configuration as served to the Casper CLI
 * (`casper setup --from-bsc`), so Local Coder can run the same model the web
 * Casper uses.
 *
 * The web resolves "no personal endpoint" to the platform provider, so the
 * effective model/endpoint are returned alongside where each came from. The
 * platform API key is never included; the user's own key (from
 * `user_ai_credentials`) is only included when the caller asks for it.
 */
export type CliAiSettingsPayload = {
  model: string;
  endpoint: string;
  modelSource: 'user' | 'platform';
  endpointSource: 'user' | 'platform';
  hasApiKey: boolean;
  apiKey?: string;
  temperature: number | null;
};

type UserAiSettingsLike = {
  apiKey?: string | null;
  endpoint?: string | null;
  model?: string | null;
  temperature?: number | null;
};

type PlatformAiConfigLike = {
  baseUrl: string;
  model: string;
};

export function summarizeAiSettingsForCli(
  user: UserAiSettingsLike,
  platform: PlatformAiConfigLike,
  opts: { includeKey?: boolean } = {},
): CliAiSettingsPayload {
  const userModel = typeof user.model === 'string' ? user.model.trim() : '';
  const userEndpoint = typeof user.endpoint === 'string' ? user.endpoint.trim().replace(/\/+$/, '') : '';
  const userKey = typeof user.apiKey === 'string' ? user.apiKey.trim() : '';
  const hasUserModel = Boolean(userModel) && userModel !== 'platform_default';

  const payload: CliAiSettingsPayload = {
    model: hasUserModel ? userModel : platform.model,
    endpoint: userEndpoint || platform.baseUrl.replace(/\/+$/, ''),
    modelSource: hasUserModel ? 'user' : 'platform',
    endpointSource: userEndpoint ? 'user' : 'platform',
    hasApiKey: Boolean(userKey),
    temperature: typeof user.temperature === 'number' && Number.isFinite(user.temperature) ? user.temperature : null,
  };
  if (opts.includeKey && userKey) payload.apiKey = userKey;
  return payload;
}
