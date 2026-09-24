/* ===========================================================================
   课程资源管理页 · 并入教师端的接线脚本

   背景：teacher-dist/ 是 Vite 构建产物，仓库里没有对应的 Vue 源码，
   所以只能在 dist 层用运行时脚本接进去。项目里已有同样的先例 ——
   index.html 里的 ui-theme.css 就是靠运行时注入 + MutationObserver 打补丁的。

   这里做三件事：
     1. 往 vue-router 注册 #/course-resources。
        不注册的话，这个 hash 会被应用的 404 兜底路由吃掉。
     2. 往侧栏 ul.el-menu 插一个菜单项，结构对齐 Element-Plus 原生写法
        （li.el-menu-item 外面包一层 a），这样 .el-menu-item 的样式直接复用，
        不用自己写一套侧栏样式。
     3. 路由激活时把页面挂进 .app-main，离开时卸载干净。

   为什么页面组件用 render(){return null} + mounted 里挂兄弟节点：
     Vue 3 的 render 不再把 h 作为参数传进来（Vue 2 才传），
     运行时也拿不到 createVNode，所以没法在组件里造 vnode。
     返回 null 会渲染成一个注释占位节点，它的父节点正好就是路由出口 .app-main，
     往那儿 appendChild 即可。离开时在 beforeUnmount 里摘掉，不留残留。
--------------------------------------------------------------------------- */
(function () {
  'use strict';

  var ROUTE_PATH = '/course-resources';
  var ROUTE_HASH = '#/course-resources';
  var ROUTE_NAME = 'CourseResourcesPage';
  var TITLE = '课程资源管理';
  var MENU_ID = 'crMenuEntry';

  /* 必须在应用启动前就把原始 hash 记下来。
     路由器首次导航发现这个路径没注册过，会立刻重定向到 #/404；
     等那时候再读 location.hash 就已经晚了，看到的会是 #/404。
     本脚本是普通 <script>，排在 <body> 末尾，会在 type="module" 的
     Vite 产物之前执行，所以这里读到的一定是用户真正输入的那个 hash。 */
  var ORIGINAL_HASH = location.hash;

  var installed = false;
  var hostEl = null;

  /* ---------------- 拿应用实例 / 路由 ---------------- */

  function getApp() {
    var el = document.getElementById('app');
    return (el && el.__vue_app__) || null;
  }

  function getRouter() {
    var app = getApp();
    var gp = app && app.config && app.config.globalProperties;
    return (gp && gp.$router) || null;
  }

  /* ---------------- 路由组件 ---------------- */

  function makeComponent() {
    return {
      name: 'CourseResourcesPage',
      // Vue 3 的 render 拿不到 h，返回 null → 渲染成注释占位节点
      render: function () { return null; },
      mounted: function () {
        var parent = this.$el && this.$el.parentNode;
        if (!parent) return;

        var host = document.createElement('div');
        host.className = 'cr-host';
        parent.appendChild(host);
        this._host = host;
        hostEl = host;

        if (window.CourseResources && window.CourseResources.mount) {
          window.CourseResources.mount(host);
        } else {
          host.textContent = '课程资源管理模块未加载（js/course-resources.js 缺失）';
        }
      },
      beforeUnmount: function () {
        if (window.CourseResources && window.CourseResources.unmount) {
          window.CourseResources.unmount();
        }
        hostEl = null;
        if (this._host && this._host.parentNode) this._host.parentNode.removeChild(this._host);
      },
    };
  }

  /* ---------------- 侧栏菜单项 ---------------- */

  function getMenu() {
    return document.querySelector('.layout__sidebar ul.el-menu');
  }

  /* 从原生菜单项上抄 Vue 的 scoped 属性名（形如 data-v-d391d0fe）。
     应用的组件样式是 `.menu-icon[data-v-d391d0fe] { width:18px; ... }`，
     这是 SFC 编译出来的 scoped 规则，只命中带该属性的元素。
     我们注入的节点没有这个属性 → 规则不命中 → 图标尺寸掉回 14px 而不是 18px，
     肉眼一看就和别的菜单项不一样。
     这里**动态读取**而不是硬编码哈希：硬编码的话应用一重新构建就失效了。 */
  function scopeAttrsFrom(el) {
    var names = [];
    if (!el) return names;
    for (var i = 0; i < el.attributes.length; i++) {
      if (/^data-v-/.test(el.attributes[i].name)) names.push(el.attributes[i].name);
    }
    return names;
  }

  function injectMenu() {
    var menu = getMenu();
    if (!menu || menu.querySelector('#' + MENU_ID)) return;

    var wrap = document.createElement('div');
    wrap.id = MENU_ID;
    // 结构逐字对齐原生菜单项（原生那条 li 是从真实应用上抄下来的）：
    //   <li class="el-menu-item submenu-title-noDropdown" role="menuitem" tabindex="-1">
    //     <div class="i-svg:xxx menu-icon" data-v-xxxx></div>
    //     <span class="menu-title ml-1" data-v-xxxx>文字</span>
    //   </li>
    // 三点必须照做，否则样式会和别的菜单项不一致：
    //   · 文字包在 span.menu-title 里 —— 侧栏折叠时应用靠
    //     `.el-menu-item .menu-title { display:none !important }` 把它藏起来；
    //   · 图标用应用自己的 i-svg:*（CSS mask + currentColor），自带尺寸和 margin；
    //   · 把原生节点的 data-v-* 属性抄过来，scoped 样式才会命中。
    // 外面包一层 <a href="#/...">，用 hash 跳转，vue-router 会照常响应。
    // （拿不到 RouterLink 组件，所以用原生 a。）
    wrap.innerHTML =
      '<a href="' + ROUTE_HASH + '" class="cr-menu-link">' +
        '<li class="el-menu-item submenu-title-noDropdown" role="menuitem" tabindex="-1">' +
          '<div class="i-svg:cr-resources menu-icon"></div>' +
          '<span class="menu-title ml-1">' + TITLE + '</span>' +
        '</li>' +
      '</a>';

    // 抄 scoped 属性（图标 / 标题都抄一遍，两者在原生里都带）
    var refIcon = document.querySelector('.layout__sidebar .el-menu-item .menu-icon');
    var refTitle = document.querySelector('.layout__sidebar .el-menu-item .menu-title');
    scopeAttrsFrom(refIcon).forEach(function (a) {
      wrap.querySelector('.menu-icon').setAttribute(a, '');
    });
    scopeAttrsFrom(refTitle).forEach(function (a) {
      wrap.querySelector('.menu-title').setAttribute(a, '');
    });

    menu.appendChild(wrap);
    syncMenuActive();
  }

  function syncMenuActive() {
    var wrap = document.getElementById(MENU_ID);
    if (!wrap) return;
    var li = wrap.querySelector('.el-menu-item');
    if (!li) return;
    // 注意用 ROUTE_HASH（带前导 #）来比：location.hash 是 '#/course-resources'，
    // 拿 ROUTE_PATH（'/course-resources'）去 indexOf 会得到 1 而不是 0，判断恒为假。
    var on = location.hash.indexOf(ROUTE_HASH) === 0;
    li.classList.toggle('is-active', on);
  }

  /* ---------------- 补齐应用缺的菜单图标 ----------------

     应用的菜单配置里，「学情分析」和「课程管理」都写的是 icon: 'list'，
     但它的图标包里根本没有 list —— 这两项在侧栏上一直是空白的。
     这是应用自身的 bug（配置引用了不存在的图标名），但侧栏是共享外壳，
     从我们这里顺手补掉比让用户一直看着两个没图标的菜单项要好。

     只补**确实渲染不出东西**的图标：有图的绝不碰。
     判断方式是读计算值 —— 应用的图标用 mask-image，彩色图标用 background-image，
     两者都是 none 就说明这个类名没有对应图形。
     直接读现成元素即可，display:none（折叠的子菜单）也照样能拿到计算值。 */
  var ICON_FIX = {
    '学情分析': 'cr-analytics',
    '课程管理': 'cr-course',
  };

  function iconRenders(icon) {
    var cs = getComputedStyle(icon);
    var mask = cs.maskImage || cs.webkitMaskImage || '';
    var bg = cs.backgroundImage || '';
    return (mask && mask !== 'none') || (bg && bg !== 'none');
  }

  function fixBrokenMenuIcons() {
    var sidebar = document.querySelector('.layout__sidebar');
    if (!sidebar) return;
    // 顶层项是 .el-menu-item，带子菜单的是 .el-sub-menu__title
    var items = sidebar.querySelectorAll('.el-menu-item, .el-sub-menu__title');
    Array.prototype.forEach.call(items, function (item) {
      var icon = item.querySelector('.menu-icon');
      var title = item.querySelector('.menu-title');
      if (!icon || !title) return;

      var want = ICON_FIX[title.textContent.trim()];
      if (!want) return;
      if (icon.classList.contains('i-svg:' + want)) return;   // 已经补过了
      if (iconRenders(icon)) return;                          // 有图，别动

      // 只替换 i-svg:* 那个类名，其它类名和属性（含 Vue 的 data-v-*）原样保留 ——
      // data-v-* 一丢，.menu-icon[data-v-xxx] 的 18px 尺寸就没了。
      var rest = String(icon.className).split(/\s+/).filter(function (c) {
        return c && c.indexOf('i-svg:') !== 0;
      });
      rest.push('i-svg:' + want);
      icon.className = rest.join(' ');
    });
  }

  /* ---------------- 安装 ---------------- */

  function install() {
    if (installed) return true;
    var router = getRouter();
    if (!router || typeof router.addRoute !== 'function') return false;

    router.addRoute('/', {
      path: 'course-resources',
      name: ROUTE_NAME,
      component: makeComponent(),
      meta: { title: TITLE, icon: 'list' },
    });
    installed = true;

    // 选中态必须挂 afterEach，不能只靠 hashchange：
    // vue-router 的 hash 模式是用 history.pushState 改 URL 的，而 pushState
    // **不会**触发 hashchange —— 点应用自己的 router-link 跳走时事件根本不来，
    // 菜单项就会一直停在选中态。
    // （hashchange 仍然保留：我们注入的是原生 <a href="#/...">，真实锚点跳转会触发它。）
    if (typeof router.afterEach === 'function') {
      router.afterEach(function () { syncMenuActive(); });
    }

    // 直达 / 刷新时，首次导航早已因为「路由还没注册」被兜底到 #/404 了，
    // 这里补一次 replace 把它拉回来。用 replace 而不是 push，
    // 避免在历史里多留一条记录（用户按返回不该回到 404）。
    if (ORIGINAL_HASH.indexOf(ROUTE_PATH) >= 0 && location.hash.indexOf(ROUTE_PATH) < 0) {
      try { router.replace(ROUTE_PATH); } catch (e) { /* 忽略 */ }
    }
    return true;
  }

  function boot() {
    if (install()) {
      syncMenu();
      return;
    }
    setTimeout(boot, 50);
  }

  /* 侧栏的同步动作统一走这里：注入我们的菜单项 + 补齐应用缺的图标。
     两个都是幂等的，可以放心被 MutationObserver 反复触发。 */
  function syncMenu() {
    injectMenu();
    fixBrokenMenuIcons();
  }

  /* 侧栏是异步渲染的（菜单来自接口），我们第一次找到 __vue_app__ 时
     ul.el-menu 很可能还不存在；另外登录、切换布局等情况也可能整块重建。
     所以用 MutationObserver 盯着，菜单一出现就补上。
     这和 ui-theme.css 里 keepLast() 的做法是一致的。 */
  function watchMenu() {
    var obs = new MutationObserver(function () {
      if (!installed) install();
      syncMenu();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('hashchange', syncMenuActive);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { watchMenu(); boot(); });
  } else {
    watchMenu();
    boot();
  }
})();
