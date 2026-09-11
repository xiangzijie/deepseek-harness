# bug-platform-autofix 鎵嬪姩璺戞壒

绗竴鏈熺ず渚嬶細鐩存帴璋冪敤 `@deepseek-ai/dsh-bug-platform-http` 涓?`@deepseek-ai/dsh-bug-platform-autofix` 搴擄紝**涓嶉渶瑕?* `cordis.yml`銆?

## 鐜鍙橀噺

鍦ㄤ粨搴撴牴鐩綍鐨?shell 涓缃紙**鍕垮啓鍏ヤ粨搴撱€佸嬁鎻愪氦瀵嗛挜**锛夛細

| 鍙橀噺 | 蹇呭～ | 璇存槑 |
|------|------|------|
| `BUG_PLATFORM_USERNAME` | 鏄?| Bug 骞冲彴鐧诲綍鐢ㄦ埛鍚?|
| `BUG_PLATFORM_PASSWORD` | 鏄?| Bug 骞冲彴鐧诲綍瀵嗙爜 |
| `DEEPSEEK_API_KEY` | 鏄?| headless agent 璋冩ā鍨?|
| `BUG_PLATFORM_BASE_URL` | 鍚?| 榛樿 `http://10.20.183.62:8080` |
| `GITLAB_TOKEN` | 鍚?| GitLab `PRIVATE-TOKEN`锛涙棤 Token 鏃朵粛鍙湰鍦?commit锛屼絾涓嶄細寮€ MR / 涓嶄細鏍囥€岀幇鍦洪獙璇併€?|

鍙€夎鐩栬矾寰勶細`BUG_PLATFORM_MAPPING_FILE`銆乣BUG_PLATFORM_STATE_FILE`銆乣BUG_PLATFORM_ASSETS_DIR`銆?

### Windows锛氫粠鐢ㄦ埛鐜璇诲彇 `GITLAB_TOKEN`

鑻?Token 鍐欏湪銆岀敤鎴枫€嶇幆澧冨彉閲忛噷锛屽綋鍓?PowerShell 鍙兘灏氭湭缁ф壙锛屽彲鍏堝悓姝ュ埌杩涚▼锛?

```powershell
$env:GITLAB_TOKEN = [System.Environment]::GetEnvironmentVariable('GITLAB_TOKEN', 'User')
$env:BUG_PLATFORM_USERNAME = '鈥?
$env:BUG_PLATFORM_PASSWORD = '鈥?
$env:DEEPSEEK_API_KEY = '鈥?
```

鏈剼鏈彧璇?`process.env`锛屼笉浼氬幓璇绘敞鍐岃〃锛涜纭繚鍚姩鍓嶇幆澧冨彉閲忓凡杩涘叆杩涚▼銆?

## 榛樿璺緞锛堟湰鏈猴級

| 鐢ㄩ€?| 榛樿 |
|------|------|
| 鑿滃崟鏄犲皠 | `D:/CODE/COMPANY/dkh-bugFix-project/menu-mapping.json` |
| custom / ailpha / home | `D:/CODE/COMPANY/dkh-bugFix-project/dkh-{custom,ailpha,home}` |
| 骞傜瓑鐘舵€?| `D:/CODE/COMPANY/dkh-bugFix-project/.dsh-bugfix/state.json` |
| 鎴浘闄勪欢 | `D:/CODE/COMPANY/dkh-bugFix-project/.dsh-bugfix/<ticketId>/` |

GitLab锛歚http://gitlab.info.dbappsecurity.com.cn`锛岄」鐩?id `8325`銆?

## 鎬庝箞璺?

鍓嶇疆锛氭湰 worktree 闇€瑕佸厛鏈変竴娆?`pnpm run build`锛堟垨鑷冲皯 `pnpm run build:lib`锛夈€俬eadless 鐨?typert-loader 浠庡悇鍖?`exports["./typert"]` 鍔犺浇 **宸叉瀯寤虹殑** `lib/typert.host.js`锛涘叏鏂?worktree 娌℃湁杩欎簺鏂囦欢鏃朵細鎶?`Cannot find module .../lib/typert.host.js`銆?

鍦?**deepseek-harness 浠撳簱鏍?*锛堟湰 worktree 鏍癸級鎵ц銆侫gent 浼氫粠鏈?harness 鍚姩 `apps/cli`锛坄dsh --profile headless`锛夛紝骞舵妸 **cwd 璁句负鏄犲皠鍒扮殑浜у搧宸ヤ綔鍖?*锛涗笉瑕佸湪 `dkh-custom` / `dkh-ailpha` 閲屾壘 `dsh`銆?

Windows 涓婅嫢 `pnpm run` 鍥?lefthook postinstall 閿佸け璐ワ細鍒犳帀浠撳簱 `.git/dsh-lefthook-install.lock` 鍚庨噸璇曪紝鎴栫敤涓嬮潰鐨?`node` 鍏ュ彛锛堜粛闇€鍏?build锛夛細

```sh
# 棣栨 / 缂?lib 鏃?
pnpm run build:lib

# 寮哄埗鍗曞彿锛堢粫杩囩姸鎬佺櫧鍚嶅崟锛?
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --ticket 428

# 涓€鏉″懡浠ゅ己鍒跺涓寚瀹氬崟锛堥€楀彿鍒嗛殧锛屼覆琛屾墽琛岋級
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --tickets 428,430,441

# 璺戞壒锛氫竴娆℃渶澶?N 鍗曪紙榛樿鐘舵€佺櫧鍚嶅崟锛氬緟纭,楠岃瘉鏈€氳繃锛涙湭鎸囨淳锛涙湁鏄犲皠锛?
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --max 5

# 鍙€夛細瑕嗙洊鍒楄〃 status 杩囨护锛堥€楀彿鍒嗛殧锛屼紶缁欏钩鍙?list锛?
node --import tsx/esm examples/bug-platform-autofix/src/run-once.ts --max 3 --status 寰呯‘璁?楠岃瘉鏈€氳繃

# 鎴栵紙渚濊禆妫€鏌ラ€氳繃鏃讹級
pnpm run bugfix:once -- --tickets 428,430,441
```

`--ticket` / `--tickets` 璧板己鍒惰矾寰勶紙缁曡繃鍒楄〃**鐘舵€?*鐧藉悕鍗曪級锛屼粛浼氭帓闄?`缃戠粶瀹夊叏鏁版嵁澶у睆`銆乭ome銆佹棤鏄犲皠锛?*涓嶈兘**涓?`--max` / `--status` 鍚岀敤锛沗--ticket` 涓?`--tickets` 涔熶簰鏂ャ€傛湰鍦?`state.json` 涓粛澶勪簬杩涜涓?phase 鐨勫崟浼氳烦杩囥€俙--max` 鍙奖鍝嶇櫧鍚嶅崟璺戞壒锛涘€欓€変粛鍙楁槧灏?/ 鏈寚娲?/ 鎺掗櫎鑿滃崟 / 鏈湴骞傜瓑绾︽潫锛屽疄闄呭鐞嗘暟鍙兘灏戜簬 N銆?

## 瀹夊叏

- 鍑瘉鍙潵鑷幆澧冨彉閲忥紱README / 浠ｇ爜 / 鏃ュ織涓嶅緱鍑虹幇鏄庢枃瀵嗙爜鎴?Token銆?
- 鍕挎妸 `.env`銆佸惈瀵嗛挜鐨勮剼鏈垨 state 閲岀殑鏁忔劅鍐呭鎻愪氦杩?git銆?
