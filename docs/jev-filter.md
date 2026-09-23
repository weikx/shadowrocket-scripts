# 小红书 Feed Jev 过滤器

当前系统的完整架构、数据流、判断算法、安全边界和失败策略见 [`technical-solution.md`](./technical-solution.md)。

这个版本由两个部分组成：

1. Shadowrocket 脚本读取小红书 Feed，只提取接口实际返回的标题、正文、分类、内容类型和广告标记；作者昵称不会上传，也不参与判断。
2. Cloudflare Worker 保存 TypeSafe API Key，调用 Jev 并返回结构化的 `keep/drop` 结果。

默认采用 `observe` 模式：不删除帖子，只把作者昵称临时改为 `[✅保留] 原昵称` 或 `[❌移除] 原昵称`。观察结果满意以后，才将 Module 中的 `mode=observe` 改为 `mode=filter`。

## 1. 准备 TypeSafe API Key

在 TypeSafe 控制台创建 API Key。不要把它填进 Shadowrocket 脚本、Module、GitHub 文件或聊天消息。它只会作为 Cloudflare Worker Secret 保存。

## 2. 部署 Cloudflare Worker

克隆仓库并安装依赖：

```bash
git clone https://github.com/weikx/shadowrocket-scripts.git
cd shadowrocket-scripts
npm install
npx wrangler login
```

先部署 Worker：

```bash
npm run worker:deploy
```

命令结束时会输出类似下面的地址，请保存它：

```text
https://xhs-jev-filter.<你的 Cloudflare 子域>.workers.dev
```

设置 TypeSafe API Key：

```bash
npx wrangler secret put TYPESAFE_API_KEY --config worker/wrangler.jsonc
```

生成一个仅供 Shadowrocket 调用 Worker 的随机令牌：

```bash
openssl rand -hex 32
```

保存命令输出，然后把同一个值设置成 Worker Secret：

```bash
npx wrangler secret put CLIENT_TOKEN --config worker/wrangler.jsonc
```

最后检查服务：

```bash
curl https://xhs-jev-filter.<你的 Cloudflare 子域>.workers.dev/health
```

预期结果：

```json
{"ok":true,"model":"jev-1.13.0","configured":true}
```

## 3. 配置个人过滤策略

复制示例文件：

```bash
cp worker/policy.example.json worker/policy.local.json
```

编辑 `worker/policy.local.json`，可调整：

- `blockedTopics`：明确不想看到的主题。
- `highValueDescription`：你认为有价值的内容标准。
- `contentValueCriteria`：信息价值从 0 到 3 的四级定义。
- `enabledSignals`：分别启用或关闭营销、引战、群体对立、情绪宣泄、负面噪音和互动诱导。
- `signalDefinitions`：每个语义信号中“是”和“否”的明确边界。
- `thresholds`：每个信号各自的过滤阈值。

将整个配置作为 Secret 上传：

```bash
npx wrangler secret put FILTER_POLICY_JSON --config worker/wrangler.jsonc < worker/policy.local.json
```

`policy.local.json` 已被 `.gitignore` 排除，不会被提交。修改策略后重新执行上面的命令即可，不需要重新发布 Shadowrocket 脚本。

当前默认策略偏严格：直播卡片和小红书显式标记的广告固定过滤；普通帖子综合判断标题、Feed 返回的正文、分类和内容类型，不参考作者身份。Jev 分别返回内容价值、营销、引战、群体对立、情绪宣泄、负面噪音和互动诱导的结构化判断，Worker 再应用可见的阈值。详细规则见下表。

| 规则 | 默认条件 | 原因码 |
| --- | --- | --- |
| 屏蔽主题 | `blocked >= 0.80` | `BLOCKED_TOPIC` |
| 商业营销 | `commercial >= 0.75` | `COMMERCIAL` |
| 引战 | `conflictBait >= 0.70` | `CONFLICT_BAIT` |
| 群体对立 | `polarization >= 0.70` | `POLARIZATION` |
| 低信息价值 | `contentValue <= 0.45` 且 `confidence >= 0.40` | `LOW_INFORMATION_VALUE` |
| 情绪宣泄 | 概率 `>= 0.80`，并且满足低信息价值 | `EMOTIONAL_VENTING` |
| 负面噪音 | 概率 `>= 0.80`，并且满足低信息价值 | `NEGATIVE_NOISE` |
| 互动诱导 | 概率 `>= 0.75`，并且满足低信息价值 | `ENGAGEMENT_BAIT` |

商业营销、引战和群体对立是硬语义规则，达到各自阈值即可过滤。情绪宣泄、负面噪音和互动诱导会同时检查信息价值，避免把有事实、有分析或有行动建议的负面新闻、风险提示、诈骗预警和疾病科普误删。低信息价值本身也会触发过滤。只有标题和正文同时为空时才直接标记为无内容；标题为空但正文存在时仍由 Jev 判断。

Jev 无法查看 Feed 里的封面与视频。部分小红书首页 Feed 响应并不下发帖子正文（示例响应中的 `desc` 就全部为空），此时本次判断仍只能使用标题；脚本不会为了补正文而逐帖调用详情接口。

## 4. 配置 Shadowrocket Module

模板地址：

```text
https://raw.githubusercontent.com/weikx/shadowrocket-scripts/main/shadowrocket/xhs-feed-jev.module
```

这个模板不能原样启用，因为 `argument` 里有两个占位符。先下载或复制 Module，然后在 Shadowrocket 本地编辑这一行：

```ini
argument=endpoint=https%3A%2F%2FREPLACE_WITH_YOUR_WORKER.workers.dev%2Ffilter&token=REPLACE_WITH_CLIENT_TOKEN&mode=observe&timeoutMs=6000&minKeep=6&minKeepRatio=0.4
```

替换内容：

- `endpoint`：Worker 的 `/filter` 地址，需要进行 URL 编码。对于普通 `https://.../filter` 地址，只需要将 `:` 写成 `%3A`、`/` 写成 `%2F`。
- `token`：上一步生成并保存的 `CLIENT_TOKEN`。64 位十六进制字符串不需要额外编码。
- 初次测试保持 `mode=observe`。

示例：

```ini
argument=endpoint=https%3A%2F%2Fxhs-jev-filter.example.workers.dev%2Ffilter&token=0123456789abcdef&mode=observe&timeoutMs=6000&minKeep=6&minKeepRatio=0.4
```

然后安装并启用该本地 Module。之前安装的 Shadowrocket HTTPS 解密证书和 `rec.xiaohongshu.com` MITM 配置可以继续使用。

注意：Module 中的 `CLIENT_TOKEN` 不要提交到公开 GitHub。它不是 TypeSafe API Key，但泄露后别人可以消耗你的 Jev 调用额度。

## 5. 观察与正式过滤

在 `observe` 模式下刷新小红书首页：

```text
[✅保留] 原作者
[❌移除] 原作者
```

观察一段时间并调整策略、阈值，确认误判率可以接受以后，把本地 Module 中的：

```text
mode=observe
```

改成：

```text
mode=filter
```

正式过滤时，直播卡片和显式广告固定删除。其余由 Jev 判定的帖子默认至少保留 6 条，同时至少保留原 Feed 的 40%，避免语义判断一次删掉过多内容。Worker、Jev 或 JSON 处理失败时，脚本会原样放行该页。

## 6. 接口测试

设置 shell 变量后可以绕过 Shadowrocket，直接测试 Worker：

```bash
FILTER_URL='https://xhs-jev-filter.<你的 Cloudflare 子域>.workers.dev/filter'
CLIENT_TOKEN_VALUE='<你的 CLIENT_TOKEN>'

curl "$FILTER_URL" \
  -H "Authorization: Bearer $CLIENT_TOKEN_VALUE" \
  -H 'Content-Type: application/json' \
  --data '{"items":[{"key":"0","title":"在飞书里用豆包工作的几个实用方法","content":"正文介绍三个可以直接复用的工作流及其适用场景。","category":"科技","contentType":"normal","isAds":false}]}'
```

响应中的 `decisions[0].action` 应为 `keep` 或 `drop`，并包含各项概率、原因代码、模型版本和 token 用量。

当前实现遵循 TypeSafe 的 System One 方式：把帖子字段组织为结构化 `state`，用一个 `Score` 判断信息价值，用多个原子 `Noul` 分别判断营销、引战、群体对立、情绪宣泄、负面噪音、互动诱导和可选屏蔽主题，再由 Worker 中的明确阈值组合最终结果。所有问题在一次请求中并行计算。模型固定为 `jev-1.13.0`，避免模型别名升级后让已经调好的阈值无提示漂移。

## 7. 本地验证

```bash
npm test
npm run worker:deploy -- --dry-run
```

## 隐私边界

Shadowrocket 不会把原始响应或请求头发给 Worker。发送内容仅包括：

- 帖子标题；
- Feed 接口实际返回的帖子正文（最多 600 个字符）；
- 分类名称；
- 图文、视频或直播类型；
- 小红书返回的广告布尔标记。

Cookie、Session ID、IDFA、定位、帖子 ID、图片地址、视频地址和推荐跟踪参数都不会上传。
