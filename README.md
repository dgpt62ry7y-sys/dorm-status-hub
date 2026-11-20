# DormSync / 宿舍状态共享

DormSync 是一个面向四人寝和六人寝的轻量状态共享 Web App。室友通过邀请码加入同一个空间，共享休息、学习、活动和外出状态，减少因信息不同步造成的打扰。

项目目前由个人维护并持续迭代，适合小规模宿舍自用和二次开发，不承诺 SLA，也不宣称已经具备大型生产系统所需的高可用、审计或运维能力。

## 功能概览

- 创建四人寝或六人寝，通过邀请码或链接加入
- 共享睡觉、正常活动、专注学习和外出状态
- 状态留言、预计结束时间、外出回寝时间和自动恢复
- 当前成员自动置顶，展示安静人数和预计安静结束时间
- 每个宿舍共用一个 ntfy 通知频道，成员主动改状态时发送手机提醒
- 5 秒自动同步，网络中断时保留最近数据
- 同一成员账号绑定最多 5 台设备
- 8 位短时设备绑定码和 20 位账号恢复码
- 查看、撤销设备，单独退出当前设备
- 房主管理邀请码、成员和四人寝/六人寝切换
- 全站版本更新公告和设置页新版本提示
- 寝室创建密钥、存量寝室授权验证和定时清理

## 使用方式

### 自行部署

项目不把任何维护者的 CloudBase 环境作为默认目标。自行部署需要准备你自己的腾讯云 CloudBase 环境、PostgreSQL、Document 扩展和静态网站托管。

完整步骤见 [自行部署指南](docs/self-hosting.md)。

自行部署后的网页、云函数和数据库使用部署者自己的云资源，资源费用由部署者承担。腾讯云的实际价格、额度和续费规则以部署者自己的控制台为准。

### 在线演示

当前 README 不提供固定的公共演示地址，也不保证存在长期在线体验服务。请使用自己的 CloudBase 环境进行部署和测试。

## 技术架构

```text
Vue 3 Web App
      |
      | HTTPS
      v
CloudBase HTTP 云函数
      |
      | 成员令牌校验
      v
CloudBase PostgreSQL
└── Document 扩展
```

- 前端：Vue 3、TypeScript、Vite、Vue Router
- UI 图标：Lucide
- 后端：CloudBase HTTP 云函数
- 数据：CloudBase PostgreSQL + Document 扩展
- 托管：CloudBase 静态网站托管
- 清理任务：CloudBase 定时云函数

更完整的模块和权限说明见 [架构文档](docs/architecture.md)。

## 本地运行

环境要求：

- Node.js 20 或更高版本
- npm 10 或更高版本

安装依赖：

```bash
npm install
```

从示例创建自己的环境配置：

Windows PowerShell：

```powershell
Copy-Item .env.example .env.local
```

macOS / Linux：

```bash
cp .env.example .env.local
```

填写自己的 CloudBase 环境 ID、HTTP API 地址和服务端密钥后运行：

```bash
npm run dev
```

构建和测试：

```bash
npm test
npm run build
```

本地只读管理站：

```bash
npm run admin
```

使用独立虚拟数据库的六账号测试环境：

```bash
npm run dev:test
```

本地测试面板还可以查看通知收件箱。收件箱只存在于本机内存，不会向真实
`ntfy.sh` 发布消息，重置虚拟测试数据时会一并清空。

Windows 完成首次依赖安装和 `.env.local` 配置后，也可以直接双击：

```text
启动本地工具.bat
```

然后从菜单选择只读管理站或六账号测试版。菜单不会重复安装依赖，服务停止后可以返回菜单选择另一个工具。

## 宿舍通知

设置页的“ntfy 共享频道”可以把宿舍状态提醒发送到手机。每个宿舍有独立
Topic，同一宿舍的已验证成员会拿到同一个 Topic，不同宿舍不会共用。

1. 从设置页复制 Topic，或按页面提示安装 ntfy App。
2. Android 可直接尝试打开订阅深链；微信内置浏览器或 iPhone 请复制 Topic 后在 App 中手动添加。
3. 确认 App 中填写的服务器与设置页一致。
4. 房主可以在设置页发送测试通知，并在一分钟间隔后再次测试。

成员主动修改状态、留言或预计时间时会发送一条通知；自动到期不会发送。通知发送失败不会撤销已经保存的状态，页面会显示非阻塞提示。

### 通知安全边界

公共 `ntfy.sh` 的 Topic 不是账号密码，也不是严格的访问控制。知道 Topic
的人可以订阅、读取甚至伪造消息。昵称、留言、预计时间和安静人数也会经过
所选 ntfy 服务。不要把 Topic 发到公开群聊、公开仓库、截图或日志中。

成员退出或被移除后，房主会看到重新生成频道的提醒，但系统不会自动轮换。重新生成后，所有设备都需要订阅新的 Topic。

自行部署的默认服务器是 `https://ntfy.sh`。如果使用自建 ntfy，可在
`.env.local` 中配置：

```env
DORMSYNC_NTFY_SERVER=https://ntfy.example.com
DORMSYNC_NTFY_PUBLIC_URL=https://ntfy.example.com
```

`DORMSYNC_NTFY_SERVER` 供云函数发布消息，`DORMSYNC_NTFY_PUBLIC_URL`
用于设置页展示和 Android 深链。部署脚本会把这两个值写入云函数环境变量。

## 隐私与安全

- 业务数据保存在部署者自己的 CloudBase 数据库。
- 浏览器不会直接访问数据库。
- 设备令牌保存在浏览器 `localStorage`，数据库只保存令牌哈希。
- 设备绑定码和账号恢复码只保存哈希。
- 创建密钥和管理密钥只保存在 CloudBase 云函数环境变量。
- 仓库不包含 `.env.local`、数据库密码、成员令牌、恢复码或真实邀请码。
- ntfy Topic 不会进入普通状态接口、创建宿舍响应、日志或静态构建产物。
- 启用宿舍通知后，昵称、留言、预计时间和安静人数会发送到部署者选择的 ntfy 服务。
- 应用不采集定位、通讯录、麦克风或摄像头。

详细说明见 [安全政策](SECURITY.md)。

## 参与贡献

- [贡献指南](CONTRIBUTING.md)
- [行为准则](CODE_OF_CONDUCT.md)
- [安全政策](SECURITY.md)

提交代码前请运行：

```bash
npm test
npm run build
```

## 许可证

本项目使用 [MIT License](LICENSE)，版权声明为 `Copyright (c) 2026 BAI`。

MIT License 允许使用、复制、修改、合并、发布、分发、再许可和/或销售软件副本，也允许商业使用。分发本软件或其重要部分时，必须保留原版权声明和 MIT 许可证文本。

软件按“原样”提供，不附带任何明示或默示担保；完整条款与免责声明见 [LICENSE](LICENSE)。

MIT License 授权的是代码，不自动授予 DormSync 名称、Logo 或官方身份的使用权，也不代表获得官方合作、维护或背书。品牌边界、建议性来源标注和第三方素材说明见 [许可证与署名说明](docs/ATTRIBUTION.md)。

## 二次开发来源标注

维护者鼓励在 README、关于页面或项目文档中注明原项目来源，但这不是 MIT License 之外的强制条件。MIT 也没有要求二次开发者公开修改后的源代码。

可以直接使用以下示例：

```text
本项目基于 DormSync 开发。
原项目：https://github.com/dgpt62ry7y-sys/dorm-status-hub
本项目经过独立修改，非 DormSync 官方发布版本。
```

```text
Based on DormSync
Original project: https://github.com/dgpt62ry7y-sys/dorm-status-hub
This project has been modified. It is not an official DormSync release.
```

更完整的品牌说明和第三方许可证列表见 [docs/ATTRIBUTION.md](docs/ATTRIBUTION.md)。

## 致谢

- [Vue](https://vuejs.org/)
- [Vite](https://vite.dev/)
- [CloudBase](https://cloudbase.net/)
- [Lucide](https://lucide.dev/)
- [ntfy](https://ntfy.sh/)
