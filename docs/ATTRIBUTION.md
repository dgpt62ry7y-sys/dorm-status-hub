# 许可证、来源标注与第三方素材说明

本文说明 DormSync 的代码许可、建议性来源标注、品牌边界和当前第三方素材审计结果。本文不改变根目录 [MIT License](../LICENSE) 的条款。

## 项目代码许可

DormSync 使用 MIT License，版权声明为：

```text
Copyright (c) 2026 BAI
```

MIT License 允许获得软件副本的人使用、复制、修改、合并、发布、分发、再许可和/或销售软件副本，也允许商业使用。

分发本软件或其重要部分时，必须保留原版权声明和 MIT 许可证文本。许可证全文见根目录 [LICENSE](../LICENSE)。MIT 不要求二次开发者公开修改后的源代码。

软件按“原样”提供，不附带任何明示或默示担保；具体免责声明以 [LICENSE](../LICENSE) 全文为准。

## 二次开发与来源标注建议

维护者鼓励二次开发者在 README、关于页面或其他适当位置注明原项目来源，帮助使用者识别项目关系。这是良好的社区实践，不是 MIT License 之外的附加许可条件。

中文示例：

```text
本项目基于 DormSync 开发。
原项目：https://github.com/dgpt62ry7y-sys/dorm-status-hub
本项目经过独立修改，非 DormSync 官方发布版本。
```

English example:

```text
Based on DormSync
Original project: https://github.com/dgpt62ry7y-sys/dorm-status-hub
This project has been modified. It is not an official DormSync release.
```

二次开发者可以更换产品名称、Logo 和视觉设计。代码采用 MIT License 不代表必须继续使用 DormSync 的品牌素材。

## 品牌与官方身份

MIT License 授权的是代码，不自动授予 DormSync 名称、Logo、图标或其他品牌识别元素的使用权。

未经维护者授权，不得以容易造成混淆的方式使用 DormSync 名称、Logo 或官方标识，暗示衍生项目由 DormSync 官方开发、维护、认可或背书。

二次开发者可以如实说明“基于 DormSync”，但应同时明确标注自己的修改内容、维护主体和项目性质，避免被误认为官方版本。

本说明没有声称 DormSync 已完成商标注册。相关品牌表述不构成 MIT License 之外的额外许可条件。

## 第三方依赖与素材

以下按当前仓库的直接依赖和已发现素材整理。具体依赖版本由锁文件确定，依赖包自身仍适用其原始许可证。

| 名称 | 用途 | 许可证 | 上游 |
| --- | --- | --- | --- |
| Vue | 前端框架 | MIT | <https://github.com/vuejs/core> |
| Vue Router | 前端路由 | MIT | <https://github.com/vuejs/router> |
| Lucide Vue | 界面图标 | ISC | <https://github.com/lucide-icons/lucide> |
| Tencent CloudBase Node SDK | 云函数数据库访问 | MIT | <https://github.com/TencentCloudBase/node-sdk> |
| Vite | 构建与本地开发 | MIT | <https://github.com/vitejs/vite> |
| `@vitejs/plugin-vue` | Vue 构建插件 | MIT | <https://github.com/vitejs/vite-plugin-vue> |
| TypeScript | 类型检查与编译工具 | Apache-2.0 | <https://github.com/microsoft/TypeScript> |
| `vue-tsc` | Vue TypeScript 类型检查 | MIT | <https://github.com/vuejs/language-tools> |
| `@cloudbase/cli` | CloudBase 部署工具 | ISC | <https://www.npmjs.com/package/@cloudbase/cli> |

安装后的依赖包会保留其自身许可证文件。重新分发包含第三方代码的构建产物时，应根据实际打包结果保留适用的版权和许可信息。

### 字体

仓库包含：

- `public/fonts/plus-jakarta-sans-latin.woff2`
- 字体名称：Plus Jakarta Sans
- 许可证：SIL Open Font License 1.1
- 版权：Copyright 2020 The Plus Jakarta Sans Project Authors
- 上游：<https://github.com/tokotype/PlusJakartaSans>

随仓库保存的字体许可证全文见 `public/fonts/PLUS_JAKARTA_SANS_OFL.txt`。字体许可证与 DormSync 代码的 MIT License 相互独立。

### 图标与品牌素材

- `public/icons/dormsync.svg` 是当前仓库内的 DormSync 品牌图标。
- 该文件没有记录外部来源或第三方许可证标记，当前按项目品牌素材使用。
- 如果该图标并非由项目维护者创作，维护者需要补充确认原始作者、来源和分发许可。
- `src/` 中的界面图标来自 Lucide，适用其 ISC 许可证。

### 行为准则

`CODE_OF_CONDUCT.md` 改编自 Contributor Covenant 2.1，并在文件中保留了官方来源链接。Contributor Covenant 官方页面提供的许可信息为 CC BY 4.0：

<https://www.contributor-covenant.org/version/2/1/code_of_conduct/>

### 外部服务

ntfy 和腾讯云 CloudBase 是部署者可选择使用的外部服务。其服务条款、隐私规则、可用性和费用不由本仓库的 MIT License 覆盖。

## 需要维护者确认

- 如需公开使用不同的版权人名称或年份，应先修改根 `LICENSE`；本次保持 `Copyright (c) 2026 BAI` 不变。
- 如 `public/icons/dormsync.svg` 并非维护者原创，应补充其来源和许可信息。
- 本说明不是法律意见；如涉及商标注册、商业合规或特定司法辖区的义务，应咨询合格专业人士。
