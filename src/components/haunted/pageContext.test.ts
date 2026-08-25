import { describe, expect, it } from 'vitest';
import {
  PAGE_SELECTION_CAP,
  PAGE_TEXT_CAP,
  buildHauntedCasperCommand,
  isFreshPageContext,
  wantsPageInjection,
} from './pageContext';
import { NEWTAB, type PageContext } from './ghost';

const PAGE = 'https://example.com/docs';

function ctx(overrides: Partial<PageContext> = {}): PageContext {
  return {
    url: PAGE,
    title: 'Docs',
    text: 'Hello from the page.',
    ...overrides,
  };
}

describe('wantsPageInjection', () => {
  it('is true for explicit inject or page-aware keywords', () => {
    expect(wantsPageInjection('hello')).toBe(false);
    expect(wantsPageInjection('hello', true)).toBe(true);
    expect(wantsPageInjection('Summarize this page')).toBe(true);
    expect(wantsPageInjection('key points please')).toBe(true);
    expect(wantsPageInjection('explain')).toBe(true);
  });
});

describe('isFreshPageContext', () => {
  it('requires non-empty text that belongs to the active tab (hash ignored)', () => {
    expect(isFreshPageContext(ctx(), PAGE)).toBe(true);
    expect(isFreshPageContext(ctx({ url: `${PAGE}#section` }), PAGE)).toBe(true);
    expect(isFreshPageContext(ctx({ url: 'https://other.example/' }), PAGE)).toBe(false);
    expect(isFreshPageContext(ctx({ text: '   ' }), PAGE)).toBe(false);
    expect(isFreshPageContext(null, PAGE)).toBe(false);
    expect(isFreshPageContext(ctx(), NEWTAB)).toBe(false);
  });
});

describe('buildHauntedCasperCommand', () => {
  it('includes capped page text and selection when reading is allowed', () => {
    const built = buildHauntedCasperCommand({
      userText: 'Summarize this page',
      currentUrl: PAGE,
      tabTitle: 'Docs',
      ctx: ctx({
        text: 'X'.repeat(PAGE_TEXT_CAP + 500),
        selection: 'Y'.repeat(PAGE_SELECTION_CAP + 200),
      }),
      injectPage: true,
      pageReadingAllowed: true,
    });

    expect(built.includedPageText).toBe(true);
    expect(built.includedChars).toBe(PAGE_TEXT_CAP);
    expect(built.command).toContain('Page text:');
    expect(built.command).toContain('X'.repeat(PAGE_TEXT_CAP));
    expect(built.command).not.toContain('X'.repeat(PAGE_TEXT_CAP + 1));
    expect(built.command).toContain('Y'.repeat(PAGE_SELECTION_CAP));
    expect(built.command).not.toContain('Y'.repeat(PAGE_SELECTION_CAP + 1));
    expect(built.command).toContain('User says: Summarize this page');
  });

  it('keeps URL-only context when page reading is off', () => {
    const built = buildHauntedCasperCommand({
      userText: 'Summarize this page',
      currentUrl: PAGE,
      tabTitle: 'Docs',
      ctx: ctx({ text: 'secret dashboard contents' }),
      injectPage: true,
      pageReadingAllowed: false,
    });

    expect(built.includedPageText).toBe(false);
    expect(built.includedChars).toBe(0);
    expect(built.command).not.toContain('secret dashboard contents');
    expect(built.command).not.toContain('Page text:');
    expect(built.command).toContain('page reading is off');
  });

  it('does not attach another tab\'s snapshot even when reading is allowed', () => {
    const built = buildHauntedCasperCommand({
      userText: 'Summarize this page',
      currentUrl: PAGE,
      ctx: ctx({ url: 'https://mail.example/inbox', text: 'private inbox' }),
      injectPage: true,
      pageReadingAllowed: true,
    });

    expect(built.includedPageText).toBe(false);
    expect(built.command).not.toContain('private inbox');
  });

  it('notes missing live text when inject is requested in the web app', () => {
    const built = buildHauntedCasperCommand({
      userText: 'Summarize this page',
      currentUrl: PAGE,
      ctx: null,
      injectPage: true,
      pageReadingAllowed: true,
    });

    expect(built.includedPageText).toBe(false);
    expect(built.command).toContain('live page text is only readable');
  });

  it('sends a URL browse line without page text for ordinary chat', () => {
    const built = buildHauntedCasperCommand({
      userText: 'What can you do?',
      currentUrl: PAGE,
      tabTitle: 'Docs',
      ctx: ctx(),
      pageReadingAllowed: true,
    });

    expect(built.includedPageText).toBe(false);
    expect(built.command).toContain(`[Haunted Browser viewing ${PAGE}`);
    expect(built.command).not.toContain('Page text:');
    expect(built.command).toContain('User says: What can you do?');
  });
});
