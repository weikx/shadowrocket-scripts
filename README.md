# 小红书 Feed 昵称替换测试

这组文件用于验证 Shadowrocket 能否拦截并重写小红书首页 Feed 响应。它只把可见作者昵称改成 `momo`，不修改帖子标题、帖子 ID、分页字段或其他业务数据。

## 文件

- `xhs-feed-momo.js`：响应重写脚本。
- `xhs-feed-momo.module`：Shadowrocket Module 模板。

## 使用方法

1. 在 Shadowrocket 中通过下面的 URL 添加 Module：

   ```text
   https://raw.githubusercontent.com/weikx/shadowrocket-scripts/main/xhs-feed-momo.module
   ```

2. 启用“`小红书 Feed 昵称改为 momo`”Module。
4. 在 Shadowrocket 中生成并安装 HTTPS 解密证书，然后到 iOS 的“设置 > 通用 > 关于本机 > 证书信任设置”中对该根证书启用完全信任。
5. 确认 HTTPS 解密/MITM 已启用，并且 hostname 包含 `rec.xiaohongshu.com`。
6. 完全关闭小红书后重新打开，刷新推荐首页。普通帖子和直播卡片的作者昵称应显示为 `momo`。

Module 的 URL 匹配只限定到下面这个接口路径，不包含不断变化的 query 参数：

```text
https://rec.xiaohongshu.com/api/sns/v6/homefeed
```

## 本次样本验证

给定响应包含 10 个 Feed 项。脚本会修改：

- 9 个 `data[].user.nickname`；
- 1 个 `data[].live.nickname`。

`data[].name` 是帖子标题，不是用户名，因此脚本不会修改它。解析失败或响应结构发生变化时，脚本会原样放行响应，避免首页白屏。

## 排查

- 完全没有效果：先看 Shadowrocket 日志中是否命中 `homefeed` 规则，以及是否出现 `[xhs-feed-momo]` 日志。
- 命中规则但没有响应正文：通常是 HTTPS 解密、证书信任、QUIC 或证书绑定导致的，需要先解决抓包问题。
- 首页无法加载：先停用 Module；脚本本身采用失败放行，但 App 或接口版本变化仍可能造成兼容问题。
- 只有部分昵称变化：保存一份新的 Feed 响应，检查新卡片类型中的昵称字段路径，再把该路径加入脚本。

仅建议在自己的设备和账号上测试。不要分享原始请求 URL；其中可能包含定位、设备标识、会话标识和行为数据。
