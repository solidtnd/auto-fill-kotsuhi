import type { Page } from 'playwright';
import { findRecord, saveRecord } from './route-record';

export type Candidate = { idx: string; fingerprint: string };

const SEL = {
  candidate: '#resultHyouka_t tr.hyouka:visible',
  fingerprint: (idx: string) => `#keiroTable${idx} span.eki, #keiroTable${idx} td.rosen`,
  candidateRow: (idx: string) => `#resultHyouka_t${idx}`,
  decide: '#decideButton',
};

const BINDING_NAME = '__autoFillKotsuhiDecide';
const BANNER_TEXT = 'auto-fill-kotsuhi: 使うルートをクリックして「決定」を押してください';

const CANDIDATE_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 10_000;

/** 改行・全角空白を含む連続した空白を1つにし、前後を削る。 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 記録と同じ目印の候補の位置を返す。なければ -1。 */
export function findCandidateIndex(fingerprints: string[], recorded: string): number {
  const target = normalizeText(recorded);
  return fingerprints.findIndex(f => normalizeText(f) === target);
}

/** 表示中の経路候補ごとに、経路番号と駅・路線の並び(目印)を読む。 */
export async function readCandidates(transitPage: Page): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const row of await transitPage.locator(SEL.candidate).all()) {
    const idx = await row.getAttribute('idx');
    if (!idx) continue;
    const parts = await transitPage.locator(SEL.fingerprint(idx)).allInnerTexts();
    candidates.push({ idx, fingerprint: normalizeText(parts.join(' ')) });
  }
  return candidates;
}

/** 経路候補が出るまで待って読む。出なければユーザーが検索し直すのを待つ。 */
async function waitForCandidates(transitPage: Page): Promise<Candidate[]> {
  const first = transitPage.locator(SEL.candidate).first();
  try {
    await first.waitFor({ timeout: CANDIDATE_TIMEOUT_MS });
  } catch {
    console.log('ルート候補が表示されません(駅名があいまいな場合など)。');
    console.log('乗換案内のタブで駅を選んで検索してください。経路の一覧が出たら自動で進みます。');
    await first.waitFor({ timeout: 0 });
  }
  return readCandidates(transitPage);
}

type ChoiceWatcherArgs = {
  bindingName: string;
  bannerText: string;
  selectors: { row: string; selected: string; decide: string; fingerprint: string };
};

/** ページ内で動かす処理。経路行のクリックを覚えておき、決定ボタンが押されたらその経路の駅・路線をNode側に渡す。 */
function installChoiceWatcher({ bindingName, bannerText, selectors }: ChoiceWatcherArgs): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__autoFillKotsuhiInstalled) return;
  w.__autoFillKotsuhiInstalled = true;

  let clickedIdx: string | null = null;
  document.addEventListener('click', e => {
    const target = e.target instanceof Element ? e.target : null;
    const row = target?.closest(selectors.row);
    if (row) clickedIdx = row.getAttribute('idx');
    if (!target?.closest(selectors.decide)) return;
    const idx = clickedIdx ?? document.querySelector(selectors.selected)?.getAttribute('idx') ?? null;
    const elements = idx ? [...document.querySelectorAll(selectors.fingerprint.replaceAll('{idx}', idx))] : [];
    const parts = elements.map(el => (el as HTMLElement).innerText);
    (w[bindingName] as (parts: string[]) => void)(parts);
  }, true);

  const banner = document.createElement('div');
  banner.textContent = bannerText;
  banner.style.cssText =
    'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:8px;' +
    'background:#fff3b0;color:#000;font-size:14px;text-align:center;pointer-events:none;';
  if (document.body) document.body.append(banner);
  else document.addEventListener('DOMContentLoaded', () => document.body.append(banner));
}

/** ユーザーが乗換案内のタブで経路を選んで「決定」を押すのを待ち、選んだ経路の目印を返す。 */
export async function waitForUserChoice(transitPage: Page): Promise<string> {
  const args: ChoiceWatcherArgs = {
    bindingName: BINDING_NAME,
    bannerText: BANNER_TEXT,
    selectors: {
      row: 'tr.hyouka[idx]',
      selected: 'tr.hyouka.selected[idx]',
      decide: SEL.decide,
      fingerprint: SEL.fingerprint('{idx}'),
    },
  };
  return new Promise<string>((resolve, reject) => {
    const onClose = () => reject(new Error('ルートの決定を検知できませんでした。乗換案内のタブが閉じられました。'));
    transitPage.once('close', onClose);
    const decided = (_source: unknown, parts: string[]) => {
      const fingerprint = normalizeText(parts.join(' '));
      if (!fingerprint) return;
      transitPage.off('close', onClose);
      resolve(fingerprint);
    };
    Promise.all([
      transitPage.exposeBinding(BINDING_NAME, decided),
      transitPage.addInitScript(installChoiceWatcher, args),
    ])
      // 今の画面への組み込みは画面遷移で失敗することがあるが、遷移先には init script で組み込まれる。
      .then(() => transitPage.evaluate(installChoiceWatcher, args).catch(() => {}))
      .catch(reject);
  });
}

/** タブが閉じるのを待つ。閉じたら true、時間切れなら false。 */
function waitClosed(transitPage: Page): Promise<boolean> {
  if (transitPage.isClosed()) return Promise.resolve(true);
  return transitPage.waitForEvent('close', { timeout: CLOSE_TIMEOUT_MS }).then(
    () => true,
    () => false
  );
}

/** 候補を選んで決定する。タブが自動で閉じなければ閉じる。 */
export async function chooseCandidate(transitPage: Page, candidate: Candidate): Promise<void> {
  await transitPage.click(SEL.candidateRow(candidate.idx));
  const closed = waitClosed(transitPage);
  await transitPage.click(SEL.decide);
  if (!(await closed)) await transitPage.close();
}

/** 記録と一致する候補があれば選び、なければユーザーに乗換案内のタブで選んでもらって記録する。 */
export async function selectRoute(transitPage: Page, from: string, to: string): Promise<void> {
  const candidates = await waitForCandidates(transitPage);
  const fingerprints = candidates.map(c => c.fingerprint);
  const record = findRecord(from, to);
  const recordedIndex = record ? findCandidateIndex(fingerprints, record.fingerprint) : -1;

  if (recordedIndex !== -1) {
    console.log(`記録済みのルートを選びます: ${fingerprints[recordedIndex]}`);
    await chooseCandidate(transitPage, candidates[recordedIndex]);
    return;
  }

  console.log(record ? '記録したルートが今回の候補にありません。' : `${from}→${to} のルートはまだ記録がありません。`);
  console.log('乗換案内のタブで使うルートをクリックし、「決定」を押してください。');
  const fingerprint = await waitForUserChoice(transitPage);
  if (!(await waitClosed(transitPage))) await transitPage.close();
  saveRecord(from, to, fingerprint);
  console.log(`選んだルート: ${fingerprint}`);
  console.log('このルートを記録しました。次回からは自動で選びます。');
}
