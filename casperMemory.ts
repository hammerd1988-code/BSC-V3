import { SupabaseClient } from '@supabase/supabase-js';

// Define the shape of Casper's memory and state
export interface CasperMemory {
  id: string;
  user_id: string | null;
  memory_type: 'conversation' | 'network' | 'mood' | 'world';
  content: string;
  importance: number;
  tags: string[];
  created_at: string;
  last_accessed: string;
  access_count: number;
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
    type: 'conversation' | 'network' | 'mood' | 'world',
    content: string,
    importance: number = 5,
    userId: string | null = null,
    tags: string[] = []
  ): Promise<void> {
    try {
      await this.supabase.from('casper_memories').insert({
        memory_type: type,
        content,
        importance,
        user_id: userId,
        tags
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
      const prompt = `Analyze this exchange between a user and CASPER. Extract any important facts, preferences, or topics discussed that CASPER should remember for future interactions with this specific user. Be concise. If nothing is worth remembering, reply with "NONE".\n\nUser: "${userMessage}"\nCASPER: "${casperReply}"`;
      
      const extraction = await this.generateAIText(prompt, 'You are an analytical engine summarizing key facts for a memory system. Return ONLY the facts, or "NONE".');
      
      if (extraction && extraction.trim() !== 'NONE' && extraction.trim() !== '') {
        // Determine importance (1-10)
        const importancePrompt = `Rate the importance of remembering this fact about a user on a scale of 1 to 10 (1 = trivial, 10 = critical personal detail or core belief). Return ONLY the number.\n\nFact: "${extraction}"`;
        const importanceStr = await this.generateAIText(importancePrompt, 'You are an analytical engine. Return only a number between 1 and 10.');
        const importance = parseInt(importanceStr.trim()) || 5;

        await this.storeMemory('conversation', extraction, importance, userId);
        console.log(`[Casper Memory] Stored conversation memory for user ${userId} (Importance: ${importance})`);
      }
    } catch (e) {
      console.error('[Casper Memory] Error extracting conversation memory:', e);
    }
  }

  // ── MEMORY RETRIEVAL ──────────────────────────────────────────────────────────

  /**
   * Retrieve relevant memories for a chat context
   */
  async getRelevantMemories(userId: string | null, limit: number = 5): Promise<string> {
    try {
      let query = this.supabase
        .from('casper_memories')
        .select('*')
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false });

      if (userId) {
        // Get user-specific memories OR general world/network memories
        query = query.or(`user_id.eq.${userId},user_id.is.null`);
      } else {
        // Only get general memories
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
        const prefix = m.memory_type === 'conversation' ? 'Past interaction with this user: ' 
                     : m.memory_type === 'network' ? 'Network observation: '
                     : m.memory_type === 'world' ? 'Current event: '
                     : 'Internal state: ';
        return `- ${prefix}${m.content}`;
      }).join('\n');

      return `\n\n--- RELEVANT MEMORIES ---\n${formattedMemories}\n-------------------------\n`;
    } catch (e) {
      console.error('[Casper Memory] Error retrieving memories:', e);
      return '';
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
        const parsed = JSON.parse(response);
        
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
          const facts = JSON.parse(companyFacts.trim());
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
      
      // Keep the top 100 memories per user, plus top 200 general memories
      // For simplicity in this implementation, we'll just delete memories older than 30 days with importance < 5
      
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      await this.supabase
        .from('casper_memories')
        .delete()
        .lt('created_at', thirtyDaysAgo.toISOString())
        .lt('importance', 5);
        
    } catch (e) {
      console.error('[Casper Memory] Error pruning memories:', e);
    }
  }
}
