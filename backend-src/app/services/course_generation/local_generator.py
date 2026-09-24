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
        chapters = course["chapters"]
        for index, chapter in enumerate(chapters):
            self._step_gap()
            self._generate_chapter(job, chapter, str(chapter["title"]), index, units)

        # 4. 组装 course.json 并写入工作区（留一点收尾停顿）
        self._step_gap(_BUILD_GAP_SECONDS)
        course_json = {
            "title": str(course["title"]),
            "description": str(course["description"]),
            "courseType": str(course["course_type"]),
            "allowedRuntimes": list(course.get("allowed_runtimes") or []),
            "units": units,
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
                          title: str, index: int, units: List[Dict[str, Any]]) -> None:
        """生成一个章节：写小节正文到工作区，组装 unit 结构。

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

        self.harness.emit(job, state.STAGE_EPISODE, state.EVENT_EPISODE_FINISHED,
                          {"item": item_title}, f"已完成：{item_title}")
