# HeaderPilot

基于 **WXT + Vite + TypeScript** 的 Chrome Manifest V3 扩展，在弹窗中管理 HTTP 请求及响应 Header。

## 功能

- 添加或覆盖 Header，或从请求 / 响应中移除指定 Header。
- 全局即时启停，单条规则独立勾选。
- 多个 Profile，可新建、复制、重命名、删除和切换。每次仅应用当前 Profile。
- 每个 Profile 可配置 URL 匹配范围。
- 配置保存在 `chrome.storage.local`，关闭弹窗或重启浏览器后仍然保留。
- 工具栏角标展示当前已启用规则数。
- 校验 Header 名称、非法字符、重复规则和配置大小。保存失败时保留之前的配置及规则。
- 中文界面，编辑后自动保存并应用，无需手动保存。

## 开发

需要 Node.js **22.12+**，建议使用 Node.js 24 LTS。

```sh
npm install
npm run dev
```

WXT 使用 Vite 提供开发服务器和热更新。此项目不自动启动浏览器，第一次需手动加载扩展：

1. 打开 `chrome://extensions`。
2. 开启右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择项目内的 `.output/chrome-mv3-dev` 目录。
4. 将 HeaderPilot 固定到工具栏，点击图标打开弹窗。

## 构建与安装

```sh
npm run build
```

在 `chrome://extensions` 中加载 `.output/chrome-mv3` 目录即可安装生产构建。开发构建和生产构建是两个独立扩展，测试时仅启用其中一个，避免规则互相影响。

```sh
npm run zip
```

压缩包生成在 `.output/`，可用于分发或提交 Chrome Web Store。

## 使用

1. 默认 Profile 为 `Default`，全局开关初始为关闭。
2. 点击「添加 Header」，填写名称和值，选择请求或响应、设置或移除，修改后自动保存。
3. 点击「匹配范围」可展开 URL 过滤器，修改后自动保存并生效。
4. 开启全局开关后，当前 Profile 中已保存且勾选的规则对新请求生效。
5. 点击 Profile 右侧的「更多」按钮，可新建、复制、重命名和删除 Profile。点击选择器切换配置，支持方向键选择及 Esc 关闭。操作时自动保存；若当前内容校验失败，操作取消，并保留编辑内容。

Header 编辑、单条规则开关、删除和 URL 范围修改都会立即发送到后台，自动保存并应用。后台合并连续修改，并按顺序处理全局开关，关闭弹窗后仍继续处理已收到的修改。

新增空白规则需填写有效名称后才能保存。非法或不完整的编辑会显示错误，并保留上一次有效规则；全局暂停仍然可用。弹窗只局部更新控件，保存时不重建页面，也不打断输入焦点、光标或滚动位置。

### URL 匹配示例

使用 Chrome `declarativeNetRequest` 的 `urlFilter` 语法，大小写不敏感：

| 过滤器 | 匹配范围 |
| --- | --- |
| 留空 | 所有 HTTP / HTTPS 请求 |
| `||example.com^` | example.com 及其子域名 |
| `||api.example.com^` | api.example.com 及其子域名 |
| `*/api/*` | URL 中包含 `/api/` 的请求 |

`*` 是通配符；`||` 锚定域名；`^` 匹配分隔符或 URL 结尾。国际化域名需使用 Punycode，非 ASCII 路径需使用 URL 编码。

如需匹配 URL 前缀，可输入 `|https://example.com/api/`。

### 示例

```text
Profile: Development
URL:     ||api.example.com^
请求 Header:
  X-Environment = development
  X-Debug = 1
```

`set` 操作会添加不存在的 Header，或覆盖已有值；空字符串是有效值。相同方向不能启用多个同名 Header，名称不区分大小写。移除操作无需填写值。

## 验证

```sh
npm run check
```

执行 TypeScript 检查、Vitest 单元测试和生产构建。测试覆盖规则生成、Profile 隔离、非法 Header、全局及单条启停、存储失败回滚、连续保存合并和后台操作串行化。

```sh
npx playwright install chromium
npm run test:e2e
```

端到端测试在独立的 Chromium 临时配置目录加载真实扩展，使用本地 HTTP 服务检查请求 Header 的添加、覆盖及移除，响应 Header 的修改、URL 过滤、Profile 切换、配置持久化和全局暂停。不会读取个人浏览器数据。

仅预览弹窗界面：

```sh
npm run preview:ui
```

打开 `http://127.0.0.1:5173`。预览使用独立的 `localStorage`，不会修改浏览器请求，也不与扩展共享配置。

## 项目结构

```text
entrypoints/
  background.ts       Chrome service worker，接收消息并更新规则
  popup/              弹窗 HTML、TypeScript 和 CSS
lib/
  model.ts            类型、默认配置和输入校验
  rules.ts            declarativeNetRequest 规则生成
  controller.ts       串行化读写、规则应用与失败回滚
  save-queue.ts       后台自动保存队列与连续编辑合并
  protocol.ts         弹窗与后台消息类型
  client.ts           扩展及独立界面预览通信
public/               扩展图标
tests/                单元测试和真实扩展端到端测试
wxt.config.ts         WXT 和 Chrome 权限配置
```

## 实现说明

使用 Chrome 原生 [`declarativeNetRequest`](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) 动态规则，规则在后台 service worker 休眠后仍然有效。配置中的启用规则编译为当前 Profile 对应的一条原子规则，切换或暂停时原子替换。

需要 `storage`、`declarativeNetRequestWithHostAccess` 及 HTTP(S) 主机权限，以便修改用户指定网站的 Header。项目无远程脚本、统计服务或数据上传逻辑。

仅作用于扩展获得访问权限的网站及后续网络请求。Chrome 内部页面、Chrome Web Store 等受保护页面不适用。其他扩展的规则可能影响最终结果；缓存或 Service Worker 直接返回的响应不一定经过网络规则。需要验证时可在开发者工具 Network 中关闭缓存后重新请求。

构建与入口约定参考 [WXT 文档](https://wxt.dev/guide/installation.html)。
