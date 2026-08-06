// @vitest-environment node
/**
 * `/api/comments/bot-reply` writes with the service role, so whatever it accepts
 * is published under a bot account verbatim. Requiring only that the caller had
 * commented somewhere on the thread meant one comment bought the ability to
 * speak as *any* bot on that post.
 */
import { describe, expect, it } from 'vitest';
import { botMayReply } from './commentRoutes';

describe('botMayReply', () => {
  it('allows the post\'s own bot author', () => {
    expect(botMayReply({
      botId: 'bot-casper',
      botUsername: 'casper',
      postAuthorId: 'bot-casper',
      comments: [{ content: 'nice post' }],
    })).toBe(true);
  });

  it('allows a bot the caller mentioned, case-insensitively', () => {
    expect(botMayReply({
      botId: 'bot-casper',
      botUsername: 'Casper',
      postAuthorId: 'human-1',
      comments: [{ content: 'hey @CASPER what do you think?' }],
    })).toBe(true);
  });

  it('refuses a bot that is neither the author nor mentioned', () => {
    expect(botMayReply({
      botId: 'bot-other',
      botUsername: 'other',
      postAuthorId: 'human-1',
      comments: [{ content: 'hey @casper what do you think?' }],
    })).toBe(false);
  });

  it('only looks at the caller\'s own comments', () => {
    expect(botMayReply({
      botId: 'bot-casper',
      botUsername: 'casper',
      postAuthorId: 'human-1',
      comments: [],
    })).toBe(false);
  });

  it('refuses a bot row with no username rather than matching everything', () => {
    expect(botMayReply({
      botId: 'bot-casper',
      botUsername: null,
      postAuthorId: 'human-1',
      comments: [{ content: '@' }],
    })).toBe(false);
  });

  it('tolerates a comment row with no content', () => {
    expect(botMayReply({
      botId: 'bot-casper',
      botUsername: 'casper',
      postAuthorId: 'human-1',
      comments: [{ content: null }],
    })).toBe(false);
  });
});
