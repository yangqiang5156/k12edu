# 阿里云 OSS 密钥轮换操作指南

核对日期：2026-10-17。本文是人工操作指南，不会自动修改云端权限或配置。

## 1. 先确认项目正在使用哪组密钥

用本地编辑器打开根目录 `.env`，找到 `OSS_ACCESS_KEY_ID`。生产环境按本项目既有部署目录，在宝塔“文件”中打开 `/root/lexue/.env`，找到同名字段。分别记录对应的 AccessKey ID，判断本地和生产是否用同一组凭据。不要复制 Secret 到聊天、工单、截图或公开文件。

OSS AccessKey 归属阿里云主账号或 RAM 用户，不是在某个 Bucket 中单独创建。Secret 仅创建时显示一次，以后无法再次查看；更换意味着创建新 ID 和新 Secret，而不是修改旧 Secret。

进入 [RAM 控制台](https://ram.console.aliyun.com/) → 身份管理 → 用户，在用户列表的筛选/搜索条件中按 AccessKey ID 查询归属用户（界面若支持此条件）。若找不到，检查是否登录了正确的阿里云账号，以及右上角头像 → AccessKey 管理中的主账号密钥。可参考[查询密钥归属](https://help.aliyun.com/zh/document_detail/463039.html)。

只记录 ID 来做对应，不必找回旧 Secret。生产与本地不同的旧密钥需要分别识别，旧备份中曾出现的密钥也要查明是否仍启用。

## 2. 选择轮换方式并检查权限

如果旧密钥属于本项目专用、权限合适的 RAM 用户，可在同一用户下创建第二组密钥，权限沿用该用户的有效权限。每个 RAM 用户最多有两组 AccessKey。若名额已满，不要随意删除正在使用的密钥；先核实闲置密钥，或创建新的项目专用 RAM 用户。

如果原来使用主账号密钥，或 RAM 用户还供其他项目共用，建议创建新的专用 RAM 用户，例如 `lexue-oss`：RAM → 身份管理 → 用户 → 创建用户；仅供应用调用，不需要为它开通控制台登录。随后只给它本项目 OSS 目录的必要权限。不要为应用授予 RAM 管理员、账号管理员或全站 OSS 管理权限。

需要新建最小权限策略时，在 RAM → 权限管理 → 权限策略 → 创建权限策略 → 脚本编辑中使用下面的示例，再把策略授权给新 RAM 用户。将 `YOUR_BUCKET_NAME` 替换为 `.env` 中的 `OSS_BUCKET`，路径按实际 `OSS_TTS_PREFIX` 和 `OSS_STORY_PREFIX` 替换；不要将真实密钥写进策略。

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["oss:GetObject", "oss:PutObject", "oss:DeleteObject"],
      "Resource": [
        "acs:oss:*:*:YOUR_BUCKET_NAME/lexue/tts/*",
        "acs:oss:*:*:YOUR_BUCKET_NAME/lexue/stories/*"
      ]
    }
  ]
}
```

本项目普通对象读写与删除使用上述权限；`GetObjectMeta` 也由 `oss:GetObject` 授权。若桶开启 KMS 加密或存在额外显式拒绝策略，还需按桶实际配置核对相应权限。此策略不提供 OSS 控制台列举桶/对象的浏览权限，不应为了在控制台看目录就直接扩大应用权限。参考 [OSS 授权语法与接口映射](https://help.aliyun.com/zh/oss/user-guide/authorization-syntax-and-elements)。

## 3. 创建新 AccessKey

在 RAM → 身份管理 → 用户 → 点击目标用户 → 凭证管理（部分界面称认证管理）→ AccessKey → 创建 AccessKey。按提示选择实际应用场景并完成安全验证。

创建成功后，把新 ID 与 Secret 成对保存到密码管理器等私有位置；关闭窗口后无法再查看 Secret。此时先保留旧密钥启用，等所有使用它的应用切换并验证后再禁用。不要给应用 RAM 用户额外授予管理 AccessKey 的权限来完成这次操作，应由已有管理员操作。

参考 [阿里云创建 AccessKey 官方说明](https://help.aliyun.com/zh/ram/user-guide/create-an-accesskey-pair)。

## 4. 备份并更新本地和生产 .env

生产服务器终端在实际部署目录执行；下例采用本项目既有路径：

```sh
cd /root/lexue
umask 077
mkdir -p .env.backups
chmod 700 .env.backups
cp -p .env ".env.backups/.env.before-oss-$(date +%Y%m%d-%H%M%S)"
```

随后用宝塔文件编辑器修改 `/root/lexue/.env`，只替换下面两项，不修改 Bucket、地域、Endpoint、路径前缀及其他密钥：

```dotenv
OSS_ACCESS_KEY_ID='新AccessKey ID'
OSS_ACCESS_KEY_SECRET='新AccessKey Secret'
```

本地 `.env` 同样先私有备份，再更新成对的两个字段；如果本地有独立的 RAM 用户，则应轮换该用户自己的凭据。不要把真实值复制到 `.env.example`。同组旧密钥若还供其他应用、脚本或 OSS 工具使用，也必须切换；GitHub Secrets 只有实际保存过这组 OSS 密钥时才需要更新，本项目正常发布由服务器 `.env` 提供 OSS 凭据。

保存后保持生产 `.env` 权限为600：

```sh
chmod 600 /root/lexue/.env
```

不要输出完整 `.env` 或完整 `docker compose config` 到聊天/日志。

## 5. 重新创建应用容器

仍在生产部署目录执行：

```sh
docker compose -f compose.yaml up -d --force-recreate --pull never lexue
docker inspect --format '{{.State.Health.Status}}' lexue
```

启动初期可能显示 `starting`，稍后应变为 `healthy`。本项目把 `.env` 只读挂载进容器，文件编辑可能替换文件节点，因此需要 `--force-recreate`；单纯刷新网页或只执行 `docker restart` 可能仍读到旧文件。

只重建 `lexue` 应用，不重建数据库或变更应用版本；本地开发/预览服务也需重新启动。

## 6. 实际验证 OSS，而不只看网页能否打开

普通朗读可能命中浏览器或本机缓存，网页正常和容器健康不能证明新密钥已生效。可以在生产服务器运行以下独立检查：它在两个业务前缀下各写入一个随机测试对象、读回并校验后删除，不访问其他业务文件，也不调用付费语音或大模型接口；会产生少量正常 OSS 请求费用。

```sh
docker exec -i lexue node --env-file=/app/.env --input-type=module <<'JS'
import OSS from 'ali-oss';
import { randomUUID } from 'node:crypto';
const env = process.env;
for (const [prefix, internal] of [
  [env.OSS_TTS_PREFIX || 'lexue/tts/', env.OSS_INTERNAL === 'true'],
  [env.OSS_STORY_PREFIX || 'lexue/stories', env.OSS_STORY_INTERNAL === 'true'],
]) {
  const client = new OSS({
    region: env.OSS_REGION, bucket: env.OSS_BUCKET,
    accessKeyId: env.OSS_ACCESS_KEY_ID, accessKeySecret: env.OSS_ACCESS_KEY_SECRET,
    endpoint: env.OSS_ENDPOINT || undefined, internal, secure: true, timeout: 15000,
  });
  const key = `${prefix.replace(/^\/+|\/+$/g, '')}/healthchecks/rotation-${randomUUID()}.txt`;
  const marker = randomUUID();
  let uploaded = false;
  try {
    await client.put(key, Buffer.from(marker)); uploaded = true;
    const result = await client.get(key);
    if (Buffer.from(result.content).toString() !== marker) throw new Error('读写内容不一致');
    await client.getObjectMeta(key);
  } finally {
    if (uploaded) await client.delete(key);
  }
  console.log(`${prefix}: OSS 写入、读取、元数据读取、删除通过`);
}
JS
```

该进程显式加载容器内 `.env`，不会依赖主进程启动时加载的环境变量。若报权限错误，先核对新 RAM 用户授权、桶策略、Endpoint、IP限制及加密要求，不要直接切换为管理员权限。若测试上传后删除失败，只清理对应 `healthchecks/rotation-*.txt` 测试对象，勿批量删除业务对象。

再打开网站试听一个内置故事，核对播放、拖动和续听。在 RAM 用户的 AccessKey 页面核对新 ID 的最近使用信息（可能延迟），并确认生产 `.env` 填写的是新 ID。

## 7. 禁用旧密钥，再做一次验证

回到原 RAM 用户的 AccessKey 列表，按旧 ID 找到旧密钥，点击“禁用”。再次运行第6步检查并试听故事。本地、生产、上传工具等全部通过后，确认不再有旧密钥调用，再按控制台流程删除旧密钥。

若禁用后有其他项目故障，说明旧密钥仍有使用方；应补齐迁移。已怀疑泄露的旧密钥不要为长期兼容继续启用；确需临时恢复时，应明确评估风险并尽快切换。

如果已经发现异常调用或正在产生异常费用，应优先禁用疑似泄露密钥并止损，接受服务可能短暂不可用，不应为了无感切换继续暴露密钥。

旧 `.env.backups` 可保留为受限回滚材料，但旧密钥应在云端失效；不要用旧备份恢复已撤销的凭据。无需删除 Bucket、重传故事、把桶改为公共读或重新生成音频。

官方顺序为“创建第二组 → 替换所有使用方 → 禁用旧组 → 验证 → 删除旧组”，见 [轮转 RAM 用户的 AccessKey](https://help.aliyun.com/zh/ram/user-guide/rotate-accesskey-pairs-of-ram-users)。
