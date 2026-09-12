# hxwl-01 听力验配记录工作台

门店听力师与复诊助理使用的听力验配记录工作台：患者档案、纯音测听（气导/骨导）、
言语识别率、助听器型号与增益调整的录入、筛选、近期记录查看与 Markdown 摘要导出。
纯前端应用，数据保存在本机浏览器 localStorage，无需后端。

## 技术栈

React 19 + Vite 7 + TypeScript + 原生 CSS

## 本地运行

```bash
npm install
npm run dev
```

打开 http://localhost:5101 即可使用（首次进入自带 3 位演示患者与 3 条验配记录）。
项目 `.npmrc` 已固定 `legacy-peer-deps` 等选项，直接 `npm install` 即可，无需额外参数。

## 脚本

```bash
npm run dev            # 开发服务器（5101）
npm run build          # 生产构建到 dist/
npm run preview        # 本地预览生产构建（5101）
npm run typecheck      # 类型检查（源码 src + 测试 test + 脚本 scripts）
npm test               # jsdom 场景隔离测试（62 个断言，0 个 act 警告）
npm run setup:browser  # 一键准备真实浏览器（幂等，详见下节）
npm run test:browser   # Playwright 真实 Chromium 端到端验证（自动先跑 setup，17 个断言）
npm run verify         # 一条命令串行执行 typecheck + test + test:browser + build
```

## 真实浏览器测试环境（无需 root，自动准备）

`npm run test:browser` 会通过 `pretest:browser` 钩子自动执行 `scripts/setup-browser.ts`，
该脚本幂等，已完成的步骤自动跳过：

1. 从 `playwright-core` 解析当前锁定的 Chromium 版本，下载完整浏览器并解压到
   `~/.cache/ms-playwright/chromium-<rev>`；官方源失败时自动回退国内镜像
   （`cdn.npmmirror.com` / `registry.npmmirror.com`）。
2. 用 `ldd` 检测缺失的系统库，按 Debian bookworm 的 arm64/amd64 软件包索引下载对应
   `.deb`，解包到 `~/chrome-libs/root`，循环到依赖闭环（本机两轮即可）。
3. 写出 `~/chrome-libs/.ldpath`；运行测试时只把它注入浏览器子进程的
   `LD_LIBRARY_PATH`，不影响全局环境，也不需要 root / apt。
4. 结束前真实 headless 启动一次浏览器做自检。

浏览器与库都在用户主目录，因此**不需要** `npx playwright install` 或系统级安装。

### 离线缓存与复用

所有下载物都保留在缓存目录 `~/chrome-libs/cache`（约 210 MB），**默认优先命中缓存**，
已下载的 Chromium 安装包、Debian 索引、`.deb` 可反复复用、支持离线：

```bash
# 有网环境预热一次（填充缓存）
npm run setup:browser

# 之后即使断网也可执行（0 次联网，仅解包缓存）
OFFLINE=1 npm run setup:browser
OFFLINE=1 npm run test:browser
```

离线但缺少某项缓存时，脚本会明确指出缺的文件与缓存路径，并提示先在有网环境预热。
跨机器离线时，拷贝 `~/chrome-libs/cache` 与 `~/.cache/ms-playwright` 即可；缓存目录
可用 `HXWL_BROWSER_CACHE` 改到其他位置。

### 环境变量与失败提示

| 变量 | 作用 |
| --- | --- |
| `OFFLINE=1` | 纯离线，只使用缓存、绝不联网 |
| `PLAYWRIGHT_CHROME=/path/to/chrome` | 直接用系统浏览器（非 Linux / 非 Debian 推荐） |
| `HXWL_BROWSER_CACHE` | 离线缓存目录（默认 `~/chrome-libs/cache`） |
| `HXWL_CHROME_LIB_ROOT` | 解包库根目录（默认 `~/chrome-libs/root`） |
| `HXWL_FORCE_DEB=1` | 非 Debian 系 Linux 也强制用 bookworm `.deb` 解包 |
| `PLAYWRIGHT_DOWNLOAD_HOST` | 额外/优先的 Chromium 下载源（逗号分隔多个） |
| `DEBIAN_MIRROR` | Debian 源镜像（默认 `deb.debian.org`） |

脚本在以下情况会退出码 1 并给出可操作的安装指引：缺少 `curl/unzip/dpkg-deb/ldd`；
非 Debian 系（按 Fedora / Arch / Alpine 分别给出 `dnf/pacman/apk` 命令或
`PLAYWRIGHT_CHROME` 方案）；所有下载源失败且无缓存；遇到映射表之外的新 soname；
浏览器下载后启动自检失败。新增系统依赖时，在 `scripts/setup-browser.ts` 的
`CURATED_SONAME_PKG` 中补充 soname → Debian 包名即可。

> 在已具备 Chromium 运行库的常规桌面/CI 环境，setup 第 2 步会检测到依赖齐全而跳过。
> dev server 由测试脚本在 5199 端口自动拉起、结束时按进程组回收。

## 功能说明

### 角色

- **听力师**：全部权限——新增患者档案、录入任意分类（初配/复调/复诊/儿童/老人）。
- **复诊助理**：可查看、筛选、导出，仅能录入「复诊」分类；不显示新增患者档案入口。
- 顶部可切换角色并填写记录人姓名（提交记录的前置条件），选择保存在本机。

### 新增与保存

- 患者档案：姓名（≥2 字）、性别、出生日期（不得晚于今天）、电话（选填，格式校验）、备注；
  **同名 + 同出生日期**判定为重复档案并阻止保存。
- 验配记录：
  - 气导 500/1k/2k/4k Hz 必填（250、8k 选填），骨导 500/1k/2k 必填（4k 选填），阈值 -10~120 整数；
  - 同频率骨导显著高于气导（>10 dB，气骨差异常）会提示核对；
  - 言语识别率 0–100 整数，至少填写一只耳；
  - 至少一台助听器，型号必填、增益为 -20~40 dB 的数值，支持多台与调整说明；
  - 就诊日期不得晚于今天。
- **重复提交防护**（两层）：
  1. 同患者 + 同日期 + 同分类，且气导、骨导、言语识别率与助听器（型号/验配耳/增益/说明）
     完全相同 → 判定为重复记录，提示已存在记录编号；上述任一项不同（如复调增益、骨导复测变化）
     均视为新记录允许保存；
  2. 5 秒内内容完全相同的二次提交（双击/重放）→ 直接拦截。
- 录入不完整时：顶部红色横幅给出首要原因，每个出错字段标红并显示具体提示。

### 筛选与查看

- 「近期记录」默认展示近 14 天；「全部记录」展示历史全部。
- 可按分类、记录人角色筛选，并按患者姓名 / 助听器型号 / 记录人关键字搜索。
- 列表展示双耳 PTA（500/1k/2k 平均）、WRS、助听器型号与增益。
- 点击「查看」打开详情：临床符号听力图（红 O 右耳气导、蓝 X 左耳气导、骨导尖括号）、
  PTA/听力损失分级、WRS、助听器与增益卡片、用户反馈。
- 「患者档案」页按人查看档案卡、最近一次结果与全部历史记录。

### 导出摘要

- 列表页「导出筛选结果」：按当前筛选条件导出批量 Markdown 摘要（含筛选条件与汇总表）；
  筛选结果为空时给出错误提示。
- 详情页「导出 Markdown 摘要」：导出单条完整记录（双耳阈值表、WRS、助听器/增益、反馈）。
- 文件通过浏览器下载，文件名含患者姓名/日期，带 UTF-8 BOM，可直接用 Typora/VS Code 打开。

## 数据与重置

所有数据仅存于浏览器 localStorage（键 `hxwl-audiology-workbench:v1`），刷新与重启不丢失；
页面底部「恢复演示数据」可清空并重置为内置示例。

## 目录结构

```
src/
  types.ts                 # 领域类型、PTA 与听力损失分级
  validation.ts            # 档案/记录校验、重复记录与重复提交检测
  store.ts                 # localStorage 持久化 store、会话、演示数据
  export.ts                # 单条/批量 Markdown 摘要与下载
  App.tsx                  # 顶栏、角色、筛选、列表、患者档案页
  components/
    PatientForm.tsx        # 新增患者档案弹窗（含通用 Modal）
    EncounterForm.tsx      # 验配记录录入（阈值表/WRS/助听器）
    EncounterDetail.tsx    # 记录详情与单条导出
    AudiogramChart.tsx     # SVG 听力图
test/
  smoke.tsx                # jsdom 场景隔离测试（单元 + 集成）
  browser.e2e.ts           # Playwright 真实浏览器端到端验证
  browser-env.ts           # 浏览器可执行文件与库路径的共享解析
  setup-dom.ts             # jsdom 测试环境（DOM 全局/CSS stub）
scripts/
  setup-browser.ts         # 一键下载 Chromium + 无 root 补齐系统依赖库（幂等）
tsconfig.test.json         # 含 test/scripts 的类型检查配置
```
