import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';
import { type Config, loadConfigFromDotEnv } from './config';
import { ensureLoggedIn, garoonTarget, newContextWithState, rakurakuTarget } from './auth';
import { waitForBrowserClosed } from './browser';
import { type AllowanceInfo, openPreviousMonth, readAllowanceInfo } from './garoon';
import {
  addFirstMeisai,
  confirmFirstMeisai,
  copyMeisaiWithDate,
  fillBiko,
  openNewDenpyo,
  openTransit,
  saveTemporarily,
  toRakurakuDate,
} from './rakuraku-denpyo';
import { selectRoute } from './rakuraku-transit';

/** 出勤日を読み、交通費伝票を作って一時保存し、一時保存一覧を開く。読んだ手当情報を返す。出勤日がなければ伝票は作らない。 */
export async function fillKotsuhi(page: Page, config: Config, options: { prev: boolean }): Promise<AllowanceInfo> {
  await ensureLoggedIn(page, garoonTarget(config));
  if (options.prev) await openPreviousMonth(page);
  const info = await readAllowanceInfo(page);
  console.log(`${info.year}年${info.month}月度: 出勤日 ${info.workDates.length}日、${info.homeStation}→${info.workStation}`);

  const [first, ...rest] = info.workDates;
  if (!first) return info;

  await ensureLoggedIn(page, rakurakuTarget(config));
  await openNewDenpyo(page, config.rakurakuDenpyoUrl);
  await fillBiko(page, info.month);
  await addFirstMeisai(page, first, info.homeStation, info.workStation);
  await selectRoute(await openTransit(page), info.homeStation, info.workStation);
  await confirmFirstMeisai(page);
  console.log(`追加: ${toRakurakuDate(first)}`);

  for (const date of rest) {
    await copyMeisaiWithDate(page, date);
    console.log(`追加: ${toRakurakuDate(date)}`);
  }

  await saveTemporarily(page);
  await page.goto(config.rakurakuTmpListUrl);
  return info;
}

/** コマンドの入口。--prev なら前月分。最後はユーザーがブラウザを閉じるまで待つ。 */
async function main() {
  const { values } = parseArgs({ options: { prev: { type: 'boolean', default: false } } });
  const config = loadConfigFromDotEnv();
  const browser = await chromium.launch({ headless: false });
  const context = await newContextWithState(browser);
  const page = await context.newPage();

  try {
    const info = await fillKotsuhi(page, config, { prev: values.prev });
    if (info.workDates.length === 0) {
      console.log('出勤日がないので終了します。');
      await browser.close();
      return;
    }
    console.log('一時保存しました。一時保存一覧から内容を確認して、確定申請してください。');
  } catch (e) {
    console.error(`エラーで止まりました: ${e instanceof Error ? e.message : e}`);
    console.error('ブラウザは開いたままです。画面の状態を確認できます。');
    process.exitCode = 1;
  }

  console.log('終了するときはブラウザを閉じてください。');
  await waitForBrowserClosed(browser);
  await browser.close();
}

if (require.main === module) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
