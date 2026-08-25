import { NEWTAB, samePageUrl, type PageContext } from './ghost';

export const PAGE_TEXT_CAP = 12_000;
export const PAGE_SELECTION_CAP = 1_500;
export const PAGE_INJECT_KEYWORDS =
  /(summar|explain|this page|current page|fix site|fix this|about this|describe|key points|extract|tldr)/i;

export function wantsPageInjection(userText: string, injectPage?: boolean): boolean {
  return Boolean(injectPage) || PAGE_INJECT_KEYWORDS.test(userText);
}

export function isFreshPageContext(ctx: PageContext | null | undefined, currentUrl: string): boolean {
  return Boolean(ctx?.text?.trim() && samePageUrl(ctx.url, currentUrl));
}

export function buildHauntedCasperCommand(input: {
  userText: string;
  currentUrl: string;
  tabTitle?: string;
  ctx: PageContext | null;
  injectPage?: boolean;
  pageReadingAllowed: boolean;
}): { command: string; includedPageText: boolean; includedChars: number } {
  const browseLine =
    input.currentUrl === NEWTAB
      ? '[Haunted Browser idle — new tab]'
      : `[Haunted Browser viewing ${input.currentUrl}${input.tabTitle ? ` — "${input.tabTitle}"` : ''}]`;

  const wants = wantsPageInjection(input.userText, input.injectPage);
  const fresh = isFreshPageContext(input.ctx, input.currentUrl);

  if (wants && fresh && input.pageReadingAllowed) {
    const snippet = input.ctx!.text!.slice(0, PAGE_TEXT_CAP);
    const selection = input.ctx!.selection?.trim()
      ? `\n\nThe user has selected this text on the page — focus on it if relevant:\n"${input.ctx!.selection!.slice(0, PAGE_SELECTION_CAP)}"`
      : '';
    return {
      command: `${browseLine}${selection}\n\nPage text:\n${snippet}\n\nUser says: ${input.userText}\n\n(Answer using the provided page text excerpt when relevant.)`,
      includedPageText: true,
      includedChars: snippet.length,
    };
  }

  if (wants && !input.pageReadingAllowed && input.currentUrl !== NEWTAB) {
    return {
      command: `${browseLine}\n\nUser says: ${input.userText}\n\n(Note: page reading is off — I can see the URL but not the page text.)`,
      includedPageText: false,
      includedChars: 0,
    };
  }

  if (input.injectPage && !fresh && input.currentUrl !== NEWTAB) {
    return {
      command: `${browseLine}\n\nUser says: ${input.userText}\n\n(Note: live page text is only readable in the Blood Sweat Code desktop app. I can still talk about this URL.)`,
      includedPageText: false,
      includedChars: 0,
    };
  }

  return {
    command: `${browseLine}\n\nUser says: ${input.userText}`,
    includedPageText: false,
    includedChars: 0,
  };
}
