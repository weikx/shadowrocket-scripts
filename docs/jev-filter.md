# 小红书 Feed Jev 过滤器

当前系统的完整架构、数据流、判断算法、安全边界和失败策略见 [`technical-solution.md`](./technical-solution.md)。

这个版本由两个部分组成：

1. Shadowrocket 脚本读取小红书 Feed，只提取接口实际返回的标题、正文、分类、内容类型和广告标记；作者昵称不会上传，也不参与判断。
2. Cloudflare Worker 保存 TypeSafe API Key，调用 Jev 并返回结构化的 `keep/drop` 结果。

默认采用 `observe` 模式：不删除帖子，只把作者昵称临时改为 `[✅应保留] 原昵称` 或 `[❌应移除] 原昵称`。对于应移除的帖子，标题还会变成 `[移除原因：具体原因] 原标题`。观察结果满意以后，才将 Module 中的 `mode=observe` 改为 `mode=filter`。

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
- `enabledSignals`：分别启用或关闭营销、引战、群体对立、性别/家庭对立、个人情绪表达、负面噪音和互动诱导。
- `signalDefinitions`：每个语义信号中“是”和“否”的明确边界。
- `enabledPreserveSignals`：分别启用或关闭经验分享、生活分享和摄影分享保护。
- `preserveSignalDefinitions`：三类应保留内容的明确边界。
- `thresholds`：每个信号各自的过滤阈值。

将整个配置作为 Secret 上传：

```bash
npx wrangler secret put FILTER_POLICY_JSON --config worker/wrangler.jsonc < worker/policy.local.json
```

`policy.local.json` 已被 `.gitignore` 排除，不会被提交。修改策略后重新执行上面的命令即可，不需要重新发布 Shadowrocket 脚本。

当前策略同时包含过滤信号和保留信号：直播卡片和小红书显式标记的广告固定过滤；普通帖子综合判断标题、Feed 返回的正文、分类和内容类型，不参考作者身份。默认策略过滤明确的商业营销、引战、群体对立、性别/家庭对立，以及以表达作者个人情绪或心情为主要目的的帖子；低信息价值、互动诱导和一般负面主题不会单独触发删除。

| 规则 | 默认条件 | 原因码 |
| --- | --- | --- |
| 屏蔽主题 | `blocked >= 0.80` | `BLOCKED_TOPIC` |
| 商业营销 | `commercial >= 0.80` | `COMMERCIAL` |
| 引战 | `conflictBait >= 0.82` | `CONFLICT_BAIT` |
| 群体对立 | `polarization >= 0.82` | `POLARIZATION` |
| 性别/家庭对立 | `genderFamilyConflict >= 0.65` | `GENDER_FAMILY_CONFLICT` |
| 个人情绪表达 | `personalEmotion >= 0.65` | `PERSONAL_EMOTION` |

三类保留信号及默认阈值：

| 保留信号 | 默认阈值 | 包含的内容 |
| --- | ---: | --- |
| 经验分享 | `experienceSharing >= 0.55` | 真实经历、过程、结果、测评、教训、观察或个人叙述，不要求必须写成教程 |
| 生活分享 | `lifestyleSharing >= 0.60` | 日常、饮食、旅行、居家、宠物、家庭活动、穿搭、爱好或个人审美 |
| 摄影分享 | `photographySharing >= 0.60` | 摄影作品、照片日记、风景、人像、街拍、构图、相机或修图，短标题也可以 |

保留信号用于记录和解释生活、摄影、经验分享，但不覆盖上述过滤规则。尤其是，以个人情绪表达为主要目的的生活或经验分享仍会移除；明确广告、直播、屏蔽主题、商业营销和各类对立内容也会移除。

这意味着摄影作品和普通生活记录不再被迫满足“必须有知识或教程”的要求；真实经验分享也不要求一定有步骤或普遍适用。由于 Jev 看不到图片和视频，摄影内容仍需要标题、正文或分类中存在可识别线索；完全无法从文字和分类识别的视觉内容暂时不能可靠保护。

信息价值 Score 不再是删除条件，低分本身不会删除帖子，也不会产生“信息价值低”原因。个人情绪表达判断不区分正面或负面：开心、兴奋、难过、委屈、愤怒、焦虑等，只要表达自己的情绪或心情是帖子主要目的，就会移除。情绪只是顺带提及，而主体是事实、分析、方法、测评、创作展示或具体问题时，不按个人情绪表达移除。标题为空但正文存在时仍由 Jev 判断；标题和正文同时为空时默认保留，因为它仍可能是 Jev 看不到的纯摄影或视频内容。

性别/家庭对立覆盖男女、夫妻、父母与子女、婆媳、代际和家庭阵营等关系。讨论这些话题本身不会触发过滤；只有通过群体刻板印象、集体归罪、蔑视、优劣论、敌对泛化或煽动站队来制造或加剧对立时才命中。

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

如果 GitHub 脚本更新后手机仍显示旧文案或旧行为，说明 Shadowrocket 还在使用已缓存的远程脚本。将个人 Module 中的 `script-path` 替换为公共 Module 当前提供的固定提交地址，然后停用并重新启用 Module。固定提交地址不会和旧版共用缓存；成功加载本版后，Shadowrocket 日志会包含 `scriptVersion=2026.09.23.3`。更新 `script-path` 时只替换 URL，保留个人 Module 中原有的 `endpoint`、`token`、`mode` 和其他参数。

注意：Module 中的 `CLIENT_TOKEN` 不要提交到公开 GitHub。它不是 TypeSafe API Key，但泄露后别人可以消耗你的 Jev 调用额度。

## 5. 观察与正式过滤

在 `observe` 模式下刷新小红书首页：

```text
[✅应保留] 原作者
[❌应移除] 原作者
[移除原因：商业营销] 原标题
```

标题中的原因来自 Worker 返回的 `reasonCodes`，可能同时显示多个原因。保留帖的标题不修改。

观察一段时间并调整策略、阈值，确认误判率可以接受以后，把本地 Module 中的：

```text
mode=observe
```

改成：

```text
mode=filter
```

正式过滤时，直播、显式广告、屏蔽主题、商业营销、引战、群体对立、性别/家庭对立和个人情绪表达固定删除，不受最低保留数量影响。其他可选语义规则仍受至少保留 6 条和至少保留原 Feed 40% 的安全机制约束。Worker、Jev 或 JSON 处理失败时，脚本会原样放行该页。

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

当前实现遵循 TypeSafe 的 System One 方式：把帖子字段组织为结构化 `state`，用一个 `Score` 判断信息价值，用多个原子 `Noul` 分别判断已启用的五个过滤信号、三个保留信号和可选屏蔽主题，再由 Worker 中的明确阈值组合最终结果。“性别/家庭对立”和“个人情绪表达”各用一个独立 Noul，不混入模糊的低质量分类。所有问题在一次请求中并行计算。`negativeNoise` 和 `engagementBait` 保留为可选实验信号，但默认关闭。模型固定为 `jev-1.13.0`，避免模型别名升级后让已经调好的阈值无提示漂移。

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
