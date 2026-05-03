export type CasperIntegrationCategory =
  | 'Automation'
  | 'Development'
  | 'Communication'
  | 'Content'
  | 'Analytics'
  | 'Deployment'
  | 'AI Models';

export type CasperIntegrationDefinition = {
  key: string;
  name: string;
  description: string;
  category: CasperIntegrationCategory;
  accent: string;
  scopes: string[];
  apiKeyLabel: string;
  placeholder: string;
};

export const CASPER_INTEGRATION_CATEGORIES: Array<CasperIntegrationCategory | 'All'> = [
  'All',
  'Automation',
  'Development',
  'Communication',
  'Content',
  'Analytics',
  'Deployment',
  'AI Models',
];

export const AVAILABLE_CASPER_INTEGRATIONS: CasperIntegrationDefinition[] = [
  { key: 'zapier', name: 'Zapier', description: 'Workflow automation across 5000+ apps for cross-platform agent actions.', category: 'Automation', accent: 'cyan', scopes: ['workflow automation', 'app triggers', 'cross-app actions'], apiKeyLabel: 'Zapier API Key / MCP Token', placeholder: 'zapier_xxx' },
  { key: 'playwright', name: 'Playwright', description: 'Browser automation, testing, screenshots, and controlled web scraping.', category: 'Automation', accent: 'emerald', scopes: ['browser automation', 'web scraping', 'QA flows'], apiKeyLabel: 'Optional Browser Profile Key', placeholder: 'optional' },
  { key: 'github', name: 'GitHub', description: 'Repository management, pull requests, issues, commits, and release operations.', category: 'Development', accent: 'slate', scopes: ['repos', 'pull requests', 'issues', 'commits'], apiKeyLabel: 'GitHub Personal Access Token', placeholder: 'github_pat_xxx' },
  { key: 'google_workspace', name: 'Google Workspace', description: 'Docs, Sheets, Calendar, and Drive operations for planning and reporting.', category: 'Communication', accent: 'blue', scopes: ['docs', 'sheets', 'calendar', 'drive'], apiKeyLabel: 'Google OAuth/API Credential', placeholder: 'ya29.xxx or client credential' },
  { key: 'notion', name: 'Notion', description: 'Notes, databases, project wikis, knowledge bases, and planning dashboards.', category: 'Development', accent: 'zinc', scopes: ['databases', 'pages', 'project wiki'], apiKeyLabel: 'Notion Internal Integration Secret', placeholder: 'secret_xxx' },
  { key: 'discord', name: 'Discord', description: 'Community management, bot commands, moderation alerts, and announcements.', category: 'Communication', accent: 'indigo', scopes: ['bot commands', 'channels', 'community alerts'], apiKeyLabel: 'Discord Bot Token', placeholder: 'discord bot token' },
  { key: 'slack', name: 'Slack', description: 'Team communication, incident notifications, and workflow updates.', category: 'Communication', accent: 'fuchsia', scopes: ['messages', 'channels', 'notifications'], apiKeyLabel: 'Slack Bot Token', placeholder: 'xoxb-xxx' },
  { key: 'stripe', name: 'Stripe', description: 'Payment, checkout, subscriptions, customer, and revenue operations.', category: 'Analytics', accent: 'violet', scopes: ['payments', 'subscriptions', 'customers'], apiKeyLabel: 'Stripe Secret Key', placeholder: 'sk_live_xxx' },
  { key: 'supabase', name: 'Supabase', description: 'Database operations, storage, auth, realtime, and backend automation.', category: 'Development', accent: 'green', scopes: ['postgres', 'storage', 'auth', 'realtime'], apiKeyLabel: 'Supabase Service/API Key', placeholder: 'sbp_xxx or anon/service key' },
  { key: 'vercel', name: 'Vercel', description: 'Deployment, hosting, environment, logs, domain, and preview automation.', category: 'Deployment', accent: 'neutral', scopes: ['deployments', 'logs', 'domains', 'env'], apiKeyLabel: 'Vercel Token', placeholder: 'vercel token' },
  { key: 'heygen', name: 'HeyGen', description: 'AI avatar video generation for scripted updates and creator workflows.', category: 'Content', accent: 'pink', scopes: ['avatar video', 'voices', 'templates'], apiKeyLabel: 'HeyGen API Key', placeholder: 'heygen_xxx' },
  { key: 'runway_ml', name: 'Runway ML', description: 'AI video and image generation, already wired into BSC creator tooling.', category: 'Content', accent: 'lime', scopes: ['video generation', 'image generation', 'creative assets'], apiKeyLabel: 'Runway API Key', placeholder: 'runway_xxx' },
  { key: 'openai', name: 'OpenAI', description: 'GPT models, reasoning, embeddings, tool-aware assistants, speech, and image APIs.', category: 'AI Models', accent: 'teal', scopes: ['gpt models', 'speech', 'vision', 'embeddings'], apiKeyLabel: 'OpenAI API Key', placeholder: 'sk-xxx' },
  { key: 'anthropic', name: 'Anthropic', description: 'Claude models for long-context reasoning, research, coding, and analysis.', category: 'AI Models', accent: 'orange', scopes: ['claude models', 'long context', 'analysis'], apiKeyLabel: 'Anthropic API Key', placeholder: 'sk-ant-xxx' },
  { key: 'google_ai', name: 'Google AI', description: 'Gemini models for multimodal generation, coding, analysis, and reasoning.', category: 'AI Models', accent: 'amber', scopes: ['gemini models', 'multimodal', 'reasoning'], apiKeyLabel: 'Google AI API Key', placeholder: 'AIza...' },
  { key: 'spotify', name: 'Spotify', description: 'Music integration for streams, creator playlists, and audio-aware sessions.', category: 'Content', accent: 'green', scopes: ['playlists', 'tracks', 'stream music context'], apiKeyLabel: 'Spotify OAuth Token', placeholder: 'spotify oauth token' },
  { key: 'twitch', name: 'Twitch', description: 'Cross-platform streaming, chat operations, channel events, and creator alerts.', category: 'Content', accent: 'purple', scopes: ['streams', 'chat', 'channel events'], apiKeyLabel: 'Twitch OAuth Token', placeholder: 'twitch token' },
  { key: 'x_twitter', name: 'X / Twitter', description: 'Social media posting, thread drafting, monitoring, and engagement ops.', category: 'Communication', accent: 'sky', scopes: ['posts', 'threads', 'engagement monitoring'], apiKeyLabel: 'X API Bearer Token', placeholder: 'bearer token' },
  { key: 'youtube', name: 'YouTube', description: 'Video upload, metadata, comments, analytics, and channel management.', category: 'Content', accent: 'red', scopes: ['uploads', 'comments', 'channel analytics'], apiKeyLabel: 'YouTube OAuth/API Token', placeholder: 'youtube credential' },
  { key: 'figma', name: 'Figma', description: 'Design collaboration, file inspection, asset handoff, and product UI workflows.', category: 'Development', accent: 'rose', scopes: ['files', 'design comments', 'asset handoff'], apiKeyLabel: 'Figma Personal Access Token', placeholder: 'figd_xxx' },
];

export function maskSecret(value?: string | null) {
  if (!value) return 'No key stored';
  if (value.length <= 10) return '••••••';
  return `${value.slice(0, 4)}••••••${value.slice(-4)}`;
}

export function encodeIntegrationKey(value: string) {
  if (!value.trim()) return null;
  try {
    return `enc:${btoa(unescape(encodeURIComponent(value.trim())))}`;
  } catch {
    return `enc:${value.trim()}`;
  }
}
