import test from 'node:test';
import assert from 'node:assert/strict';
import { safePostHtml } from '../html.ts';

test('safePostHtml escapes content when DOM APIs are unavailable', () => {
  const input = `<script>alert('x')</script><b>ok</b>&`;
  const sanitized = safePostHtml(input);

  assert.equal(
    sanitized,
    '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&lt;b&gt;ok&lt;/b&gt;&amp;',
  );
});

