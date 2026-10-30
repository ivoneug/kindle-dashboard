import { renderMarkdown, renderMarkdownPreview } from '../screens/markdown.js';

export const validTs = (ts) => typeof ts === 'string' && /^\d{1,20}\.\d{1,9}$/.test(ts);
const tsKey = (ts) => { const [whole, part] = ts.split('.'); return whole.padStart(20, '0') + part.padEnd(9, '0'); };
export const compareTs = (a, b) => tsKey(a) < tsKey(b) ? -1 : tsKey(a) > tsKey(b) ? 1 : 0;
const decode = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const literal = (s) => String(s).replace(/[\\`*_{}\[\]()#+.!|>~-]/g, '\\$&');

function rich(elements = []) {
  return elements.map((e) => {
    if (e.type === 'text') {
      let text = e.text || '';
      if (e.style?.code) return '`' + text + '`';
      if (e.style?.bold) text = '*' + text + '*';
      if (e.style?.italic) text = '_' + text + '_';
      if (e.style?.strike) text = '~' + text + '~';
      return text;
    }
    if (e.type === 'link') return '<' + e.url + (e.text ? '|' + e.text : '') + '>';
    if (e.type === 'user') return '<@' + e.user_id + '>';
    if (e.type === 'channel') return '<#' + e.channel_id + '>';
    if (e.type === 'emoji') return ':' + e.name + ':';
    if (e.type === 'broadcast') return '<!' + e.range + '>';
    if (e.type === 'rich_text_list') return (e.elements || []).map((item, i) =>
      '  '.repeat(Math.min(8, e.indent || 0)) + (e.style === 'ordered' ? (i + 1) + '. ' : '- ') + rich(item.elements)).join('\n');
    if (e.type === 'rich_text_quote') return rich(e.elements).split('\n').map((line) => '> ' + line).join('\n');
    if (e.type === 'rich_text_preformatted') return '```\n' + rich(e.elements) + '\n```';
    return e.elements ? rich(e.elements) : '';
  }).join('');
}

function blocksText(blocks = []) {
  return blocks.map((b) => {
    if (b.type === 'rich_text') return (b.elements || []).map((e) => rich([e])).join('\n');
    return [b.text?.text, ...(b.fields || []).map((f) => f.text), ...(b.elements || []).map((e) => e.text)].filter((s) => typeof s === 'string').join('\n');
  }).filter(Boolean).join('\n\n');
}

export function normalizeMessage(raw, users = {}) {
  if (!validTs(raw?.ts) || raw.type !== 'message' || (raw.thread_ts && raw.thread_ts !== raw.ts) ||
    ['channel_join', 'channel_leave', 'message_deleted', 'message_changed', 'tombstone'].includes(raw.subtype)) return null;
  return normalizeReply(raw, users);
}

export function normalizeReply(raw, users = {}) {
  if (!validTs(raw?.ts) || ['message_deleted', 'tombstone'].includes(raw.subtype)) return null;
  // Block Kit is the visible message; text can be only its notification fallback.
  const parts = [blocksText(raw.blocks) || raw.text];
  for (const a of raw.attachments || []) {
    const body = [a.pretext, a.title, a.text, ...(a.fields || []).map((f) => [f.title, f.value].filter(Boolean).join(': ')), blocksText(a.blocks)].filter(Boolean).join('\n\n') || a.fallback;
    if (body && !parts.some((p) => p && p.includes(body))) parts.push(body);
  }
  for (const f of raw.files || []) parts.push('[File: ' + (f.title || f.name || 'attachment') + ']');
  const author = raw.username || raw.bot_profile?.name || users[raw.user] || raw.user || 'Slack';
  return { id: raw.ts, user: raw.user || '', author, text: parts.filter(Boolean).join('\n\n'),
    replyCount: raw.reply_count || 0, latestReply: raw.latest_reply || null, edited: raw.edited?.ts || null };
}

// Slack mrkdwn is distinct from Markdown. Convert only prose; code stays literal.
export function slackMarkdown(text, users = {}) {
  return String(text || '').split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, i) => {
    if (i % 2) return decode(part);
    return decode(part)
      .replace(/<@([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, label) => '@' + literal(users[id] || label || id))
      .replace(/<#([A-Z0-9]+)(?:\|([^>]+))?>/g, (_, id, label) => '#' + literal(label || id))
      .replace(/<!subteam\^[^|>]+\|([^>]+)>/g, (_, label) => literal(label))
      .replace(/<!(here|channel|everyone)>/g, '@$1')
      .replace(/<((?:https?:\/\/|mailto:)[^>|]+)(?:\|([^>]*))?>/g, (_, url, label) => literal(label || url.replace(/^mailto:/, '')))
      .replace(/(^|[^\w*])\*([^*\n]+)\*(?!\w)/g, '$1**$2**')
      .replace(/(^|[^\w~])~([^~\n]+)~(?!\w)/g, '$1~~$2~~');
  }).join('');
}

export const renderSlackText = (text, users) => renderMarkdown(slackMarkdown(text, users), { breaks: true });
export const previewSlackText = (text, users) => renderMarkdownPreview(slackMarkdown(text, users));
