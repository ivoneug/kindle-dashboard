import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderMarkdownPreview } from '../src/screens/markdown.js';
import { renderSessions } from '../src/screens/sessions.js';

test('lists, bold and code come out as markup', () => {
  const html = renderMarkdown('**Done**\n\n- one `a`\n- two\n\n1. first');
  assert.match(html, /<strong>Done<\/strong>/);
  assert.match(html, /<ul>\s*<li>one <code>a<\/code><\/li>\s*<li>two<\/li>\s*<\/ul>/);
  assert.match(html, /<ol>\s*<li>first<\/li>\s*<\/ol>/);
});

test('HTML in a message is shown, not rendered', () => {
  const html = renderMarkdown('see <task-id>x</task-id> and <script>alert(1)</script>');
  assert.doesNotMatch(html, /<script>|<task-id>/);
  assert.match(html, /&lt;task-id&gt;/);
});

test('links keep their words and lose the URL', () => {
  const html = renderMarkdown('[the PR](https://example.com/pr/1)');
  assert.match(html, /<u>the PR<\/u>/);
  assert.doesNotMatch(html, /example\.com/);
});

test('tile previews keep inline styles and flatten block Markdown', () => {
  const html = renderMarkdownPreview('# **Готово**\n\n- *первый* `a`\n- [второй](https://example.com)\n\n3. третий\n4. четвёртый\n\n```js\nconst a = 1;\n```');
  assert.match(html, /<strong><strong>Готово<\/strong><\/strong>/);
  assert.match(html, /▪ <em>первый<\/em> <code>a<\/code> ▪ <u>второй<\/u>/);
  assert.match(html, /3\. третий 4\. четвёртый/);
  assert.match(html, /<code>const a = 1;<\/code>/);
  assert.doesNotMatch(html, /<(?:p|ul|ol|li|pre|h1|br)\b|example\.com/);
});

test('tile previews escape raw HTML and code and show task markers as text', () => {
  const html = renderMarkdownPreview('- [x] **готово**\n- [ ] осталось\n\n<script>alert(1)</script>\n\n```html\n<img src=x onerror=alert(1)>\n```');
  assert.match(html, /☑ <strong>готово<\/strong> ☐ осталось/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<code>&lt;img src=x onerror=alert\(1\)&gt;<\/code>/);
  assert.doesNotMatch(html, /<(?:script|img|input)\b/);
});

test('session tiles render message Markdown and keep tool descriptions literal', () => {
  const session = { id: 'a', name: 'Session', state: 'busy' };
  const render = (detail) => renderSessions({
    sessions: [session], details: { a: detail }, selected: 0, orientation: 'portrait',
  }, { width: 600, height: 800 });
  assert.match(render({ lastMessage: '**Готово**: `код`' }), /<span class="tmessage"><strong>Готово<\/strong>: <code>код<\/code><\/span>/);
  assert.match(render({ currentTool: '<exec>', lastMessage: '*проверяю*' }), /&lt;exec&gt; · <span class="tmessage"><em>проверяю<\/em>/);
  const activity = render({ activity: 'cat **/*.js <input>', lastMessage: '**скрыто**' });
  assert.match(activity, /▶ cat \*\*\/\*\.js &lt;input&gt;/);
  assert.doesNotMatch(activity, /<span class="tmessage">/);
});
