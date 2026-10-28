// Claude's replies are Markdown. The detail screen shows them the way the
// Claude app does — paragraphs, lists, bold, code — in e-ink terms. Raw HTML
// inside a message is shown as text, never rendered: a message is data.

import { Marked } from 'marked';
import { esc } from './page.js';

const md = new Marked({
  gfm: true,
  renderer: {
    html({ text }) { return esc(text); },
    // Nothing to click on e-ink: keep the words, mark them, drop the URL.
    link({ tokens }) { return '<u>' + this.parser.parseInline(tokens) + '</u>'; },
    image({ text }) { return text ? esc('[' + text + ']') : ''; },
  },
});

export function renderMarkdown(text) {
  return md.parse(String(text || ''));
}
