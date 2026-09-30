import type { Browser, Page } from 'playwright';

/** ユーザーがブラウザのタブをすべて閉じるか、ブラウザが終了するまで待つ。 */
export function waitForBrowserClosed(browser: Browser): Promise<void> {
  return new Promise(resolve => {
    if (!browser.isConnected()) return resolve();
    browser.once('disconnected', () => resolve());

    const onPageClose = () => {
      if (browser.contexts().every(context => context.pages().length === 0)) resolve();
    };
    const watch = (page: Page) => page.once('close', onPageClose);
    for (const context of browser.contexts()) {
      context.pages().forEach(watch);
      context.on('page', watch);
    }
  });
}
