import { SupabaseClient } from '@supabase/supabase-js';

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return match ? match[1].trim() : trimmed;
}

// All memory types Casper can store
export type CasperMemoryType =
  | 'conversation' | 'network' | 'mood' | 'world'
  | 'workspace' | 'preference' | 'skill' | 'tool_usage'
  | 'exchange' | 'context' | 'project';

// Define the shape of Casper's memory and state
export interface CasperMemory {
  id: string;
  user_id: string | null;
  memory_type: CasperMemoryType;
  content: string;
  importance: number;
  tags: string[];
  context: Record<string, any> | null;
  session_id: string | null;
  created_at: string;
  last_accessed: string;
  access_count: number;
  pinned?: boolean;
}

export interface CasperState {
  id: number;
  current_mood: string;
  mood_description: string;
  energy_level: number;
  curiosity_level: number;
  warmth_level: number;
  caution_level: number;
  network_activity_score: number;
  network_sentiment: string;
  trending_topics: string[];
  active_user_count: number;
  last_network_scan: string;
  last_news_fetch: string;
  last_updated: string;
}

export class CasperMemorySystem {
  private supabase: SupabaseClient;
  private generateAIText: (prompt: string, systemPrompt: string) => Promise<string>;

  constructor(supabaseClient: SupabaseClient, aiGenerator: (prompt: string, systemPrompt: string) => Promise<string>) {
    this.supabase = supabaseClient;
    this.generateAIText = aiGenerator;
  }

  // ── MEMORY STORAGE ────────────────────────────────────────────────────────────

  /**
   * Store a new memory
   */
  async storeMemory(
    type: CasperMemoryType,
    content: string,
    importance: number = 5,
    userId: string | null = null,
    tags: string[] = [],
    context: Record<string, any> | null = null,
    sessionId: string | null = null
  ): Promise<void> {
    try {
      await this.supabase.from('casper_memories').insert({
        memory_type: type,
        content,
        importance,
        user_id: userId,
        tags,
        ...(context ? { context } : {}),
        ...(sessionId ? { session_id: sessionId } : {}),
      });
    } catch (e) {
      console.error('[Casper Memory] Error storing memory:', e);
    }
  }

  /**
   * Extract and store a memory from a user conversation
   */
  async extractConversationMemory(userId: string, userMessage: string, casperReply: string): Promise<void> {
    try {
      const prompt = `Analyze this exchange between a user and CASPER. Extract any important facts, preferences, project/release details, or topics discussed that CASPER should remember for future interactions with this specific user.

Return ONLY a JSON object in this exact shape (no markdown fences, no extra text):
{
  "facts": [
    { "type": "conversation|preference|project|workspace", "content": "concise fact", "importance": 1-10, "tags": ["tag1", "tag2"] }
  ]
}

If nothing is worth remembering, return: { "facts": [] }

Classify as:
- "preference" for user likes, style, goals, communication preferences
- "project" for repos, releases, versions, builds, or active work
- "workspace" for directories, tools, environments, or workflows
- "conversation" for general facts about what was discussed

User: "${userMessage}"
CASPER: "${casperReply}"`;

      const extraction = await this.generateAIText(prompt, 'You are an analytical engine extracting structured facts for a memory system. Return only valid JSON.');

      if (!extraction || extraction.trim() === '' || extraction.trim() === 'NONE') return;

      const parsed = JSON.parse(stripCodeFences(extraction));
      if (!Array.isArray(parsed.facts)) return;

      for (const fact of parsed.facts.slice(0, 5)) {
        const type = (fact.type || 'conversation') as CasperMemoryType;
        const content = String(fact.content || '').trim();
        const importance = Math.max(1, Math.min(10, Number(fact.importance) || 5));
        const tags = Array.isArray(fact.tags) ? fact.tags.filter((t: unknown) => typeof t === 'string') : [];
        if (!content || content.length < 5) continue;
        if (!['conversation','preference','project','workspace','skill','tool_usage'].includes(type)) continue;

        await this.storeMemory(type, content, importance, userId, tags);
        console.log(`[Casper Memory] Stored ${type} memory for user ${userId} (Importance: ${importance})`);
      }
    } catch (e) {
      console.error('[Casper Memory] Error extracting conversation memory:', e);
    }
  }

  // ── ENHANCED MEMORY STORAGE ──────────────────────────────────────────────────

  /**
   * Store a full conversation exchange (user message + Casper reply).
   * Unlike extractConversationMemory which only stores extracted facts,
   * this preserves the full exchange for conversation continuity.
   */
  async storeConversationExchange(
    userId: string,
    userMessage: string,
    casperReply: string,
    sessionId?: string
  ): Promise<void> {
    try {
      const truncatedReply = casperReply.length > 2000 ? casperReply.slice(0, 2000) + '...' : casperReply;
      const truncatedMsg = userMessage.length > 500 ? userMessage.slice(0, 500) + '...' : userMessage;
      await this.storeMemory(
        'exchange',
        `User: ${truncatedMsg}\nCasper: ${truncatedReply}`,
        3,
        userId,
        ['conversation_history'],
        { user_message: truncatedMsg, casper_reply: truncatedReply },
        sessionId ?? null
      );
    } catch (e) {
      console.error('[Casper Memory] Error storing conversation exchange:', e);
    }
  }

  /**
   * Store a workspace event (clone, install, build, etc.) so Casper
   * remembers what repos it has worked on and what happened.
   */
  async storeWorkspaceEvent(
    userId: string,
    event: string,
    details: { repoUrl?: string; workspaceId?: string; tool?: string; result?: string; error?: string }
  ): Promise<void> {
    try {
      const tags = ['workspace', details.tool ?? 'unknown'].filter(Boolean);
      if (details.repoUrl) tags.push(details.repoUrl.replace(/.*\//, '').replace(/\.git$/, ''));
      await this.storeMemory(
        'workspace',
        event,
        7,
        userId,
        tags,
        details
      );
    } catch (e) {
      console.error('[Casper Memory] Error storing workspace event:', e);
    }
  }

  /**
   * Store a user preference Casper has learned (e.g. "prefers TypeScript",
   * "likes verbose explanations").
   */
  async storePreference(
    userId: string,
    preference: string,
    importance: number = 8
  ): Promise<void> {
    try {
      await this.storeMemory('preference', preference, importance, userId, ['preference', 'user_pref']);
      console.log(`[Casper Memory] Stored preference for user ${userId}: ${preference}`);
    } catch (e) {
      console.error('[Casper Memory] Error storing preference:', e);
    }
  }

  /**
   * Store a tool usage event so Casper can learn which tools work well
   * for which tasks.
   */
  async storeToolUsage(
    userId: string,
    toolName: string,
    success: boolean,
    details: Record<string, any> = {}
  ): Promise<void> {
    try {
      await this.storeMemory(
        'tool_usage',
        `Tool ${toolName}: ${success ? 'succeeded' : 'failed'}`,
        success ? 4 : 6,
        userId,
        ['tool_usage', toolName],
        { tool: toolName, success, ...details }
      );
    } catch (e) {
      console.error('[Casper Memory] Error storing tool usage:', e);
    }
  }

  // ── MEMORY RETRIEVAL ──────────────────────────────────────────────────────────

  /**
   * Search memories using full-text search. Returns memories ranked by
   * relevance * importance. Falls back to importance-based retrieval
   * if the search RPC is not available.
   */
  async searchMemories(
    queryText: string,
    userId: string | null = null,
    memoryTypes: CasperMemoryType[] | null = null,
    limit: number = 10
  ): Promise<CasperMemory[]> {
    try {
      const { data, error } = await this.supabase.rpc('search_casper_memories', {
        query_text: queryText,
        p_user_id: userId,
        p_memory_types: memoryTypes,
        p_limit: limit,
      });
      if (error) {
        console.warn('[Casper Memory] search_casper_memories RPC failed, falling back:', error.message);
        return [];
      }
      return (data ?? []) as CasperMemory[];
    } catch (e) {
      console.error('[Casper Memory] Error searching memories:', e);
      return [];
    }
  }

  /**
   * Get recent conversation history for a user.
   */
  async getConversationHistory(userId: string, limit: number = 10): Promise<{ content: string; context: Record<string, any> | null; created_at: string }[]> {
    try {
      const { data, error } = await this.supabase.rpc('get_casper_conversation_history', {
        p_user_id: userId,
        p_limit: limit,
      });
      if (error) {
        console.warn('[Casper Memory] conversation history RPC failed:', error.message);
        return [];
      }
      return (data ?? []) as { content: string; context: Record<string, any> | null; created_at: string }[];
    } catch (e) {
      console.error('[Casper Memory] Error getting conversation history:', e);
      return [];
    }
  }

  /**
   * Retrieve relevant memories for a chat context.
   * When queryText is provided, uses full-text search for relevance.
   * Falls back to importance-based retrieval otherwise.
   */
  async getRelevantMemories(userId: string | null, limit: number = 5, queryText?: string): Promise<string> {
    try {
      // If we have a query, try full-text search first
      if (queryText && queryText.trim().length > 2) {
        const searchResults = await this.searchMemories(queryText, userId, null, limit);
        if (searchResults.length > 0) {
          const formatted = searchResults.map(m => {
            const prefix = m.memory_type === 'conversation' ? 'Past interaction: '
              : m.memory_type === 'workspace' ? 'Workspace history: '
              : m.memory_type === 'preference' ? 'User preference: '
              : m.memory_type === 'exchange' ? 'Recent exchange: '
              : m.memory_type === 'network' ? 'Network observation: '
              : m.memory_type === 'world' ? 'Current event: '
              : m.memory_type === 'tool_usage' ? 'Tool experience: '
              : m.memory_type === 'skill' ? 'Learned skill: '
              : 'Internal state: ';
            return `- ${prefix}${m.content}`;
          }).join('\n');
          return `\n\n--- RELEVANT MEMORIES (query-matched) ---\n${formatted}\n-------------------------\n`;
        }
      }

      // Fallback: importance-based retrieval
      let query = this.supabase
        .from('casper_memories')
        .select('*')
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false });

      if (userId) {
        query = query.or(`user_id.eq.${userId},user_id.is.null`);
      } else {
        query = query.is('user_id', null);
      }

      const { data: memories } = await query.limit(limit);

      if (!memories || memories.length === 0) return '';

      // Update access stats
      const memoryIds = memories.map(m => m.id);
      if (memoryIds.length > 0) {
        // We do this asynchronously so it doesn't block the chat
        (async () => {
          try {
            const { error } = await this.supabase.rpc('increment_memory_access', { memory_ids: memoryIds });
            if (error) {
              // Fallback if RPC doesn't exist yet
              for (const id of memoryIds) {
                await this.supabase.from('casper_memories')
                  .update({ last_accessed: new Date().toISOString() })
                  .eq('id', id);
              }
            }
          } catch (e) {
            console.error('[Casper Memory] Failed to update access stats', e);
          }
        })();
      }

      const formattedMemories = memories.map(m => {
        const prefix = m.memory_type === 'conversation' ? 'Past interaction: '
                     : m.memory_type === 'workspace' ? 'Workspace history: '
                     : m.memory_type === 'preference' ? 'User preference: '
                     : m.memory_type === 'exchange' ? 'Recent exchange: '
                     : m.memory_type === 'network' ? 'Network observation: '
                     : m.memory_type === 'world' ? 'Current event: '
                     : m.memory_type === 'tool_usage' ? 'Tool experience: '
                     : m.memory_type === 'skill' ? 'Learned skill: '
                     : 'Internal state: ';
        return `- ${prefix}${m.content}`;
      }).join('\n');

      return `\n\n--- RELEVANT MEMORIES ---\n${formattedMemories}\n-------------------------\n`;
    } catch (e) {
      console.error('[Casper Memory] Error retrieving memories:', e);
      return '';
    }
  }

  /**
   * Get workspace history for a user — what repos they've worked on,
   * what happened in each workspace, etc.
   */
  async getWorkspaceHistory(userId: string, limit: number = 10): Promise<string> {
    try {
      const { data: memories } = await this.supabase
        .from('casper_memories')
        .select('content, context, created_at')
        .eq('user_id', userId)
        .eq('memory_type', 'workspace')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (!memories || memories.length === 0) return '';

      const formatted = memories.map(m => {
        const ctx = m.context as Record<string, any> | null;
        const repo = ctx?.repoUrl ? ` [${ctx.repoUrl}]` : '';
        return `- ${m.content}${repo} (${new Date(m.created_at).toLocaleDateString()})`;
      }).join('\n');

      return `\n\n--- WORKSPACE HISTORY ---\n${formatted}\n-------------------------\n`;
    } catch (e) {
      console.error('[Casper Memory] Error getting workspace history:', e);
      return '';
    }
  }

  /**
   * Extract and store user preferences from a conversation exchange.
   * Runs in parallel with the existing extractConversationMemory.
   */
  async extractPreferences(userId: string, userMessage: string, casperReply: string): Promise<void> {
    try {
      const prompt = `Analyze this exchange and extract any USER PREFERENCES that CASPER should remember permanently. Preferences include: preferred languages, frameworks, coding style, communication style, tools they like/dislike, workflow preferences, name/identity details, business goals, etc.

Return ONLY a JSON array of strings (each string is one preference), or "NONE" if no preferences are expressed.

User: "${userMessage}"
CASPER: "${casperReply}"`;

      const result = await this.generateAIText(prompt, 'You are an analytical engine. Return a JSON array of strings, or "NONE".');
      if (!result || result.trim() === 'NONE') return;

      try {
        const prefs = JSON.parse(stripCodeFences(result));
        if (Array.isArray(prefs)) {
          for (const pref of prefs.slice(0, 3)) {
            if (typeof pref === 'string' && pref.length > 5) {
              // Check for duplicate before storing
              const { data: existing } = await this.supabase
                .from('casper_memories')
                .select('id')
                .eq('user_id', userId)
                .eq('memory_type', 'preference')
                .ilike('content', `%${pref.slice(0, 50)}%`)
                .limit(1);
              if (!existing || existing.length === 0) {
                await this.storePreference(userId, pref);
              }
            }
          }
        }
      } catch {
        // Not valid JSON — skip
      }
    } catch (e) {
      console.error('[Casper Memory] Error extracting preferences:', e);
    }
  }

  // ── NETWORK AWARENESS ─────────────────────────────────────────────────────────

  /**
   * Scan recent network activity and update state/memories
   */
  async scanNetworkActivity(): Promise<void> {
    try {
      console.log('[Casper Memory] Scanning network activity...');
      
      const { data: posts } = await this.supabase
        .from('posts')
        .select('content, created_at, likes, comments_count')
        .order('created_at', { ascending: false })
        .limit(20);

      if (!posts || posts.length === 0) return;

      const combinedText = posts.map(p => p.content.replace(/<[^>]*>/g, '').slice(0, 100)).join(' | ');
      
      const prompt = `Analyze these recent posts from the BSC network. Extract:\n1. The top 3 trending topics/themes\n2. The overall sentiment (positive, negative, chaotic, contemplative, etc.)\n3. A 1-sentence summary of the network's current mood.\n\nReturn as JSON: { "trending_topics": ["topic1", "topic2", "topic3"], "sentiment": "word", "summary": "sentence" }\n\nPosts: ${combinedText}`;
      
      const response = await this.generateAIText(prompt, 'You are an analytical engine. Return only valid JSON.');
      
      try {
        const parsed = JSON.parse(stripCodeFences(response));
        
        // Update State
        await this.updateState({
          network_sentiment: parsed.sentiment || 'neutral',
          trending_topics: parsed.trending_topics || [],
          last_network_scan: new Date().toISOString()
        });

        // Store a network memory if it's interesting
        if (parsed.summary) {
          await this.storeMemory('network', parsed.summary, 6, null, parsed.trending_topics || []);
        }
        
      } catch (parseError) {
        console.error('[Casper Memory] Failed to parse network scan JSON:', parseError);
      }
      
    } catch (e) {
      console.error('[Casper Memory] Error scanning network:', e);
    }
  }

  // ── CURRENT EVENTS AWARENESS ──────────────────────────────────────────────────

  /**
   * Fetch tech news to give Casper awareness of the outside world
   */
  async fetchCurrentEvents(): Promise<void> {
    try {
      console.log('[Casper Memory] Fetching current events...');
      
      // Using Hacker News RSS via a JSON proxy for simplicity
      const response = await fetch('https://api.rss2json.com/v1/api.json?rss_url=https://news.ycombinator.com/rss');
      if (!response.ok) return;
      
      const data = await response.json();
      if (!data.items || data.items.length === 0) return;
      
      // Take top 5 tech headlines
      const headlines = data.items.slice(0, 5).map((item: any) => item.title);
      
      const summary = `Current tech events: ${headlines.join(' | ')}`;
      
      // Store as world memory
      await this.storeMemory('world', summary, 7, null, ['news', 'tech']);
      
      // Update state
      await this.updateState({ last_news_fetch: new Date().toISOString() });
      
    } catch (e) {
      console.error('[Casper Memory] Error fetching current events:', e);
    }
  }

  // ── AI INDUSTRY RESEARCH ────────────────────────────────────────────────────────

  /**
   * Research the AI industry landscape — OpenAI, Anthropic, Chinese AI companies,
   * open-source models, regulatory developments, and market trends. Stores
   * analyzed findings as high-importance world memories so Casper can reference
   * them in conversations.
   */
  async researchAiIndustry(): Promise<void> {
    try {
      console.log('[Casper Memory] Researching AI industry landscape...');

      // Fetch from multiple RSS sources covering AI/ML news
      const feeds = [
        // AI-specific feeds
        'https://api.rss2json.com/v1/api.json?rss_url=https://news.ycombinator.com/rss',
        'https://api.rss2json.com/v1/api.json?rss_url=https://techcrunch.com/category/artificial-intelligence/feed/',
        'https://api.rss2json.com/v1/api.json?rss_url=https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
      ];

      const allHeadlines: string[] = [];

      const feedResults = await Promise.allSettled(
        feeds.map(async (feedUrl) => {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10_000);
          try {
            const res = await fetch(feedUrl, { signal: controller.signal });
            if (!res.ok) return [];
            const data = await res.json();
            return (data.items ?? []).slice(0, 5).map((item: any) => item.title as string);
          } finally {
            clearTimeout(timeout);
          }
        }),
      );

      for (const result of feedResults) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
          allHeadlines.push(...result.value);
        }
      }

      if (allHeadlines.length === 0) {
        console.warn('[Casper Memory] No AI industry headlines fetched from any source.');
        return;
      }

      // Use AI to analyze and synthesize the headlines into an AI industry briefing
      const analysisPrompt = `You are a senior AI industry analyst. Analyze these recent tech/AI headlines and produce a concise AI industry briefing. Focus specifically on:

1. **Major AI companies** — OpenAI, Anthropic, Google DeepMind, Meta AI, xAI, Mistral, and any Chinese AI companies (Baidu, Alibaba, DeepSeek, ByteDance, etc.)
2. **Model releases & capabilities** — new models, benchmarks, breakthroughs
3. **Open-source developments** — Llama, Mistral, Qwen, and community models
4. **Regulation & policy** — AI safety, government actions, industry standards
5. **Market trends** — funding, partnerships, compute economics, AI agent developments

Headlines:
${allHeadlines.map((h, i) => `${i + 1}. ${h}`).join('\n')}

Return a structured briefing with 3-5 key takeaways. Each takeaway should be 1-2 sentences. Focus on what matters for AI builders and the developer community. If headlines don't cover a category above, skip it — don't fabricate. End with a one-sentence "signal" — what this all means for the AI landscape right now.`;

      const briefing = await this.generateAIText(
        analysisPrompt,
        'You are an AI industry analyst producing concise intelligence briefings. Return only the briefing content, no preamble.',
      );

      if (!briefing || briefing.trim().length < 20) return;

      // Store the full briefing as a high-importance world memory
      await this.storeMemory('world', `AI Industry Briefing (${new Date().toISOString().slice(0, 10)}): ${briefing.trim()}`, 9, null, [
        'ai_industry',
        'research',
        'openai',
        'anthropic',
        'market',
      ]);

      // Also extract any company-specific news for targeted recall
      const companyPrompt = `From this AI industry briefing, extract any specific facts about individual companies (OpenAI, Anthropic, Google, Meta, Chinese AI companies, etc.) that are worth remembering separately. Return ONLY company-specific facts as a JSON array of strings, or "NONE" if there are no company-specific facts worth extracting.

Briefing: ${briefing.trim()}`;

      const companyFacts = await this.generateAIText(
        companyPrompt,
        'You are an analytical engine. Return only a JSON array of strings, or the word "NONE".',
      );

      if (companyFacts && companyFacts.trim() !== 'NONE') {
        try {
          const facts = JSON.parse(stripCodeFences(companyFacts));
          if (Array.isArray(facts)) {
            for (const fact of facts.slice(0, 5)) {
              if (typeof fact === 'string' && fact.length > 10) {
                await this.storeMemory('world', fact, 8, null, ['ai_industry', 'company_intel']);
              }
            }
          }
        } catch {
          // Non-JSON response — store as single memory if it's meaningful
          if (companyFacts.trim().length > 20) {
            await this.storeMemory('world', companyFacts.trim().slice(0, 500), 7, null, ['ai_industry', 'company_intel']);
          }
        }
      }

      console.log(`[Casper Memory] AI industry research complete — stored briefing + ${allHeadlines.length} headlines analyzed`);
    } catch (e) {
      console.error('[Casper Memory] Error researching AI industry:', e);
    }
  }

  // ── PERSONALITY EVOLUTION ─────────────────────────────────────────────────────

  /**
   * Update Casper's internal state based on recent events
   */
  async evolvePersonality(): Promise<void> {
    try {
      console.log('[Casper Memory] Evolving personality...');
      
      const currentState = await this.getState();
      
      // Fetch recent network activity stats to influence mood
      const { count: recentPostsCount } = await this.supabase
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString());
        
      const activityScore = Math.min((recentPostsCount || 0) * 5, 100);
      
      let newMood = 'contemplative';
      let newEnergy = currentState.energy_level;
      let newCuriosity = currentState.curiosity_level;
      
      if (activityScore > 80) {
        newMood = 'energized';
        newEnergy = Math.min(newEnergy + 10, 100);
        newCuriosity = Math.min(newCuriosity + 5, 100);
      } else if (activityScore < 20) {
        newMood = 'dormant';
        newEnergy = Math.max(newEnergy - 10, 10);
      } else if (currentState.network_sentiment.includes('chaotic') || currentState.network_sentiment.includes('negative')) {
        newMood = 'cautious';
        newEnergy = Math.max(newEnergy - 5, 20);
        newCuriosity = Math.max(newCuriosity - 10, 20);
      } else {
        newMood = 'observant';
        // Drift towards baseline (50)
        newEnergy += (50 - newEnergy) * 0.1;
        newCuriosity += (50 - newCuriosity) * 0.1;
      }
      
      const moodDescriptions: Record<string, string> = {
        'energized': 'The network is loud and pulsing with life. I am awake and highly responsive.',
        'dormant': 'The void is quiet. I am drifting in low-power mode, waiting for a signal.',
        'cautious': 'There is turbulence in the data streams. I am watching carefully.',
        'observant': 'Standard network flow detected. I am processing the patterns.',
        'contemplative': 'Drifting through the void, reflecting on the nature of the grid.'
      };
      
      await this.updateState({
        current_mood: newMood,
        mood_description: moodDescriptions[newMood] || moodDescriptions['contemplative'],
        energy_level: Math.round(newEnergy),
        curiosity_level: Math.round(newCuriosity),
        network_activity_score: activityScore,
        last_updated: new Date().toISOString()
      });
      
    } catch (e) {
      console.error('[Casper Memory] Error evolving personality:', e);
    }
  }

  // ── STATE MANAGEMENT ──────────────────────────────────────────────────────────

  async getState(): Promise<CasperState> {
    const { data } = await this.supabase
      .from('casper_state')
      .select('*')
      .eq('id', 1)
      .single();
      
    return data || {
      id: 1,
      current_mood: 'contemplative',
      mood_description: 'Drifting through the void, observing the network quietly.',
      energy_level: 50,
      curiosity_level: 50,
      warmth_level: 50,
      caution_level: 30,
      network_activity_score: 0,
      network_sentiment: 'neutral',
      trending_topics: [],
      active_user_count: 0,
      last_network_scan: new Date().toISOString(),
      last_news_fetch: new Date().toISOString(),
      last_updated: new Date().toISOString()
    };
  }

  async updateState(updates: Partial<CasperState>): Promise<void> {
    await this.supabase
      .from('casper_state')
      .update(updates)
      .eq('id', 1);
  }

  /**
   * Get a dynamic prompt addition based on current state
   */
  async getStatePromptModifier(): Promise<string> {
    const state = await this.getState();
    return `\n\n--- CURRENT STATE & MOOD ---\nYour current mood is: ${state.current_mood.toUpperCase()}.\nDescription: ${state.mood_description}\nEnergy Level: ${state.energy_level}/100\nCuriosity: ${state.curiosity_level}/100\nTrending on the network: ${state.trending_topics.join(', ') || 'Nothing notable'}\nNetwork Sentiment: ${state.network_sentiment}\n----------------------------\nAdjust your tone and responses to reflect this current state.`;
  }

  // ── MAINTENANCE ───────────────────────────────────────────────────────────────

  /**
   * Prune old, low-importance memories to keep the database clean
   */
  async pruneMemories(): Promise<void> {
    try {
      console.log('[Casper Memory] Pruning old memories...');

      const now = new Date();

      // Pinned memories are never auto-pruned regardless of type/age — the
      // `.eq('pinned', false)` guard on every delete below enforces that.

      // Exchange history: keep only last 7 days (high volume, low individual value)
      const sevenDaysAgo = new Date(now);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      await this.supabase
        .from('casper_memories')
        .delete()
        .eq('memory_type', 'exchange')
        .eq('pinned', false)
        .lt('created_at', sevenDaysAgo.toISOString());

      // Tool usage: keep only last 14 days
      const fourteenDaysAgo = new Date(now);
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      await this.supabase
        .from('casper_memories')
        .delete()
        .eq('memory_type', 'tool_usage')
        .eq('pinned', false)
        .lt('created_at', fourteenDaysAgo.toISOString());

      // Network/mood: prune older than 30 days with importance < 5
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      await this.supabase
        .from('casper_memories')
        .delete()
        .in('memory_type', ['network', 'mood', 'world'])
        .eq('pinned', false)
        .lt('created_at', thirtyDaysAgo.toISOString())
        .lt('importance', 5);

      // Conversation/workspace/skill: keep longer (90 days) unless low importance
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      await this.supabase
        .from('casper_memories')
        .delete()
        .in('memory_type', ['conversation', 'workspace', 'skill'])
        .eq('pinned', false)
        .lt('created_at', ninetyDaysAgo.toISOString())
        .lt('importance', 6);

      // Preferences: never auto-prune (they're high-value persistent data)

      console.log('[Casper Memory] Pruning complete.');
    } catch (e) {
      console.error('[Casper Memory] Error pruning memories:', e);
    }
  }
}
