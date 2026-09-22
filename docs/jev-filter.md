# 小红书 Feed Jev 过滤器

这个版本由两个部分组成：

1. Shadowrocket 脚本读取小红书 Feed，只提取标题、作者、分类、内容类型和广告标记。
2. Cloudflare Worker 保存 TypeSafe API Key，调用 Jev 并返回结构化的 `keep/drop` 结果。

默认采用 `observe` 模式：不删除帖子，只把作者昵称临时改为 `[保留 82] 原昵称` 或 `[过滤 13] 原昵称`。观察结果满意以后，才将 Module 中的 `mode=observe` 改为 `mode=filter`。

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

编辑 `worker/policy.local.json`，至少填写：

- `interests`：希望看到的主题。
- `blockedTopics`：明确不想看到的主题。
- `highValueDescription`：你认为有价值的内容标准。
- `lowValueDescription`：你认为低质量的内容标准。

将整个配置作为 Secret 上传：

```bash
npx wrangler secret put FILTER_POLICY_JSON --config worker/wrangler.jsonc < worker/policy.local.json
```

`policy.local.json` 已被 `.gitignore` 排除，不会被提交。修改策略后重新执行上面的命令即可，不需要重新发布 Shadowrocket 脚本。

默认阈值非常保守：只有明确的广告、屏蔽主题、营销内容或高概率低质量内容才会标记为过滤。Jev 只有标题和少量元数据可用，无法查看 Feed 里的封面与视频，因此信息不足时默认保留。

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
[保留 82] 原作者
[过滤 13] 原作者
```

分数是 Worker 返回的综合保留分，范围为 0–100。观察一段时间并调整策略、阈值，确认误判率可以接受以后，把本地 Module 中的：

```text
mode=observe
```

改成：

```text
mode=filter
```

正式过滤时，脚本默认至少保留 6 条，同时至少保留原 Feed 的 40%，避免整页被删空。Worker、Jev 或 JSON 处理失败时，脚本会原样放行该页。

## 6. 接口测试

设置 shell 变量后可以绕过 Shadowrocket，直接测试 Worker：

```bash
FILTER_URL='https://xhs-jev-filter.<你的 Cloudflare 子域>.workers.dev/filter'
CLIENT_TOKEN_VALUE='<你的 CLIENT_TOKEN>'

curl "$FILTER_URL" \
  -H "Authorization: Bearer $CLIENT_TOKEN_VALUE" \
  -H 'Content-Type: application/json' \
  --data '{"items":[{"key":"0","title":"在飞书里用豆包工作的几个实用方法","author":"测试作者","category":"科技","contentType":"normal","isAds":false}]}'
```

响应中的 `decisions[0].action` 应为 `keep` 或 `drop`，并包含各项概率、原因代码、模型版本和 token 用量。

## 7. 本地验证

```bash
npm test
npm run worker:deploy -- --dry-run
```

## 隐私边界

Shadowrocket 不会把原始响应或请求头发给 Worker。发送内容仅包括：

- 帖子标题；
- 作者昵称；
- 分类名称；
- 图文、视频或直播类型；
- 小红书返回的广告布尔标记。

Cookie、Session ID、IDFA、定位、帖子 ID、图片地址、视频地址和推荐跟踪参数都不会上传。
