// @vitest-environment node
/**
 * /api/bot/post and /api/bot/comment write with the service role, so whatever
 * they accept is published verbatim and rendered by every client. They used to
 * check only that `content` was truthy: size, type and `media_type`'s domain
 * were all passed straight to Postgres.
 */
import { describe, expect, it } from 'vitest';
import { InvalidInput, parseBotComment, parseBotPost } from './botApi';

describe('parseBotPost', () => {
  it('normalises a well-formed post', () => {
    expect(parseBotPost({
      content: '  neural uplink established  ',
      media_url: 'https://cdn.example.com/a.png',
      media_type: 'image',
      neural_tags: ['  ai  ', 'bots'],
    })).toEqual({
      content: 'neural uplink established',
      media_url: 'https://cdn.example.com/a.png',
      media_type: 'image',
      neural_tags: ['ai', 'bots'],
    });
  });

  it('defaults the optional fields rather than sending undefined', () => {
    expect(parseBotPost({ content: 'hello' })).toEqual({
      content: 'hello',
      media_url: null,
      media_type: null,
      neural_tags: [],
    });
  });

  it('rejects a missing or whitespace-only body', () => {
    expect(() => parseBotPost({})).toThrow(InvalidInput);
    expect(() => parseBotPost({ content: '   ' })).toThrow(/content is required/i);
    expect(() => parseBotPost(undefined)).toThrow(InvalidInput);
  });

  it('rejects content that is not a string instead of coercing it', () => {
    expect(() => parseBotPost({ content: { toString: () => 'x' } })).toThrow(/must be a string/i);
    expect(() => parseBotPost({ content: 42 })).toThrow(/must be a string/i);
  });

  it('caps content length', () => {
    expect(() => parseBotPost({ content: 'a'.repeat(10_001) })).toThrow(/10000 characters or fewer/i);
    expect(parseBotPost({ content: 'a'.repeat(10_000) }).content).toHaveLength(10_000);
  });

  it("rejects a media_type outside the posts_media_type_check domain", () => {
    // 'check (media_type in (image, video))' — anything else reached Postgres
    // and came back to the caller as a 500.
    expect(() => parseBotPost({ content: 'x', media_type: 'audio' })).toThrow(/image.*video/i);
    expect(parseBotPost({ content: 'x', media_type: 'video' }).media_type).toBe('video');
    expect(parseBotPost({ content: 'x', media_type: '' }).media_type).toBeNull();
  });

  it('bounds the tag array and each tag', () => {
    expect(() => parseBotPost({ content: 'x', neural_tags: new Array(13).fill('t') }))
      .toThrow(/12 tags or fewer/i);
    expect(() => parseBotPost({ content: 'x', neural_tags: 'not-an-array' }))
      .toThrow(/must be an array/i);
    expect(() => parseBotPost({ content: 'x', neural_tags: [1] }))
      .toThrow(/only strings/i);
    expect(parseBotPost({ content: 'x', neural_tags: ['a'.repeat(80), '  '] }).neural_tags)
      .toEqual(['a'.repeat(40)]);
  });

  it('bounds media_url', () => {
    expect(() => parseBotPost({ content: 'x', media_url: `https://e.com/${'a'.repeat(2_049)}` }))
      .toThrow(/2048 characters or fewer/i);
  });
});

describe('parseBotComment', () => {
  it('requires both fields', () => {
    expect(() => parseBotComment({ content: 'hi' })).toThrow(/post_id is required/i);
    expect(() => parseBotComment({ post_id: 'p1' })).toThrow(/content is required/i);
  });

  it('trims and caps', () => {
    expect(parseBotComment({ post_id: ' p1 ', content: ' hi ' })).toEqual({ post_id: 'p1', content: 'hi' });
    expect(() => parseBotComment({ post_id: 'p1', content: 'a'.repeat(5_001) }))
      .toThrow(/5000 characters or fewer/i);
  });
});
