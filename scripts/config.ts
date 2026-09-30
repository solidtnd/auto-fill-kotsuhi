import fs from 'node:fs';
import path from 'node:path';

export const LOCAL_STATE_DIR = 'local-state';
export const AUTH_STATE_PATH = path.join(LOCAL_STATE_DIR, 'state.json');
export const ROUTE_RECORD_PATH = path.join(LOCAL_STATE_DIR, 'route-selection.json');

export type Config = {
  garoonLoginUrl: string;
  garoonAllowanceUrl: string;
  rakurakuDenpyoUrl: string;
  rakurakuTmpListUrl: string;
};

const ENV_KEYS = {
  garoonLoginUrl: 'GAROON_LOGIN_URL',
  garoonAllowanceUrl: 'GAROON_ALLOWANCE_URL',
  rakurakuDenpyoUrl: 'RAKURAKU_DENPYO_URL',
  rakurakuTmpListUrl: 'RAKURAKU_TMP_LIST_URL',
} as const satisfies Record<keyof Config, string>;

/** 環境変数から設定を作る。足りないキーがあれば、全部並べてエラーにする。 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const missing = Object.values(ENV_KEYS).filter(key => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`.env に次の設定がありません: ${missing.join(', ')}(.env.example を参照)`);
  }
  return {
    garoonLoginUrl: env[ENV_KEYS.garoonLoginUrl]!.trim(),
    garoonAllowanceUrl: env[ENV_KEYS.garoonAllowanceUrl]!.trim(),
    rakurakuDenpyoUrl: env[ENV_KEYS.rakurakuDenpyoUrl]!.trim(),
    rakurakuTmpListUrl: env[ENV_KEYS.rakurakuTmpListUrl]!.trim(),
  };
}

/** `.env` を読み込んで設定を作る。 */
export function loadConfigFromDotEnv(file = '.env'): Config {
  if (!fs.existsSync(file)) {
    throw new Error(`${file} がありません。.env.example をコピーして値を埋めてください。`);
  }
  process.loadEnvFile(file);
  return loadConfig(process.env);
}
