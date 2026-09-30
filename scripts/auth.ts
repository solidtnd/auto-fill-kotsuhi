import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { AUTH_STATE_PATH, type Config } from './config';
import { hasCalendar } from './garoon';
import { hasDenpyoForm } from './rakuraku-denpyo';

export type LoginTarget = {
  name: string;
  loginUrl: string;
  checkUrl: string;
  isLoggedIn: (page: Page) => Promise<boolean>;
};

const LOGIN_POLL_INTERVAL_MS = 3_000;

/** ガルーンのログイン先。出勤手当カレンダー画面が見えればログイン済み。 */
export function garoonTarget(config: Config): LoginTarget {
  return {
    name: 'ガルーン',
    loginUrl: config.garoonLoginUrl,
    checkUrl: config.garoonAllowanceUrl,
    isLoggedIn: hasCalendar,
  };
}

/** 楽楽精算のログイン先。新規交通費伝票画面が見えればログイン済み。 */
export function rakurakuTarget(config: Config): LoginTarget {
  return {
    name: '楽楽精算',
    loginUrl: config.rakurakuDenpyoUrl,
    checkUrl: config.rakurakuDenpyoUrl,
    isLoggedIn: hasDenpyoForm,
  };
}

/** 保存済みのログイン状態があれば読み込んで、ブラウザコンテキストを作る。 */
export async function newContextWithState(browser: Browser, statePath = AUTH_STATE_PATH): Promise<BrowserContext> {
  return browser.newContext(fs.existsSync(statePath) ? { storageState: statePath } : {});
}

/** ユーザーのタブにパスワード入力欄が見えているか(ログイン画面にいるか)。画面遷移中も入力欄ありとみなす。 */
async function showsPasswordField(page: Page): Promise<boolean> {
  return page
    .locator('input[type="password"]:visible')
    .count()
    .then(n => n > 0, () => true);
}

/** Cookie をコピーした画面なしのブラウザで確認画面を開き、ログイン済みか調べる。 */
async function checkLoggedIn(checker: Browser, page: Page, target: LoginTarget): Promise<boolean> {
  // storageState() は localStorage を集めるために一時タブを開いてちらつくので、Cookie だけを渡す。
  const context = await checker.newContext({ storageState: { cookies: await page.context().cookies(), origins: [] } });
  try {
    const checkPage = await context.newPage();
    await checkPage.goto(target.checkUrl);
    return await target.isLoggedIn(checkPage);
  } finally {
    await context.close();
  }
}

/**
 * ユーザーがログインするまで待つ。ユーザーのタブがログイン画面を離れたら、画面なしの別のブラウザで確認画面を開いて判定する。
 * ログイン画面の表示中に確認すると、同じセッションでログイン画面が作り直されてログインに失敗するシステムがあるため、その間は確認しない。
 */
async function waitUntilLoggedIn(page: Page, target: LoginTarget, intervalMs: number): Promise<void> {
  const checker = await chromium.launch();
  try {
    for (;;) {
      if (page.isClosed()) throw new Error(`${target.name}のログイン画面が閉じられました。`);
      if (!(await showsPasswordField(page)) && (await checkLoggedIn(checker, page, target))) return;
      await sleep(intervalMs);
    }
  } finally {
    await checker.close();
  }
}

/** ログイン画面を開き、ログインされたのを検知したらログイン状態を保存する。 */
export async function recordLogin(
  page: Page,
  target: LoginTarget,
  statePath = AUTH_STATE_PATH,
  intervalMs = LOGIN_POLL_INTERVAL_MS
): Promise<void> {
  await page.goto(target.loginUrl);
  console.log(`開いた画面で${target.name}にログインしてください。ログインできたら自動で進みます。`);
  await waitUntilLoggedIn(page, target, intervalMs);

  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  await page.context().storageState({ path: statePath });
  console.log(`ログイン状態を保存しました: ${statePath}`);
}

/** 確認画面を開いてログイン済みか調べ、未ログインならログインしてもらう。確認画面を開いたまま返す。 */
export async function ensureLoggedIn(
  page: Page,
  target: LoginTarget,
  statePath = AUTH_STATE_PATH,
  intervalMs = LOGIN_POLL_INTERVAL_MS
): Promise<void> {
  await page.goto(target.checkUrl);
  if (await target.isLoggedIn(page)) return;

  console.log(`${target.name}へのログインが必要です。`);
  await recordLogin(page, target, statePath, intervalMs);

  await page.goto(target.checkUrl);
  if (!(await target.isLoggedIn(page))) {
    throw new Error(`${target.name}のログインを確認できませんでした。npm run login でやり直してください。`);
  }
}
