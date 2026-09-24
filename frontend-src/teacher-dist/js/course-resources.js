/* ===========================================================================
   课程资源管理页 · 交互逻辑（并入教师端的可挂载版本）

   本文件由 tools/bundle_page.py 从预览稿自动生成，**不要手改**。
   改预览稿（teacher-dist-redesign/）后重新跑：
       python tools/bundle_page.py

   与预览稿的差别只有「怎么挂上去」：
     · 复刻的侧栏 / 顶栏整块去掉 —— 真实应用自己提供外壳；
     · 页面标记收进 PAGE_HTML，由 mount(host) 注入；
     · 浮层（批量舱 / 弹窗 / toast）挂到 document.body，避免被 .app-main 的
       滚动容器或路由切换时的 transform 影响 position:fixed 的参照系；
     · $ / $$ 改成跨「宿主 + 浮层」查找；
     · 不再监听 DOMContentLoaded，改为对外暴露 window.CourseResources.mount/unmount。

   数据依旧全部来自真实接口，不内置任何演示数据。
--------------------------------------------------------------------------- */
(function () {
  'use strict';

  /* 页面主体标记：由 mount() 注入宿主。 */
  var PAGE_HTML = [
    '<main class="content">',
    '',
    '      <!-- 页面自己的工具条（搜索 + 归档按钮），属于本页内容，不占用顶栏 -->',
    '      <section class="page-tools">',
    '        <div class="search">',
    '          <iconify-icon icon="mdi:magnify" width="15"></iconify-icon>',
    '          <input id="globalSearch" type="text" placeholder="搜索资料名、章节、课程、关键字…">',
    '          <kbd>⌘K</kbd>',
    '        </div>',
    '        <button class="btn btn-soft" id="exportDataBtn"><iconify-icon icon="mdi:database-export-outline" width="14"></iconify-icon><span>导出数据</span></button>',
    '        <button class="btn btn-dark" id="openUploadBtn">',
    '          <iconify-icon icon="mdi:plus-circle-outline" width="15"></iconify-icon><span>存入历史资料</span>',
    '        </button>',
    '      </section>',
    '',
    '      <!-- 课程（一级导航：先看课程，点开某门课才显示它的资料） -->',
    '      <section id="courseSection">',
    '        <div class="sec-head">',
    '          <div>',
    '            <h2>课程</h2>',
    '            <p id="courseHint">选择一门课程，查看它归档的全部资料</p>',
    '          </div>',
    '          <div class="sec-tools">',
    '            <button class="btn btn-ghost is-hidden" id="backToCoursesBtn">',
    '              <iconify-icon icon="mdi:arrow-left" width="14"></iconify-icon><span>全部课程</span>',
    '            </button>',
    '          </div>',
    '        </div>',
    '        <div class="course-grid" id="courseCardGrid"></div>',
    '      </section>',
    '',
    '      <!-- 未选课程时的提示（选中课程后隐藏，露出下方资料区） -->',
    '      <section class="course-empty" id="courseEmptyHint">',
    '        <span class="empty-icon"><iconify-icon icon="mdi:cursor-default-click-outline" width="26"></iconify-icon></span>',
    '        <h4>请先选择一门课程</h4>',
    '        <p>点击上方课程卡片，即可查看该课程的归档资料（课程总览、章节讲义、课件、测验、编程练习等）。</p>',
    '      </section>',
    '',
    '      <!-- 资料区：选中课程后才显示 -->',
    '      <div id="resourceArea" class="is-hidden">',
    '',
    '      <!-- 学期时间轴（学期由真实课程的归档时间推导，见 loadRealData） -->',
    '      <section>',
    '        <div class="sec-head">',
    '          <div>',
    '            <h2>学期归档</h2>',
    '            <p id="semesterHint">正在读取课程归档记录…</p>',
    '          </div>',
    '          <div class="sec-tools">',
    '            <button class="icon-btn bordered" id="semScrollPrev" title="向左滚动"><iconify-icon icon="mdi:chevron-left" width="15"></iconify-icon></button>',
    '            <button class="icon-btn bordered" id="semScrollNext" title="向右滚动"><iconify-icon icon="mdi:chevron-right" width="15"></iconify-icon></button>',
    '          </div>',
    '        </div>',
    '        <div class="sem-grid" id="semesterCardGrid"></div>',
    '      </section>',
    '',
    '      <!-- 指标（数值全部来自真实接口，见 js/resource-vault.js 的 loadRealData） -->',
    '      <section class="stats">',
    '        <div class="stat">',
    '          <div>',
    '            <p>已归档课程</p>',
    '            <h4 id="statCourses">--</h4>',
    '            <span class="tone-brand"><iconify-icon icon="mdi:layers-outline" width="12"></iconify-icon><span id="statChapters">--</span></span>',
    '          </div>',
    '          <span class="stat-icon tone-brand"><iconify-icon icon="mdi:school-outline" width="19"></iconify-icon></span>',
    '        </div>',
    '        <div class="stat">',
    '          <div>',
    '            <p>归档资料总数</p>',
    '            <h4 id="statTotalFiles">--</h4>',
    '            <span class="tone-ok"><iconify-icon icon="mdi:file-check-outline" width="12"></iconify-icon><span id="statSections">--</span></span>',
    '          </div>',
    '          <span class="stat-icon tone-ok"><iconify-icon icon="mdi:file-multiple-outline" width="19"></iconify-icon></span>',
    '        </div>',
    '        <div class="stat">',
    '          <div>',
    '            <p>内容总体量</p>',
    '            <h4 id="statVolume">--</h4>',
    '            <span class="tone-warn"><iconify-icon icon="mdi:harddisk" width="12"></iconify-icon><span id="statVolumeNote">按归档正文实测</span></span>',
    '          </div>',
    '          <span class="stat-icon tone-warn"><iconify-icon icon="mdi:harddisk" width="19"></iconify-icon></span>',
    '        </div>',
    '        <div class="stat">',
    '          <div>',
    '            <p>最近归档</p>',
    '            <h4 id="statLatest">--</h4>',
    '            <span class="tone-info"><iconify-icon icon="mdi:progress-clock" width="12"></iconify-icon><span id="statLatestNote">--</span></span>',
    '          </div>',
    '          <span class="stat-icon tone-info"><iconify-icon icon="mdi:progress-clock" width="19"></iconify-icon></span>',
    '        </div>',
    '      </section>',
    '',
    '      <!-- 筛选面板 -->',
    '      <section class="panel">',
    '        <div class="panel-row">',
    '          <!-- 分类胶囊由 JS 按真实内容类型渲染（讲解课件/随堂测验/编程练习/交互演示/小节讲义/课程文档） -->',
    '          <div class="pills" id="categoryTabs"></div>',
    '          <div class="panel-tools">',
    '            <label class="select">',
    '              <iconify-icon icon="mdi:sort" width="14"></iconify-icon>',
    '              <select id="sortBySelect">',
    '                <option value="newest">更新时间: 最新优先</option>',
    '                <option value="oldest">更新时间: 最早优先</option>',
    '                <option value="size">内容体积: 大到小</option>',
    '                <option value="chapter">按章节顺序</option>',
    '              </select>',
    '            </label>',
    '            <div class="seg" id="viewSeg">',
    '              <button class="is-on" data-view="grid" title="卡片视图"><iconify-icon icon="mdi:view-grid-outline" width="15"></iconify-icon></button>',
    '              <button data-view="list" title="清单视图"><iconify-icon icon="mdi:format-list-bulleted" width="15"></iconify-icon></button>',
    '            </div>',
    '          </div>',
    '        </div>',
    '',
    '        <div class="panel-row panel-row-sub">',
    '          <div class="facets">',
    '            <!-- 课程下拉由 JS 按 /api/v1/course/list 真实返回渲染 -->',
    '            <label class="select">',
    '              <span class="dim">课程筛选:</span>',
    '              <select id="courseSelect"></select>',
    '            </label>',
    '            <button class="link-btn" id="resetBtn">',
    '              <iconify-icon icon="mdi:backup-restore" width="13"></iconify-icon><span>重置筛选</span>',
    '            </button>',
    '          </div>',
    '          <div class="count">检索到符合条件资料: <b id="resultCountBadge">0</b> 份</div>',
    '        </div>',
    '      </section>',
    '',
    '      <!-- 卡片视图 -->',
    '      <section class="grid" id="gridWrapper"></section>',
    '',
    '      <!-- 清单视图 -->',
    '      <section class="table-wrap is-hidden" id="tableWrapper">',
    '        <table class="table">',
    '          <thead>',
    '            <tr>',
    '              <th class="col-check"><input type="checkbox" id="selectAllRows"></th>',
    '              <th>资料与文件名</th><th>归属课程</th><th>学年学期</th>',
    '              <th>体积</th><th>更新时间</th><th>内容构成</th><th class="ta-r">快捷操作</th>',
    '            </tr>',
    '          </thead>',
    '          <tbody id="tableBody"></tbody>',
    '        </table>',
    '      </section>',
    '',
    '      <!-- 空状态 -->',
    '      <section class="empty is-hidden" id="emptyView">',
    '        <span class="empty-icon"><iconify-icon icon="mdi:inbox-outline" width="28"></iconify-icon></span>',
    '        <h4>未找到相匹配的历史教研资料</h4>',
    '        <p>请尝试调整搜索关键词、切换学年学期，或直接点击右上角按钮存入该课程的新材料。</p>',
    '        <button class="btn btn-dark" id="emptyResetBtn">恢复所有历史资料</button>',
    '      </section>',
    '',
    '      </div><!-- /#resourceArea -->',
    '',
    '    </main>',
  ].join('\n');

  /* 浮层标记：挂到 document.body，避开 .app-main 的滚动/动画上下文。 */
  var PORTAL_HTML = [
    '<div class="dock" id="batchDock">',
    '  <div class="dock-count"><span id="dockSelectedCount">0</span> 项资料已选中</div>',
    '  <button class="btn btn-brand" id="dockClone"><iconify-icon icon="mdi:content-duplicate" width="14"></iconify-icon><span>一键继承到新学期</span></button>',
    '  <button class="btn btn-ghost" id="dockPack"><iconify-icon icon="mdi:folder-zip-outline" width="14"></iconify-icon><span>打包下载 (.ZIP)</span></button>',
    '  <button class="btn btn-ghost" id="dockZip"><iconify-icon icon="mdi:database-export-outline" width="14"></iconify-icon><span>导出结构数据</span></button>',
    '  <button class="icon-btn danger" id="dockDelete" title="删除所选手动存入的文件（课程生成产出的内容不受影响）"><iconify-icon icon="mdi:delete-outline" width="16"></iconify-icon></button>',
    '  <button class="icon-btn" id="dockClear" title="取消选择"><iconify-icon icon="mdi:close" width="15"></iconify-icon></button>',
    '</div>',
    '<div class="overlay is-hidden" id="previewModal">',
    '  <div class="modal modal-xl" role="dialog" aria-modal="true">',
    '    <div class="modal-head">',
    '      <div class="modal-head-main">',
    '        <span class="badge-lg" id="previewBadge">PPT</span>',
    '        <div>',
    '          <h3 id="previewTitle">资料详情预览</h3>',
    '          <p id="previewSub">课程代号 · 历史学期</p>',
    '        </div>',
    '      </div>',
    '      <button class="icon-btn" id="previewClose"><iconify-icon icon="mdi:close" width="16"></iconify-icon></button>',
    '    </div>',
    '    <!-- 专业文档阅览工具栏：按查看器类型动态渲染（缩放 / 双视图 / 翻页…） -->',
    '    <div class="pv-toolbar is-hidden" id="previewToolbar"></div>',
    '',
    '    <div class="modal-body pv-body">',
    '      <!-- 沉浸式预览工作台：按资料类型渲染对应的交互预览器 -->',
    '      <div class="pv-stage" id="previewStage"></div>',
    '',
    '      <!-- 无专属查看器时的兜底：一句「装载了什么」的说明 -->',
    '      <div class="viewer is-hidden" id="previewFallback">',
    '        <span class="viewer-icon"><iconify-icon id="previewViewerIcon" icon="mdi:book-check-outline" width="24"></iconify-icon></span>',
    '        <h4 id="previewViewerTitle">课件幻灯片大纲切片已装载</h4>',
    '        <p id="previewViewerDesc">包含课程知识脉络图谱、期末考点批注、算法推导板书及课后作业答案。</p>',
    '        <div class="viewer-foot"><span>支持按需重构</span><em>高保真教学归档格式</em></div>',
    '      </div>',
    '',
    '      <details class="pv-meta">',
    '        <summary><iconify-icon icon="mdi:information-outline" width="14"></iconify-icon><span>资料元信息</span></summary>',
    '        <div class="meta-grid">',
    '          <div><span>归属课程</span><b id="previewCourse">--</b></div>',
    '          <div><span>归档学期</span><b id="previewSemester">--</b></div>',
    '          <div><span>内容体积</span><b id="previewSize">--</b></div>',
    '          <div><span>内容构成</span><b class="tone-ok-text" id="previewComposition">--</b></div>',
    '          <div class="span2"><span>内容摘要（来自课程实际生成结果）</span><p id="previewNotes">--</p></div>',
    '        </div>',
    '      </details>',
    '    </div>',
    '    <div class="modal-foot">',
    '      <button class="link-btn" id="previewCopyLink"><iconify-icon icon="mdi:link-variant" width="15"></iconify-icon><span>复制归档标识</span></button>',
    '      <div class="modal-foot-actions">',
    '        <button class="btn btn-brand-soft" id="previewClone"><iconify-icon icon="mdi:content-copy" width="14"></iconify-icon><span>继承到新学期</span></button>',
    '        <!-- 导出：按条目真实类型给格式（文档→doc、课件→ppt、源码→zip…），不再一律 JSON -->',
    '        <div class="pv-export">',
    '          <button class="btn btn-dark" id="previewDownload"><iconify-icon icon="mdi:download-outline" width="14"></iconify-icon><span>导出</span><iconify-icon icon="mdi:chevron-down" width="14"></iconify-icon></button>',
    '          <div class="pv-export-menu is-hidden" id="previewExportMenu"></div>',
    '        </div>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>',
    '<div class="overlay is-hidden" id="uploadModal">',
    '  <div class="modal" role="dialog" aria-modal="true">',
    '    <div class="modal-head">',
    '      <div class="modal-head-main">',
    '        <span class="badge-lg badge-dark"><iconify-icon icon="mdi:cloud-upload-outline" width="17"></iconify-icon></span>',
    '        <div>',
    '          <h3>存入课程资料</h3>',
    '          <p>归档到课程资源库，与课程生成产出的内容并列</p>',
    '        </div>',
    '      </div>',
    '      <button class="icon-btn" id="uploadClose"><iconify-icon icon="mdi:close" width="16"></iconify-icon></button>',
    '    </div>',
    '    <form class="modal-body" id="uploadForm">',
    '      <div class="dropzone" id="dropzone">',
    '        <input type="file" id="filePickerInput" hidden>',
    '        <span class="dropzone-icon"><iconify-icon icon="mdi:file-upload-outline" width="22"></iconify-icon></span>',
    '        <p id="uploadDropText">点击选择或将文件拖入此区域</p>',
    '        <!-- 真实上传接口是 POST /api/v1/course/archive-file（multipart），',
    '             后端不限格式、不限类型， nginx 侧放开到 2GB（client_max_body_size）。',
    '             文件按课程落盘 + 元数据入库，列表页可原样下载回来。 -->',
    '        <span class="dim">支持任意格式文件（PPTX / PDF / DOCX / ZIP / MP4 …），单个最大 2GB，存入后可随时原样下载</span>',
    '      </div>',
    '',
    '      <div class="form-grid">',
    '        <!-- 课程下拉按真实数据渲染（见 js/resource-vault.js 的 renderUploadOptions）。',
    '             归属学期不再让用户挑 —— 上传时间即归档时间，学期由它推导',
    '             （与学期归档时间轴的口径一致），选了反而在说谎。 -->',
    '        <label><span>对应课程</span>',
    '          <select id="modalCourse"></select>',
    '        </label>',
    '      </div>',
    '',
    '      <div class="field">',
    '        <span class="field-label">资料类型标签</span>',
    '        <div class="radio-grid" id="uploadTypeGrid">',
    '          <label><input type="radio" name="uploadType" value="slides" checked><span>讲解课件</span></label>',
    '          <label><input type="radio" name="uploadType" value="quiz"><span>随堂测验</span></label>',
    '          <label><input type="radio" name="uploadType" value="code"><span>编程练习</span></label>',
    '          <label><input type="radio" name="uploadType" value="interactive"><span>交互演示</span></label>',
    '          <label><input type="radio" name="uploadType" value="md"><span>小节讲义</span></label>',
    '          <label><input type="radio" name="uploadType" value="doc"><span>课程文档</span></label>',
    '        </div>',
    '      </div>',
    '',
    '      <label class="field">',
    '        <span class="field-label">归档备注（选填）</span>',
    '        <input type="text" id="modalNotes" placeholder="例：期末复习重点，建议新学期保留">',
    '      </label>',
    '',
    '      <div class="progress is-hidden" id="uploadProgress">',
    '        <div class="progress-head"><span>正在上传文件…</span><b id="uploadProgressText">0%</b></div>',
    '        <div class="progress-bar"><i id="uploadProgressBar" style="width:0%"></i></div>',
    '      </div>',
    '',
    '      <div class="modal-foot inline">',
    '        <button type="button" class="btn btn-ghost" id="uploadCancel">取消</button>',
    '        <button type="submit" class="btn btn-dark" id="modalSubmitBtn">',
    '          <iconify-icon icon="mdi:check" width="14"></iconify-icon><span>存入资料库</span>',
    '        </button>',
    '      </div>',
    '    </form>',
    '  </div>',
    '</div>',
    '<div class="overlay is-hidden" id="exportModal">',
    '  <div class="modal modal-lg" role="dialog" aria-modal="true">',
    '    <div class="modal-head">',
    '      <div class="modal-head-main">',
    '        <span class="badge-lg badge-dark"><iconify-icon icon="mdi:database-export-outline" width="17"></iconify-icon></span>',
    '        <div>',
    '          <h3>导出教研资料数据</h3>',
    '          <p>结构化数据（JSON / CSV / Markdown）或按真实类型打包原始文件（.ZIP）</p>',
    '        </div>',
    '      </div>',
    '      <button class="icon-btn" id="exportClose"><iconify-icon icon="mdi:close" width="16"></iconify-icon></button>',
    '    </div>',
    '    <div class="modal-body export-body">',
    '      <!-- 1 格式 + 2 范围：左右两列并排 -->',
    '      <div class="export-cols">',
    '        <section class="export-card">',
    '          <span class="export-card-title">1. 目标数据格式</span>',
    '          <div class="export-fmt-grid" id="exportFormatSeg">',
    '            <button class="is-on" data-fmt="json"><b>JSON</b><em>标准对象 / API</em></button>',
    '            <button data-fmt="csv"><b>CSV</b><em>Excel / 教务表</em></button>',
    '            <button data-fmt="md"><b>Markdown</b><em>知识库 / 教案</em></button>',
    '            <!-- 真实文件：按每条资料的类型产出 doc/ppt/md/html/json，打成一个 .ZIP -->',
    '            <button data-fmt="files"><b>原始文件</b><em>按类型打包 .ZIP</em></button>',
    '          </div>',
    '        </section>',
    '',
    '        <section class="export-card">',
    '          <span class="export-card-title">2. 数据提取范围</span>',
    '          <div class="export-scope" id="exportScopeGrid">',
    '            <label><input type="radio" name="exportScope" value="all"><span>全部历史库</span></label>',
    '            <label><input type="radio" name="exportScope" value="filtered"><span>当前筛选结果</span></label>',
    '            <label><input type="radio" name="exportScope" value="selected"><span>浮动舱选中条目</span></label>',
    '          </div>',
    '          <!-- 课程限定：在选定范围之上再按课程收窄 -->',
    '          <div class="export-course">',
    '            <span class="export-course-label"><iconify-icon icon="mdi:school-outline" width="14"></iconify-icon>限定课程</span>',
    '            <select id="exportCourseSelect"></select>',
    '          </div>',
    '        </section>',
    '      </div>',
    '',
    '      <!-- 3 字段投射 -->',
    '      <section class="export-card" id="exportFieldWrap">',
    '        <div class="export-card-head">',
    '          <span class="export-card-title">3. 导出字段投射（勾选要导出的列）</span>',
    '          <a class="link-btn sm" id="exportToggleAll">全选 / 反选</a>',
    '        </div>',
    '        <div class="field-grid" id="exportFieldGrid"></div>',
    '      </section>',
    '',
    '      <!-- 4 实时预览 -->',
    '      <section class="export-card">',
    '        <div class="export-card-head">',
    '          <span class="export-card-title">4. 实时预览（前 1000 字符）</span>',
    '          <span class="dim" id="exportMeta"></span>',
    '        </div>',
    '        <pre class="export-preview" id="exportPreview"></pre>',
    '      </section>',
    '    </div>',
    '    <div class="modal-foot">',
    '      <span class="dim" id="exportFootStat">已解析 0 条记录</span>',
    '      <div class="modal-foot-actions">',
    '        <button class="link-btn" id="exportCopy"><iconify-icon icon="mdi:content-copy" width="15"></iconify-icon><span>复制内容</span></button>',
    '        <button class="btn btn-ghost" id="exportCancel">取消</button>',
    '        <button class="btn btn-dark" id="exportDownload"><iconify-icon icon="mdi:download-outline" width="14"></iconify-icon><span id="exportDownloadText">下载文件</span></button>',
    '      </div>',
    '    </div>',
    '  </div>',
    '</div>',
    '<div class="toast-root" id="toastRoot"></div>',
  ].join('\n');

  /* =========================================================================
     数据来源：全部走真实接口，不内置任何演示数据。

       GET /api/v1/course/list                        → 课程列表（与「课程列表」页同源）
       GET /api/v1/course/content-summary?courseId=N  → 课程内容汇总（与「课程管理」页同源）
       GET /api/teacher-portal/course-generation/jobs → 生成任务（与「课程生成」页同源）
       POST /api/v1/course/archive-file               → 存入历史资料（任意格式 multipart 上传）
       GET  /api/v1/course/archive-files              → 手动存入的归档文件列表
       GET  /api/v1/course/archive-file/download?id=N → 按原始文件名下载归档文件
       DELETE /api/v1/course/archive-file?id=N        → 删除一条手动存入的归档

     页面上的每一个数字、每一条资料都由上面接口的真实返回推导出来：
     归档资料 = 课程 × (逐章场景 + 小节讲义) + 课程级文档 + 手动存入的文件。
     接口返回 code=40100（未登录）时不渲染任何内容，直接提示去登录 ——
     宁可空着，也不要拿假数据糊弄。
  ========================================================================= */

  var API = {
    courseList: '/api/v1/course/list',
    currentUser: '/api/v1/user/current',
    jobs: '/api/teacher-portal/course-generation/jobs',
    archiveUpload: '/api/v1/course/archive-file',
    archiveList: '/api/v1/course/archive-files',
    archiveDownload: function (id) {
      return '/api/v1/course/archive-file/download?id=' + encodeURIComponent(id);
    },
    archiveDelete: function (id) {
      return '/api/v1/course/archive-file?id=' + encodeURIComponent(id);
    },
    summary: function (courseId) {
      return '/api/v1/course/content-summary?courseId=' + encodeURIComponent(courseId);
    }
  };

  /* 真实内容类型 → 徽标与图标。
     这些 key 就是课程生成器写入 scenes[].type 的取值，以及我们补的文档类型。 */
  var FORMAT = {
    slides:      { label: '课件', cls: 'badge-slides',      icon: 'mdi:presentation' },
    quiz:        { label: '测验', cls: 'badge-quiz',        icon: 'mdi:file-check-outline' },
    code:        { label: '代码', cls: 'badge-code',        icon: 'mdi:code-braces' },
    interactive: { label: '交互', cls: 'badge-interactive', icon: 'mdi:gesture-tap' },
    handout:     { label: '大纲', cls: 'badge-doc',         icon: 'mdi:file-document-edit-outline' },
    video:       { label: '视频', cls: 'badge-interactive', icon: 'mdi:video-outline' },
    md:          { label: '讲义', cls: 'badge-md',          icon: 'mdi:file-document-outline' },
    html:        { label: '总览', cls: 'badge-doc',         icon: 'mdi:book-open-page-variant' },
    json:        { label: '归档', cls: 'badge-doc',         icon: 'mdi:package-variant-closed' },
    other:       { label: '文件', cls: 'badge-doc',         icon: 'mdi:file-outline' }
  };

  /* 手动上传文件 → 图标与配色：按扩展名挑最贴切的。
     ⚠️ 这里的 label 已不再用于显示 —— fmt() 现在直接取**真实扩展名**做徽标文字
     （zip→ZIP、pdf→PDF），本表只剩 icon / cls 两个用途。
     这些是「存入历史资料」上传的任意格式文件（后端不限格式），
     category（上传时选的类型标签）单独存，用于分类胶囊筛选。 */
  var FILE_TYPE_FORMAT = {
    ppt:  { label: 'PPT',   cls: 'badge-slides',      icon: 'mdi:file-powerpoint-outline' },
    pptx: { label: 'PPT',   cls: 'badge-slides',      icon: 'mdi:file-powerpoint-outline' },
    pdf:  { label: 'PDF',   cls: 'badge-doc',         icon: 'mdi:file-pdf-box' },
    doc:  { label: 'Word',  cls: 'badge-md',          icon: 'mdi:file-word-outline' },
    docx: { label: 'Word',  cls: 'badge-md',          icon: 'mdi:file-word-outline' },
    xls:  { label: '表格',  cls: 'badge-doc',         icon: 'mdi:file-excel-outline' },
    xlsx: { label: '表格',  cls: 'badge-doc',         icon: 'mdi:file-excel-outline' },
    csv:  { label: '表格',  cls: 'badge-doc',         icon: 'mdi:file-delimited-outline' },
    zip:  { label: '压缩包', cls: 'badge-doc',        icon: 'mdi:folder-zip-outline' },
    rar:  { label: '压缩包', cls: 'badge-doc',        icon: 'mdi:folder-zip-outline' },
    '7z': { label: '压缩包', cls: 'badge-doc',        icon: 'mdi:folder-zip-outline' },
    mp4:  { label: '视频',  cls: 'badge-interactive', icon: 'mdi:file-video-outline' },
    mov:  { label: '视频',  cls: 'badge-interactive', icon: 'mdi:file-video-outline' },
    avi:  { label: '视频',  cls: 'badge-interactive', icon: 'mdi:file-video-outline' },
    mkv:  { label: '视频',  cls: 'badge-interactive', icon: 'mdi:file-video-outline' },
    mp3:  { label: '音频',  cls: 'badge-interactive', icon: 'mdi:file-music-outline' },
    wav:  { label: '音频',  cls: 'badge-interactive', icon: 'mdi:file-music-outline' },
    png:  { label: '图片',  cls: 'badge-quiz',        icon: 'mdi:file-image-outline' },
    jpg:  { label: '图片',  cls: 'badge-quiz',        icon: 'mdi:file-image-outline' },
    jpeg: { label: '图片',  cls: 'badge-quiz',        icon: 'mdi:file-image-outline' },
    gif:  { label: '图片',  cls: 'badge-quiz',        icon: 'mdi:file-image-outline' },
    py:   { label: '代码',  cls: 'badge-code',        icon: 'mdi:language-python' },
    js:   { label: '代码',  cls: 'badge-code',        icon: 'mdi:language-javascript' },
    ts:   { label: '代码',  cls: 'badge-code',        icon: 'mdi:language-typescript' },
    java: { label: '代码',  cls: 'badge-code',        icon: 'mdi:language-java' },
    c:    { label: '代码',  cls: 'badge-code',        icon: 'mdi:language-c' },
    cpp:  { label: '代码',  cls: 'badge-code',        icon: 'mdi:language-cpp' },
    ipynb:{ label: '笔记',  cls: 'badge-code',        icon: 'mdi:language-python' },
    txt:  { label: '文本',  cls: 'badge-md',          icon: 'mdi:text-box-outline' },
    md:   { label: '讲义',  cls: 'badge-md',          icon: 'mdi:file-document-outline' }
  };

  function fileExt(name) {
    var m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
  }

  /* 手动上传条目的 format 统一是 'file'，渲染徽标时再按扩展名细分 */
  var FILE_FORMAT = { label: '文件', cls: 'badge-doc', icon: 'mdi:file-outline' };

  /* 筛选胶囊 —— 与上面的真实类型一一对应 */
  var CATEGORY_ORDER = [
    { id: 'ALL',         label: '全部归档资料' },
    { id: 'slides',      label: '讲解课件' },
    { id: 'quiz',        label: '随堂测验' },
    { id: 'code',        label: '编程练习' },
    { id: 'interactive', label: '交互演示' },
    { id: 'handout',     label: '教学大纲' },
    { id: 'video',       label: '课堂实录' },
    { id: 'md',          label: '小节讲义' },
    { id: 'doc',         label: '课程文档' }
  ];

  /* 预览弹窗里那块「阅览器」的文案按真实类型走。
     标题**不要**再包一层《》—— 弹窗头部已经把条目标题完整显示出来了，
     这里再包一次会变成「《《从零开始学Python编程》知识图谱》…」。
     所以这里只描述「装载了什么」，不重复标题。 */
  var VIEWER = {
    slides:      { icon: 'mdi:presentation', label: '逐页讲解课件',
                   title: '逐页讲解课件已装载',
                   desc: '由课程生成器按小节产出的幻灯片序列，含课程导入、要点拆解与小结，可直接用于课堂讲授或学生端自学。' },
    quiz:        { icon: 'mdi:file-check-outline', label: '随堂测验题组',
                   title: '随堂测验题组已装载',
                   desc: '含题干、选项、正确答案与解析，本地判题，可用于课堂即时检测与课后自测。' },
    code:        { icon: 'mdi:code-braces', label: '编程练习与参考实现',
                   title: '编程练习已装载',
                   desc: '含初始代码骨架、题目说明、期望输出与测试用例，可直接下发给学生作答。' },
    interactive: { icon: 'mdi:gesture-tap', label: '交互演示',
                   title: '交互演示已装载',
                   desc: '独立可运行的交互式 HTML，用于演示抽象概念，学生端可嵌入播放。' },
    handout:     { icon: 'mdi:file-document-edit-outline', label: '教学大纲与板书解析',
                   title: '教学大纲与板书解析已装载',
                   desc: '包含课程知识脉络图谱、期末考点批注、算法推导板书及课后作业答案。' },
    video:       { icon: 'mdi:video-outline', label: '课堂实录视频',
                   title: '课堂实录视频已归档',
                   desc: '本节课的课堂实录视频，含章节打点与同步字幕，可定位到具体知识点。' },
    md:          { icon: 'mdi:file-document-outline', label: '小节讲义',
                   title: '小节讲义已装载',
                   desc: '课程生成器写入的 Markdown 讲义原稿，是章节课件与测验的素材来源。' },
    html:        { icon: 'mdi:book-open-page-variant', label: '课程总览',
                   title: '课程总览已装载',
                   desc: '课程总览页 HTML，含课程定位、章节脉络与学习建议。' },
    json:        { icon: 'mdi:package-variant-closed', label: '结构化归档',
                   title: '结构化归档已装载',
                   desc: '结构化归档数据（学习路径 / 知识图谱 / 完整课程包），可整体迁移到新学期。' },
    other:       { icon: 'mdi:file-outline', label: '归档内容',
                   title: '归档内容已装载',
                   desc: '该条目已完整归档。' },
    file:        { icon: 'mdi:file-check-outline', label: '原始文件',
                   title: '历史资料文件已归档',
                   desc: '通过「存入历史资料」上传的原始文件，已完整落库存档，可随时原样下载。' }
  };

  /* ---------------- 运行时状态 ---------------- */

  var courses = [];        // 真实课程
  var resources = [];      // 由真实数据推导出的归档条目
  var generatedResources = [];  // 课程生成器产出的条目（resources 的子集）
  var semesterList = [];   // 由课程归档时间推导出的学期
  var jobsByUid = {};      // 生成任务（用于「最近归档」的补充信息）
  var archiveFiles = [];   // 「存入历史资料」上传的真实文件（/api/v1/course/archive-files）

  var state = {
    semester: 'ALL', category: 'ALL', course: 'ALL',
    search: '', sort: 'newest', view: 'grid',
    selectedIds: new Set()
  };

  var activePreviewItem = null;

  /* ---------------- 小工具 ---------------- */

  function bytesOf(s) {
    if (!s) return 0;
    try { return new Blob([String(s)]).size; } catch (e) { return String(s).length; }
  }

  function formatBytes(n) {
    if (!n) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }

  function jsonBytes(o) {
    try { return bytesOf(JSON.stringify(o)); } catch (e) { return 0; }
  }

  function clip(s, n) {
    s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  /* 归档时间 → 学年学期。8 月–次年 1 月算秋季，2–7 月算春季。 */
  function semesterOf(iso) {
    var d = new Date(String(iso || '').replace(' ', 'T'));
    if (isNaN(d.getTime())) return { id: 'UNKNOWN', label: '学期未标注', year: '' };
    var y = d.getFullYear(), m = d.getMonth() + 1;
    var autumn = (m >= 8 || m === 1);
    var start = m === 1 ? y - 1 : y;
    return {
      id: start + (autumn ? '-A' : '-S'),
      label: start + '-' + (start + 1) + (autumn ? ' 第一学期 (秋)' : ' 第二学期 (春)'),
      year: start + '-' + (start + 1),
      autumn: autumn
    };
  }

  /* 统一取数：教师端一律 {code, message, data}，code!==0 视为失败 */
  function fetchJSON(url) {
    return fetch(url, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    }).then(function (r) {
      if (!r.ok) {
        var e = new Error('HTTP ' + r.status);
        e.status = r.status;
        throw e;
      }
      return r.json();
    }).then(function (body) {
      if (body && typeof body.code === 'number' && body.code !== 0) {
        var err = new Error(body.message || ('接口返回 code=' + body.code));
        err.code = body.code;
        throw err;
      }
      return body ? body.data : null;
    });
  }

  /* ---------------- 真实数据 → 归档条目 ---------------- */

  /* 单个场景 → 归档条目 */
  function sceneItem(course, chapter, chapterNo, sc, date) {
    var type = sc.type || 'other';
    var slides = sc.slides || [];
    var questions = sc.questions || [];
    var testCases = sc.testCases || [];
    var sizeBytes, composition, summary;

    if (type === 'slides') {
      sizeBytes = jsonBytes(slides);
      composition = slides.length + ' 页幻灯片';
      summary = slides.length
        ? '首节：' + clip(slides[0].title || '', 40) + '；共 ' + slides.length + ' 页逐页讲解。'
        : '逐页讲解课件。';
    } else if (type === 'quiz') {
      sizeBytes = jsonBytes(questions);
      composition = questions.length + ' 道题（含答案解析）';
      summary = questions.length
        ? '首题：' + clip(questions[0].question || '', 52)
        : '随堂测验题组。';
    } else if (type === 'interactive') {
      sizeBytes = bytesOf(sc.html || '');
      composition = '交互式 HTML';
      summary = clip(sc.description || '可在浏览器中直接运行的交互演示。', 90);
    } else if (type === 'code') {
      sizeBytes = bytesOf(sc.initialCode || '') + bytesOf(sc.description || '') + jsonBytes(testCases);
      composition = testCases.length + ' 个测试用例';
      summary = clip(sc.description || '编程练习。', 90);
    } else if (type === 'handout') {
      // 教学大纲与板书解析：一讲一份的「讲义型」材料
      sizeBytes = jsonBytes(sc);
      composition = '教学大纲 / 板书 / 考点 / 作业';
      summary = clip(sc.description ||
        '教学大纲与板书解析：含知识脉络图谱、考点批注、推导板书与课后作业答案。', 90);
    } else {
      sizeBytes = jsonBytes(sc);
      composition = '结构化内容';
      summary = clip(sc.description || sc.title || '', 90);
    }

    return {
      id: course.id + '-' + sc.key,
      // 场景自带的 title 已经含讲标题（如「环境搭建与第一个程序 · 讲解」），
      // 所以这里只补讲号，不要再拼一次 chapter.title，否则会重复成
      // 「第01讲：环境搭建与第一个程序 · 环境搭建与第一个程序 · 讲解」。
      title: '第' + pad2(chapterNo) + '讲：' + (sc.title || chapter.title),
      fileName: sc.key,
      format: type,
      category: type,
      chapterNo: chapterNo,
      size: formatBytes(sizeBytes),
      sizeBytes: sizeBytes,
      composition: composition,
      summary: summary,
      raw: sc
    };
  }

  function buildResources(list, summaryMap) {
    var out = [];

    list.forEach(function (c) {
      var s = summaryMap[c.id];
      if (!s) return;

      var sem = semesterOf(c.updateTime || c.createTime);
      var date = String(c.updateTime || c.createTime || '').slice(0, 10);
      var scenes = (s.scenes && s.scenes.scenes) || [];

      function push(o) {
        o.courseId = c.id;
        o.courseCode = c.courseCode;
        o.courseName = c.title;
        o.courseStatus = c.status;
        o.semester = sem.id;
        o.semesterName = sem.label;
        o.updateDate = date;
        o.courseIndex = c.id;
        out.push(o);
      }

      /* 1) 逐章：场景 + 小节讲义 */
      (s.structure || []).forEach(function (ch, ci) {
        var no = ci + 1;
        var sections = ch.children || [];

        scenes
          .filter(function (sc) { return String(sc.key || '').indexOf(ch.id + '-') === 0; })
          .forEach(function (sc) { push(sceneItem(c, ch, no, sc, date)); });

        if (sections.length) {
          // 小节讲义没有独立正文可量（正文在 course_content 里，接口只给到章节 id/title），
          // 所以用「能真正导出的那份 JSON」来量体积 —— 之前这里写死 0，
          // 结果统计卡的「按归档 JSON 实测」会把这 6 条悄悄漏掉，按体积排序时也一律沉底。
          // 带上 md 正文（种子/生成器写入），供预览里的 Markdown 阅读器渲染
          var mdPayload = sections.map(function (x) { return { path: x.id, title: x.title, md: x.md || x.content || '' }; });
          push({
            id: c.id + '-' + ch.id + '-MD',
            title: '第' + pad2(no) + '讲：' + ch.title + ' · 小节讲义',
            fileName: sections.map(function (x) { return x.id; }).join('、'),
            format: 'md', category: 'md', chapterNo: no,
            sectionCount: sections.length,
            size: sections.length + ' 个小节', sizeBytes: jsonBytes(mdPayload),
            composition: sections.length + ' 个小节讲义',
            summary: sections.map(function (x) { return x.title; }).join(' / '),
            payload: mdPayload
          });
        }
      });

      /* 2) 课程级文档 */
      var html = (s.example && s.example.html) || '';
      if (html) {
        var hb = bytesOf(html);
        push({
          id: c.id + '-OVERVIEW', title: '《' + c.title + '》课程总览',
          fileName: 'course-overview.html', format: 'html', category: 'doc', chapterNo: 0,
          size: formatBytes(hb), sizeBytes: hb,
          composition: '总览 HTML',
          summary: '课程总览页，含课程定位、章节脉络与学习建议。',
          payload: { html: html }
        });
      }

      var lp = s.learningPath;
      if (lp && (lp.nodes || []).length) {
        var lb = jsonBytes(lp);
        push({
          id: c.id + '-PATH', title: '《' + c.title + '》学习路径',
          fileName: 'learning-path.json', format: 'json', category: 'doc', chapterNo: 0,
          size: formatBytes(lb), sizeBytes: lb,
          composition: (lp.nodes || []).length + ' 个节点 / ' + ((lp.edges || []).length) + ' 条边',
          summary: '课程整体学习路径图，标注知识点先后依赖，可迁移到新学期直接复用。',
          payload: lp
        });
      }

      var kg = s.knowledgeGraphs;
      if (kg && kg.length) {
        var gb = jsonBytes(kg);
        var nodeCount = 0;
        kg.forEach(function (g) { nodeCount += ((g && g.nodes) || []).length; });
        push({
          id: c.id + '-GRAPH', title: '《' + c.title + '》知识图谱',
          fileName: 'knowledge-graph.json', format: 'json', category: 'doc', chapterNo: 0,
          size: formatBytes(gb), sizeBytes: gb,
          composition: kg.length + ' 张图谱 / ' + nodeCount + ' 个节点',
          summary: '按小节组织的知识图谱，含节点与关联边，供学生端可视化复习。',
          payload: kg
        });
      }

      /* 3) 完整归档包 = 该课程所有条目之和（即 course.json 的等价物） */
      var own = out.filter(function (o) { return o.courseId === c.id; });
      var total = own.reduce(function (a, o) { return a + (o.sizeBytes || 0); }, 0);
      var chapterCount = (s.structure || []).length;
      var sectionCount = (s.structure || []).reduce(function (a, ch) {
        return a + ((ch.children || []).length);
      }, 0);
      push({
        id: c.id + '-BUNDLE', title: '《' + c.title + '》完整课程归档包',
        fileName: 'course.json', format: 'json', category: 'doc', chapterNo: -1,
        size: formatBytes(total), sizeBytes: total,
        composition: chapterCount + ' 讲 / ' + sectionCount + ' 节 / ' + scenes.length + ' 个场景',
        summary: '该课程的全部结构化内容打包归档，含章节结构、场景、学习路径与知识图谱。',
        payload: { course: c, content: s }
      });
    });

    return out;
  }

  /* 由真实条目汇总出学期卡片 */
  function buildSemesters(items) {
    var map = {};
    items.forEach(function (it) {
      if (!map[it.semester]) {
        map[it.semester] = { id: it.semester, label: it.semesterName, year: '', count: 0 };
      }
      map[it.semester].count++;
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    arr.sort(function (a, b) { return b.id.localeCompare(a.id); });   // 新在前
    arr.unshift({ id: 'ALL', label: '全部学期', count: items.length, year: '' });
    return arr;
  }

  /* 手动上传的归档记录 → 与生成内容同构的条目，让同一套渲染/筛选直接吃。
     课程可能已删（课程列表里找不到）—— 归档是「历史资料」，课程没了资料还在，
     用记录自带的 courseName 兜底显示。 */
  function fileItem(f, c) {
    var sem = semesterOf(f.createTime);
    return {
      id: 'FILE-' + f.id,
      archiveId: f.id,                 // 删除/下载要用的真实主键
      title: f.fileName,
      fileName: f.fileName,
      format: 'file',
      category: f.category || 'doc',
      chapterNo: 0,
      size: formatBytes(f.sizeBytes),
      sizeBytes: f.sizeBytes || 0,
      composition: (f.mimeType || '未知类型') + ' · 原始文件',
      summary: f.notes || '手动存入的历史资料，可原样下载。',
      courseId: f.courseId,
      courseCode: f.courseCode || (c ? c.courseCode : ''),
      courseName: f.courseName || (c ? c.title : '（课程已删除）'),
      courseStatus: c ? c.status : undefined,
      semester: sem.id,
      semesterName: sem.label,
      updateDate: String(f.createTime || '').slice(0, 10),
      courseIndex: c ? c.id : 99999,   // 课程已删的沉底
      isUploadedFile: true
    };
  }

  /* 生成内容 + 手动文件 → 最终列表/学期。上传成功、删除后都要重跑。 */
  function rebuildDerived() {
    var courseMap = {};
    courses.forEach(function (c) { courseMap[c.id] = c; });
    resources = generatedResources.concat(
      archiveFiles.map(function (f) { return fileItem(f, courseMap[f.courseId]); }));
    semesterList = buildSemesters(resources);
  }

  /* ---------------- 首屏加载 ---------------- */

  function setStatus(text) {
    var el = $('semesterHint');
    if (el) el.textContent = text;
  }

  function showFatal(title, detail) {
    var grid = $('gridWrapper');
    if (grid) {
      grid.innerHTML =
        '<div class="empty" style="grid-column:1/-1">' +
          '<span class="empty-icon"><iconify-icon icon="mdi:alert-outline" width="28"></iconify-icon></span>' +
          '<h4>' + esc(title) + '</h4>' +
          '<p>' + esc(detail) + '</p>' +
        '</div>';
    }
    ['tableWrapper', 'emptyView'].forEach(function (id) {
      var e = $(id); if (e) e.classList.add('is-hidden');
    });
    $('resultCountBadge').textContent = '0';
    ['statCourses', 'statTotalFiles', 'statVolume', 'statLatest'].forEach(function (id) {
      if ($(id)) $(id).textContent = '—';
    });
  }

  function loadRealData() {
    // 顶栏右侧显示当前登录人 —— 与真实教师端 .navbar 一致，用接口返回的真实账号，不自造
    fetchJSON(API.currentUser).then(function (u) {
      if (u && $('navbarUser')) {
        $('navbarUser').textContent = u.userName || u.userAccount || '--';
      }
    }).catch(function () {
      if ($('navbarUser')) $('navbarUser').textContent = '未登录';
    });

    return fetchJSON(API.courseList).then(function (list) {
      courses = (list || []).slice();

      if (!courses.length) {
        setStatus('当前账号下还没有任何课程，先在「课程生成」里生成一门课，这里就会出现它的归档资料。');
        // 顺序不能反：renderAll() 会重写 gridWrapper.innerHTML，
        // 先 showFatal 再 renderAll 的话，错误提示会被清掉，用户只看到通用空态。
        renderAll();
        showFatal('还没有可归档的课程', '本页展示的是课程生成器实际产出的内容，暂无数据。');
        return;
      }

      return Promise.all([
        Promise.all(courses.map(function (c) {
          return fetchJSON(API.summary(c.id))
            .then(function (s) { return { id: c.id, s: s }; })
            .catch(function () { return { id: c.id, s: null }; });
        })),
        fetchJSON(API.jobs).catch(function () { return []; }),
        // 手动存入的历史资料：跟生成内容并列展示。读失败不拦整页 ——
        // 生成内容照常出，只是少了上传的文件，并提示一句
        fetchJSON(API.archiveList).catch(function () { return null; })
      ]).then(function (res) {
        var summaryMap = {};
        res[0].forEach(function (x) { if (x.s) summaryMap[x.id] = x.s; });
        (res[1] || []).forEach(function (j) { jobsByUid[j.jobId] = j; });
        archiveFiles = (res[2] || []).slice();

        generatedResources = buildResources(courses, summaryMap);
        rebuildDerived();

        if (!resources.length) {
          setStatus(archiveFiles.length
            ? '课程尚未生成内容，但已有 ' + archiveFiles.length + ' 份手动存入的历史资料。'
            : '课程已存在，但尚未保存任何内容（去「课程生成」发布一次即可归档）。');
          renderAll();
          if (!archiveFiles.length) {
            showFatal('课程还没有内容', '这门课程还没有生成并保存内容，暂无可归档的资料。');
          }
          return;
        }
        setStatus('归档学期由课程的实际归档时间推导，共 ' + (semesterList.length - 1) +
                  ' 个学期 / ' + resources.length + ' 条资料' +
                  (archiveFiles.length ? '（含手动存入 ' + archiveFiles.length + ' 份）' : '') + '。');
        renderAll();
      });
    }).catch(function (err) {
      if (err && (err.code === 40100 || err.status === 401)) {
        setStatus('未登录，无法读取课程数据。');
        renderAll();
        showFatal('请先登录教师端', '本页数据全部来自真实接口，需要登录后才能读取。');
      } else {
        setStatus('读取课程数据失败：' + (err && err.message ? err.message : '未知错误'));
        renderAll();
        showFatal('数据读取失败', (err && err.message) || '请确认后端服务是否正常。');
      }
    });
  }

  /* ---------------- 工具 ---------------- */

  /* 查找根：宿主（页面主体）+ 各浮层。
     浮层挂在 document.body 上，所以不能只在宿主里找。 */
  var ROOTS = [];
  var $ = function (id) {
    for (var i = 0; i < ROOTS.length; i++) {
      var r = ROOTS[i];
      // ⚠️ 根节点自身也要比一次。querySelector 只找**后代**，元素永远匹配不到自己；
      // 而 #batchDock / #previewModal / #uploadModal 这三个浮层容器本身就是 ROOTS 的成员，
      // 漏了这一步的话 $('previewModal') 会恒为 null，
      // 然后调用方在 .addEventListener 上炸掉，报错行号还跟真正的原因对不上。
      if (r.id === id) return r;
      var el = r.querySelector('[id="' + id + '"]');
      if (el) return el;
    }
    if (window.__CR_DEBUG_LOOKUP) {
      console.warn('[course-resources] 找不到 #' + id + '（ROOTS=' + ROOTS.length + '）');
    }
    return null;
  };
  var $$ = function (sel) {
    var out = [];
    for (var i = 0; i < ROOTS.length; i++) {
      var r = ROOTS[i];
      if (r.matches && r.matches(sel)) out.push(r);   // 同理：根自身也要算上
      out = out.concat(Array.prototype.slice.call(r.querySelectorAll(sel)));
    }
    return out;
  };

  function fmt(item) {
    /* 手动存入的文件：徽标直接显示**真实扩展名**（zip→ZIP、pdf→PDF、xlsx→XLSX），
       不再用「压缩包 / 表格」这类中文归类 —— 一眼看出这是什么文件。
       图标与配色仍按类型挑最贴切的（FILE_TYPE_FORMAT 那份映射照旧管 icon/cls）。 */
    if (item.isUploadedFile) {
      var ext = fileExt(item.fileName);
      var t = FILE_TYPE_FORMAT[ext];
      return {
        label: ext ? ext.toUpperCase() : FILE_FORMAT.label,
        cls: (t && t.cls) || FILE_FORMAT.cls,
        icon: (t && t.icon) || FILE_FORMAT.icon
      };
    }
    return FORMAT[item.format] || FORMAT.other;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 讲号补零：第 9 讲 → 第09讲（和「第09讲：…」的写法对齐） */
  function pad2(n) {
    n = Number(n) || 0;
    return n < 10 ? '0' + n : String(n);
  }

  /* ---------------- 渲染：学期卡片 ---------------- */

  function renderSemesterCards() {
    /* 学期卡只反映**当前选中课程**的归档时间；未选课程（ALL）时用全部。
       课程优先导航下，学期是课程内的二级筛选，不该跨课程混在一起。 */
    var scope = state.course === 'ALL'
      ? resources
      : resources.filter(function (it) { return String(it.courseId) === String(state.course); });
    var list = buildSemesters(scope);
    $('semesterCardGrid').innerHTML = list.map(function (s) {
      var on = state.semester === s.id;
      return '<div class="sem-card' + (on ? ' is-on' : '') + '" data-sem="' + s.id + '" tabindex="0" role="button">' +
        '<div class="sem-top"><span>' + esc(s.label) + '</span>' + (on ? '<i class="sem-dot"></i>' : '') + '</div>' +
        '<div class="sem-foot"><span>资料归档</span><b>' + s.count + ' 份</b></div>' +
      '</div>';
    }).join('');
    syncSemScroll();
  }

  /* 右上角那两个左右箭头，只在「真的滚得动」时才显示。
     学期少的时候（比如只有 2 个），横向时间轴根本不会溢出，
     留着箭头就是一对点了没反应的死按钮 —— 这正是之前被反馈的问题。
     卡片是横向排布的（.sem-grid 用 grid-auto-flow: column + overflow-x），
     所以 scrollWidth > clientWidth 才说明有内容可滚。 */
  function syncSemScroll() {
    var g = $('semesterCardGrid');
    if (!g) return;
    var scrollable = g.scrollWidth - g.clientWidth > 1;
    ['semScrollPrev', 'semScrollNext'].forEach(function (id) {
      var b = $(id);
      if (b) b.classList.toggle('is-hidden', !scrollable);
    });
  }

  /* 窗口尺寸一变，卡片宽度（响应式）和可滚动性都会变，要重算。
     注册在模块级而不是 bind() 里：bind() 每次挂载都会跑，
     监听器会越积越多；模块级只注册一次，页面卸载时 $() 返回 null 也会被上面的守卫挡住。 */
  window.addEventListener('resize', syncSemScroll);

  /* ---------------- 渲染：课程卡片（一级导航） ----------------
     课程是入口、资料是二级：默认只露课程卡片，点开某门课才显示它的资料。
     这样即使一屏资料都属于同一门课，也不会看不出归属、找不到是哪门课。 */
  function courseScopedResources(courseId) {
    return resources.filter(function (it) {
      return String(it.courseId) === String(courseId);
    });
  }

  function renderCourseCards() {
    var grid = $('courseCardGrid');
    if (!grid) return;
    if (!courses.length) {
      grid.innerHTML = '<div class="course-empty" style="grid-column:1/-1">' +
        '<span class="empty-icon"><iconify-icon icon="mdi:school-outline" width="26"></iconify-icon></span>' +
        '<h4>还没有课程</h4><p>先在「课程生成」里生成一门课，这里就会出现它。</p></div>';
      return;
    }
    grid.innerHTML = courses.map(function (c) {
      var on = String(state.course) === String(c.id);
      var its = courseScopedResources(c.id);
      var sem = its.length ? its[0].semesterName : '';
      return '<button class="course-card' + (on ? ' is-on' : '') + '" data-course="' + c.id + '" type="button">' +
        '<div class="course-card-top">' +
          '<span class="course-card-ico"><iconify-icon icon="mdi:book-education-outline" width="19"></iconify-icon></span>' +
          '<span class="course-card-code" title="' + esc(c.courseCode || '') + '">' + esc(c.courseCode || '未编号') + '</span>' +
        '</div>' +
        '<h4>' + esc(c.title) + '</h4>' +
        '<p>' + esc(c.description || '（暂无课程说明）') + '</p>' +
        '<div class="course-card-meta">' +
          '<span>' + its.length + ' 份资料</span>' +
          (sem ? '<span>' + esc(String(sem).split(' ')[0]) + '</span>' : '') +
          (c.status === 'active' ? '<span>已启用</span>' : '') +
        '</div>' +
      '</button>';
    }).join('');
  }

  /* 未选课程 → 只露课程卡片 + 提示；选中 → 露出资料区，并显示「全部课程」返回按钮。 */
  function syncCourseView() {
    var picked = state.course !== 'ALL';
    var area = $('resourceArea');
    var hint = $('courseEmptyHint');
    var back = $('backToCoursesBtn');
    if (area) area.classList.toggle('is-hidden', !picked);
    if (hint) hint.classList.toggle('is-hidden', picked);
    if (back) back.classList.toggle('is-hidden', !picked);
    var h = $('courseHint');
    if (h) {
      h.textContent = picked
        ? '正在查看该课程的归档资料，点右上角「全部课程」返回'
        : '选择一门课程，查看它归档的全部资料';
    }
  }

  function selectCourse(id) {
    state.course = (id === undefined || id === null) ? 'ALL' : String(id);
    // 切课程时把学期筛选复位：不同课程的学期集合不一定相同，
    // 留着上一门课的学期 id 会筛出空列表，看起来像「这门课没资料」。
    state.semester = 'ALL';
    var sel = $('courseSelect');
    if (sel) sel.value = state.course;
    renderCourseCards();
    syncCourseView();
    renderCategoryPills();
    renderSemesterCards();
    renderMainResources();
  }

  /* ---------------- 过滤 + 排序 ---------------- */

  /* 同一课程下所有条目共用同一个归档时间，所以「最新/最早」一定会打平，
     必须再按章节序号兜底排序，否则顺序会退化成 id 的字典序（归档包会排到最前面）。
     归档包 chapterNo = -1，固定压到最后。 */
  function chapterRank(it) {
    return it.chapterNo === -1 ? 9999 : (it.chapterNo || 0);
  }

  function getFilteredList() {
    var kw = state.search.trim().toLowerCase();
    return resources.filter(function (it) {
      if (state.semester !== 'ALL' && it.semester !== state.semester) return false;
      if (state.category !== 'ALL' && it.category !== state.category) return false;
      if (state.course !== 'ALL' && String(it.courseId) !== String(state.course)) return false;
      if (kw) {
        var hit = [it.title, it.courseName, it.fileName, it.composition, it.summary || '']
          .join(' ').toLowerCase().indexOf(kw) > -1;
        if (!hit) return false;
      }
      return true;
    }).sort(function (a, b) {
      if (state.sort === 'size') return (b.sizeBytes || 0) - (a.sizeBytes || 0);
      if (a.courseIndex !== b.courseIndex) return a.courseIndex - b.courseIndex;
      if (state.sort === 'chapter') {
        if (chapterRank(a) !== chapterRank(b)) return chapterRank(a) - chapterRank(b);
        return a.id.localeCompare(b.id);
      }
      var d = String(b.updateDate).localeCompare(String(a.updateDate));
      if (d !== 0) return state.sort === 'oldest' ? -d : d;
      if (chapterRank(a) !== chapterRank(b)) return chapterRank(a) - chapterRank(b);
      return a.id.localeCompare(b.id);
    });
  }

  /* ---------------- 渲染：主列表 ---------------- */

  function renderMainResources() {
    var list = getFilteredList();
    var grid = $('gridWrapper');
    var tbody = $('tableBody');

    $('resultCountBadge').textContent = list.length;

    if (!list.length) {
      grid.innerHTML = '';
      tbody.innerHTML = '';
      $('emptyView').classList.remove('is-hidden');
      updateDock();
      return;
    }
    $('emptyView').classList.add('is-hidden');

    grid.innerHTML = list.map(function (it) {
      var f = fmt(it);
      var sel = state.selectedIds.has(it.id);
      // 手动存入的文件：下载 = 原文件落盘，且可以删；生成内容仍是导出 JSON、没有删除接口
      var dlTitle = it.isUploadedFile ? '下载原始文件' : '导出该条目的真实数据 (JSON)';
      var delBtn = it.isUploadedFile
        ? '<button class="icon-btn" data-delete="' + it.id + '" title="删除该归档文件"><iconify-icon icon="mdi:delete-outline" width="14"></iconify-icon></button>'
        : '';
      var cloneBtn = it.isUploadedFile
        ? ''
        : '<button class="icon-btn" data-clone="' + it.id + '" title="继承到新学期"><iconify-icon icon="mdi:content-copy" width="14"></iconify-icon></button>';
      return '' +
      '<article class="card' + (sel ? ' is-sel' : '') + '" data-id="' + it.id + '">' +
        '<div class="card-body">' +
          '<div class="card-top">' +
            '<div class="card-tags">' +
              '<span class="badge ' + f.cls + '"><iconify-icon icon="' + f.icon + '" width="13"></iconify-icon>' + f.label + '</span>' +
              (it.courseStatus === 'active' ? '<span class="badge-cloned"><iconify-icon icon="mdi:check" width="11"></iconify-icon>课程已启用</span>' : '') +
              (it.isUploadedFile ? '<span class="badge-cloned"><iconify-icon icon="mdi:cloud-upload-outline" width="11"></iconify-icon>手动存入</span>' : '') +
            '</div>' +
            '<input type="checkbox" data-check="' + it.id + '"' + (sel ? ' checked' : '') + ' aria-label="选择该资料">' +
          '</div>' +
          '<h4 class="card-title" data-preview="' + it.id + '">' + esc(it.title) + '</h4>' +
          '<div class="card-course"><iconify-icon icon="mdi:book-open" width="13"></iconify-icon><span>' + esc(it.courseName) + '</span></div>' +
          '<div class="card-note">' + esc(it.summary || it.fileName) + '</div>' +
          '<div class="card-meta">' +
            '<span>' + esc(it.size) + '</span>' +
            '<span class="dl"><iconify-icon icon="mdi:layers-outline" width="12"></iconify-icon>' + esc(it.composition) + '</span>' +
            '<span>' + esc(String(it.semesterName).split(' ')[0]) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="card-foot">' +
          '<span>' + esc(it.updateDate) + '</span>' +
          '<div class="card-actions">' +
            cloneBtn +
            '<button class="icon-btn" data-preview="' + it.id + '" title="预览详情"><iconify-icon icon="mdi:arrow-expand" width="14"></iconify-icon></button>' +
            '<button class="icon-btn dl" data-download="' + it.id + '" title="' + dlTitle + '"><iconify-icon icon="mdi:download-outline" width="14"></iconify-icon></button>' +
            delBtn +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');

    tbody.innerHTML = list.map(function (it) {
      var f = fmt(it);
      var sel = state.selectedIds.has(it.id);
      var dlTitle = it.isUploadedFile ? '下载原始文件' : '导出该条目的真实数据 (JSON)';
      var delBtn = it.isUploadedFile
        ? '<button class="icon-btn" data-delete="' + it.id + '" title="删除该归档文件"><iconify-icon icon="mdi:delete-outline" width="14"></iconify-icon></button>'
        : '';
      var cloneBtn = it.isUploadedFile
        ? ''
        : '<button class="icon-btn" data-clone="' + it.id + '" title="继承至新学期"><iconify-icon icon="mdi:content-copy" width="14"></iconify-icon></button>';
      return '' +
      '<tr class="' + (sel ? 'is-sel' : '') + '" data-id="' + it.id + '">' +
        '<td><input type="checkbox" data-check="' + it.id + '"' + (sel ? ' checked' : '') + ' aria-label="选择该资料"></td>' +
        '<td><div class="cell-file">' +
          '<span class="cell-badge ' + f.cls + '">' + f.label + '</span>' +
          '<span class="txt">' +
            '<span class="cell-title" data-preview="' + it.id + '">' + esc(it.title) + '</span>' +
            '<span class="cell-name">' + esc(it.fileName) + '</span>' +
          '</span>' +
        '</div></td>' +
        '<td class="cell-course">' + esc(it.courseName) + '</td>' +
        '<td>' + esc(it.semesterName) + '</td>' +
        '<td class="cell-num">' + esc(it.size) + '</td>' +
        '<td class="cell-num">' + esc(it.updateDate) + '</td>' +
        '<td class="cell-num">' + esc(it.composition) + '</td>' +
        '<td class="ta-r">' +
          cloneBtn +
          '<button class="icon-btn" data-preview="' + it.id + '" title="预览"><iconify-icon icon="mdi:eye-outline" width="14"></iconify-icon></button>' +
          '<button class="icon-btn dl" data-download="' + it.id + '" title="' + dlTitle + '"><iconify-icon icon="mdi:download-outline" width="14"></iconify-icon></button>' +
          delBtn +
        '</td>' +
      '</tr>';
    }).join('');

    updateDock();
  }

  /* ---------------- 渲染：分类胶囊 / 课程下拉 / 指标 ---------------- */

  function renderCategoryPills() {
    var box = $('categoryTabs');
    if (!box) return;
    /* 胶囊上的数字要反映「点了之后会看到多少条」，所以先套上课程 / 学期 / 搜索，
       再按类别计数 —— 原来用的是全局 `resources.length`，切到某门课后
       数字还是两门课的合计（如「讲解课件 15」），点进去却只有 9 条，对不上。 */
    var kw = state.search.trim().toLowerCase();
    var base = resources.filter(function (it) {
      if (state.semester !== 'ALL' && it.semester !== state.semester) return false;
      if (state.course !== 'ALL' && String(it.courseId) !== String(state.course)) return false;
      if (kw) {
        var hit = [it.title, it.courseName, it.fileName, it.composition, it.summary || '']
          .join(' ').toLowerCase().indexOf(kw) > -1;
        if (!hit) return false;
      }
      return true;
    });
    box.innerHTML = CATEGORY_ORDER.map(function (c) {
      var n = c.id === 'ALL'
        ? base.length
        : base.filter(function (it) { return it.category === c.id; }).length;
      return '<button class="pill' + (state.category === c.id ? ' is-on' : '') + '" data-cat="' + c.id + '">' +
        esc(c.label) + (n ? ' <i class="pill-n">' + n + '</i>' : '') + '</button>';
    }).join('');
  }

  function renderCourseOptions() {
    var sel = $('courseSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="ALL">全部课程（' + courses.length + ' 门）</option>' +
      courses.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.title) + '</option>';
      }).join('');
    sel.value = state.course;
  }

  /* 上传弹窗的课程下拉走真实数据，不留写死的假选项。
     学期不再让用户挑：上传时间即归档时间，学期由它推导（与时间轴口径一致）。 */
  function renderUploadOptions() {
    var crs = $('modalCourse');
    if (crs) {
      crs.innerHTML = courses.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.title) + '</option>';
      }).join('') || '<option value="">暂无课程</option>';
    }
  }

  function renderStats() {
    var volume = 0, latest = '', chapterTotal = 0, sectionTotal = 0, sceneTotal = 0;
    resources.forEach(function (it) {
      // 「完整课程归档包」是其他条目的合集，算总体积时排除，否则重复计量
      if (!/-BUNDLE$/.test(it.id)) volume += it.sizeBytes || 0;
      if (String(it.updateDate) > latest) latest = String(it.updateDate);
      if (it.format === 'md') { chapterTotal++; sectionTotal += (it.sectionCount || 0); }
      if (it.category !== 'doc' && it.category !== 'md') sceneTotal++;
    });

    if ($('statCourses')) $('statCourses').textContent = courses.length + ' 门';
    if ($('statChapters')) {
      $('statChapters').textContent = '覆盖 ' + chapterTotal + ' 讲 / ' + sectionTotal + ' 节';
    }
    if ($('statTotalFiles')) $('statTotalFiles').textContent = resources.length + ' 份';
    if ($('statSections')) {
      $('statSections').textContent = sceneTotal + ' 个场景内容已归档';
    }
    if ($('statVolume')) $('statVolume').textContent = formatBytes(volume);
    if ($('statVolumeNote')) $('statVolumeNote').textContent = '按归档正文实测';
    if ($('statLatest')) $('statLatest').textContent = latest || '—';
    if ($('statLatestNote')) {
      $('statLatestNote').textContent = courses.length ? '来源：课程生成任务产出' : '暂无归档记录';
    }
  }

  /* ---------------- 统一渲染入口 ---------------- */

  function renderAll() {
    renderCategoryPills();
    renderCourseOptions();
    renderUploadOptions();
    renderCourseCards();
    syncCourseView();
    renderSemesterCards();
    renderStats();
    renderMainResources();
  }

  /* ---------------- 筛选交互 ---------------- */

  function selectSemester(id) {
    state.semester = id;
    renderSemesterCards();
    renderCategoryPills();
    renderMainResources();
  }

  function selectCategory(cat) {
    state.category = cat;
    renderCategoryPills();
    renderMainResources();
  }

  function resetAllFilters(silent) {
    state.semester = 'ALL';
    state.category = 'ALL';
    state.search = '';
    state.sort = 'newest';
    state.selectedIds.clear();
    // 课程是一级导航、不是「筛选条件」，重置时保留当前课程 ——
    // 否则在课程里点「恢复所有历史资料」会被踢回课程列表，反而看不到本课程的资料。

    $('globalSearch').value = '';
    $('sortBySelect').value = 'newest';
    $('selectAllRows').checked = false;

    renderCategoryPills();
    renderCourseCards();
    syncCourseView();
    renderSemesterCards();
    renderMainResources();
    if (!silent) toast('已重置筛选条件', 'info');
  }

  function switchView(mode) {
    state.view = mode;
    var isGrid = mode === 'grid';
    $('gridWrapper').classList.toggle('is-hidden', !isGrid);
    $('tableWrapper').classList.toggle('is-hidden', isGrid);
    $$('#viewSeg button').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.view === mode);
    });
  }

  /* ---------------- 选择与批量操作 ---------------- */

  function toggleSelect(id, checked) {
    if (checked) state.selectedIds.add(id); else state.selectedIds.delete(id);
    // 局部更新：只改受影响元素的类，避免整表重绘导致的闪烁
    $$('[data-id="' + id + '"]').forEach(function (el) {
      el.classList.toggle('is-sel', checked);
    });
    updateDock();
  }

  function updateDock() {
    var n = state.selectedIds.size;
    $('dockSelectedCount').textContent = n;
    $('batchDock').classList.toggle('is-hidden', n === 0);
  }

  function clearSelection() {
    state.selectedIds.clear();
    $('selectAllRows').checked = false;
    renderMainResources();
  }

  /* ---------------- 预览弹窗 ---------------- */

  function openPreview(id) {
    var it = resources.filter(function (r) { return r.id === id; })[0];
    if (!it) return;
    activePreviewItem = it;

    var f = fmt(it);
    var badge = $('previewBadge');
    badge.className = 'badge-lg ' + f.cls;
    badge.textContent = f.label;

    $('previewTitle').textContent = it.title;
    // 副标题用「课程代码 · 学期」：一眼看出这是哪门课、哪个学期的资料。
    // 原来放的是「课程名 · 文件名」—— 课程名下方 meta 里已有，文件名意义不大。
    $('previewSub').textContent =
      (it.courseCode ? it.courseCode + ' · ' : '') + (it.semesterName || '');
    $('previewCourse').textContent = it.courseName;
    $('previewSemester').textContent = it.semesterName;
    $('previewSize').textContent = it.sizeBytes ? it.size : it.composition;
    $('previewComposition').textContent = it.composition;
    $('previewNotes').textContent = it.summary || it.fileName;

    // 按资料类型渲染对应的交互预览器（PPT / A4 大纲 / 试卷 / 源码 / 视频…）
    // 兜住渲染异常：预览器一旦抛错，`renderPreviewStage` 会把异常冒到调用方，
    // 结果就是**弹窗根本打不开、连错误都看不到**（用户只能反馈「打不开」）。
    // 这里把异常摊到弹窗里 —— 至少保证「能打开、能看到为什么」。
    try {
      renderPreviewStage(it);
    } catch (e) {
      console.error('[course-resources] 预览器渲染失败:', e);
      var st = $('previewStage');
      if (st) {
        st.innerHTML =
          '<div class="pv-empty" style="text-align:left;color:#b91c1c">' +
            '<b>预览器渲染失败</b><br>' + esc(e && e.message ? e.message : String(e)) +
            '<pre style="margin:8px 0 0;white-space:pre-wrap;font-size:11px;color:#94a3b8">' +
              esc(e && e.stack ? String(e.stack) : '(无堆栈)') +
            '</pre>' +
          '</div>';
      }
      ['previewToolbar', 'previewFallback'].forEach(function (id) {
        var el = $(id); if (el) el.classList.add('is-hidden');
      });
    }

    $('previewModal').classList.remove('is-hidden');
  }

  function closePreview() {
    $('previewModal').classList.add('is-hidden');
    activePreviewItem = null;
  }

  /* ================= 预览工作台：按资料类型分派专属预览器 =================
     把「点开资料」从一句文字说明，升级为可交互的专业预览器：
       · slides      → 讲义 PPT（16:9 画布 / 上下一页 / 缩略图 / 板书 + 口播提纲）
       · handout     → OBE 教学大纲 A4 Word（左侧大纲导航 / 缩放 70–150% / 双视图 /
                       16 周进度 / 考核权重 / 电子签名）
       · quiz        → 试卷与答案（学生卷面 ⇄ 参考答案与评分细则 + 题型分析）
       · code        → 实验工程源码（文件树 / 行号深色编辑器 / 模拟控制台）
       · video       → 课堂实录视频（播放器 / 章节打点 / 同步字幕）
       · interactive → 直接嵌入可运行 HTML
     内容全部来自条目自带的 raw（课程生成器写入）；缺字段时给合理兜底，不空白。 */

  var pvState = { slide: 0, docView: 'doc', zoom: 100, file: 0, paper: 'paper', chapter: 0 };

  function pvKind(it) {
    if (it.format === 'slides') return 'ppt';
    if (it.format === 'handout') return 'doc';
    if (it.format === 'quiz') return 'paper';
    if (it.format === 'code') return 'code';
    if (it.format === 'video') return 'video';
    if (it.format === 'interactive') return 'iframe';
    if (it.format === 'md') return 'md';            // 小节讲义 → Markdown 阅读器
    if (it.format === 'html') return 'htmldoc';     // 课程总览 → HTML 文档
    if (it.format === 'json') return 'json';        // 学习路径 / 知识图谱 / 归档包 → 结构化
    return 'generic';
  }

  function pvList(a, f) { return (a && a.length) ? a : (f || []); }

  function pvToolbar(html) {
    var tb = $('previewToolbar');
    tb.innerHTML = html;
    tb.classList.remove('is-hidden');
    return tb;
  }

  /* 轻量代码着色：一次扫描，按 token 分类，避免「先包字符串再匹配关键字」的错染。 */
  function hlCode(src) {
    var kw = /^(def|class|return|if|else|elif|for|while|import|from|as|with|try|except|finally|raise|yield|lambda|None|True|False|and|or|not|in|is|self|async|await|const|let|var|function|new|this|export|default|int|float|str|bool|dict|list)$/;
    var re = /#[^\n]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b/g;
    var out = '', last = 0, m;
    while ((m = re.exec(src)) !== null) {
      out += esc(src.slice(last, m.index));
      var t = m[0], cls = null;
      if (t.charAt(0) === '#') cls = 'c';
      else if (t.charAt(0) === '"' || t.charAt(0) === "'") cls = 's';
      else if (/^\d/.test(t)) cls = 'n';
      else if (kw.test(t)) cls = 'k';
      out += cls ? '<span class="' + cls + '">' + esc(t) + '</span>' : esc(t);
      last = m.index + t.length;
    }
    return out + esc(src.slice(last));
  }

  function renderPreviewStage(it) {
    var stage = $('previewStage');
    var tb = $('previewToolbar');
    var fb = $('previewFallback');
    stage.innerHTML = '';
    tb.innerHTML = '';
    tb.classList.add('is-hidden');
    fb.classList.add('is-hidden');
    var em = $('previewExportMenu');
    if (em) em.classList.add('is-hidden');
    var raw = it.raw || {};
    var kind = pvKind(it);
    if (kind === 'ppt') return pvPpt(it, raw);
    if (kind === 'doc') return pvDoc(it, raw);
    if (kind === 'paper') return pvPaper(it, raw);
    if (kind === 'code') return pvCode(it, raw);
    if (kind === 'video') return pvVideo(it, raw);
    if (kind === 'iframe') return pvIframe(it, raw);
    if (kind === 'md') return pvMd(it, raw);
    if (kind === 'htmldoc') return pvHtmlDoc(it, raw);
    if (kind === 'json') return pvJson(it, raw);
    // 兜底：没有专属查看器 → 显示「装载了什么」的文字说明
    var v = VIEWER[it.format] || VIEWER.other;
    $('previewViewerIcon').setAttribute('icon', v.icon);
    $('previewViewerTitle').textContent =
      (v.label && it.title.indexOf(v.label) < 0) ? '《' + it.title + '》' + v.label : v.title;
    $('previewViewerDesc').textContent = v.desc;
    fb.classList.remove('is-hidden');
  }

  /* ---------- ① 讲义 PPT ---------- */
  function pvPpt(it, raw) {
    var slides = pvList(raw.slides, [{ title: it.title, bullets: ['（本条目暂无逐页内容）'] }]);
    pvState.slide = 0;
    pvToolbar('<span class="pv-label"><iconify-icon icon="mdi:presentation" width="14"></iconify-icon> 讲义 PPT</span>' +
      '<span class="pv-spacer"></span><span class="pv-label" id="pvPos"></span>');
    $('previewStage').innerHTML =
      '<div class="pv-ppt">' +
        '<div class="pv-slide-col">' +
          '<div class="pv-slide" id="pvSlide"></div>' +
          '<div class="pv-slide-nav">' +
            '<button class="btn btn-ghost" id="pvPrev"><iconify-icon icon="mdi:chevron-left" width="15"></iconify-icon>上一页</button>' +
            '<button class="btn btn-dark" id="pvNext">下一页<iconify-icon icon="mdi:chevron-right" width="15"></iconify-icon></button>' +
            '<span class="pv-count" id="pvCount"></span>' +
          '</div>' +
          '<div class="pv-thumbs" id="pvThumbs"></div>' +
        '</div>' +
        '<div class="pv-side" id="pvSide"></div>' +
      '</div>';

    function draw() {
      var s = slides[pvState.slide] || {};
      /* 两种数据形状都要吃：
         · 课程生成器产出 `{title, content}`（content 是 Markdown）
         · 演示种子产出 `{title, bullets[]}`（要点数组）
         只认 bullets 的话，生成器产出的每一页都会显示「本页要点待补充」。 */
      var bl = (s.bullets && s.bullets.length) ? s.bullets : null;
      var body;
      if (bl) {
        body = '<ul>' + bl.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>';
      } else if (s.content) {
        // 正文自带一级标题时去掉，避免和上面的 h3 重复
        body = '<div class="pv-slide-md">' +
          mdToHtml(String(s.content).replace(/^\s*#{1,6}\s+.*\n+/, '')) + '</div>';
      } else {
        body = '<ul><li>（本页要点待补充）</li></ul>';
      }
      $('pvSlide').innerHTML =
        '<h3>' + esc(s.title || it.title) + '</h3>' + body +
        (s.formula ? '<div class="pv-formula">' + esc(s.formula) + '</div>' : '') +
        '<span class="pv-slide-no">' + (pvState.slide + 1) + ' / ' + slides.length + '</span>';
      var pos = '第 ' + (pvState.slide + 1) + ' / ' + slides.length + ' 页';
      $('pvCount').textContent = pos;
      $('pvPos').textContent = pos;
      $('pvThumbs').innerHTML = slides.map(function (x, i) {
        return '<div class="pv-thumb' + (i === pvState.slide ? ' is-on' : '') + '" data-i="' + i + '">' +
          '<b>' + (i + 1) + '. ' + esc(String(x.title || '').slice(0, 13)) + '</b>' +
          esc(String((x.bullets && x.bullets[0]) || x.content || '').replace(/[#*>\n]/g, ' ').slice(0, 28)) + '</div>';
      }).join('');
      $('pvSide').innerHTML =
        '<div class="pv-panel"><h5><iconify-icon icon="mdi:clipboard-text-outline" width="13"></iconify-icon>板书推导</h5>' +
          '<ul>' + pvList(s.boardNotes || raw.boardNotes, ['（本页无板书）'])
            .map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' +
          (s.formula ? '<code class="pv-mono">' + esc(s.formula) + '</code>' : '') +
        '</div>' +
        '<div class="pv-panel"><h5><iconify-icon icon="mdi:account-voice" width="13"></iconify-icon>教师口播提纲</h5>' +
          '<ul>' + pvList(s.teacherNotes, [
            '先用一句话点出本页要解决的问题。',
            '结合板书逐步推导，强调关键词与常见误区。',
            '留 1 分钟提问互动，确认学生跟上节奏。'
          ]).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' +
        '</div>';
    }
    $('pvPrev').addEventListener('click', function () {
      pvState.slide = (pvState.slide - 1 + slides.length) % slides.length; draw();
    });
    $('pvNext').addEventListener('click', function () {
      pvState.slide = (pvState.slide + 1) % slides.length; draw();
    });
    $('pvThumbs').addEventListener('click', function (e) {
      var t = e.target.closest('[data-i]');
      if (t) { pvState.slide = +t.dataset.i; draw(); }
    });
    draw();
  }

  /* ---------- ② OBE 教学大纲（A4 Word） ---------- */
  function pvDoc(it, raw) {
    var info = raw.courseInfo || {};
    var name = info.name || it.courseName || '课程';
    var code = info.code || it.courseCode || '—';
    var credit = info.credit || '3.0';
    var hours = info.hours || '48';
    var teacher = info.teacher || '课程组';
    var schedule = pvList(raw.schedule, []);
    var assess = pvList(raw.assessment, []);
    var matrix = pvList(raw.obeMatrix, []);
    var memo = pvList(raw.memo, []);
    pvState.docView = 'doc';
    pvState.zoom = 100;

    pvToolbar('<span class="pv-label"><iconify-icon icon="mdi:file-document-outline" width="14"></iconify-icon> 教学大纲（A4 文档）</span>' +
      '<div class="pv-seg" id="pvDocSeg">' +
        '<button data-v="doc" class="is-on"><iconify-icon icon="mdi:file-document-outline" width="13"></iconify-icon>正文</button>' +
        '<button data-v="memo"><iconify-icon icon="mdi:note-text-outline" width="13"></iconify-icon>授课备忘录</button>' +
      '</div>' +
      '<span class="pv-spacer"></span>' +
      '<span class="pv-zoom"><button id="pvZoomOut" title="缩小">−</button>' +
        '<b id="pvZoomVal">100%</b><button id="pvZoomIn" title="放大">＋</button></span>');

    var secDefs = [
      { id: 'pv-s1', t: '一、课程基本信息' },
      { id: 'pv-s2', t: '二、课程目标与毕业要求' },
      { id: 'pv-s3', t: '三、教学内容与 16 周进度' },
      { id: 'pv-s4', t: '四、考核方式与成绩构成' }
    ];
    $('previewStage').innerHTML =
      '<div class="pv-doc">' +
        '<aside class="pv-toc"><h5><iconify-icon icon="mdi:format-list-bulleted" width="13"></iconify-icon> 大纲导航</h5>' +
          secDefs.map(function (s, i) {
            return '<a data-t="' + s.id + '"' + (i === 0 ? ' class="is-on"' : '') + '>' + esc(s.t) + '</a>';
          }).join('') +
        '</aside>' +
        '<div class="pv-doc-scroll" id="pvDocScroll"><div class="pv-a4" id="pvA4">' + pvA4Html(it, name, code, credit, hours, teacher, schedule, assess, matrix) + '</div>' +
          (memo.length ? '<div class="pv-memo" id="pvMemo" style="margin:12px auto 18px;width:720px"><h5><iconify-icon icon="mdi:note-text-outline" width="13"></iconify-icon> 授课备忘录（教师备忘，非正式大纲）</h5><ul>' +
            memo.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul></div>' : '') +
        '</div>' +
      '</div>';

    function setZoom(z) {
      pvState.zoom = Math.max(70, Math.min(150, z));
      $('pvA4').style.zoom = (pvState.zoom / 100);
      $('pvZoomVal').textContent = pvState.zoom + '%';
    }
    $('pvZoomIn').addEventListener('click', function () { setZoom(pvState.zoom + 10); });
    $('pvZoomOut').addEventListener('click', function () { setZoom(pvState.zoom - 10); });
    $('pvDocSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]'); if (!b) return;
      pvState.docView = b.dataset.v;
      $$('#pvDocSeg button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      var memoEl = $('pvMemo');
      var a4 = $('pvA4');
      if (pvState.docView === 'memo') {
        if (memoEl) { memoEl.style.display = ''; a4.style.display = 'none'; memoEl.scrollIntoView({ block: 'start' }); }
      } else {
        if (memoEl) memoEl.style.display = 'none';
        a4.style.display = '';
        $('pvDocScroll').scrollTop = 0;
      }
    });
    var toc = $('previewStage').querySelector('.pv-toc');
    toc.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-t]'); if (!a) return;
      $$('.pv-toc a').forEach(function (x) { x.classList.toggle('is-on', x === a); });
      var target = $(a.dataset.t);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    setZoom(100);
  }

  function pvA4Html(it, name, code, credit, hours, teacher, schedule, assess, matrix) {
    var total = assess.reduce(function (a, x) { return a + (Number(x.weight) || 0); }, 0) || 100;
    return '' +
      '<div class="pv-a4-head">' +
        '<div class="pv-red">普 通 高 等 学 校 本 科 课 程 教 学 大 纲</div>' +
        '<h2>' + esc(name) + '</h2>' +
        '<div class="pv-sub">' + esc(code) + '　|　' + esc(it.semesterName || '') + '　|　OBE 成果导向</div>' +
      '</div>' +
      '<h4 id="pv-s1">一、课程基本信息</h4>' +
      '<table><tbody>' +
        '<tr><th style="width:22%">课程名称</th><td>' + esc(name) + '</td><th style="width:22%">课程代码</th><td>' + esc(code) + '</td></tr>' +
        '<tr><th>学分 / 学时</th><td>' + esc(String(credit)) + ' 学分 / ' + esc(String(hours)) + ' 学时</td><th>开课学期</th><td>' + esc(it.semesterName || '—') + '</td></tr>' +
        '<tr><th>适用专业</th><td>计算机科学与技术 / 软件工程</td><th>授课教师</th><td>' + esc(teacher) + '</td></tr>' +
        '<tr><th>先修课程</th><td colspan="3">数据结构、操作系统、计算机网络</td></tr>' +
      '</tbody></table>' +
      '<h4 id="pv-s2">二、课程目标与毕业要求指标点</h4>' +
      '<p>本课程面向工程教育专业认证（OBE）要求，支撑以下毕业要求指标点：</p>' +
      '<table><thead><tr><th>课程目标</th><th>毕业要求指标点</th><th>支撑强度</th></tr></thead><tbody>' +
        (matrix.length ? matrix.map(function (m) {
          return '<tr><td>' + esc(m.goal || '') + '</td><td>' + esc(m.indicator || '') + '</td><td class="pv-center">' + esc(m.level || 'H') + '</td></tr>';
        }).join('') : '<tr><td colspan="3" class="pv-center">（指标点矩阵待补充）</td></tr>') +
      '</tbody></table>' +
      '<h4 id="pv-s3">三、教学内容与 16 周进度</h4>' +
      '<table><thead><tr><th style="width:12%">周次</th><th>教学内容</th><th style="width:22%">教学方式</th></tr></thead><tbody>' +
        (schedule.length ? schedule.map(function (s) {
          return '<tr><td class="pv-center">第 ' + esc(String(s.week)) + ' 周</td><td>' + esc(s.topic) + '</td><td>' + esc(s.mode || '讲授 + 研讨') + '</td></tr>';
        }).join('') : '<tr><td colspan="3" class="pv-center">（进度表待补充）</td></tr>') +
      '</tbody></table>' +
      '<h4 id="pv-s4">四、考核方式与成绩构成</h4>' +
      (assess.length ? assess.map(function (a) {
        var w = Number(a.weight) || 0;
        return '<div class="pv-bar"><span style="width:132px">' + esc(a.name) + '</span>' +
          '<span class="pv-bar-track"><span class="pv-bar-fill" style="width:' + Math.round(w / total * 100) + '%"></span></span>' +
          '<b>' + w + '%</b></div>';
      }).join('') : '<p>（成绩构成待补充）</p>') +
      '<div class="pv-sign"><span>制定人：' + esc(teacher) + '</span><span>审核人：系教学指导委员会</span>' +
        '<span>制定日期：' + esc(String(it.updateDate || '')) + '　<em>' + esc(teacher) + '</em></span></div>';
  }

  /* ---------- ③ 试卷与答案 ---------- */
  function pvPaper(it, raw) {
    var qs = pvList(raw.questions, []);
    pvState.paper = 'paper';
    pvToolbar('<span class="pv-label"><iconify-icon icon="mdi:file-check-outline" width="14"></iconify-icon> 试卷与答案</span>' +
      '<div class="pv-seg" id="pvPaperSeg">' +
        '<button data-v="paper" class="is-on"><iconify-icon icon="mdi:file-document-outline" width="13"></iconify-icon>学生卷面</button>' +
        '<button data-v="answer"><iconify-icon icon="mdi:check-decagram-outline" width="13"></iconify-icon>参考答案与评分细则</button>' +
      '</div>' +
      '<span class="pv-spacer"></span><span class="pv-label">' + qs.length + ' 题</span>');
    var total = qs.reduce(function (a, q) { return a + (Number(q.points) || 0); }, 0);
    var stats = raw.stats || {};
    $('previewStage').innerHTML =
      '<div class="pv-paper">' +
        '<div class="pv-paper-head"><h3>' + esc(it.courseName || '') + ' · 期末试卷</h3>' +
          '<p>' + esc(it.semesterName || '') + '　|　闭卷　|　满分 ' + (total || 100) + ' 分　|　考试时长 120 分钟</p></div>' +
        '<div class="pv-stats">' +
          '<div class="pv-stat"><p>及格率</p><b>' + esc(String(stats.pass || '86')) + '%</b></div>' +
          '<div class="pv-stat"><p>平均分</p><b>' + esc(String(stats.avg || '78.4')) + '</b></div>' +
          '<div class="pv-stat"><p>最高分</p><b>' + esc(String(stats.max || '97')) + '</b></div>' +
        '</div>' +
        '<div id="pvQList"></div>' +
      '</div>';

    function drawQ() {
      var showAns = pvState.paper === 'answer';
      $('pvQList').innerHTML = qs.length ? qs.map(function (q, i) {
        var opts = pvList(q.options, []);
        var ansIdx = (typeof q.answer === 'number') ? q.answer : -1;
        return '<div class="pv-q" style="margin-bottom:10px">' +
          '<div class="pv-q-h"><i>' + (i + 1) + '</i><span>' + esc(q.question || '') + '</span>' +
            (q.points ? '<span style="margin-left:auto;color:#94a3b8;font-weight:400;font-size:12px">（' + esc(String(q.points)) + ' 分）</span>' : '') + '</div>' +
          (opts.length ? '<ul class="pv-opts">' + opts.map(function (o, oi) {
            return '<li' + (showAns && oi === ansIdx ? ' class="is-ans"' : '') + '>' +
              String.fromCharCode(65 + oi) + '. ' + esc(o) + '</li>';
          }).join('') + '</ul>' : '') +
          (showAns ? '<div class="pv-exp"><b>答案：</b>' + esc(q.explanation || '见评分细则。') + '</div>' +
            (q.rubric && q.rubric.length ? '<div class="pv-rubric">评分细则：' +
              q.rubric.map(function (r) { return '<span>' + esc(r) + '</span>'; }).join('') + '</div>' : '') : '') +
        '</div>';
      }).join('') : '<div class="pv-empty">（本试卷暂无题目数据）</div>';
    }
    $('pvPaperSeg').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]'); if (!b) return;
      pvState.paper = b.dataset.v;
      $$('#pvPaperSeg button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      drawQ();
    });
    drawQ();
  }

  /* ---------- ④ 实验工程源码 ---------- */
  function pvCode(it, raw) {
    /* ⚠️ 这里不能用 pvList(raw.files, null)：它在缺失时返回 `[]`（**真值**），
       于是 files[0] 是 undefined，draw() 里读 f.code 直接抛错 ——
       而 openPreview 没有兜底，表现就是「点编程练习，弹窗根本打不开」。
       课程生成器产出的 code 场景只有 initialCode、没有 files，正好踩中。
       所以显式判「有没有内容」，再退回单文件。 */
    var extMap = { python: 'py', javascript: 'js', typescript: 'ts', java: 'java', c: 'c', cpp: 'cpp', go: 'go', rust: 'rs' };
    var ext = extMap[String(raw.language || 'python').toLowerCase()] || 'py';
    var files = (raw.files && raw.files.length)
      ? raw.files
      : [{ name: (raw.fileName || ('solution.' + ext)), code: raw.initialCode || '# （暂无源码）' }];
    var logs = (raw.console && raw.console.length) ? raw.console : null;
    if (!logs) {
      logs = ['$ python ' + files[0].name];
      if (raw.expectedOutput) {
        String(raw.expectedOutput).split('\n').forEach(function (l) { logs.push(l); });
      } else {
        logs.push('（本练习未附带运行输出）');
      }
    }
    pvState.file = 0;
    pvToolbar('<span class="pv-label"><iconify-icon icon="mdi:code-braces" width="14"></iconify-icon> 实验工程源码</span>' +
      '<span class="pv-spacer"></span><span class="pv-label">' + files.length + ' 个文件</span>');
    $('previewStage').innerHTML =
      '<div class="pv-code">' +
        '<div class="pv-tree" id="pvTree"></div>' +
        '<div class="pv-editor">' +
          '<div class="pv-editor-bar"><i class="r"></i><i class="y"></i><i class="g"></i><span id="pvFileName"></span></div>' +
          '<div class="pv-code-body"><div class="pv-lines" id="pvLines"></div><div class="pv-code-src" id="pvSrc"></div></div>' +
        '</div>' +
        '<div class="pv-console" id="pvConsole"></div>' +
      '</div>';

    function draw() {
      var f = files[pvState.file] || files[0];
      var code = f.code || '';
      var n = code.split('\n').length;
      var nums = []; for (var i = 1; i <= n; i++) nums.push(i);
      $('pvLines').innerHTML = nums.join('<br>');
      $('pvSrc').innerHTML = hlCode(code);
      $('pvFileName').textContent = f.name;
      $('pvTree').innerHTML = files.map(function (x, i) {
        return '<button class="' + (i === pvState.file ? 'is-on' : '') + '" data-i="' + i + '">' +
          '<iconify-icon icon="mdi:file-code-outline" width="13"></iconify-icon>' + esc(x.name) + '</button>';
      }).join('');
      $('pvConsole').innerHTML = logs.map(function (l) {
        var cls = /pass|ok|✓|success/i.test(l) ? 'ok' : (/warn/i.test(l) ? 'warn' : (/^\$/.test(l) ? 'dim' : ''));
        return '<div' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(l) + '</div>';
      }).join('');
    }
    $('pvTree').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]'); if (!b) return;
      pvState.file = +b.dataset.i; draw();
    });
    draw();
  }

  /* ---------- ⑤ 课堂实录视频 ---------- */
  function pvVideo(it, raw) {
    var chapters = pvList(raw.chapters, [
      { t: '00:00', title: '课堂导入与本节目标' },
      { t: '06:20', title: '核心概念讲解' },
      { t: '18:45', title: '推导与板书演示' },
      { t: '31:10', title: '课堂练习与答疑' }
    ]);
    var transcript = pvList(raw.transcript, []);
    var duration = raw.duration || '45:00';
    pvState.chapter = 0;
    pvToolbar('<span class="pv-label"><iconify-icon icon="mdi:video-outline" width="14"></iconify-icon> 课堂实录视频</span>' +
      '<span class="pv-spacer"></span><span class="pv-label">时长 ' + esc(duration) + '</span>');
    $('previewStage').innerHTML =
      '<div class="pv-video">' +
        '<div class="pv-player">' +
          '<button class="pv-play" id="pvPlay"><iconify-icon icon="mdi:play" width="30"></iconify-icon></button>' +
          '<div class="pv-vbar"><div class="pv-vtrack"><div class="pv-vfill"></div></div>' +
            '<div class="pv-vtime"><span id="pvNow">00:00</span><span>' + esc(duration) + '</span></div></div>' +
        '</div>' +
        '<div class="pv-side">' +
          '<div class="pv-panel"><h5><iconify-icon icon="mdi:bookmark-outline" width="13"></iconify-icon>章节打点</h5>' +
            '<div class="pv-chapters" id="pvChapters">' + chapters.map(function (c, i) {
              return '<button class="' + (i === 0 ? 'is-on' : '') + '" data-i="' + i + '"><i>' + esc(c.t) + '</i>' + esc(c.title) + '</button>';
            }).join('') + '</div></div>' +
          (transcript.length ? '<div class="pv-panel"><h5><iconify-icon icon="mdi:subtitles-outline" width="13"></iconify-icon>同步字幕</h5>' +
            '<div class="pv-transcript" id="pvTranscript">' + transcript.map(function (x, i) {
              return '<div class="pv-ts' + (i === 0 ? ' is-on' : '') + '" data-i="' + i + '"><b>' + esc(x.t) + '</b><span>' + esc(x.text) + '</span></div>';
            }).join('') + '</div></div>' : '') +
        '</div>' +
      '</div>';

    $('pvPlay').addEventListener('click', function () {
      toast('课堂实录为归档预览，播放需接入课程视频源', 'info');
    });
    $('pvChapters').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]'); if (!b) return;
      pvState.chapter = +b.dataset.i;
      $$('#pvChapters button').forEach(function (x) { x.classList.toggle('is-on', x === b); });
      $('pvNow').textContent = chapters[pvState.chapter].t;
      var fill = $('previewStage').querySelector('.pv-vfill');
      if (fill) fill.style.width = Math.round((pvState.chapter + 1) / chapters.length * 100) + '%';
      var ts = $('pvTranscript');
      if (ts) $$('#pvTranscript .pv-ts').forEach(function (x, i) { x.classList.toggle('is-on', i === pvState.chapter); });
    });
  }

  /* ---------- 交互演示 ---------- */
  function pvIframe(it, raw) {
    var html = raw.html || '';
    $('previewStage').innerHTML = html
      ? '<iframe class="pv-iframe" id="pvFrame" sandbox="allow-scripts"></iframe>'
      : '<div class="pv-empty">（本交互演示暂无 HTML 内容）</div>';
    if (html) $('pvFrame').srcdoc = html;
  }

  /* ---------- ⑥ 小节讲义：Markdown 阅读器 ----------
     左边小节导航，右边渲染 Markdown 正文。
     正文优先取 section.md（种子/生成器写入）；没有就退回该小节的结构化信息，
     不编造内容。 */
  function inlineMd(s) {
    return esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  }
  // 极简 Markdown → HTML：标题 / 列表 / 引用 / 加粗 / 行内代码 / 段落。
  // 离线项目禁 CDN，不引第三方库，够渲染讲义原稿即可。
  function mdToHtml(src) {
    var out = [], list = null, quote = null, code = null;
    function flush() {
      if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; }
      if (quote) { out.push('<blockquote>' + quote.join('') + '</blockquote>'); quote = null; }
    }
    String(src || '').split('\n').forEach(function (rawLine) {
      var l = rawLine.replace(/\s+$/, ''), m;
      // ``` 围栏代码块（正文里常见，必须先于其它规则判断）
      if (/^\s*```/.test(l)) {
        if (code === null) { flush(); code = []; }
        else { out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); code = null; }
        return;
      }
      if (code !== null) { code.push(rawLine); return; }
      if ((m = l.match(/^(#{1,6})\s+(.*)$/))) {
        flush();
        var lv = Math.min(m[1].length + 1, 6);
        out.push('<h' + lv + '>' + inlineMd(m[2]) + '</h' + lv + '>');
      } else if ((m = l.match(/^\s*[-*]\s+(.*)$/))) {
        if (quote) { out.push('<blockquote>' + quote.join('') + '</blockquote>'); quote = null; }
        (list = list || []).push('<li>' + inlineMd(m[1]) + '</li>');
      } else if ((m = l.match(/^>\s?(.*)$/))) {
        if (list) { out.push('<ul>' + list.join('') + '</ul>'); list = null; }
        (quote = quote || []).push(inlineMd(m[1]));
      } else if (!l.trim()) {
        flush();
      } else {
        flush();
        out.push('<p>' + inlineMd(l) + '</p>');
      }
    });
    if (code !== null) out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
    flush();
    return out.join('');
  }

  function pvMd(it, raw) {
    var secs = (raw.sections && raw.sections.length) ? raw.sections
      : (Array.isArray(it.payload) ? it.payload : []);
    if (!secs.length && it.summary) {
      secs = String(it.summary).split(/\s*\/\s*/).map(function (t, i) {
        return { path: 'sec-' + (i + 1), title: t };
      });
    }
    pvState.mdSec = 0;
    pvToolbar('<span class="pv-label"><iconify-icon icon="mdi:file-document-outline" width="14"></iconify-icon> Markdown 讲义</span>' +
      '<span class="pv-spacer"></span><span class="pv-label">' + secs.length + ' 个小节</span>');
    $('previewStage').innerHTML =
      '<div class="pv-md">' +
        '<aside class="pv-md-toc"><h5><iconify-icon icon="mdi:format-list-bulleted" width="13"></iconify-icon> 小节导航</h5>' +
          (secs.length ? secs.map(function (s, i) {
            return '<a data-i="' + i + '"' + (i === 0 ? ' class="is-on"' : '') + '>' + esc(s.title || s.path || '') + '</a>';
          }).join('') : '<a class="is-on">（无小节）</a>') +
        '</aside>' +
        '<div class="pv-md-scroll"><article class="pv-md-doc" id="pvMdDoc"></article></div>' +
      '</div>';

    function draw() {
      var s = secs[pvState.mdSec] || {};
      var md = s.md || s.content || '';
      $('pvMdDoc').innerHTML =
        '<h1>' + esc(s.title || it.title) + '</h1>' +
        '<p class="pv-md-meta">' + esc(it.courseCode || '') + '　' + esc(it.semesterName || '') +
          (s.path ? '　·　' + esc(s.path) : '') + '</p>' +
        (md
          ? mdToHtml(md)
          : '<p class="pv-md-empty">该小节只有结构化信息，正文由课程生成器写入 course_content、归档接口未暴露。下面是本小节可用的全部字段：</p>' +
            '<pre class="pv-md-json">' + esc(JSON.stringify(s, null, 2)) + '</pre>');
    }
    var toc = $('previewStage').querySelector('.pv-md-toc');
    toc.addEventListener('click', function (e) {
      var a = e.target.closest('a[data-i]'); if (!a) return;
      pvState.mdSec = +a.dataset.i;
      $$('.pv-md-toc a').forEach(function (x) { x.classList.toggle('is-on', x === a); });
      draw();
    });
    draw();
  }

  /* ---------- ⑦ 课程总览：HTML 文档 ---------- */
  function pvHtmlDoc(it, raw) {
    var html = raw.html || (it.payload && it.payload.html) || '';
    pvToolbar('<span class="pv-label"><iconify-icon icon="mdi:book-open-page-variant" width="14"></iconify-icon> 课程总览（HTML）</span>' +
      '<span class="pv-spacer"></span><span class="pv-label">' + (html ? Math.round(html.length / 1024 * 10) / 10 + ' KB' : '无内容') + '</span>');
    $('previewStage').innerHTML = html
      ? '<iframe class="pv-iframe" id="pvFrame" sandbox="allow-scripts"></iframe>'
      : '<div class="pv-empty">（本条目没有可渲染的 HTML 内容）</div>';
    if (html) $('pvFrame').srcdoc = html;
  }

  /* ---------- ⑧ 结构化归档：学习路径 / 知识图谱 / 完整归档包 ---------- */
  function pvJson(it, raw) {
    var data = (it.payload !== undefined) ? it.payload : raw;
    var arr = (Array.isArray(data) ? data : [data]).filter(function (g) { return g && typeof g === 'object'; });
    if (arr.some(function (g) { return g.nodes || g.edges; })) return pvGraph(it, arr);
    return pvTree(it, data);
  }

  function pvGraph(it, graphs) {
    var n = 0, e = 0;
    graphs.forEach(function (g) { n += (g.nodes || []).length; e += (g.edges || []).length; });
    pvToolbar('<span class="pv-label"><iconify-icon icon="mdi:graph-outline" width="14"></iconify-icon> 图结构</span>' +
      '<span class="pv-spacer"></span><span class="pv-label">' + graphs.length + ' 张图 · ' + n + ' 个节点 · ' + e + ' 条关联</span>');
    $('previewStage').innerHTML = '<div class="pv-graph">' + graphs.map(function (g, gi) {
      var nodes = g.nodes || [], edges = g.edges || [];
      return '<section class="pv-graph-card">' +
        '<h4>' + esc(g.sectionTitle || g.title || ('图谱 ' + (gi + 1))) + '</h4>' +
        (nodes.length
          ? '<div class="pv-graph-nodes">' + nodes.map(function (x) {
              return '<span class="pv-node">' + esc(x.label || x.title || x.name || x.id || '') + '</span>';
            }).join('') + '</div>'
          : '<p class="pv-md-empty">（该图没有节点）</p>') +
        (edges.length
          ? '<div class="pv-graph-edges">' + edges.map(function (x) {
              return '<span class="pv-edge">' + esc(x.source) + '<i>→</i>' + esc(x.target) + '</span>';
            }).join('') + '</div>'
          : '') +
      '</section>';
    }).join('') + '</div>';
  }

  function pvTree(it, data) {
    var s = JSON.stringify(data, null, 2) || '';
    pvToolbar('<span class="pv-label"><iconify-icon icon="mdi:code-json" width="14"></iconify-icon> 结构化数据</span>' +
      '<span class="pv-spacer"></span><span class="pv-label">' + s.length.toLocaleString() + ' 字符</span>');
    // 顶层键做概览，下面给高亮后的 JSON 树（截断到 2 万字符，避免大对象卡住）
    var keys = (data && typeof data === 'object' && !Array.isArray(data)) ? Object.keys(data) : [];
    $('previewStage').innerHTML =
      '<div class="pv-tree">' +
        (keys.length ? '<div class="pv-tree-keys">' + keys.map(function (k) {
          var v = data[k];
          var n = Array.isArray(v) ? v.length + ' 项' : (v && typeof v === 'object' ? Object.keys(v).length + ' 个字段' : String(v).slice(0, 18));
          return '<span class="pv-node">' + esc(k) + '<i>' + esc(String(n)) + '</i></span>';
        }).join('') + '</div>' : '') +
        '<pre class="pv-json-tree">' + highlightJSON(s.slice(0, 20000)) +
          (s.length > 20000 ? '\n…（已截断，完整内容请用「导出」下载 .json）' : '') + '</pre>' +
      '</div>';
  }

  /* ================= 真实格式导出：要 doc 就导出 doc、pdf 就导出 pdf =================
     原来「导出数据」一律给 JSON —— 文档给 JSON、课件也给 JSON，拿到手还得自己转。
     现在按条目**真实类型**给格式：
       上传件 → 原文件（后端直接回）｜文档类（大纲/试卷）→ Word .doc｜课件 → PowerPoint .ppt｜
       源码 → .zip｜总览/交互 → .html｜结构化 → .json。
     Word / PowerPoint 用「Office 兼容 HTML」写法：Office 能直接打开带 .doc/.ppt 扩展名的 HTML，
     零依赖、离线可用（真 .docx/.pptx 要打包 OOXML，客户端没有库）。
     PDF 走「打印视图 + 浏览器另存为 PDF」—— 中文要靠系统字体，手写 PDF 无法嵌入 CJK 字体。 */

  var CRC_T = (function () {
    var t = new Array(256), c, n, k;
    for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function toU8(s) { return new TextEncoder().encode(s); }

  /* 最小 ZIP（store 不压缩）：够用且零依赖，用于源码打包 */
  function makeZip(files) {
    var parts = [], cd = [], off = 0;
    files.forEach(function (f) {
      var nb = toU8(f.name);
      var data = (f.data instanceof Uint8Array) ? f.data : toU8(String(f.data == null ? '' : f.data));
      var crc = crc32(data);
      var lh = new Uint8Array(30 + nb.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true);
      dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, nb.length, true); lh.set(nb, 30);
      parts.push(lh, data);
      var ch = new Uint8Array(46 + nb.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, nb.length, true); cv.setUint32(42, off, true); ch.set(nb, 46);
      cd.push(ch); off += lh.length + data.length;
    });
    var cdSize = cd.reduce(function (a, b) { return a + b.length; }, 0);
    var end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true);
    return new Blob(parts.concat(cd, [end]), { type: 'application/zip' });
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function safeName(s) { return String(s || 'export').replace(/[\\/:*?"<>|]/g, '_').slice(0, 90); }

  /* Office 兼容 HTML 外壳：Office 能直接打开带 .doc / .ppt 扩展名的 HTML */
  function officeHtml(title, body, kind) {
    var ns = kind === 'ppt'
      ? 'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:p="urn:schemas-microsoft-com:office:powerpoint" xmlns="http://www.w3.org/TR/REC-html40"'
      : 'xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"';
    return '<html ' + ns + '><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
      '@page{size:A4;margin:2cm}body{font-family:"SimSun",serif;font-size:14px;line-height:1.9;color:#1f2937}' +
      'h1{font-size:22px;text-align:center;letter-spacing:2px}' +
      'h2{font-size:16px;border-left:4px solid #b91c1c;padding-left:8px;margin:20px 0 8px}' +
      'table{border-collapse:collapse;width:100%}th,td{border:1px solid #9ca3af;padding:6px 8px;font-size:12.5px}th{background:#f3f4f6}' +
      '.slide{page-break-after:always;padding:20px 0}.slide h3{font-size:19px}.slide li{margin:6px 0}' +
      '</style></head><body>' + body + '</body></html>';
  }

  /* 文档类（大纲 / 试卷）→ Word 正文 */
  function wordBody(it, raw) {
    var ci = raw.courseInfo || {};
    var h = '<h1>' + esc(it.title) + '</h1><p style="text-align:center;color:#6b7280;font-size:12px">' +
      esc(it.courseCode || '') + '　' + esc(it.semesterName || '') + '</p>';
    if (it.format === 'handout') {
      h += '<h2>一、课程基本信息</h2><table>' +
        '<tr><th>课程名称</th><td>' + esc(ci.name || it.courseName || '') + '</td><th>课程代码</th><td>' + esc(ci.code || it.courseCode || '') + '</td></tr>' +
        '<tr><th>学分 / 学时</th><td>' + esc(ci.credit || '') + ' 学分 / ' + esc(ci.hours || '') + ' 学时</td><th>授课教师</th><td>' + esc(ci.teacher || '') + '</td></tr></table>';
      if ((raw.obeMatrix || []).length) {
        h += '<h2>二、课程目标与毕业要求支撑</h2><table><tr><th>课程目标</th><th>毕业要求指标点</th><th>支撑强度</th></tr>' +
          raw.obeMatrix.map(function (m) { return '<tr><td>' + esc(m.goal || '') + '</td><td>' + esc(m.indicator || '') + '</td><td>' + esc(m.level || '') + '</td></tr>'; }).join('') + '</table>';
      }
      if ((raw.schedule || []).length) {
        h += '<h2>三、教学进度</h2><table><tr><th>周次</th><th>教学内容</th><th>教学方式</th></tr>' +
          raw.schedule.map(function (s) { return '<tr><td>第 ' + esc(String(s.week)) + ' 周</td><td>' + esc(s.topic) + '</td><td>' + esc(s.mode || '') + '</td></tr>'; }).join('') + '</table>';
      }
      if ((raw.assessment || []).length) {
        h += '<h2>四、考核方式与成绩构成</h2><table><tr><th>考核环节</th><th>权重</th></tr>' +
          raw.assessment.map(function (a) { return '<tr><td>' + esc(a.name) + '</td><td>' + esc(String(a.weight)) + '%</td></tr>'; }).join('') + '</table>';
      }
    } else if (it.format === 'quiz') {
      h += (raw.questions || []).map(function (q, i) {
        return '<h2>第 ' + (i + 1) + ' 题' + (q.points ? '（' + q.points + ' 分）' : '') + '</h2>' +
          '<p>' + esc(q.question || '') + '</p>' +
          (q.options || []).map(function (o, oi) { return '<p style="margin-left:18px">' + String.fromCharCode(65 + oi) + '. ' + esc(o) + '</p>'; }).join('') +
          '<p style="color:#15803d"><b>参考答案：</b>' + esc(q.explanation || '') + '</p>' +
          ((q.rubric || []).length ? '<p style="color:#c2410c">评分细则：' + esc(q.rubric.join('；')) + '</p>' : '');
      }).join('');
    } else {
      h += (raw.outline || raw.bullets || []).map(function (b) { return '<p>' + esc(b) + '</p>'; }).join('');
    }
    return h;
  }

  /* 课件 → PowerPoint 正文（一页一段） */
  function slideBody(it, raw) {
    var slides = raw.slides || [];
    if (!slides.length) return '<div class="slide"><h3>' + esc(it.title) + '</h3></div>';
    return slides.map(function (s) {
      return '<div class="slide"><h3>' + esc(s.title || '') + '</h3><ul>' +
        (s.bullets || []).map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' +
        (s.formula ? '<p style="font-family:Consolas,monospace;color:#1d4ed8">' + esc(s.formula) + '</p>' : '') + '</div>';
    }).join('');
  }

  /* 条目 → 可选导出格式（按真实类型） */
  function exportFormats(it) {
    if (it.isUploadedFile) return [{ fmt: 'original', label: '下载原文件', ext: (String(it.fileName).split('.').pop() || '') }];
    if (it.format === 'handout' || it.format === 'quiz') {
      return [{ fmt: 'doc', label: 'Word 文档', ext: 'doc' }, { fmt: 'pdf', label: 'PDF（打印另存）', ext: 'pdf' }];
    }
    if (it.format === 'slides') {
      return [{ fmt: 'ppt', label: 'PowerPoint 演示文稿', ext: 'ppt' }, { fmt: 'pdf', label: 'PDF（打印另存）', ext: 'pdf' }];
    }
    if (it.format === 'code') return [{ fmt: 'zip', label: '源码压缩包', ext: 'zip' }];
    if (it.format === 'md') return [{ fmt: 'md', label: 'Markdown 讲义', ext: 'md' }, { fmt: 'pdf', label: 'PDF（打印另存）', ext: 'pdf' }];
    if (it.format === 'html') return [{ fmt: 'html', label: 'HTML 页面', ext: 'html' }, { fmt: 'pdf', label: 'PDF（打印另存）', ext: 'pdf' }];
    if (it.format === 'video') return [{ fmt: 'html', label: '章节与字幕', ext: 'html' }];
    return [{ fmt: 'json', label: 'JSON 数据', ext: 'json' }];
  }

  /* 取条目的原始数据：场景条目在 raw，课程级条目在 payload */
  function itemRaw(it) {
    if (it.raw && typeof it.raw === 'object') return it.raw;
    if (it.payload && typeof it.payload === 'object' && !Array.isArray(it.payload)) return it.payload;
    return {};
  }

  function printHtml(title, body) {
    var w = window.open('', '_blank');
    if (!w) { toast('浏览器拦截了打印窗口，请允许弹窗后重试', 'warning'); return; }
    w.document.write(officeHtml(title, body, 'doc'));
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) { /* 交给用户手动打印 */ } }, 300);
  }

  function exportItem(it, fmt) {
    var raw = itemRaw(it);
    var base = safeName(it.title || it.fileName);
    try {
      if (fmt === 'original') {
        var a = document.createElement('a');
        a.href = API.archiveDownload(it.archiveId);
        a.download = it.fileName || '';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        toast('正在下载原文件：' + it.fileName, 'success');
        return;
      }
      if (fmt === 'doc') {
        downloadBlob(new Blob([officeHtml(it.title, wordBody(it, raw), 'doc')], { type: 'application/msword' }), base + '.doc');
        toast('已导出 Word 文档', 'success'); return;
      }
      if (fmt === 'ppt') {
        downloadBlob(new Blob([officeHtml(it.title, slideBody(it, raw), 'ppt')], { type: 'application/vnd.ms-powerpoint' }), base + '.ppt');
        toast('已导出 PowerPoint 演示文稿', 'success'); return;
      }
      if (fmt === 'pdf') {
        printHtml(it.title, it.format === 'slides' ? slideBody(it, raw) : wordBody(it, raw));
        toast('已打开打印视图，在打印对话框选「另存为 PDF」即可', 'info'); return;
      }
      if (fmt === 'zip') {
        var files = (raw.files || []).map(function (f) { return { name: f.name, data: f.code || '' }; });
        if (!files.length) files = [{ name: (it.fileName || 'solution.py'), data: raw.initialCode || '' }];
        downloadBlob(makeZip(files), base + '.zip');
        toast('已导出源码压缩包（' + files.length + ' 个文件）', 'success'); return;
      }
      if (fmt === 'md') {
        // 小节讲义条目本身没带正文（正文在 course_content 里），退回用摘要里的小节标题
        var secs = raw.sections || (it.summary ? String(it.summary).split(/\s*\/\s*/) : []);
        var md = '# ' + it.title + '\n\n' + secs.map(function (s) { return '- ' + s; }).join('\n');
        downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), base + '.md');
        toast('已导出 Markdown 讲义', 'success'); return;
      }
      if (fmt === 'html') {
        var body = raw.html || ('<h1>' + esc(it.title) + '</h1>' +
          ((raw.chapters || []).map(function (c) { return '<p>' + esc(c.t) + '　' + esc(c.title) + '</p>'; }).join('') || ''));
        downloadBlob(new Blob([officeHtml(it.title, body, 'doc')], { type: 'text/html;charset=utf-8' }), base + '.html');
        toast('已导出 HTML', 'success'); return;
      }
      // 兜底：结构化 JSON
      var data = (it.payload !== undefined) ? it.payload : raw;
      downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), base + '.json');
      toast('已导出 JSON 数据', 'success');
    } catch (e) {
      toast('导出失败：' + (e && e.message ? e.message : '未知错误'), 'warning');
    }
  }

  var EXPORT_ICON = {
    pdf: 'mdi:file-pdf-box', doc: 'mdi:file-word-outline', ppt: 'mdi:file-powerpoint-outline',
    zip: 'mdi:folder-zip-outline', md: 'mdi:file-document-outline', html: 'mdi:file-code-outline',
    json: 'mdi:code-json', original: 'mdi:download-outline'
  };

  function openExportMenu(it) {
    var menu = $('previewExportMenu');
    menu.innerHTML = '<div class="pv-export-note">按条目真实类型导出</div>' +
      exportFormats(it).map(function (f) {
        return '<button data-fmt="' + f.fmt + '"><iconify-icon icon="' + (EXPORT_ICON[f.fmt] || 'mdi:download-outline') +
          '" width="15"></iconify-icon>' + esc(f.label) + (f.ext ? '<em>.' + esc(f.ext) + '</em>' : '') + '</button>';
      }).join('');
    menu.classList.remove('is-hidden');
  }

  /* 批量打包下载：把勾选的条目按各自**真实格式**打进一个 ZIP。
     上传件的字节在服务端、前端拿不到，ZIP 里放一条说明（原文件请在详情里单独下载）。 */
  function batchDownloadZip() {
    var picked = resources.filter(function (r) { return state.selectedIds.has(r.id); });
    if (!picked.length) { toast('先勾选要打包的资料', 'warning'); return; }
    var files = [];
    picked.forEach(function (it) {
      var raw = itemRaw(it);
      var name = safeName(it.title || it.fileName);
      if (it.isUploadedFile) {
        files.push({ name: name + '.txt', data: '原始文件请在该资料详情里单独下载：' + it.fileName + '\n' });
      } else if (it.format === 'handout' || it.format === 'quiz') {
        files.push({ name: name + '.doc', data: officeHtml(it.title, wordBody(it, raw), 'doc') });
      } else if (it.format === 'slides') {
        files.push({ name: name + '.ppt', data: officeHtml(it.title, slideBody(it, raw), 'ppt') });
      } else if (it.format === 'code') {
        var sub = raw.files || [{ name: it.fileName || 'solution.py', code: raw.initialCode || '' }];
        sub.forEach(function (f) { files.push({ name: name + '/' + f.name, data: f.code || '' }); });
      } else if (it.format === 'md') {
        var secs = raw.sections || (it.summary ? String(it.summary).split(/\s*\/\s*/) : []);
        files.push({ name: name + '.md', data: '# ' + it.title + '\n\n' + secs.map(function (s) { return '- ' + s; }).join('\n') + '\n' });
      } else if (it.format === 'html') {
        files.push({ name: name + '.html', data: officeHtml(it.title, raw.html || '', 'doc') });
      } else {
        files.push({ name: name + '.json', data: JSON.stringify(it.payload !== undefined ? it.payload : raw, null, 2) });
      }
    });
    if (!files.length) { toast('没有可打包的内容', 'warning'); return; }
    downloadBlob(makeZip(files), '课程资料包-' + Date.now() + '.zip');
    toast('已打包 ' + picked.length + ' 条资料（' + files.length + ' 个文件）', 'success');
  }

  /* ---------------- 上传弹窗 ---------------- */

  function openUpload() {
    $('uploadForm').reset();
    $('uploadProgress').classList.add('is-hidden');
    $('uploadProgressBar').style.width = '0%';
    $('uploadProgressText').textContent = '0%';
    $('uploadDropText').textContent = '点击选择或将文件拖入此区域';
    $('modalSubmitBtn').disabled = false;
    // 默认选中当前正在筛选的那门课：从某门课的列表点进来存资料，
    // 十有八九就是想存到那门课，不该再让用户从头翻一遍下拉
    if (state.course !== 'ALL') $('modalCourse').value = state.course;
    $('uploadModal').classList.remove('is-hidden');
  }

  function closeUpload() { $('uploadModal').classList.add('is-hidden'); }

  var uploading = false;

  /* 真实上传：POST /api/v1/course/archive-file（multipart）。
     用 XHR 而不是 fetch —— fetch 的上传进度还在草案里，
     而这里是可能传几百 MB 视频的地方，进度条必须是真字节不是动画。 */
  function submitUpload(e) {
    e.preventDefault();
    if (uploading) return;
    var picker = $('filePickerInput');
    var file = picker.files && picker.files[0];
    if (!file) {
      toast('请先选择要归档的文件', 'warning');
      return;
    }
    var courseId = $('modalCourse').value;
    if (!courseId) {
      toast('请先在「课程生成」里创建一门课程，资料需要归档到具体课程下', 'warning');
      return;
    }
    var category = 'doc';
    $$('input[name="uploadType"]').forEach(function (r) {
      if (r.checked) category = r.value;
    });
    var notes = ($('modalNotes').value || '').trim();

    var box = $('uploadProgress');
    var bar = $('uploadProgressBar');
    var txt = $('uploadProgressText');
    var btn = $('modalSubmitBtn');

    box.classList.remove('is-hidden');
    btn.disabled = true;
    uploading = true;

    var fd = new FormData();
    fd.append('file', file, file.name);
    fd.append('courseId', courseId);
    fd.append('category', category);
    if (notes) fd.append('notes', notes);

    var xhr = new XMLHttpRequest();
    xhr.open('POST', API.archiveUpload);
    xhr.withCredentials = true;
    xhr.responseType = 'json';

    xhr.upload.onprogress = function (ev) {
      if (!ev.lengthComputable) return;
      var pct = Math.round((ev.loaded / ev.total) * 100);
      bar.style.width = pct + '%';
      txt.textContent = pct + '%';
    };

    function finish(ok, msg, type) {
      uploading = false;
      box.classList.add('is-hidden');
      bar.style.width = '0%';
      txt.textContent = '0%';
      btn.disabled = false;
      if (ok) closeUpload();
      toast(msg, type || (ok ? 'success' : 'warning'));
    }

    xhr.onload = function () {
      var body = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300 && body && body.code === 0) {
        // 上传成功后立即把新文件并入列表，不用等整页刷新
        var c = courses.filter(function (x) { return String(x.id) === String(courseId); })[0];
        archiveFiles.unshift(body.data);
        rebuildDerived();
        renderAll();
        finish(true, '已存入资料库：' + file.name + '（' + formatBytes(file.size) +
                      '），可在列表中下载原文件');
      } else if (body && body.code === 40100) {
        finish(false, '登录已过期，请重新登录后再存入');
      } else {
        finish(false, '存入失败：' + ((body && body.message) || ('HTTP ' + xhr.status)));
      }
    };
    xhr.onerror = function () { finish(false, '网络错误，文件未能上传（请检查后端服务）'); };
    xhr.onabort = function () { finish(false, '已取消上传'); };

    xhr.send(fd);

    // 上传过程中再点一次提交 = 取消（大文件传错了不用等它跑完）
    btn.onclick = function () {
      if (uploading) { xhr.abort(); btn.onclick = null; }
    };
  }

  /* ---------------- Toast ---------------- */

  function toast(msg, type) {
    type = type || 'info';
    var icon = type === 'success' ? 'mdi:check-circle'
             : type === 'warning' ? 'mdi:alert-outline'
             : 'mdi:information';
    var el = document.createElement('div');
    el.className = 'toast t-' + type;
    el.innerHTML = '<iconify-icon icon="' + icon + '" width="16"></iconify-icon><span>' + esc(msg) + '</span>';
    $('toastRoot').appendChild(el);

    requestAnimationFrame(function () { el.classList.add('is-in'); });
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
    }, 3200);
  }

  /* ---------------- 事件绑定（统一委托，避免内联 onclick） ---------------- */

  function bind() {
    // 学期时间轴左右滚动
    function scrollSemesters(dir) {
      var g = $('semesterCardGrid');
      if (!g) return;
      // 按「一张卡 + 一个间隙」滚。别写死像素值 —— 卡片宽度是响应式的
      // （窄屏一行 3 张、手机一行 1 张），写死的话宽屏滚不到位、窄屏一次滚过头。
      var card = g.firstElementChild;
      var step = card ? card.getBoundingClientRect().width + 10 : Math.round(g.clientWidth * 0.8);
      g.scrollBy({ left: dir * step, behavior: 'smooth' });
    }
    $('semScrollPrev').addEventListener('click', function () { scrollSemesters(-1); });
    $('semScrollNext').addEventListener('click', function () { scrollSemesters(1); });

    // 学期卡片
    $('semesterCardGrid').addEventListener('click', function (e) {
      var card = e.target.closest('[data-sem]');
      if (card) selectSemester(card.dataset.sem);
    });

    // 课程卡片（一级导航）：点开某门课 → 才显示它的资料
    $('courseCardGrid').addEventListener('click', function (e) {
      var card = e.target.closest('[data-course]');
      if (card) selectCourse(card.dataset.course);
    });
    // 「← 全部课程」返回课程列表
    $('backToCoursesBtn').addEventListener('click', function () { selectCourse('ALL'); });

    // 类别胶囊
    $('categoryTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.pill');
      if (btn) selectCategory(btn.dataset.cat);
    });

    // 视图切换
    $('viewSeg').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-view]');
      if (btn) switchView(btn.dataset.view);
    });

    // 下拉筛选：课程下拉 = 一级导航（切换课程并露出资料区）；排序只影响列表顺序
    $('courseSelect').addEventListener('change', function () {
      selectCourse($('courseSelect').value);
    });
    $('sortBySelect').addEventListener('change', function () {
      state.sort = $('sortBySelect').value;
      renderMainResources();
    });

    // 搜索（即时）
    $('globalSearch').addEventListener('input', function (e) {
      state.search = e.target.value;
      renderCategoryPills();   // 胶囊数字跟着搜索结果走
      renderMainResources();
    });

    // 重置
    $('resetBtn').addEventListener('click', function () { resetAllFilters(); });
    $('emptyResetBtn').addEventListener('click', function () { resetAllFilters(); });

    // 列表区委托：选择 / 预览 / 克隆 / 下载
    ['gridWrapper', 'tableWrapper'].forEach(function (wrapId) {
      $(wrapId).addEventListener('click', function (e) {
        var check = e.target.closest('[data-check]');
        if (check) { toggleSelect(check.dataset.check, check.checked); return; }

        var prev = e.target.closest('[data-preview]');
        if (prev) { openPreview(prev.dataset.preview); return; }

        var clone = e.target.closest('[data-clone]');
        if (clone) { cloneOne(clone.dataset.clone); return; }

        var del = e.target.closest('[data-delete]');
        if (del) { deleteOne(del.dataset.delete); return; }

        var dl = e.target.closest('[data-download]');
        if (dl) { downloadOne(dl.dataset.download); }
      });
      // 复选框 change 不冒泡到 click 的 checked 状态之外，单独接一次
      $(wrapId).addEventListener('change', function (e) {
        var check = e.target.closest('[data-check]');
        if (check) toggleSelect(check.dataset.check, check.checked);
      });
    });

    // 全选
    $('selectAllRows').addEventListener('change', function (e) {
      var list = getFilteredList();
      list.forEach(function (it) {
        if (e.target.checked) state.selectedIds.add(it.id);
        else state.selectedIds.delete(it.id);
      });
      renderMainResources();
    });

    // 浮动舱
    $('dockClear').addEventListener('click', clearSelection);
    $('dockClone').addEventListener('click', function () {
      var n = state.selectedIds.size;
      state.selectedIds.forEach(function (id) {
        var it = byId(id);
        if (it) it.cloned = true;
      });
      clearSelection();
      toast('已把选中的 ' + n + ' 份历史资料继承到当期在教课程', 'success');
    });
    // 打包下载：把勾选的条目按各自真实格式打成一个 ZIP（真实文件，不是结构化数据）
    $('dockPack').addEventListener('click', batchDownloadZip);
    // 导出结构数据：打开结构化导出弹窗（JSON / CSV / Markdown）
    $('dockZip').addEventListener('click', function () {
      if (!state.selectedIds.size) {
        toast('未选中任何条目，已为你导出全部历史库', 'warning');
        openExport('all');
      } else {
        openExport('selected');
      }
    });

    // ---- 结构化数据导出弹窗 ----
    $('exportClose').addEventListener('click', closeExport);
    $('exportCancel').addEventListener('click', closeExport);
    $('exportModal').addEventListener('click', function (e) { if (e.target === $('exportModal')) closeExport(); });
    $$('#exportFormatSeg button').forEach(function (b) {
      b.addEventListener('click', function () { setExportFmt(b.dataset.fmt); });
    });
    $$('#exportScopeGrid input').forEach(function (r) {
      r.addEventListener('change', function () { exportState.scope = r.value; renderExportPreview(); });
    });
    // 课程限定：只导出所选课程的资料
    var ecs = $('exportCourseSelect');
    if (ecs) ecs.addEventListener('change', function () { exportState.course = ecs.value; renderExportPreview(); });
    $('exportFieldGrid').addEventListener('change', function (e) {
      if (e.target.dataset.fld) { exportState.fields[e.target.dataset.fld] = e.target.checked; renderExportPreview(); }
    });
    $('exportToggleAll').addEventListener('click', function () {
      var all = EXPORT_FIELDS.every(function (f) { return exportState.fields[f.key]; });
      EXPORT_FIELDS.forEach(function (f) { exportState.fields[f.key] = !all; });
      $('exportFieldGrid').querySelectorAll('input').forEach(function (i) { i.checked = exportState.fields[i.dataset.fld]; });
      renderExportPreview();
    });
    $('exportCopy').addEventListener('click', function () { copyExportText(buildExportText().text); });
    $('exportDownload').addEventListener('click', function () {
      // 「原始文件」：按每条资料的真实类型产出文件，打成一个 .ZIP
      if (exportState.fmt === 'files') {
        var rows = exportScopeList();
        var fl = buildFileList(rows);
        if (!fl.length) { toast('当前范围没有可导出的资料', 'warning'); return; }
        downloadBlob(makeZip(fl.map(function (f) { return { name: f.name, data: f.data }; })),
          '课程资料包-' + Date.now() + '.zip');
        toast('已打包 ' + rows.length + ' 条资料（' + fl.length + ' 个文件）', 'success');
        return;
      }
      var out = buildExportText();
      if (!out.text) { toast('没有可导出的内容', 'warning'); return; }
      var ext = exportState.fmt === 'json' ? 'json' : exportState.fmt === 'csv' ? 'csv' : 'md';
      var mime = exportState.fmt === 'json' ? 'application/json'
               : exportState.fmt === 'csv' ? 'text/csv;charset=utf-8'
               : 'text/markdown;charset=utf-8';
      var blob = new Blob([out.text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'course-archive-' + exportState.scope + '-' + Date.now() + '.' + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('已导出 ' + out.count + ' 条（' + out.text.length + ' 字符）', 'success');
    });
    var exportBtn = $('exportDataBtn');
    if (exportBtn) exportBtn.addEventListener('click', function () { openExport('all'); });

    // 注意：后端没有「删除课程内容」接口，所以这里**不能**假装删掉了。
    // 只清空当前页面的选择与视图，并在提示里讲清楚。
    $('dockDelete').addEventListener('click', function () {
      var n = state.selectedIds.size;
      clearSelection();
      toast('已取消选择 ' + n + ' 项。删除课程内容需要后端接口，当前版本未接入，不会真正删除', 'warning');
    });

    // 预览弹窗
    $('previewClose').addEventListener('click', closePreview);
    $('previewModal').addEventListener('click', function (e) {
      if (e.target === $('previewModal')) closePreview();
    });
    $('previewClone').addEventListener('click', function () {
      if (!activePreviewItem) return;
      var id = activePreviewItem.id;
      closePreview();
      cloneOne(id);
    });
    // 导出：按条目真实类型给格式（文档→doc、课件→ppt、源码→zip…），不再一律 JSON
    $('previewDownload').addEventListener('click', function () {
      if (!activePreviewItem) return;
      var menu = $('previewExportMenu');
      if (menu.classList.contains('is-hidden')) openExportMenu(activePreviewItem);
      else menu.classList.add('is-hidden');
    });
    $('previewExportMenu').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-fmt]');
      if (!b || !activePreviewItem) return;
      $('previewExportMenu').classList.add('is-hidden');
      exportItem(activePreviewItem, b.dataset.fmt);
    });
    // 点菜单以外的地方收起（点 .pv-export 内部不收起，否则会和上面的开合打架）
    document.addEventListener('click', function (e) {
      var menu = $('previewExportMenu');
      if (menu && !menu.classList.contains('is-hidden') && !e.target.closest('.pv-export')) {
        menu.classList.add('is-hidden');
      }
    });
    $('previewCopyLink').addEventListener('click', function () {
      var it = activePreviewItem;
      if (!it) return;
      // 不伪造「共享直链」：后端没有分享接口，随便拼一个 URL 是骗人的。
      // 复制的是真实存在的归档标识，拿着它可以在课程接口里定位到这条内容。
      var ref = [
        'courseCode: ' + it.courseCode,
        'courseId: ' + it.courseId,
        'itemId: ' + it.id,
        'file: ' + it.fileName
      ].join('\n');
      copyText(ref);
      toast('已复制归档标识（课程编码 / 条目 ID / 文件名）', 'success');
    });

    // 上传弹窗
    $('openUploadBtn').addEventListener('click', openUpload);
    $('uploadClose').addEventListener('click', closeUpload);
    $('uploadCancel').addEventListener('click', closeUpload);
    $('uploadModal').addEventListener('click', function (e) {
      if (e.target === $('uploadModal')) closeUpload();
    });
    $('uploadForm').addEventListener('submit', submitUpload);

    // 文件选择
    $('dropzone').addEventListener('click', function () { $('filePickerInput').click(); });
    $('filePickerInput').addEventListener('change', function (e) {
      if (!e.target.files || !e.target.files[0]) return;
      var f = e.target.files[0];
      $('uploadDropText').textContent = '已选择: ' + f.name + ' (' + (f.size / 1048576).toFixed(1) + ' MB)';
    });
    // 拖放
    ['dragover', 'dragenter'].forEach(function (t) {
      $('dropzone').addEventListener(t, function (e) { e.preventDefault(); });
    });
    $('dropzone').addEventListener('drop', function (e) {
      e.preventDefault();
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (!f) return;
      var dt = new DataTransfer();
      dt.items.add(f);
      $('filePickerInput').files = dt.files;
      $('uploadDropText').textContent = '已选择: ' + f.name + ' (' + (f.size / 1048576).toFixed(1) + ' MB)';
    });

    // 快捷键 ⌘K / Ctrl+K 聚焦搜索
    window.addEventListener('keydown', onKeydown);
  }

  /* 抽成具名函数，unmount 时才摘得掉 —— 匿名监听器挂上去就再也摘不掉，
     每次进出这个页面都会多留一个，而且里面的 $ 会指向已被移除的节点。 */
  function onKeydown(e) {
    if (!mounted) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      var s = $('globalSearch');
      if (s) s.focus();
    }
    if (e.key === 'Escape') {
      var pv = $('previewModal');
      var up = $('uploadModal');
      if (pv && !pv.classList.contains('is-hidden')) closePreview();
      else if (up && !up.classList.contains('is-hidden')) closeUpload();
    }
  }

  /* ---------------- 单项操作 ---------------- */

  function byId(id) {
    return resources.filter(function (r) { return r.id === id; })[0];
  }

  /* 单项操作。

     注意：这两个按钮**不伪造结果**。
     - 「下载」按条目真实类型导出（上传件→原文件；文档→doc；课件→ppt；源码→zip；
       结构化数据→json），浏览器直接落盘，确实能打开，不是假动作。
     - 「继承到新学期」需要后端提供复制接口，目前没有，所以只提示，不假装成功。 */

  function downloadOne(id) {
    var it = byId(id);
    if (!it) return;
    // 卡片上的「下载」= 该条目**主格式**的导出（和弹窗里导出菜单的第一项一致）
    exportItem(it, exportFormats(it)[0].fmt);
  }

  /* ---------------- 结构化数据导出（JSON / CSV / Markdown） ----------------
     把「存入历史资料」里的内容按三种行业标准格式导出：
       · JSON  —— 保留完整类型/层级/结构，便于与 LMS / Canvas / 雨课堂等系统做 API 同构同步；
       · CSV   —— 自动注入 UTF-8 BOM（\uFEFF），彻底解决 Windows/macOS 版 Excel 打开中文表格乱码，
                  可直接交教务处做课时 / 教学大纲审核；
       · MD    —— 标准 GFM 管道表格，可直接粘进 Notion / Obsidian / 语雀等备课知识库。
     范围（Scope）可在「全部历史库 / 当前筛选结果 / 浮动舱选中」间切换；
     字段投射（Field Projection）支持勾选要导出的列。纯前端，数据都在浏览器里。 */
  var EXPORT_FIELDS = [
    { key: 'title',          label: '标题',         def: true },
    { key: 'courseName',     label: '课程名称',     def: true },
    { key: 'courseCode',     label: '课程代码',     def: true },
    { key: 'category',       label: '分类',         def: true },
    { key: 'size',           label: '内容大小',     def: true },
    { key: 'updateDate',     label: '更新日期',     def: true },
    { key: 'semesterName',   label: '归档学期',     def: true },
    { key: 'composition',    label: '内容构成',     def: true },
    { key: 'summary',        label: '摘要/备注',    def: true },
    { key: 'isUploadedFile', label: '是否手动存入', def: true,  fmt: function (v) { return v ? '是' : '否'; } },
    { key: 'fileName',       label: '文件名',       def: false },
    { key: 'format',         label: '格式',         def: false },
    { key: 'chapterNo',      label: '章节号',       def: false },
    { key: 'archiveId',      label: '归档ID',       def: false }
  ];

  var exportState = { fmt: 'json', scope: 'all', course: 'ALL', fields: {} };

  function exportScopeList() {
    var list;
    if (exportState.scope === 'selected') list = resources.filter(function (r) { return state.selectedIds.has(r.id); });
    else if (exportState.scope === 'filtered') list = getFilteredList();
    else list = resources;
    // 课程限定：在选定范围之上再按课程收窄（可在导出弹窗里选要导出哪一门课）
    if (exportState.course !== 'ALL') {
      list = list.filter(function (r) { return String(r.courseId) === String(exportState.course); });
    }
    return list;
  }

  // 取某条目某字段的「单元格文本」：非标量统一 JSON 化，保证 CSV/MD 一个格子装得下
  function exportCell(it, f) {
    var v = it[f.key];
    if (f.fmt) return f.fmt(v);
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') return JSON.stringify(v);
    return v;
  }

  function exportActiveFields() {
    return EXPORT_FIELDS.filter(function (f) { return exportState.fields[f.key]; });
  }

  function buildExportText() {
    var rows = exportScopeList();
    var fields = exportActiveFields();
    if (!rows.length) return { text: '', count: 0 };
    if (!fields.length) return { text: '（请至少勾选一个字段）', count: rows.length };
    var text;
    if (exportState.fmt === 'json') {
      // JSON：保留原始类型与嵌套结构（对象字段原样放入，不被拍平）
      var arr = rows.map(function (r) {
        var o = {};
        fields.forEach(function (f) { o[f.label] = r[f.key]; });
        return o;
      });
      text = JSON.stringify(arr, null, 2);
    } else if (exportState.fmt === 'csv') {
      var csvEsc = function (s) {
        s = String(s == null ? '' : s);
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      };
      var head = fields.map(function (f) { return csvEsc(f.label); }).join(',');
      var body = rows.map(function (r) {
        return fields.map(function (f) { return csvEsc(exportCell(r, f)); }).join(',');
      }).join('\r\n');
      // \uFEFF = UTF-8 BOM：让 Excel 识别编码，中文不乱码
      text = '﻿' + head + '\r\n' + body;
    } else { // markdown · GFM 管道表格
      var mdEsc = function (s) {
        return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ').replace(/\r/g, '');
      };
      var head = '| ' + fields.map(function (f) { return f.label; }).join(' | ') + ' |';
      var sep = '| ' + fields.map(function () { return '---'; }).join(' | ') + ' |';
      var body = rows.map(function (r) {
        return '| ' + fields.map(function (f) { return mdEsc(exportCell(r, f)); }).join(' | ') + ' |';
      }).join('\n');
      text = head + '\n' + sep + '\n' + body;
    }
    return { text: text, count: rows.length };
  }

  /* 「原始文件」格式：按每条资料的**真实类型**产出文件，再打成一个 .ZIP。
     这是「要 doc 就导出 doc、pdf 就导出 pdf」在批量导出里的落地 ——
     与预览弹窗里单条导出复用同一套生成器（officeHtml / wordBody / slideBody）。
     手动上传件：字节在服务端、前端取不到，ZIP 里放一条说明（原文件请单独下载）。 */
  function buildFileList(rows) {
    var files = [];
    rows.forEach(function (it) {
      var raw = itemRaw(it);
      var name = safeName(it.title || it.fileName);
      if (it.isUploadedFile) {
        files.push({ name: name + '.txt', ext: 'txt', src: it.fileName, data: '原始文件请在该资料详情里单独下载：' + it.fileName + '\n' });
      } else if (it.format === 'handout' || it.format === 'quiz') {
        files.push({ name: name + '.doc', ext: 'doc', src: it.title, data: officeHtml(it.title, wordBody(it, raw), 'doc') });
      } else if (it.format === 'slides') {
        files.push({ name: name + '.ppt', ext: 'ppt', src: it.title, data: officeHtml(it.title, slideBody(it, raw), 'ppt') });
      } else if (it.format === 'code') {
        var sub = (raw.files && raw.files.length)
          ? raw.files
          : [{ name: (raw.fileName || 'solution.py'), code: raw.initialCode || '' }];
        sub.forEach(function (f) {
          files.push({ name: name + '/' + f.name, ext: (String(f.name).split('.').pop() || ''), src: it.title, data: f.code || '' });
        });
      } else if (it.format === 'md') {
        var secs = raw.sections || (it.summary ? String(it.summary).split(/\s*\/\s*/) : []);
        files.push({ name: name + '.md', ext: 'md', src: it.title, data: '# ' + it.title + '\n\n' + secs.map(function (s) { return '- ' + s; }).join('\n') + '\n' });
      } else if (it.format === 'html') {
        files.push({ name: name + '.html', ext: 'html', src: it.title, data: officeHtml(it.title, raw.html || '', 'doc') });
      } else {
        files.push({ name: name + '.json', ext: 'json', src: it.title, data: JSON.stringify(it.payload !== undefined ? it.payload : raw, null, 2) });
      }
    });
    return files;
  }

  function escHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; });
  }
  // 仅用于预览框的轻量 JSON 着色（输入已先转义，安全）；下载内容保持纯文本
  function highlightJSON(src) {
    var e = escHtml(src);
    return e.replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
      function (m, str, colon, kw) {
        if (str !== undefined) return colon ? '<span class="hl-key">' + str + '</span>' + colon : '<span class="hl-str">' + str + '</span>';
        if (kw !== undefined) return '<span class="hl-kw">' + kw + '</span>';
        return '<span class="hl-num">' + m + '</span>';
      });
  }

  var EXPORT_FMT_LABEL = { json: 'JSON', csv: 'CSV', md: 'Markdown', files: '原始文件' };

  function renderExportPreview() {
    var rows = exportScopeList();
    var pre = $('exportPreview');
    var foot = $('exportFootStat');
    // 「原始文件」下预览列的是**将要打包的文件清单**，字段投射对它没有意义
    if (exportState.fmt === 'files') {
      var fl = buildFileList(rows);
      pre.classList.add('is-plain');
      pre.textContent = fl.length
        ? fl.map(function (f) { return '· ' + f.name; }).join('\n')
        : '（当前范围没有可导出的资料）';
      $('exportMeta').textContent = '范围 ' + rows.length + ' 条';
      if (foot) foot.textContent = '将打包 ' + fl.length + ' 个文件';
      return;
    }
    var out = buildExportText();
    var full = out.text || '';
    var preview = full.length > 1000 ? full.slice(0, 1000) + '\n…（已截断，下载为完整内容）' : full;
    pre.classList.toggle('is-plain', exportState.fmt !== 'json');
    if (exportState.fmt === 'json') pre.innerHTML = highlightJSON(preview);
    else pre.textContent = preview;
    $('exportMeta').textContent = '范围 ' + rows.length + ' 条 · 已选 ' + exportActiveFields().length + ' 列';
    if (foot) foot.textContent = '已解析 ' + rows.length + ' 条记录 · 共 ' + full.length + ' 字符';
  }

  function setExportFmt(fmt) {
    exportState.fmt = fmt;
    $$('#exportFormatSeg button').forEach(function (b) { b.classList.toggle('is-on', b.dataset.fmt === fmt); });
    // 字段投射只对结构化数据有意义；「原始文件」下藏起来
    var fw = $('exportFieldWrap');
    if (fw) fw.classList.toggle('is-hidden', fmt === 'files');
    var txt = $('exportDownloadText');
    if (txt) txt.textContent = (fmt === 'files')
      ? '下载文件包 (.ZIP)'
      : '下载 ' + (EXPORT_FMT_LABEL[fmt] || '') + ' 文件';
    renderExportPreview();
  }

  function openExport(scopeDefault) {
    exportState.scope = scopeDefault || 'all';
    exportState.fmt = 'json';
    exportState.fields = {};
    // 课程限定下拉：默认跟着当前正在看的课程走（在课程里点导出，十有八九就是想导这门课）
    exportState.course = (state.course && state.course !== 'ALL') ? String(state.course) : 'ALL';
    var csel = $('exportCourseSelect');
    if (csel) {
      csel.innerHTML = '<option value="ALL">全部课程（' + courses.length + ' 门）</option>' +
        courses.map(function (c) { return '<option value="' + c.id + '">' + esc(c.title) + '</option>'; }).join('');
      csel.value = exportState.course;
      if (csel.value !== exportState.course) { csel.value = 'ALL'; exportState.course = 'ALL'; }
    }
    EXPORT_FIELDS.forEach(function (f) { exportState.fields[f.key] = !!f.def; });
    $('exportFieldGrid').innerHTML = EXPORT_FIELDS.map(function (f) {
      return '<label class="chk"><input type="checkbox" data-fld="' + f.key + '"' + (exportState.fields[f.key] ? ' checked' : '') + '><span>' + esc(f.label) + '</span></label>';
    }).join('');
    var r = document.querySelector('input[name="exportScope"][value="' + exportState.scope + '"]');
    if (r) r.checked = true;
    setExportFmt('json');
    $('exportModal').classList.remove('is-hidden');
    renderExportPreview();
  }

  function closeExport() { $('exportModal').classList.add('is-hidden'); }

  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      toast(ok ? '已复制 ' + text.length + ' 字符到剪贴板' : '复制失败，请手动选择预览框内容', ok ? 'success' : 'warning');
    } catch (e) { toast('复制失败，请手动选择预览框内容', 'warning'); }
  }

  function copyExportText(text) {
    if (!text) { toast('没有可导出的内容', 'warning'); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { toast('已复制 ' + text.length + ' 字符到剪贴板', 'success'); },
        function () { fallbackCopy(text); }
      );
    } else fallbackCopy(text);
  }

  /* 删除手动存入的归档文件（后端 DELETE /api/v1/course/archive-file）。
     只有 isUploadedFile 的条目才有删除按钮 —— 课程生成器产出的内容
     不在这里删（要改就到「课程生成」重新发布覆盖）。 */
  function deleteOne(id) {
    var it = byId(id);
    if (!it) return;
    if (!it.isUploadedFile) {
      toast('课程生成的内容不在这里删除（请到「课程生成」重新发布覆盖）', 'warning');
      return;
    }
    if (!window.confirm('确定要删除「' + it.fileName + '」吗？\n删除后无法恢复。')) return;

    fetch(API.archiveDelete(it.archiveId), { method: 'DELETE', credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (body) {
        if (body && body.code === 0) {
          archiveFiles = archiveFiles.filter(function (f) {
            return String(f.id) !== String(it.archiveId);
          });
          rebuildDerived();
          renderAll();
          toast('已删除：' + it.fileName, 'success');
        } else if (body && body.code === 40100) {
          toast('登录已过期，请重新登录后再删除', 'warning');
        } else {
          toast('删除失败：' + ((body && body.message) || '未知错误'), 'warning');
        }
      })
      .catch(function () { toast('删除失败：网络错误', 'warning'); });
  }

  function cloneOne(id) {
    var it = byId(id);
    if (!it) return;
    toast('「继承到新学期」需要后端提供课程内容复制接口，当前版本尚未接入', 'warning');
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    var t = document.createElement('textarea');
    t.value = text;
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch (err) { /* 忽略 */ }
    document.body.removeChild(t);
  }

  /* ---------------- 对外接口 ---------------- */

  /* 浮层挂在 document.body：.app-main 是 overflow:auto 的滚动容器，
     且路由切换会给它挂 animate.css 的类。只要某个祖先带上 transform，
     position:fixed 就会改成相对那个祖先定位，批量舱和弹窗会跑偏。
     挂到 body 下就永远相对视口。 */
  var mounted = false;
  var portalNodes = [];

  function buildPortals() {
    var tmp = document.createElement('div');
    tmp.innerHTML = PORTAL_HTML;
    var inner = Array.prototype.slice.call(tmp.children);
    portalNodes = [];
    inner.forEach(function (n) {
      /* 每个浮层外面再包一层 .cr-scope，**不要**把 .cr-scope 直接加在浮层根上。
         因为样式是 `.cr-scope X` 这种后代选择器形式，而后代选择器匹配不到根自身：
         如果浮层根自己就是 .cr-scope，那么 `.cr-scope .overlay.is-hidden`
         永远不会命中 —— 表现就是弹窗和批量舱关不掉，一直浮在页面上。
         （和 $() 里「根节点自身也要比一次」是同一类坑。） */
      var wrap = document.createElement('div');
      wrap.className = 'cr-scope cr-portal';
      document.body.appendChild(wrap);
      wrap.appendChild(n);
      portalNodes.push(wrap);
      ROOTS.push(wrap);
    });
  }

  function mount(host) {
    if (mounted) return;
    mounted = true;

    host.classList.add('cr-page', 'cr-scope');
    host.innerHTML = PAGE_HTML;
    ROOTS.push(host);
    buildPortals();

    /* 半挂载是最难排查的失败形态：外壳渲染出来了、浮层也建好了，
       但一个子渲染器都没跑，页面上只有一片「--」，而且异常被 Vue 的
       生命周期钩子吞掉后控制台不一定会报。所以这里必须兜住并摊到页面上。 */
    try {
      bind();
      switchView('grid');
      // 先渲染空壳，再拉真实数据；拉不到就显示明确的空态/错误态，绝不用假数据兜底
      renderAll();
      loadRealData();
    } catch (e) {
      console.error('[course-resources] 初始化失败:', e);
      if (host) {
        host.innerHTML = '<div style="padding:24px 20px;color:#ff4d4f;'
          + 'font:400 14px/1.7 Inter,PingFang SC,Microsoft YaHei,system-ui">'
          + '<b>课程资源管理页初始化失败</b><br>'
          + (e && e.message ? e.message : String(e))
          + '<pre style="margin:10px 0 0;white-space:pre-wrap;font-size:12px;color:#909399">'
          + (e && e.stack ? String(e.stack) : '(无堆栈)')
          + '</pre></div>';
      }
    }
  }

  function unmount() {
    if (!mounted) return;
    mounted = false;
    window.removeEventListener('keydown', onKeydown);
    portalNodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    portalNodes = [];
    ROOTS = [];
    // 复位筛选状态：下次进来不该还停在上一轮的搜索词/筛选上
    state.semester = 'ALL';
    state.category = 'ALL';
    state.course = 'ALL';
    state.search = '';
    state.sort = 'newest';
    state.view = 'grid';
    state.selectedIds.clear();
    activePreviewItem = null;
    resources = [];
    courses = [];
  }

  window.CourseResources = { mount: mount, unmount: unmount };
})();
