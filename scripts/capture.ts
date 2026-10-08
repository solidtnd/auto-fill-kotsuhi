import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Frame, type Page } from 'playwright';
import { waitForBrowserClosed } from './browser';

const CAPTURE_ROOT = 'capture';
const ARIA_TIMEOUT_MS = 5_000;

export const RECORDER_SCRIPT = String.raw`(() => {
  if (window.__captureInstalled) return;
  window.__captureInstalled = true;

  const ATTRS = ['id', 'name', 'type', 'role', 'aria-label', 'placeholder', 'title', 'href', 'value'];
  const CLICKABLE = 'a, button, input, select, textarea, label, summary, [role], [onclick]';

  const cssPath = el => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.documentElement; e = e.parentElement) {
      if (e.id) {
        parts.unshift('#' + CSS.escape(e.id));
        break;
      }
      let part = e.tagName.toLowerCase();
      const siblings = e.parentElement ? Array.from(e.parentElement.children).filter(c => c.tagName === e.tagName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(e) + 1) + ')';
      parts.unshift(part);
    }
    return parts.join(' > ');
  };

  const describe = el => {
    const attrs = {};
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (value) attrs[name] = value;
    }
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    return { tag: el.tagName.toLowerCase(), attrs, text, css: cssPath(el) };
  };

  const send = (type, el, extra) => window.__captureAction({ type, element: describe(el), ...extra });

  window.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    send('click', e.target.closest(CLICKABLE) || e.target);
  }, true);

  window.addEventListener('change', e => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    const checkable = el.type === 'checkbox' || el.type === 'radio';
    const selectedText = el.tagName === 'SELECT' ? el.selectedOptions[0]?.text : undefined;
    send('change', el, { value: checkable ? el.checked : el.value, selectedText });
  }, true);

  window.addEventListener('submit', e => {
    if (e.target instanceof Element) send('submit', e.target);
  }, true);
})();`;

/** 出力フォルダ名に使う、実行日時の文字列(例: 20261005-153000)。 */
function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** 画面タイトルをファイル名に使える形にする。 */
function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40) || 'untitled';
}

/** フレームのARIAスナップショットを取る。取れないフレームはエラー内容を返す。 */
async function ariaSnapshot(frame: Frame): Promise<string> {
  return frame
    .locator('html')
    .ariaSnapshot({ timeout: ARIA_TIMEOUT_MS })
    .catch(e => `(ARIAスナップショットを取得できませんでした: ${e instanceof Error ? e.message : e})`);
}

/** 画面のHTMLとARIAスナップショットを、フレームごとに連番付きで保存する。保存したフレームの一覧を返す。 */
export async function saveSnapshot(page: Page, outDir: string, seq: number) {
  const base = `${String(seq).padStart(3, '0')}_${fileSafe(await page.title())}`;
  const frames = [];
  for (const [i, frame] of page.frames().entries()) {
    const name = i === 0 ? base : `${base}.frame${i}`;
    const html = await frame.content().catch(() => undefined);
    if (html === undefined) continue;
    fs.writeFileSync(path.join(outDir, `${name}.html`), html);
    fs.writeFileSync(path.join(outDir, `${name}.aria.txt`), await ariaSnapshot(frame));
    frames.push({ file: name, url: frame.url() });
  }
  return frames;
}

/** ブラウザを開き、ユーザーの操作を記録しながら、Resumeのたびに表示中の画面を保存する。 */
async function main() {
  const url = process.argv[2];
  if (!url) throw new Error('使い方: npm run capture -- <URL>');

  const outDir = path.join(CAPTURE_ROOT, timestamp());
  fs.mkdirSync(outDir, { recursive: true });
  const log = (entry: Record<string, unknown>) =>
    fs.appendFileSync(path.join(outDir, 'actions.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const pageIds = new Map<Page, number>();
  let activePage: Page | undefined;

  await context.exposeBinding('__captureAction', ({ page, frame }, action: Record<string, unknown>) => {
    activePage = page;
    log({ tab: pageIds.get(page), url: frame.url(), ...action });
  });
  await context.addInitScript({ content: RECORDER_SCRIPT });
  context.on('page', page => {
    pageIds.set(page, pageIds.size + 1);
    activePage = page;
    log({ tab: pageIds.get(page), type: 'newTab' });
    page.on('framenavigated', frame => {
      if (frame === page.mainFrame()) log({ tab: pageIds.get(page), type: 'navigate', url: frame.url() });
    });
  });

  const currentPage = () => (activePage && !activePage.isClosed() ? activePage : context.pages().at(-1));
  const browserClosed = waitForBrowserClosed(browser).then(() => 'closed' as const);

  await (await context.newPage()).goto(url);
  console.log(`記録先: ${outDir}`);
  console.log('保存したい画面でInspectorのResume(▶)を押してください。ブラウザを閉じると終了します。');

  for (let seq = 1; ; ) {
    const page = currentPage();
    if (!page) break;
    const result = await Promise.race([
      page.pause().then(() => 'resumed' as const, () => 'pageClosed' as const),
      new Promise<'pageClosed'>(resolve => page.once('close', () => resolve('pageClosed'))),
      browserClosed,
    ]);
    if (result === 'closed') break;
    const target = currentPage();
    if (result !== 'resumed' || !target) continue;

    const frames = await saveSnapshot(target, outDir, seq).catch(e => {
      console.error(`保存に失敗しました: ${e instanceof Error ? e.message : e}`);
      return undefined;
    });
    if (!frames) continue;
    log({ tab: pageIds.get(target), type: 'snapshot', url: target.url(), frames });
    console.log(`保存しました: ${frames.map(f => f.file).join(', ')}`);
    seq++;
  }

  await browser.close().catch(() => {});
}

if (require.main === module) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
