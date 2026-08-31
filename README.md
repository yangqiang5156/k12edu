# 乐学

面向 4 岁儿童的手机 PWA 早教工作台。应用包含国学、识字、数学、英语、控笔和科学启蒙六个模块，提供每日轻量任务、宠物成长、星光奖励、家长看板以及离线数据保存。

## 本地运行

```bash
pnpm install
pnpm dev
```

生产构建与自动化测试：

```bash
CI=true pnpm test
CI=true pnpm build
CI=true pnpm preview
```

构建产物位于 `dist/`，可部署至任意 HTTPS 静态托管。项目使用相对资源路径和 Hash 路由，部署在域名根目录或子目录均可使用。

## Docker 与自动发布

本项目支持 Docker 部署。推送 `vX.Y.Z` 版本标签后，GitHub Actions 会自动测试、构建并推送 GHCR 灾备镜像，创建 GitHub Release，再将压缩镜像通过 SSH 直接传送并导入阿里云；生产机无需跨境拉取 GHCR。新容器健康检查失败时会恢复上一镜像。

服务器参数、GitHub Secrets、首次发布、回滚和客户端缓存更新策略见 [自动发布与阿里云部署](docs/自动发布与阿里云部署.md)。

本地验证容器：

```bash
docker build -t lexue:local .
docker run --rm -p 8080:80 lexue:local
```

## 手机安装

- Android：使用 Chrome 等浏览器打开 HTTPS 地址，点击页面内“添加”，或从浏览器菜单选择“安装应用”。
- iPhone/iPad：使用 Safari 打开，点击“分享”，选择“添加到主屏幕”。
- PWA 安装和 Service Worker 在正式环境中需要 HTTPS；`localhost` 本地预览除外。

首次打开后，应用壳、示例题库、图标和数字模块的中英文语音都会被缓存。更新就绪时页面会显示刷新提示。

当前内置课程共 1834 项：65 首古诗、11 篇经典古文、665 个常用字、240 道六阶数学任务、26 个英文字母、270 个主题词、12 本原创启蒙绘本、443 个描红目标和 102 个科学任务。英语先按每天 2 个新字母学习 A–Z，穿插已学字母复习；认识全部 26 个字母后，再进入主题词和每周 3 本绘本。

## 数据与家长入口

- 设置、题库、每日清单、完成事件、奖励流水、宠物、兑换和报告均存入 IndexedDB。
- 应用会申请浏览器持久存储，但清理浏览器网站数据、卸载 PWA 或系统回收仍可能删除本地记录。
- 家长应从“家长中心 → 数据”定期导出 JSON 完整备份；恢复前应用会校验格式并展示确认提示。
- 家长入口仅显示在“兑换”页面，默认固定四位口令为 `2580`。口令通过 PBKDF2-SHA256 加盐摘要保存在本机，仅用于防止儿童误触。
- 忘记家长密码时，必须先正确回答一道随机六年级数学题，才可设置新的四位数字密码。

## 内容包

家长中心支持导入 `ContentPackV1` JSON 文件。示例见 `public/content-pack-example.json`。

必填字段：

- 内容包：`schemaVersion: 1`、唯一 `id`、`title`、`contentVersion`、非空 `items`。
- 内容项：唯一 `id`、`module`、`kind`、`title`。
- `module` 可选：`guoxue`、`literacy`、`math`、`english`、`writing`、`science`。
- `kind` 可选：`poem`、`classic`、`character`、`math-choice`、`letter`、`word`、`reader`、`trace`、`science`。

内容包采用事务写入：校验或写入任一条失败时，不会留下部分数据。RAZ 绘本只提供书目、正版链接与进度管理框架，请勿导入未获授权的原书页面或音频。

## 主要规则

- 默认周一至周五为学习日，每周完成任意 5 个完整学习日可获得 5 星光和 1 宝石。
- 国学、识字、数学、英语、科学模块完成后分别获得 2 星光、1 粮食和 2 经验；控笔获得 1 星光、0.5 粮食和 1 经验。
- 同一日期、模块和任务使用固定完成键，重复点击或刷新不会重复发奖。
- 每 100 经验提升一级宠物外观；完成 5、20、50、100、200 个模块时获得里程碑勋章。
- 数学任务内置 0–1000 数字探索：支持 ±1、±10、滑动选数、随机数字、中英文展示、百位里程碑庆祝和完全离线的中英文组合朗读。

## 离线数字语音

数字模块不依赖外部 HTML 页面、网络接口或系统 TTS。`public/audio/numbers/` 中的 44 个中英文词元可以组合朗读 0–1000 的全部整数，并由 Service Worker 预缓存。665 个内置常用字的讲读音频位于 `public/audio/literacy/`，26 个字母和例词的读音位于 `public/audio/english/`。字母音频直接朗读具体字母，不朗读“uppercase/lowercase”标签，并在两个字母和例词之间保留适合跟读的停顿。

在 macOS 上需要重新生成语音时运行：

```bash
pnpm audio:numbers
pnpm audio:literacy
pnpm audio:letters
pnpm audio:guoxue
# 或一次生成全部语音
pnpm audio:all
```

脚本使用系统 `say` 和本机 `ffmpeg` 生成 MP3。应用构建和运行不需要这两个工具，只需保留已经生成的音频文件。
