import fs from 'node:fs';
import path from 'node:path';
import { ROUTE_RECORD_PATH } from './config';

export type RouteRecord = { fingerprint: string; updatedAt: string };

type RouteRecords = Record<string, RouteRecord>;

/** 駅ペアの記録キーを返す。向きを区別する。 */
export function routeKey(from: string, to: string): string {
  return `${from}→${to}`;
}

/** 記録ファイル全体を読む。ファイルがなければ空。 */
function readAll(filePath: string): RouteRecords {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as RouteRecords;
  } catch (e) {
    throw new Error(
      `${filePath} を読めません。削除すると、次の実行でルートを選び直せます。(${(e as Error).message})`
    );
  }
}

/** 駅ペアの記録を返す。なければ undefined。 */
export function findRecord(from: string, to: string, filePath = ROUTE_RECORD_PATH): RouteRecord | undefined {
  return readAll(filePath)[routeKey(from, to)];
}

/** 駅ペアの記録を保存する。同じ駅ペアの記録は上書きする。 */
export function saveRecord(
  from: string,
  to: string,
  fingerprint: string,
  filePath = ROUTE_RECORD_PATH,
  now = new Date()
): void {
  const records = readAll(filePath);
  records[routeKey(from, to)] = { fingerprint, updatedAt: now.toISOString() };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(records, null, 2) + '\n', 'utf8');
}
