<div align="center">

# 📮 dsh-airdrop

### 把文件拖进 DSH,AI 就能读

**⭐ 支持拖拽上传&ensp;·&ensp;⭐ 支持远程上传&ensp;·&ensp;⭐ 任意格式附件**

部署在服务器上的 DSH,也能像本地一样,拖了就发

[English](README.en.md)&ensp;·&ensp;[AI 版本](README.ai.md)&ensp;·&ensp;[更新日志](CHANGELOG.md)

[![listed on awesome dsh plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com/p/demacia1314/dsh-airdrop/)
![DSH](https://img.shields.io/badge/DSH-0.1.0--rc.6-4c8dff)
![License](https://img.shields.io/badge/license-MIT-3fb950)

<img src="https://raw.githubusercontent.com/demacia1314/dsh-airdrop/main/assets/in-chat.png" alt="附件随消息发出,AI 直接读取文件内容" width="880">

</div>

## ✨ 亮点

- 🖱️ **拖进来就行**——文件、整个文件夹,拖到窗口任意位置,松手即传
- 🌐 **远程也好用**——DSH 装在服务器上?通过 SSH 隧道访问,传文件和本地一模一样
- 📎 **不挑格式**——图片、视频、音频、PDF、压缩包、代码文件……任何文件都能传
- 👀 **先看再发**——发送前在浏览器里直接预览:图片放大看,视频拖进度条,音频直接播
- 💬 **原生体验**——附件卡片与聊天气泡对齐,点平常见的发送按钮即可,AI 自动读取文件内容
- 🔒 **各管各的**——文件只落在当前会话的工作区,会话之间互相隔离

## 🖼️ 看一看

| 拖进来 | 发出去 | 随时预览 |
| :---: | :---: | :---: |
| <img src="https://raw.githubusercontent.com/demacia1314/dsh-airdrop/main/assets/drop-in.png" alt="拖入文件后显示附件卡片"> | <img src="https://raw.githubusercontent.com/demacia1314/dsh-airdrop/main/assets/in-chat.png" alt="附件随消息发出,AI 读取内容"> | <img src="https://raw.githubusercontent.com/demacia1314/dsh-airdrop/main/assets/preview-modal.png" alt="浏览器内预览附件"> |
| 拖到窗口任意位置,卡片立刻出现 | 附件跟着消息走,AI 直接读内容 | 点开就能预览,还能下载 |

## 🚀 三分钟上手

```powershell
dsh plugin --profile web add dsh-universal-attachments
dsh web
```

> 重启 `dsh web` 生效;会话需要有工作区目录。另外:仓库名叫 `dsh-airdrop`,安装包名保持 `dsh-universal-attachments` 不变——改名会破坏已有安装。

<details>
<summary>想从源码构建?</summary>

```powershell
pnpm install
pnpm run build
pnpm pack
dsh plugin --profile web add .\dsh-universal-attachments-0.1.1.tgz
```

</details>

## ❓ 可能会问

**大文件能传吗?**
能。文件分块上传,网络断了自动续传;网关嫌块太大(返回 413)时会自动调小重试。单文件上限 20 GiB。

**支持哪些格式?**
全部。不按格式拒绝任何文件。"任意格式"指不拦截字节内容,不代表 AI 一定能读懂每种格式;插件也不会自己去执行或解压你的文件。

**空文件夹会一起传吗?**
浏览器一般不报告空目录,所以完全空的文件夹可能不会被保留。

**开多个标签页会怎样?**
同一会话的多个标签页共享一份待发送附件,谁先点发送,谁就带走当时已传完的文件。

**想清理空间怎么办?**
先停掉 DSH,然后只删除该插件对应的会话目录和它的元数据文件(`.dsh/uploads/.universal-attachments/<会话标识>.json`)。不要整个删掉 `.dsh/uploads/`,历史附件链接会失效。

## 🛡️ 要放到服务器上?

DSH 没有内建的多用户认证,别直接暴露到公网。让它只监听服务器本机,用 SSH 隧道访问:

```sh
# 服务器上
dsh web --port 3080

# 你的电脑上
ssh -L 3080:127.0.0.1:3080 user@你的服务器
```

然后在本机浏览器打开 `http://127.0.0.1:3080` 即可。

## License

[MIT](LICENSE)
