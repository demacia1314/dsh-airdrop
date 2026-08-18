# dsh-airdrop

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web 界面用的附件插件，体验对标 Codex app：把任意文件——或整个文件夹——拖到 DSH 窗口的任意位置，字节直接上传进服务器的会话工作区，agent 直接就能读。本机、远程服务器、SSH 隧道，体验完全一样。图片、视频、音频、PDF、压缩包：浏览器能选中的，插件就能传。

[English](README.md) | 简体中文

按 **DSH 0.1.0-rc.6（2026-08-13 发布）** 的公开接口开发。DSH 还在 Developer Preview 阶段，升级前建议先拿一个测试 profile 试试。

> 关于名字：仓库叫 `dsh-airdrop`，但安装包名仍是 `dsh-universal-attachments`。改包名会破坏已有安装，所以不动。

## 用法

- 把文件或文件夹拖进窗口任意位置。输入框上方的 dock 里每个文件一张卡片，带类型图标、大小和进度。
- 卡片可以直接在浏览器里预览——图片、可拖进度条的视频、音频、文本——发送前后都能看。
- 用平时的发送按钮发送。传完的附件会随消息一起发出，agent 拿到的是工作区相对路径，可以用文件工具或 `read_image` 打开。
- 符合 DSH 图片限额（PNG、JPEG、WebP、GIF）的图片走原生图片链路，进自带的消息图库和灯箱；其他格式在对话里显示为紧凑卡片。
- 不按文件类型拒绝任何内容。"任意文件"的意思是不过滤字节，不保证模型能读懂每种格式。插件不会自己执行、解压或转码上传内容。

## 安装

从源码构建：

```powershell
pnpm install
pnpm run check
pnpm run test
pnpm run build
pnpm pack
dsh plugin --profile web add .\dsh-universal-attachments-0.1.1.tgz
dsh web
```

发布到 npm 之后可以省掉构建：

```powershell
dsh plugin --profile web add dsh-universal-attachments
```

装完重启 `dsh web` 生效。会话必须有工作区 `cwd`——没有工作区就没有安全的落盘位置。

## 为什么远程部署也能用

浏览器和 DSH 服务器通常不在一台机器上，把本地文件路径丢给服务器是读不到的。所以链路是这样的：

```text
用户浏览器 File/Directory
        │ raw chunks
        ▼
DSH Host WebServer
        │ 已验证文件句柄写入
        ▼
<session cwd>/.dsh/uploads/<session-hash>/...
        │ relative path note
        ▼
Agent filesystem tools
```

浏览器只发字节，走同源 HTTP 分片——不用 Base64 RPC，也就没有 32 MB 的现实上限。工作区由 Host 根据 `sessionId` 自己解析，客户端不能指定服务器目录。每个 session 在 `.dsh/uploads/` 下有独立命名空间，服务端会检查路径穿越、绝对路径、盘符、UNC、NUL、Windows 保留名、大小写冲突、父目录 symlink/junction 和叶文件 hard link。上传和预览路由要短期 capability 票据，强制同源校验，不开 CORS。

草稿能扛重启：待发送的附件只有在对应的 `user/message` 提交、且 session durability barrier 成功之后，才会转入历史态。

## 内部结构

- Host 侧：`TypertRemoteService` 负责 JSON 控制面（批次、条目、列表、删除、预览票据）;`ctx.webServer` 的 prefix 路由负责收发原始字节。写入绑定同一个已验证的文件句柄、可回滚，传了一半的文件不会漏进提示词或预览。
- 符合要求的栅格图片会被解码进 DSH 的不可变附件存储，再追加到被 claim 的那条消息上，保留原 `MessageId`。
- 浏览器侧：回形针挂在 `conversation.input.left`,dock 挂在 `conversation.input.dock`。拖放和粘贴在捕获阶段接管，避免 DSH 原生的 image-only 入口重复处理。待发送媒体用本地 object URL 预览；历史内容走 Host 的 content endpoint。

## 部署在服务器上

DSH 没有内建多用户认证，别直接暴露到公网。监听回环地址，走 SSH 隧道：

```sh
# 服务器
dsh web --port 3080

# 本机
ssh -L 3080:127.0.0.1:3080 user@example-server
```

然后在本机打开 `http://127.0.0.1:3080`。实在要用反向代理，就在代理层终结 HTTPS、加认证、限制请求体大小、记访问日志：保留浏览器侧的 `Host`,`/api` 和插件路由都要保护，日志里把带 capability 的预览 URL 脱敏。`--trusted-host` 是 Host/Origin 信任配置，不是用户认证。

## 一些值得知道的事

- 文件夹上传保留相对层级（File System Access API，兼容 `webkitGetAsEntry` / `webkitdirectory`)，但浏览器一般不报告空目录。
- 文件按 4 MiB 分片顺序上传，文件之间有限并发；网络抖一下，客户端会 `HEAD` 问当前 offset 接着传。网关回 413 时自动缩小分片重试。
- 等进度走完再发送——还在传的文件不会挂到这条消息上。
- 同一会话的多个标签页共享一份"下一条消息"草稿，先发送的标签页消费掉已就绪的文件。
- 限额：单文件 20 GiB、单 root 50 GiB、单草稿 100 GiB、单工作区保留 200 GiB，另有保留 root/文件/session 数量上限和最低磁盘余量。
- 上传内容是不可信输入。agent 读文件时仍可能遇到提示注入或恶意数据。
- 还没有保留期管理界面。要释放空间，先停 DSH，只删本插件的 session hash 目录和对应的 `.dsh/uploads/.universal-attachments/<session-hash>.json`。除非确实要重置所有使用者，别整个删掉 `.dsh/uploads/`——历史附件链接会失效。
- 一个工作区只跑一个 DSH 写入进程。上传票据和写锁是进程内状态，集群或负载均衡的多进程部署不支持。
- 纯 Node 实现，能防正常运行中的静态路径替换，但它不是操作系统级的用户隔离层。

## 开发

```powershell
pnpm run check    # TypeScript
pnpm run test     # path/state/range/browser intake 测试
pnpm run build    # lib/index.js + 包装后的 lib/client.js
```

构建依赖的几条规则：

- Host 方法的参数名就是 Typert wire 字段名，任何东西都不能改写它们。
- client 产物必须保持 `window.__ModuleLoader__.load(...)` 包装。
- `package.json` 声明了 `exports["./client"]`、`exports["./typert"]` 和 `dsh.client`。
- 二进制字节不走 Typert JSON RPC。

## 参考

- [插件开发基础](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md) · [打包与安装](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [WebServer 子系统](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-server.md) · [Client Modules](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.md)
- 设计参考：MIT 许可的 `CocoSgt/dsh-attachments`

## License

MIT
