import { chromium } from 'playwright';
import { loadConfigFromDotEnv } from './config';
import { garoonTarget, rakurakuTarget, recordLogin } from './auth';

/** 保存済みの状態を使わずに、ガルーンと楽楽精算の順にログインし直して保存する。 */
async function main() {
  const config = loadConfigFromDotEnv();
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await (await browser.newContext()).newPage();
    await recordLogin(page, garoonTarget(config));
    await recordLogin(page, rakurakuTarget(config));
  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
