# dsh-pair：远程控制（Remote Control）

扫码配对后，在 iPhone（PWA）上可以：看会话列表和实时输出、发消息（排队或插话）、停止、新建会话、审批和回答提问（离开模式），并在任务完成、需要审批或出错时收到推送。

```
iPhone PWA ──wss──▶ Cloudflare Worker + Durable Object（中继，只转发密文）◀──wss（出站）── DSH 插件
```

- 电脑**只有出站连接**：不开端口，不需要 Tailscale 或内网穿透，也不改 GUI 的 token 和 `trustedHosts`。
- **端到端加密**：X25519 三次 DH（静态-临时混合，含前向保密），XSalsa20-Poly1305，按计数器取 nonce（防重放）。中继和 Apple 推送服务只能看到密文。
- **配对**：二维码包含桌面公钥和一次性令牌（10 分钟有效），手机和电脑各显示一个 6 位核对码，电脑确认后记录手机公钥。设备可以在电脑上随时移除。
- 中继地址：<https://dsh-pair-relay.sir-housir.workers.dev>（同一个 Worker 也托管 PWA）。

## 目录

| 路径 | 内容 |
|---|---|
| `shared/e2e.js` | 握手、加密帧、配对链接、中继签名（桌面和手机共用） |
| `relay/` | Cloudflare Worker：`/v1/desktop/<id>`（Ed25519 签名占位）、`/v1/client/<id>`、`/v1/status/<id>`，其余路径是静态 PWA |
| `plugin/` | DSH 插件 `@local/dsh-pair`：Host 端（中继连接、配对、RPC→`sessionController`、审批/提问拦截、离开模式、Web Push）；Client 端（左侧栏「远程控制」页） |
| `app/` | PWA 源码，`node app/build.mjs` 输出到 `relay/public/` |
| `test/` | `e2e.test.mjs` 加密单测；`host.live.test.mjs` 用模拟 DSH、真实中继和模拟手机跑完整链路 |
| `dev/` | `fake-desktop.mjs` 模拟电脑；`ui-smoke.mjs` 用无头 Chrome 模拟 iPhone 截图 |

## 常用命令

```bash
npm test                                            # 加密单测 + 真实中继全链路
cd app && NODE_PATH=../node_modules node build.mjs   # 构建 PWA
cd relay && npx wrangler deploy                      # 部署中继和 PWA
cd plugin && NODE_PATH=../node_modules node build.mjs # 构建插件
```

插件更新：构建后执行 `plugin_manager install_bundle file:<repo>/plugin`。Host 代码被 Node 的 ESM 缓存，**要重启 DSH 才能生效**；Client 页面刷新即可。

数据在 `~/.dsh/plugin-data/pair/state.json`（权限 0600）：桌面密钥、已配对设备的公钥和推送订阅、VAPID 密钥、离开模式的恢复表。删除这个文件等于重置所有配对。

## 离开模式

开启后，当前运行的会话（以及离开期间新建的会话）会切到 `workspace-write` 预设（`approval: ask`），原预设记录下来，关闭时恢复。插件以 prepend 方式监听 `approval/request` 和 `user-questions/request`：请求进入待处理队列，推送到手机，由已配对设备或电脑「远程控制」页中先作答的一方决定。审批 30 分钟无人处理即自动拒绝。关闭离开模式时，所有请求直接交回 DSH 自己的界面处理。

配置项（profile patch 的 `dsh-pair` 行）：`relayUrl`、`awayPreset`（默认 `workspace-write`）、`approvalTimeoutMinutes`（默认 30）、`notifyAfterSeconds`（运行超过这个时长才推送「已完成」，默认 20）。
