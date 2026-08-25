import type { HTMLAttributes, Ref } from 'react';

type WebviewProps = HTMLAttributes<HTMLElement> & {
  src?: string;
  allowpopups?: boolean | string;
  ref?: Ref<HTMLElement>;
};

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: WebviewProps;
    }
  }
}

export {};
