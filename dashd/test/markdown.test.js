import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/screens/markdown.js';

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
