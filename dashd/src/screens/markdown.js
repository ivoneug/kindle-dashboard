// Agent replies are Markdown. The detail screen shows paragraphs, lists,
// bold and code in e-ink terms. Raw HTML
// inside a message is shown as text, never rendered: a message is data.

import { Marked } from 'marked';
import { esc } from './page.js';

const renderer = {
  html({ text }) { return esc(text); },
  // Nothing to click on e-ink: keep the words, mark them, drop the URL.
  link({ tokens }) { return '<u>' + this.parser.parseInline(tokens) + '</u>'; },
  image({ text }) { return text ? esc('[' + text + ']') : ''; },
};

const md = new Marked({ gfm: true, renderer });

// Tiles use the same inline formatting and escaping as the detail screen.
// Flatten block layout so headings, lists and fenced code fit a clipped line.
const preview = new Marked({
  gfm: true,
  renderer: {
    ...renderer,
    html({ text, block }) { return esc(text) + (block ? ' ' : ''); },
    paragraph({ tokens }) { return this.parser.parseInline(tokens) + ' '; },
    heading({ tokens }) { return '<strong>' + this.parser.parseInline(tokens) + '</strong> '; },
    code({ text }) { return '<code>' + esc(text) + '</code> '; },
    blockquote({ tokens }) { return this.parser.parse(tokens) + ' '; },
    list({ ordered, start, items }) {
      return items.map((item, i) => {
        const mark = item.task ? (item.checked ? '☑' : '☐') : ordered ? (Number(start) + i) + '.' : '▪';
        return mark + ' ' + this.parser.parse(item.tokens).trim();
      }).join(' ') + ' ';
    },
    checkbox() { return ''; },
    table({ header, rows }) {
      const cells = (row) => row.map((cell) => this.parser.parseInline(cell.tokens)).join(' | ');
      return ['<strong>' + cells(header) + '</strong>', ...rows.map(cells)].join(' · ') + ' ';
    },
    hr() { return ' · '; },
    br() { return ' '; },
  },
});

export function renderMarkdown(text) {
  return md.parse(String(text || ''));
}

export function renderMarkdownPreview(text) {
  return preview.parse(String(text || '')).trim();
}
