// HTML → e-ink frame. One long-lived headless Chrome page; renders are
// serialized through it, so callers can fire and await without coordinating.

import { chromium } from 'playwright-core';
import { screenshotToFrame } from './gray.js';
import { log } from './log.js';

export function createRenderer({ channel, executablePath } = {}) {
  let browser = null;
  let page = null;
  let chain = Promise.resolve();

  async function ensurePage() {
    if (page && browser && browser.isConnected()) return page;
    browser = await chromium.launch({
      channel: executablePath ? undefined : channel,
      executablePath,
      headless: true,
      // Grayscale antialiasing: LCD subpixel text would come out as colour
      // fringes that the gray conversion turns into blur.
      args: ['--disable-lcd-text', '--font-render-hinting=none'],
    });
    browser.on('disconnected', () => { browser = null; page = null; });
    page = await browser.newPage({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 1 });
    log('--', `chrome up (${executablePath || channel})`);
    return page;
  }

  // width × height is the layout size; rotateDeg turns the result onto the
  // panel afterwards.
  async function renderOnce(html, { width, height, rotateDeg = 0 }) {
    const p = await ensurePage();
    await p.setViewportSize({ width, height });
    await p.setContent(html, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    const shot = await p.screenshot({ type: 'png', animations: 'disabled', caret: 'hide' });
    return screenshotToFrame(shot, { rotateDeg });
  }

  function render(html, opts) {
    const run = chain.then(() => renderOnce(html, opts));
    chain = run.catch(() => {});
    return run;
  }

  async function close() {
    const b = browser;
    browser = null;
    page = null;
    if (b) await b.close().catch(() => {});
  }

  return { render, close };
}
