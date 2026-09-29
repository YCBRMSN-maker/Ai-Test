# 教师端 UI 重构说明（已应用到项目）

> 设计工程理念来源：`emil-design-eng` skill（Emil Kowalski）
> 状态：**已应用到 `frontend-src/teacher-dist`**（2026-09-23）
>
> ⚠️ 本文件曾在 2026-09-23 13:52 被意外删除（同批消失的还有 `teacher_preview_server.py`，
> 回收站中无记录）。此版为**据实测数据重建**，内容以当时验证过的结果为准。
> 若你记得原版还有别的内容，告诉我补回来。

---

## 1. 改动清单（就两处）

| 文件 | 改动 |
| --- | --- |
| `teacher-dist/css/ui-theme.css` | **新增**。主题覆盖层，1229 行，含全部视觉工艺与动效规则 |
| `teacher-dist/index.html` | **修改**。`</head>` 前插入一行 `<link>` + 一段 `MutationObserver`（+15 行） |

`teacher-dist` 里的其它 134 个文件**一个都没动**（Vite 产物、JS、原有 CSS 全部原样）。

### 为什么要 MutationObserver

Vite 会在运行时把按需加载的组件 CSS chunk 动态 append 到 `<head>`。
静态 `<link>` 会被这些 chunk 排到前面，导致覆盖失效。
所以 `index.html` 里用 `MutationObserver` 监听 `<head>` 的 childList，
把主题 `<link>` 始终移到末尾 —— 这样同优先级下本文件的规则才能胜出。

---

## 2. 改了什么

**分两层。配色已按要求回退为原版，本层只做工艺与动效。**

### 2.1 工艺层（不动色相）

统一圆角（8px / 6px）、多层阴影、发丝描边、间距节奏、`tabular-nums` 数字对齐、
滚动条、`:focus-visible` 焦点环。**色相全部沿用原版**（主色 `#4080ff`、
页底 `#f5f8fd`、侧栏 `#304156`、选中项无填充蓝字）。

### 2.2 动效层（Emil skill 的核心）

| Before | After | Why |
| --- | --- | --- |
| 弹窗 `animation: dialog-fade-in`（keyframes，`translate3d(0,-20px,0)`） | `transition` + `scale(0.95)` | keyframes **不可打断**，快速连点开/关会从零重播；从 -20px 滑入是纯位移，没有「生长」感 |
| 弹窗出场与入场同速 | 出场 160ms（更快） | 用户已经决定了，系统只需利落收尾 |
| `.el-drawer { transition: all }` | 显式属性 + iOS 抽屉曲线 | `all` 会把不该动的属性也纳入过渡 |
| `--el-transition-fade-linear: ... linear` | `ease-out` | `linear` 只适合匀速运动（进度条、跑马灯） |
| `.el-message { transform .4s }` | 统一 220ms + ease-out | 400ms 超 300ms 上限，且与 opacity 不同步导致收尾发飘 |
| `.el-zoom-in-center-leave-active { scaleX(0) }` | `scaleX(0.96)` | 现实中不存在被压扁成一条线的物体 |
| 气泡 `transform-origin` 只处理上/下 | 补 left/right | 左右放置时会从错误的位置长出来 |
| `.el-switch__action { transition: all }`；轨道 `.el-switch__core` 只有 EP 默认的 200ms `ease` | 两者都显式声明，统一曲线 | 轨道变色与旋钮位移原本不同步 |
| 无级联 | `animation ... backwards` + 40ms 步进 | 同时出现会「啪」一下砸出来 |
| `--animate-duration: 1s`（animate.css 默认） | `220ms` | 侧栏 logo 的 `animate__fadeInLeft` 原本**跑满 1 秒**，是上限的 3.3 倍 |
| 入场靠 JS 打 `mounted` 属性 | `@starting-style` | 现代 CSS 入场写法，不需要 JS |
| 按钮无按压反馈 | `:active { transform: scale(0.97) }` | 给点击一个即时物理回执，成本最低、体感提升最大 |

**下面 4 行是「优先级被压掉」的问题**，靠 CDP 抓命中规则才发现（看截图永远看不出来）：

| Before | After | Why |
| --- | --- | --- |
| 导航栏按钮被应用自身的 scoped 规则 `.action-buttons > .el-button[data-v-x]`（**0,3,0**）压回 `transition: all .3s ease` | `.el-button.el-button.el-button`（同为 0,3,0），靠「主题表始终排在最后」取胜 | **单类名（0,1,0）赢不了 scoped 父选择器** |
| analysis / 课程管理页的卡片用 antd 默认阴影 | `.ant-card.ant-card`（0,2,0） | antd 用 `:where(.css-x).ant-card:not(.ant-card-bordered)`。**`:where()` 权重为 0 容易让人误判成「没威胁」，但 `.ant-card` + `:not(…)` 加起来是 0,2,0** |
| 下拉框过渡是 antd 的 `all .2s cubic-bezier(0.645,0.045,0.355,1)` | `.ant-select.ant-select .ant-select-selector`（0,3,0） | 同上；`all` 会把不该动的属性也纳入过渡 |
| 课程详情页卡片式页签过渡是 antd 的 `all .3s cubic-bezier(0.645,…)` | `.ant-tabs .ant-tabs-tab.ant-tabs-tab`（0,3,0） | 同上。**只提 `transition`**，页签上圆角保留 antd 的 `8px 8px 0 0`（要跟卡片的 8px 对齐） |
| 选中态单选按钮边框是 antd 自己的蓝 `#1677ff`（与主题蓝 `#4080ff` 不一致，肉眼可辨） | `.ant-radio-button-wrapper.ant-radio-button-wrapper-checked:not(…)`（0,3,0） | antd 的选中态规则带 `:first-child`，同样是 0,3,0 |

### 2.3 刻意没做的事

- **没有给路由切换加 `blur(2px)`**。实测应用的路由过渡是
  `<Transition enter-active-class="animate__animated animate__fadeIn" mode="out-in">`
  —— 只声明了 enter 类，且 `mode="out-in"` 意味着旧页先被移除、新页才入场，
  **根本不存在交叉淡入**。而 skill 里的 blur 是专治「两个状态叠加」的补救手段，
  没有 crossfade 就不该硬加。
- **没有补离场动画**。Vue 会给未指定 leave 类的过渡打默认 `v-leave-*` 类，理论上能补；
  但在 `mode="out-in"` 下会让**每次导航都多等一个离场时长**，导航是高频操作，不划算。
- **有些地方该输就让它输**（见 3.2）。

---

## 3. 怎么预览 / 验证

| 入口 | 地址 | 说明 |
| --- | --- | --- |
| 真实应用（教师端） | `http://127.0.0.1:8326/` | 容器 `ats-comp-frontend`，改完需 rebuild |
| 左右对比页 | `http://127.0.0.1:5600/_compare.html` | 左=原版(8326) 右=重构版；登录 `uipreview` / `preview123` |
| 动效演示 | `http://127.0.0.1:5600/_motion.html` | 7 个可重播的动效对照实验。**静态截图看不出动效，看这个** |

对比页与动效页由 `teacher_preview_server.py`（端口 5600）提供，它静态托管
`teacher-dist-redesign/` 并按 nginx 规则反代 `/api`。**这两个页面属于预览产物，不是项目的一部分。**

### 3.1 怎么证明「真的生效了」（不看截图）

**截图证明不了动效。** 静态图看不出 220ms 还是 300ms、看不出用的是哪条缓动曲线。
所以验证一律读**计算样式**和**命中规则**，工具是 `tools/probe.js`（零依赖，CDP 驱动）：

```bash
cd frontend-src
COOKIE=$(curl -s -i -X POST http://localhost:8326/api/v1/user/login \
  -H "Content-Type: application/json" \
  -d '{"userAccount":"uipreview","userPassword":"preview123"}' \
  | grep -io "pbl_session=[^;]*" | head -1)

node tools/probe.js http://127.0.0.1:8326 --cookie="$COOKIE" \
  --routes=#/dashboard,#/course-generator,#/analysis,#/course-management/list
```

它分四层取证：

| 层 | 查什么 | 靠什么 |
| --- | --- | --- |
| A 加载层 | 主题表是不是真的排在 Vite 动态 chunk 之后 | `document.head` 子节点顺序 |
| B 令牌层 | CSS 变量有没有落到 `:root`（含被行内样式抢占的 `--el-color-primary`） | `getComputedStyle(document.documentElement)` |
| C 计算层 | 真实元素 + 瞬态组件（弹窗/抽屉/消息/气泡）的实际取值 | `getComputedStyle` |
| D 命中层 | **到底是哪条规则赢了、来自哪个文件** | CDP `CSS.getMatchedStylesForNode` |

额外三个开关：

- `--explain=<选择器>`：打印该元素所有命中规则及来源文件 —— 排查「为什么我的样式没生效」用它。
- `--audit=<sel1;sel2;…>`：对一批选择器**逐个算出每个属性哪条规则赢了**，标出被压掉的属性。
- `--active=<选择器>`：**派发真实鼠标事件**（mouseMoved / mousePressed）触发 `:hover` / `:active`，
  读取按压瞬间的 `transform`。比 `CSS.forcePseudoState` 可靠，也更接近真人操作。

**实测基线**（可作为回归基准）：

| 项目 | 实测值 |
| --- | --- |
| 主题表位置 | `isLastInHead: true` |
| `--el-color-primary` / `--el-border-radius-base` | `#4080ff` / `8px` |
| 卡片过渡 | `0.22s` + `cubic-bezier(0.23, 1, 0.32, 1)` |
| 卡片阴影 | `rgba(15,23,42,0.04) 0 2px 4px, rgba(15,23,42,0.06) 0 4px 12px -2px` |
| 按钮过渡 | `0.18s ×4 + 0.14s`，同一条曲线 |
| 按钮按压（真实鼠标按下） | `transform: matrix(0.97, 0, 0, 0.97, 0, 0)`，松开归位 |
| 弹窗入场 / 出场 | `scale(0.95)` / `scale(0.96)`，`transform-origin: 50px 50px`（居中） |
| 抽屉 | `transform, opacity 320ms` + `cubic-bezier(0.32, 0.72, 0, 1)` |
| 消息 | 四个属性统一 `0.22s` + ease-out |
| 气泡 origin | left→`100px 25px`、right→`0px 25px`、top→`50px 50px` |
| 仪表盘错峰 | `ui-rise-in` `0.06 / 0.10 / 0.14s`，`backwards` |
| 表格表头 | `rgb(248, 249, 251)` |

> ⚠️ 探查「瞬态组件」时，模拟节点要**固定尺寸**（`position:absolute; width:100px`）。
> 被 flex 收缩成 `width: 0` 时，`center right` 和 `center left` 都会算成 `0px`，会误判成「没生效」。
> ⚠️ 测交互态之前先打印 `getBoundingClientRect()`，`w>0 && h>0` 才算数 ——
> `querySelector` 很容易命中导航栏里被折叠、尺寸为 0 的同名元素。

### 3.2 优先级审计（`--audit`，全量而不是抽样）

**只抽查几个元素是不够的。** 本项目就是靠「恰好点到 `.el-button`」才发现一条 scoped 规则
把覆盖层压掉了。所以 `probe.js` 提供 `--audit`：给定一批选择器，逐个算出
**每个属性到底是哪条规则赢了**，并标出「本层声明了、但赢家不是本层」的属性。

**审计结果（5 条路由 × 33 个选择器）：52 个组合，49 个通过。**

| 剩余 3 项 | 赢家 | 结论 |
| --- | --- | --- |
| `.ant-card` / `.dashboard-welcome` 的 `border-radius` | 应用自身的 `.dashboard-welcome[data-v-x]` → `12px` | **有意保留**。欢迎卡是 hero 卡，12px 是应用原本的设计 |
| `.ant-input` 的 `border-radius` | antd `:where(…).ant-input-affix-wrapper > input.ant-input` → `0` | **有意保留**。antd 故意把 affix 内层输入框圆角设成 0（圆角由外层负责），提上去反而会多出一层圆角 |
| `.ant-tabs-tab` 的 `border-radius` | antd `8px 8px 0 0` | **有意保留**。卡片式页签的上圆角要跟卡片 8px 对齐，我们的 6px 反而不对 |

> **原则：该输的地方就让它输。** 覆盖层的目标不是「每条规则都赢」，
> 而是「本层有意改变的属性都生效」。审计的意义是**逼你逐个确认**，
> 而不是把剩余项也一起硬压过去。
>
> 值得注意：**剩余 3 项全是 `border-radius`，没有一条是动效或颜色** ——
> 也就是说本层真正想改的东西，全部生效了。

---

## 4. 怎么回滚

三种方式，任选：

1. **只删主题层**（推荐，最轻）：删除 `teacher-dist/css/ui-theme.css`，
   并去掉 `teacher-dist/index.html` 里那段 `<link>` + `<script>`。
2. **用 git**：`teacher-dist` 被 git 跟踪（134 个文件），
   `git checkout -- frontend-src/teacher-dist/index.html` 即可还原 HTML；
   再删掉未跟踪的 `ui-theme.css`。
3. **备份**：原始 `index.html` 备份在
   `.workbuddy-ai/artifacts/teacher-ui/backup/index.html.orig`。

---

## 5. ⚠️ 重建后需要重新应用

`teacher-dist/` 是**构建产物**，由构建脚本从 `teacher-frontend` 构建后拷入
（见 `Dockerfile` 第 30-31 行注释）。所以：

> **下次从 `teacher-frontend` 重新构建时，本次改动会被覆盖。**

若要在源工程里永久生效，做这两步（都只需要一次）：

1. 把 `teacher-dist/css/ui-theme.css` 复制到源工程，例如
   `teacher-frontend/src/styles/ui-theme.css`；
2. 在 `teacher-frontend/src/main.ts` 里**作为最后一个样式引入**：

   ```ts
   import './styles/ui-theme.css'
   ```

   放在所有 UI 库样式（Element Plus、Antd）之后。

**注意**：走源码构建时**不需要** MutationObserver。
Vite 在生产构建里会把 CSS 按确定顺序打进 `<head>`，不存在运行时 chunk 乱序问题。
所以源工程里**不要**复制 `index.html` 里那段 `<script>`。

**改完本层后，重新构建容器**（`teacher-dist` 是 COPY 进镜像的，不重建不生效）：

```bash
cd D:/Program/Ai-Test
docker-compose --env-file .env -f docker-compose.submission.yml build frontend
docker-compose --env-file .env -f docker-compose.submission.yml up -d frontend
```

---

## 6. 已知边界

- **深色主题未精修**：覆盖规则一律限定在 `html:not(.dark)`，深色模式保持原样。
- **tooltip「后续悬停跳过延迟」**：Element Plus 靠 `:show-after` 这个 JS 属性控制，
  纯 CSS 覆盖层做不到，需要改组件调用处。
- **路由切换的「旧页瞬间消失」**：应用只声明了 `enter-active-class`，没有 leave 过渡。
  要补离场动画必须改 Vue 模板，纯 CSS 做不到，且未必值得（见 2.3）。
- **进度条 / 页签下划线的 `width` 过渡**：`width` 是布局属性，会触发重排；
  但 Element Plus 用内联 `width: X%` 驱动，纯 CSS 无法改成 `scaleX`，属库约束。
- **字体**：优先 `Inter`，中文回落 `PingFang SC` / `Microsoft YaHei`。
  若追求更佳观感，可自托管 Inter 可变字体并做 `font-display: swap`。
- **优先级是持续风险**：应用自身与 antd 都存在更高优先级的选择器
  （`.action-buttons > .el-button[data-v-x]` = 0,3,0；
  `:where(.css-x).ant-card:not(.ant-card-bordered)` = 0,2,0），能压掉单类名覆盖。
  本次已把受影响的 `.el-button` / `.ant-card` / `.ant-select .ant-select-selector` /
  `.ant-tabs-tab` / `.ant-radio-button-wrapper` 提到同优先级。
  **⚠️ `:where()` 权重为 0，但它两侧的普通类选择器照常计权 —— 不要因为它就放松警惕。**
  若源工程后续新增更长的 scoped 选择器（0,4,0 以上），可能再次压过覆盖层 ——
  重建后跑一遍 `tools/probe.js --audit=…` 即可发现（见 3.2）。
- 只覆盖视觉与手感层，**未改任何 DOM 结构、布局结构与 JS 逻辑** —— 不存在功能回归风险。
