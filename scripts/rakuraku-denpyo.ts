import type { Page } from 'playwright';
import type { WorkDate } from './garoon';

const SEL = {
  biko: 'textarea[name="biko"]',
  addMeisai: '.e2e-denpyo-insert-meisai-btn',
  inputWindow: '#inputAreaWindow',
  dateInput: '#inputAreaWindow input[name="meisaiDate"]',
  fromInput: '#inputAreaWindow input[name="startPoint"]',
  toInput: '#inputAreaWindow input[name="arrivalPoint"]',
  roundTrip: '#inputAreaWindow select[name="ohukuKbn"]',
  kotsukikan: '#inputAreaWindow select[name="kotsukikan"]',
  transitButton: '#inputAreaWindow button.norikae',
  insertMeisai: '#inputAreaWindow button.insertMeisai',
  firstMeisaiCopy: '#meisai0 .copyMeisai',
  saveTemporarily: '.denpyo__footer button.save',
};

/** 楽楽精算の日付欄の形式(YYYY/MM/DD)にする。 */
export function toRakurakuDate(date: WorkDate): string {
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${date.year}/${mm}/${dd}`;
}

/** 新規伝票画面の明細追加ボタンがあるか(ログイン判定に使う)。 */
export async function hasDenpyoForm(page: Page): Promise<boolean> {
  return (await page.locator(SEL.addMeisai).count()) > 0;
}

/** 新規交通費伝票画面を開く。 */
export async function openNewDenpyo(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator(SEL.addMeisai).waitFor();
}

/** 伝票の備考に対象月の数字(9月なら「9」)を入れる。 */
export async function fillBiko(page: Page, month: number): Promise<void> {
  await page.fill(SEL.biko, String(month));
}

/** 入力欄に入力し、フォーカスを外して画面側の処理を走らせる。 */
async function fillAndBlur(page: Page, selector: string, value: string): Promise<void> {
  await page.fill(selector, value);
  await page.press(selector, 'Tab');
}

/** 明細を追加して入力ウィンドウを開き、日付・駅・往復を入れる。確定はしない。 */
export async function addFirstMeisai(page: Page, date: WorkDate, from: string, to: string): Promise<void> {
  await page.click(SEL.addMeisai);
  await page.locator(SEL.inputWindow).waitFor({ state: 'visible' });
  await fillAndBlur(page, SEL.dateInput, toRakurakuDate(date));
  await page.selectOption(SEL.roundTrip, { label: '往復' });
  await fillAndBlur(page, SEL.fromInput, from);
  await fillAndBlur(page, SEL.toInput, to);
}

/** 乗換案内ボタンを押し、開いた乗換案内Biz.のタブを返す。 */
export async function openTransit(page: Page): Promise<Page> {
  const [transitPage] = await Promise.all([page.waitForEvent('popup'), page.click(SEL.transitButton)]);
  await transitPage.waitForLoadState();
  return transitPage;
}

/** 入力ウィンドウの確定を押し、ウィンドウが閉じるまで待つ。 */
export async function confirmMeisai(page: Page): Promise<void> {
  await page.click(SEL.insertMeisai);
  await page.locator(SEL.inputWindow).waitFor({ state: 'hidden' });
}

/** 1件目の明細で交通機関に「電車」を選んで確定する。乗換案内の決定の後に呼ぶ。 */
export async function confirmFirstMeisai(page: Page): Promise<void> {
  await page.selectOption(SEL.kotsukikan, { label: '電車' });
  await confirmMeisai(page);
}

/** 1件目の明細をコピーし、日付を変えて確定する。往復などはコピーで引き継がれる。 */
export async function copyMeisaiWithDate(page: Page, date: WorkDate): Promise<void> {
  await page.click(SEL.firstMeisaiCopy);
  await page.locator(SEL.inputWindow).waitFor({ state: 'visible' });
  await fillAndBlur(page, SEL.dateInput, toRakurakuDate(date));
  await confirmMeisai(page);
}

/** 伝票を一時保存し、完了画面に移る(伝票の編集画面から離れる)まで待つ。 */
export async function saveTemporarily(page: Page): Promise<void> {
  await page.click(SEL.saveTemporarily);
  await page.locator(SEL.addMeisai).waitFor({ state: 'detached' });
  await page.waitForLoadState();
}
