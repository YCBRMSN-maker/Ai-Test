"""本地课程生成器：模板 → course.json，不调 LLM、可控时长。

替代原「多智能体 + DeepSeek」生成链路：不再需要 planner/worker 编排与模型调用，
直接从模板内容库（template_content.py）选取章节语料/测试题/知识图谱，组装出
满足发布契约的 course.json 并写入工作区。驱动循环（driver.py）看到产物落盘后
复用 Publisher 落库，SSE / draft 契约完全不变。

设计要点：
  - 章节标题、语料、测试题、知识图谱全部固定来自模板内容库，与所选模板语言
    严格一致（python 模板只产出 Python 知识点、c++ 模板只产出 C++ 知识点，
    不再用学习路径里的标题覆盖，避免混入其他主题内容）；
  - 每章开始前按 settings.COURSEGEN_LOCAL_STEP_GAP 停顿，加上组装间隙，
    把整体生成时长控制在 30 秒左右，保留「正在生成」的过程感；
  - 过程中用 harness.emit 推 plan_updated / stage_start / item_start /
    item_complete / stage_complete，让前端进度条与消息流有过程感。
"""
import json
import logging
import time
from typing import Any, Dict, List

from app.core.config import settings
from app.models.course_generation import CourseGenerationJob
from app.services.course_generation import state
from app.services.course_generation import template_content
from app.services.course_generation.harness import Harness

logger = logging.getLogger(__name__)

# 工作区里每个 block 正文的路径前缀（course.json 的 bodyPath 指向它们）
_BODY_PATH_PREFIX = "content"

# 组装 course.json 前的停顿（秒），配合章节间隔让整体时长贴近 30 秒
_BUILD_GAP_SECONDS = 3.0

# 模板 → 编程语言（课件/练习里要用）
_TEMPLATE_LANGUAGE = {
    "python-basic": "Python",
    "cpp-basic": "C++",
    "web-frontend": "JavaScript",
}


def _first_line(md: str, limit: int = 80) -> str:
    """取 Markdown 的第一行实质内容（跳过标题行与空行），当摘要用。"""
    for line in str(md or "").split("\n"):
        t = line.strip().lstrip("#").strip().lstrip("-*>").strip()
        if t:
            return t[:limit]
    return ""


def _slides_of(chapter: Dict[str, Any]) -> List[Dict[str, Any]]:
    """小节语料 → 逐页讲解（每页 title + content，与 llm_generator 同形）。"""
    return [{"title": str(s.get("title") or ""), "content": str(s.get("body_md") or "")}
            for s in (chapter.get("sections") or [])]


def _quiz_of(chapter: Dict[str, Any]) -> List[Dict[str, Any]]:
    """章节测试的 checkpoints → 单选题；没有检查点就按小节标题出概念题。"""
    t = chapter.get("test") if isinstance(chapter.get("test"), dict) else {}
    cps = [c for c in (t.get("checkpoints") or [])
           if c.get("input") not in (None, "") and c.get("expected_output") not in (None, "")]
    exps = [str(c.get("expected_output")) for c in cps]
    qs: List[Dict[str, Any]] = []
    for cp in cps[:4]:
        exp = str(cp.get("expected_output"))
        others = [e for e in exps if e != exp][:2]
        for fallback in ("无任何输出", "程序抛出异常"):
            if len(others) >= 2:
                break
            others.append(fallback)
        qs.append({
            "question": "运行本章示例程序，输入 %s 时正确的输出是？" % cp.get("input"),
            "options": [exp] + others[:2] + ["以上都不对"],
            "answer": 0,
            "explanation": str(cp.get("description") or ("输入 %s 应输出 %s" % (cp.get("input"), exp))),
            "points": 10,
            "rubric": ["选对得满分", "错选、多选不得分"],
        })
    if not qs:
        for s in (chapter.get("sections") or [])[:3]:
            title = str(s.get("title") or "")
            qs.append({
                "question": "关于「%s」，下列说法正确的是？" % title,
                "options": ["它是本章的知识点之一", "它与本章内容无关",
                            "它只出现在最后一章", "以上都不对"],
                "answer": 0,
                "explanation": "「%s」属于本章的知识点。" % title,
                "points": 10,
                "rubric": ["选对得满分", "错选、多选不得分"],
            })
    return qs


def _code_of(chapter: Dict[str, Any], language: str) -> Dict[str, Any]:
    """章节测试 → 实验工程源码（多文件 + 模拟控制台输出）。"""
    t = chapter.get("test") if isinstance(chapter.get("test"), dict) else {}
    cps = t.get("checkpoints") or []
    desc = str(t.get("description_md") or "").strip()
    start = str(t.get("start_code") or "").strip()
    main = "# %s\n# %s\n\n%s\n" % (t.get("title") or "编程练习", desc, start or "# 在此编写代码")
    cfg = "{\n  \"language\": \"%s\",\n  \"checkpoints\": %d\n}\n" % (language, len(cps))
    tests = [{"input": str(c.get("input") or ""), "expected": str(c.get("expected_output") or "")}
             for c in cps]
    console = ["$ run solution"]
    for c in cps[:3]:
        console.append("input> %s" % c.get("input"))
        console.append(str(c.get("expected_output") or ""))
    console.append("✓ 全部检查点通过" if cps else "（本练习未附带检查点）")
    return {
        "language": language,
        "description": desc or "完成本章的编程练习。",
        "initialCode": main,
        "expectedOutput": (str(cps[0].get("expected_output")) if cps else ""),
        "testCases": tests,
        "fileName": "solution.py",
        "files": [
            {"name": "solution.py", "code": main},
            {"name": "checkpoints.json", "code": cfg},
        ],
        "console": console,
    }


def _interactive_html(chapter: Dict[str, Any], index: int, language: str) -> str:
    """交互演示：自包含 HTML（内联 CSS/JS）—— 按检查点逐条「试运行」。"""
    t = chapter.get("test") if isinstance(chapter.get("test"), dict) else {}
    cps = t.get("checkpoints") or []
    title = str(chapter.get("title") or ("第 %d 章" % (index + 1)))
    buttons = "".join(
        "<button data-in=\"%s\" data-exp=\"%s\">输入 %s</button>"
        % (str(c.get("input")).replace('"', "&quot;"),
           str(c.get("expected_output")).replace('"', "&quot;"),
           str(c.get("input")).replace("<", "&lt;"))
        for c in cps
    ) or "<button data-in=\"—\" data-exp=\"—\">（本章暂无检查点）</button>"
    return (
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>" + title + " · 交互演示</title><style>"
        "*{box-sizing:border-box}"
        "body{margin:0;padding:18px 20px;font:14px/1.7 'PingFang SC','Microsoft YaHei',system-ui,sans-serif;color:#1e293b;background:#f8fafc}"
        "h2{margin:0 0 3px;font-size:17px}.sub{margin:0 0 14px;font-size:12.5px;color:#64748b}"
        ".panel{background:#fff;border:1px solid #e6e9f0;border-radius:12px;padding:14px 16px}"
        ".row{display:flex;gap:8px;flex-wrap:wrap}"
        "button{font:inherit;font-size:12.5px;padding:6px 13px;border-radius:9px;border:1px solid #dbe2ee;background:#fff;color:#334155;cursor:pointer}"
        "button:hover{border-color:#2f5fff;color:#2f5fff}button.on{background:#1e293b;border-color:#1e293b;color:#fff}"
        ".io{margin-top:12px;background:#0f172a;color:#cbd5e1;border-radius:10px;padding:11px 14px;font:12px/1.8 'SF Mono',Consolas,monospace;min-height:74px;white-space:pre-wrap}"
        ".io b{color:#7dd3fc}.io i{color:#86efac;font-style:normal}"
        "</style></head><body><h2>" + title + "</h2>"
        "<p class=\"sub\">点击任一输入，看这段 " + language + " 程序应该输出什么（依据本章检查点）。</p>"
        "<div class=\"panel\"><div class=\"row\">" + buttons + "</div>"
        "<div class=\"io\" id=\"io\">$ 等待运行…</div></div><script>"
        "var io=document.getElementById('io');"
        "document.querySelectorAll('button').forEach(function(b){b.onclick=function(){"
        "document.querySelectorAll('button').forEach(function(x){x.classList.remove('on');});b.classList.add('on');"
        "io.innerHTML='$ run solution\\ninput&gt; <b>'+b.dataset.in+'</b>\\n<i>'+b.dataset.exp+'</i>';};});"
        "</script></body></html>"
    )


def _handout_of(chapter: Dict[str, Any], course: Dict[str, Any],
                index: int, all_chapters: List[Dict[str, Any]]) -> Dict[str, Any]:
    """教学大纲与板书解析：从章节的小节/描述 + 课程级信息派生。

    courseInfo / schedule 都来自真实课程数据；assessment / obeMatrix 是**教学大纲模板的
    固定章节**（每份大纲都有这两节），不是对某门课的事实断言。
    """
    secs = chapter.get("sections") or []
    t = chapter.get("test") if isinstance(chapter.get("test"), dict) else {}
    return {
        "description": "教学大纲与板书解析：含知识脉络、考点批注、板书要点与课后作业。",
        "courseInfo": {
            "name": str(course.get("title") or ""),
            "credit": "3.0",
            "hours": str(len(all_chapters) * 8),
            "teacher": "课程组",
        },
        "schedule": [{"week": i + 1, "topic": str(c.get("title") or ""), "mode": "讲授 + 研讨"}
                     for i, c in enumerate(all_chapters)],
        "assessment": [
            {"name": "平时作业与考勤", "weight": 20},
            {"name": "章节测验与实验", "weight": 40},
            {"name": "期末综合项目", "weight": 40},
        ],
        "obeMatrix": [
            {"goal": "目标 1：掌握本课程核心知识",
             "indicator": "1.2 能运用数学与工程知识分析复杂工程问题", "level": "H"},
            {"goal": "目标 2：能动手实现并验证",
             "indicator": "3.2 能设计 / 开发满足特定需求的系统", "level": "M"},
            {"goal": "目标 3：具备工程协作与表达能力",
             "indicator": "9.2 能在团队中承担个体与负责人角色", "level": "L"},
        ],
        "memo": ["按小节顺序讲授，先建立直觉再讲实现细节。",
                 "每章结束后安排一次上机练习，巩固本章检查点。"],
        "outline": [str(s.get("title") or "") for s in secs],
        "boardNotes": ["%s：%s" % (s.get("title") or "", _first_line(s.get("body_md"), 60))
                       for s in secs],
        "examPoints": [str(t.get("title") or "本章测验"),
                       _first_line(t.get("description_md"), 60)],
        "homework": ["完成本章编程练习并提交实验报告", "复习本章小结并整理笔记"],
    }


def _video_of(chapter: Dict[str, Any]) -> Dict[str, Any]:
    """课堂实录：章节小节 → 章节打点 + 同步字幕。"""
    secs = chapter.get("sections") or []
    marks: List[Dict[str, str]] = [{"t": "00:00", "title": "课堂导入与本节目标"}]
    transcript: List[Dict[str, str]] = [
        {"t": "00:12", "text": "同学们好，本节我们讲「%s」。" % (chapter.get("title") or "")}]
    for i, s in enumerate(secs):
        mm = 4 + i * 7
        marks.append({"t": "%02d:%02d" % (mm, (i * 13) % 60), "title": str(s.get("title") or "")})
        transcript.append({"t": "%02d:%02d" % (mm, (i * 13) % 60),
                           "text": "接下来看「%s」：%s" % (s.get("title") or "",
                                                       _first_line(s.get("body_md"), 50))})
    marks.append({"t": "36:05", "title": "课堂练习与答疑"})
    transcript.append({"t": "36:20", "text": "最后留几分钟答疑，课后请完成练习与思考题。"})
    return {"duration": "45:00", "chapters": marks, "transcript": transcript}


class LocalGenerator:
    """本地生成器：把模板内容组装成可发布的 course.json。"""

    def __init__(self, harness: Harness) -> None:
        self.harness = harness
        self.repo = harness.repo

    # ------------------------------ 对外入口 ------------------------------

    def generate(self, job: CourseGenerationJob) -> None:
        """执行一次完整本地生成：组装课程并写入工作区。

        完成后由 driver 调 Publisher 落库；任何异常向上抛，driver 转 failed。
        """
        payload = job.request_payload if isinstance(job.request_payload, dict) else {}
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        # 前端创建任务时 config 用 camelCase 键 template（见 index.vue 一键体验流程），
        # 兼容 templateId / template_id / template 三种写法，取不到再兜底 web-frontend
        template_id = str(config.get("templateId") or config.get("template_id")
                          or config.get("template") or "web-frontend")
        course = template_content.get_course(template_id)
        if not course:
            # 未知模板兜底到 Web 前端，保证流程不中断
            logger.warning("coursegen: unknown template %s, fallback to web-frontend", template_id)
            template_id = "web-frontend"
            course = template_content.get_course(template_id)

        # 1. 计划快照（前端编排面板 / draft 回退展示用）
        plan = [
            {"item": ch["title"], "type": "chapter", "detail": "章节语料与测试题"}
            for ch in course["chapters"]
        ] + [{"item": "组装 course.json", "type": "build", "detail": "校验契约并落库"}]
        self.harness.update_plan(job, plan)

        # 2. 阶段开始（stage=harness → SSE stage_start）
        self.harness.emit(job, state.STAGE_HARNESS, state.EVENT_EPISODE_STARTED,
                          {}, "开始本地生成")

        # 3. 逐章写语料与测试题，同时收集 course.json 需要的结构。
        #    每章开始前停顿，让前端看到逐章推进、整体约 30 秒完成
        units: List[Dict[str, Any]] = []
        scenes: List[Dict[str, Any]] = []
        chapters = course["chapters"]
        language = _TEMPLATE_LANGUAGE.get(template_id, "Python")
        for index, chapter in enumerate(chapters):
            self._step_gap()
            self._generate_chapter(job, chapter, str(chapter["title"]), index,
                                   units, scenes, language, chapters, course)

        # 4. 组装 course.json 并写入工作区（留一点收尾停顿）
        self._step_gap(_BUILD_GAP_SECONDS)
        course_json = {
            "title": str(course["title"]),
            "description": str(course["description"]),
            "courseType": str(course["course_type"]),
            "allowedRuntimes": list(course.get("allowed_runtimes") or []),
            "units": units,
            "scenes": scenes,
            "knowledgeGraph": course["knowledge_graph"],
        }
        self.harness.write_workspace_file(
            job, "course.json", json.dumps(course_json, ensure_ascii=False, indent=2))

        # 5. 阶段完成（stage=harness → SSE stage_complete）
        self.harness.emit(job, state.STAGE_HARNESS, state.EVENT_EPISODE_FINISHED,
                          {}, "本地生成完成，等待发布")
        logger.info("coursegen: local generation done for job %s (template=%s, units=%d)",
                    job.job_uid, template_id, len(units))

    # ------------------------------ 内部 ------------------------------

    def _step_gap(self, seconds: float = 0.0) -> None:
        """章节间停顿：模拟生成过程，让整体时长贴近预期（可配置）。"""
        time.sleep(seconds if seconds > 0 else settings.COURSEGEN_LOCAL_STEP_GAP)

    def _generate_chapter(self, job: CourseGenerationJob, chapter: Dict[str, Any],
                          title: str, index: int, units: List[Dict[str, Any]],
                          scenes: List[Dict[str, Any]], language: str,
                          all_chapters: List[Dict[str, Any]],
                          course: Dict[str, Any]) -> None:
        """生成一个章节：写小节正文到工作区，组装 unit 结构 + 六类场景。

        六类场景（讲解 / 测验 / 编程练习 / 交互演示 / 教学大纲 / 课堂实录）缺一不可 ——
        少了哪一类，前端那一路资料就是空的。原来这里只写 unit、不写 scenes，
        于是新生成的课程在资源页上「什么都没有」。

        每章一个 item 进度（SSE item_start/item_complete），item 标题用于前端消息流。
        """
        key = str(chapter["key"])
        item_title = f"第{index + 1}章：{title}"
        self.harness.emit(job, state.STAGE_EPISODE, state.EVENT_EPISODE_STARTED,
                          {"item": item_title}, item_title)

        blocks: List[Dict[str, Any]] = []
        for j, section in enumerate(chapter.get("sections") or []):
            body_path = f"{_BODY_PATH_PREFIX}/{key}/s{j + 1}.md"
            self.harness.write_workspace_file(job, body_path, str(section["body_md"]))
            blocks.append({
                "kind": "corpus",
                "title": str(section["title"]),
                "bodyPath": body_path,
                "format": "markdown",
                "sortOrder": j + 1,
            })

        test = chapter.get("test")
        tests = [test] if isinstance(test, dict) else []
        units.append({
            "key": key,
            "title": title,
            "sortOrder": index + 1,
            "blocks": blocks,
            "tests": tests,
        })

        # ---- 六类场景：与 llm_generator 同形，前端预览器直接吃 ----
        slides = _slides_of(chapter)
        if slides:
            scenes.append({"key": f"{key}-slides", "type": "slides",
                           "title": f"{title} · 讲解", "slides": slides})
        quiz = _quiz_of(chapter)
        if quiz:
            scenes.append({"key": f"{key}-quiz", "type": "quiz",
                           "title": f"{title} · 测验", "questions": quiz})
        scenes.append({"key": f"{key}-code", "type": "code",
                       "title": f"{title} · 编程练习", **_code_of(chapter, language)})
        scenes.append({"key": f"{key}-interactive", "type": "interactive",
                       "title": f"{title} · 交互演示",
                       "description": "按检查点试运行本章示例程序。",
                       "html": _interactive_html(chapter, index, language)})
        scenes.append({"key": f"{key}-handout", "type": "handout",
                       "title": title,
                       **_handout_of(chapter, course, index, all_chapters)})
        scenes.append({"key": f"{key}-video", "type": "video",
                       "title": f"{title} · 课堂实录", **_video_of(chapter)})

        self.harness.emit(job, state.STAGE_EPISODE, state.EVENT_EPISODE_FINISHED,
                          {"item": item_title}, f"已完成：{item_title}")
