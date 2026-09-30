import type { Page } from 'playwright';

export type WorkDate = { year: number; month: number; day: number };

export type AllowanceInfo = {
  year: number;
  month: number;
  workDates: WorkDate[];
  homeStation: string;
  workStation: string;
};

const SEL = {
  monthLink: 'a[href*="makeAllowance.php?year="]',
  calendar: '#tbl_sykntat table[name^="cld_sykn_"]',
  workDay: '#tbl_sykntat table[name="cld_sykn_1"] td[data-flag="on"]',
  sameReturn: 'select[name="ofk_flg_1"]',
  homeStation: 'select[name="st_hm_id_1_1"]',
  workStation: 'select[name="st_ws_id_1_1"]',
};

/** 出勤手当のカレンダーがあるか(ログイン判定に使う)。 */
export async function hasCalendar(page: Page): Promise<boolean> {
  return (await page.locator(SEL.calendar).count()) > 0;
}

/** 出勤日セルの文字から、最初の数字を日付として読む。 */
export function parseDay(text: string): number {
  const match = text.match(/\d+/);
  if (!match) throw new Error(`出勤日のセルを日付として読めません: "${text}"`);
  return Number(match[0]);
}

/** 駅名の select で選ばれている駅名を読む。未選択ならエラー。 */
async function readStation(page: Page, selector: string, label: string): Promise<string> {
  const text = await page
    .locator(selector)
    .evaluate(el => (el as HTMLSelectElement).selectedOptions[0]?.text ?? '');
  const station = text.replace(/\s+/g, ' ').trim();
  if (!station) throw new Error(`ガルーンの${label}が選ばれていません`);
  return station;
}

/** 出勤手当の1行目で、往路と復路が同じであることを確かめる。 */
async function assertSameReturn(page: Page): Promise<void> {
  if ((await page.locator(SEL.sameReturn).inputValue()) !== 'true') {
    throw new Error('ガルーンの出勤手当で往路と復路が「異なる」になっています。「同じ」の場合にだけ対応しています。');
  }
}

/** 前月の年と月を返す。 */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

/** 対象月度のリンクから、年・月とリンクのURLを読む。 */
async function readTargetMonth(page: Page): Promise<{ year: number; month: number; url: URL }> {
  const href = await page.locator(SEL.monthLink).first().getAttribute('href');
  if (!href) throw new Error('対象月度のリンクが見つかりません');
  const url = new URL(href, page.url().startsWith('http') ? page.url() : 'https://placeholder.invalid/');
  const year = Number(url.searchParams.get('year'));
  const month = Number(url.searchParams.get('month'));
  if (!year || !month) throw new Error(`対象月度を読めません: ${href}`);
  return { year, month, url };
}

/** 表示中の月度の前月の画面を開き、前月が表示されたことを確かめる。 */
export async function openPreviousMonth(page: Page): Promise<void> {
  const { year, month, url } = await readTargetMonth(page);
  const prev = previousMonth(year, month);
  url.searchParams.set('year', String(prev.year));
  url.searchParams.set('month', String(prev.month));
  await page.goto(url.toString());

  const shown = await readTargetMonth(page);
  if (shown.year !== prev.year || shown.month !== prev.month) {
    throw new Error(`${prev.year}年${prev.month}月度を開けませんでした(表示: ${shown.year}年${shown.month}月度)`);
  }
}

/** 出勤手当カレンダー画面から、対象月度・1行目の出勤日(昇順)・最寄り駅2つを読む。2行目以降は無視する。 */
export async function readAllowanceInfo(page: Page): Promise<AllowanceInfo> {
  const { year, month } = await readTargetMonth(page);

  await assertSameReturn(page);
  const days = (await page.locator(SEL.workDay).allInnerTexts()).map(parseDay).sort((a, b) => a - b);

  return {
    year,
    month,
    workDates: days.map(day => ({ year, month, day })),
    homeStation: await readStation(page, SEL.homeStation, '自宅最寄り駅'),
    workStation: await readStation(page, SEL.workStation, '作業場所最寄り駅'),
  };
}
