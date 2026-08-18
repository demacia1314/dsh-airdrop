# dsh-airdrop

[English](README.md) | 简体中文

面向 DeepSeek Harness（dsh）的远程安全附件插件：把浏览器中的文件、文件夹、图片、音频、视频或任意其他字节类型上传到 DSH 所在服务器的会话工作区；图片显示缩略图，其他附件显示紧凑文件行。

本项目按 **DSH 0.1.0-rc.6（2026-08-13 发布）** 的公开插件接口开发。DSH 仍处于 Developer Preview，升级前请先在测试 profile 验证。

## 能力

- 把文件或整个文件夹拖到页面任意位置；松手后先显示读取卡片，再开始上传。
- 回形针菜单分别选择文件和文件夹；文件选择不设置 `accept` 限制。
- 目录上传保留相对层级，支持现代 File System Access API，并兼容 `webkitGetAsEntry` / `webkitdirectory`。
- 文件字节经同源 HTTP 分片流式上传；不使用 Base64 JSON RPC，不受 32 MB RPC 现实上限约束。
- 上传进度、失败状态、移除操作和服务器端持久化草稿。
- 图片、视频、音频和文本在浏览器中预览；视频端点支持 HTTP Range，可拖动进度条。
- 其他格式仍可上传和下载，不会因 MIME 类型被插件拒绝。
- 发送下一条消息时，Host 在 `agent/pre-step` 中注入服务器工作区相对路径；模型按需使用文件工具、`read_image` 或其他能力读取。
- 符合当前 DSH 图片限额的 PNG、JPEG、WebP、GIF 会经 `ctx.attachments` 持久化，并由 DSH 原生消息图库和灯箱显示。
- 附件通知保留兼容展示：旧图片可内联预览，文件、文件夹、音频和视频显示紧凑行。

“任意文件”表示**不按格式拒绝字节内容**，不表示无限大小，也不保证当前模型能理解每一种文件格式。插件不会自动执行、解压或转码用户文件。

## 为什么远程部署可用

原生本地路径方案会把浏览器所在机器的路径交给服务器，远端 DSH 无法读取。本插件的链路是：

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

Host 只接受 `sessionId`，并通过 `ctx.sessions.get(sessionId).header.cwd` 获取权威工作区。客户端不能指定服务器写入目录。

## 安装

本地构建：

```powershell
pnpm install
pnpm run check
pnpm run test
pnpm run build
pnpm pack
```

将生成的 tarball 安装进 Web profile：

```powershell
dsh plugin --profile web add .\dsh-universal-attachments-0.1.1.tgz
dsh web
```

发布到 npm 后可以直接安装包名：

```powershell
dsh plugin --profile web add dsh-universal-attachments
```

重启 `dsh web` 后生效。当前会话必须有工作区 `cwd`；无工作区会话没有安全的落盘位置。

## 远端服务器

DSH 当前没有内建多用户认证，也不应该裸露在公网。推荐让 DSH 监听服务器回环地址，然后通过 SSH 隧道访问：

```sh
# server
dsh web --port 3080

# local machine
ssh -L 3080:127.0.0.1:3080 user@example-server
```

随后在本机打开 `http://127.0.0.1:3080`。若必须使用反向代理，应在代理层增加 HTTPS、身份认证、请求体限制和访问日志；代理需要保留浏览器侧 `Host`，同时保护 `/api` 与插件上传路由，并在日志中脱敏带 capability 的预览 URL。`--trusted-host` 是 Host/Origin 信任配置，不是用户认证。

## 架构

### Host

- `UniversalAttachmentsGateway` 继承 `TypertRemoteService`，Remote 只承担批次、条目、列表、删除和预览票据等 JSON 控制面。
- `ctx.webServer.register({ kind: 'prefix', ... })` 提供二进制上传和预览路由。
- 上传采用 4 MiB raw chunk、严格 offset、独占创建、持久化文件身份，以及绑定同一已验证文件句柄的写入与回滚。未完成文件不会进入提示或预览。
- 草稿清单可跨 DSH 重启恢复；两阶段 claim 只在对应 `user/message` 已提交且已配置的 session durability barrier 成功后，才把附件转入历史态。自定义 profile 若没有 persistence listener，插件会按 live log 确认并警告此时不具备重启持久性。
- 支持的栅格图片会由 DSH 不可变附件存储解码并提交，再追加到本次真人消息，同时保留原 `MessageId`。
- 每个 session 在 `<cwd>/.dsh/uploads/` 下使用独立物理命名空间；服务端检查路径穿越、绝对路径、盘符、UNC、NUL、Windows 保留名、大小写冲突、父目录 symlink/junction 与叶文件 hard link。
- 上传与预览路由使用有数量上限的短期 opaque capability，执行同源校验且不启用 CORS；预览不接受任意服务器路径。
- 限额为单文件 20 GiB、单 root 50 GiB、单 draft 100 GiB、单 workspace 保留 200 GiB，并限制保留 root、文件、session 数量及最低磁盘余量。

### Browser

- `conversation.input.left` 注册回形针入口。
- `conversation.input.dock` 注册 64 px 图片 rail、紧凑文件行、进度和错误状态。
- 捕获阶段接管文件拖放和文件粘贴，避免原生 image-only intake 重复处理。
- 每个文件顺序分片，多个文件有限并发；网络抖动时通过 `HEAD` 查询 offset 后继续。
- 待发送媒体使用本地 Object URL 预览；刷新或历史消息通过 Host content endpoint 预览。

## 当前限制

- DSH 0.1.0-rc.6 有原生持久化图片链路，但没有通用文件、文件夹、音频或视频 content block；这些格式仍使用隔离的历史兼容层。
- 原生历史图片仅支持 PNG、JPEG、WebP、GIF，并受部署侧图片数量、字节数和像素限额约束；被原生链路跳过的图片仍可通过服务器工作区路径和兼容预览访问。
- 浏览器文件夹选择通常不报告空目录；因此完全空的子目录不一定能被保留。
- 同一会话多标签页共享服务器端“下一条消息”附件语义；先发送的标签页会消费当时已完成的附件。
- 上传中的条目不会注入当前消息；请等待进度指示消失后再发送。
- 文件内容属于不可信用户输入，模型读取后仍可能遇到提示注入或恶意数据。
- 当前还没有已发送附件的保留期管理界面。需要释放空间时，请先停止 DSH，只删除本插件选定的 session hash 目录及对应的 `.dsh/uploads/.universal-attachments/<session-hash>.json` 元数据。除非确实要重置所有使用者，否则不要删除整个 `.dsh/uploads/`；被删除的历史附件链接会失效。
- 同一 workspace 只运行一个 DSH 写入进程。上传 capability 和写入锁是进程内状态，因此不支持集群或负载均衡的多进程 DSH 部署。
- 纯 Node 实现可防正常运行中的静态路径替换，但它不是操作系统用户隔离层；能以同一账户高速竞态修改文件系统命名空间的进程仍属于服务器信任边界。

## 开发

```powershell
pnpm run check       # TypeScript
pnpm run test        # path/state/range/browser intake tests
pnpm run build       # lib/index.js + wrapped lib/client.js
```

关键规则：

- Host Remote 方法参数名就是 wire 字段名，构建不得压缩改写。
- Client bundle 必须包装为 `window.__ModuleLoader__.load(...)`。
- `package.json` 同时声明 `exports["./client"]`、`exports["./typert"]` 和 `dsh.client`。
- 二进制不得放入 Typert JSON RPC。

## 参考

- DeepSeek Harness 插件基础：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.md>
- Bundle 打包与安装：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md>
- WebServer 子系统：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-server.md>
- Client Modules：<https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.md>
- 设计参考：MIT 许可的 `CocoSgt/dsh-attachments`

## License

MIT
