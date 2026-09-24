"""教师端课程管理接口（/api/v1/course/*）。

对接 teacher-frontend/src/api/system/course-api.ts 与 course-content-api.ts：
  - GET    /list           课程列表（前端自行筛选分页），可按 status 过滤
  - GET    /get            课程详情
  - POST   /create         新增课程
  - POST   /update         修改课程（含启停）
  - DELETE /delete         删除课程（连带删除正式内容）
  - POST   /save-content   覆盖保存课程正式内容（按 courseCode 定位课程）
  - GET    /content-summary 回读课程内容汇总（从已保存内容重建，前端按空容器容错）

约定：
  - 成功响应统一 StandardResponse(code=0)（教师端 request.ts 只认 code=0）；
  - 未登录返回 HTTP 200 + code=40100（教师端拦截器跳登录页）；
  - 课程编码规则与前端一致：字母/数字/下划线/连字符；状态仅 draft / active。
"""
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.crud.crud_course import course, course_content
from app.db.database import get_db
from app.models.course import Course, CourseContent
from app.models.user import User
from app.schemas.course import (
    CourseContentSummary,
    CourseCreateRequest,
    CourseUpdateRequest,
    CourseVO,
    SaveContentRequest,
)
from app.schemas.response import StandardResponse

logger = logging.getLogger(__name__)

router = APIRouter()


def _ok(data: Any, message: str = "success") -> StandardResponse:
    """统一成功包装：code=0 与教师端约定一致（区别于原有后端 code=200）。"""
    return StandardResponse(code=0, message=message, data=data)


def _unauthorized() -> StandardResponse:
    """未登录响应：HTTP 200 + code=40100，教师端拦截器据此跳登录页。"""
    return StandardResponse(code=40100, message="未登录")


def _vo(c: Course) -> CourseVO:
    """ORM 课程转对外视图（时间序列化为 ISO 字符串）。"""
    return CourseVO(
        id=c.id,
        courseCode=c.course_code,
        title=c.title,
        description=c.description,
        coverUrl=c.cover_url,
        status=c.status,
        meta=c.meta or {},
        createTime=c.create_time.isoformat() if c.create_time else None,
        updateTime=c.update_time.isoformat() if c.update_time else None,
    )


# ------------------------------ 课程 CRUD ------------------------------

@router.get("/list", response_model=StandardResponse[List[CourseVO]])
def list_courses(request: Request, db: Session = Depends(get_db),
                 status: Optional[str] = None) -> StandardResponse[List[CourseVO]]:
    """课程列表（可按状态过滤），返回 CourseVO 数组（前端自行分页筛选）。"""
    if get_current_user(request, db) is None:
        return _unauthorized()
    rows = course.list_all(db, status=status)
    return _ok([_vo(c) for c in rows])


@router.get("/get", response_model=StandardResponse[CourseVO])
def get_course(request: Request, id: int, db: Session = Depends(get_db)) -> StandardResponse[CourseVO]:
    """课程详情。"""
    if get_current_user(request, db) is None:
        return _unauthorized()
    row = course.get_by_id(db, id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"课程不存在: {id}")
    return _ok(_vo(row))


@router.post("/create", response_model=StandardResponse[CourseVO])
def create_course(req: CourseCreateRequest, request: Request,
                  db: Session = Depends(get_db)) -> StandardResponse[CourseVO]:
    """新增课程：编码唯一性校验后落库。"""
    if get_current_user(request, db) is None:
        return _unauthorized()
    code = req.courseCode.strip()
    if course.get_by_code(db, code) is not None:
        raise HTTPException(status_code=400, detail=f"课程编码已存在: {code}")
    row = course.create(
        db, course_code=code, title=req.title.strip(),
        description=req.description, cover_url=req.coverUrl,
        status=req.status, meta=req.meta,
    )
    logger.info("教师端新增课程: id=%s code=%s", row.id, code)
    return _ok(_vo(row), message="创建课程成功")


@router.post("/update", response_model=StandardResponse[CourseVO])
def update_course(req: CourseUpdateRequest, request: Request,
                  db: Session = Depends(get_db)) -> StandardResponse[CourseVO]:
    """修改课程：编码不可与其他课程冲突（自身除外）。"""
    if get_current_user(request, db) is None:
        return _unauthorized()
    row = course.get_by_id(db, req.id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"课程不存在: {req.id}")
    code = req.courseCode.strip()
    dup = course.get_by_code(db, code)
    if dup is not None and dup.id != req.id:
        raise HTTPException(status_code=400, detail=f"课程编码已存在: {code}")
    row = course.update(
        db, row, course_code=code, title=req.title.strip(),
        description=req.description, cover_url=req.coverUrl,
        status=req.status, meta=req.meta,
    )
    logger.info("教师端更新课程: id=%s code=%s", row.id, code)
    return _ok(_vo(row), message="更新课程成功")


@router.delete("/delete", response_model=StandardResponse[None])
def delete_course(request: Request, id: int, db: Session = Depends(get_db)) -> StandardResponse[None]:
    """删除课程（连带删除其正式内容）。"""
    if get_current_user(request, db) is None:
        return _unauthorized()
    row = course.get_by_id(db, id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"课程不存在: {id}")
    course.delete(db, row)
    logger.info("教师端删除课程: id=%s code=%s", id, row.course_code)
    return _ok(None, message="删除课程成功")


# ------------------------------ 课程内容 ------------------------------

@router.post("/save-content", response_model=StandardResponse[None])
def save_content(req: SaveContentRequest, request: Request,
                 db: Session = Depends(get_db)) -> StandardResponse[None]:
    """覆盖保存课程正式内容（按 courseCode 定位课程，后保存覆盖前保存）。"""
    if get_current_user(request, db) is None:
        return _unauthorized()
    row = course.get_by_code(db, req.courseCode.strip())
    if row is None:
        raise HTTPException(status_code=404, detail=f"课程不存在: {req.courseCode}")
    course_content.upsert(
        db, course=row, title=req.title.strip(), html=req.html,
        knowledge_dict=req.knowledgeDict, chapter_dict=req.chapterDict,
        learning_path=req.learningPath, knowledge_graph_dict=req.knowledgeGraphDict,
    )
    logger.info("教师端保存课程内容: course_id=%s code=%s", row.id, row.course_code)
    return _ok(None, message="内容已保存")


@router.get("/content-summary", response_model=StandardResponse[CourseContentSummary])
def content_summary(request: Request, courseId: int,
                    db: Session = Depends(get_db)) -> StandardResponse[CourseContentSummary]:
    """课程内容汇总：从已保存内容重建各部件；未保存过的课程返回空容器。"""
    if get_current_user(request, db) is None:
        return _unauthorized()
    row = course.get_by_id(db, courseId)
    if row is None:
        raise HTTPException(status_code=404, detail=f"课程不存在: {courseId}")
    content = course_content.get_by_course_id(db, row.id)
    return _ok(_build_summary(row, content))


# ------------------------------ 汇总重建辅助 ------------------------------

def _build_summary(c: Course, content: Optional[CourseContent]) -> CourseContentSummary:
    """把 course + course_content 重建为前端契约的 CourseContentSummary。

    templateId / checkpointParadigm 取自课程 meta（生成器写入）；其余部件
    从各字典回读，未保存的部分一律返回空容器（前端按 ?./.length 容错）。
    """
    meta = c.meta or {}
    summary = CourseContentSummary(
        courseId=c.id,
        templateId=str(meta.get("templateId") or ""),
        checkpointParadigm=str(meta.get("checkpointParadigm") or "web"),
    )
    if content is None:
        return summary

    cd: Dict[str, Any] = content.chapter_dict or {}
    kd: Dict[str, Any] = content.knowledge_dict or {}
    kgd: Dict[str, Any] = content.knowledge_graph_dict or {}
    summary.scenes = content.scenes if isinstance(content.scenes, dict) else None

    summary.structure = _build_structure(cd)

    lp = content.learning_path
    if isinstance(lp, dict) and (lp.get("nodes") or lp.get("edges")):
        summary.learningPath = lp

    if content.html:
        summary.example = {"html": content.html}

    for key, kg in kgd.items():
        if not isinstance(kg, dict):
            continue
        summary.knowledgeGraphs.append({
            "sectionId": key,
            "sectionTitle": _section_title(kd, key),
            "nodes": kg.get("nodes") or [],
            "edges": kg.get("edges") or [],
        })

    for key, item in kd.items():
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or key)
        summary.knowledgePoints.append({
            "sectionId": key,
            "sectionTitle": title,
            "topicId": str(item.get("topic_id") or key),
            "title": title,
            "levels": item.get("levels") or [],
        })
        test = _extract_test(key, title, item)
        if test is not None:
            summary.sectionTests.append(test)

    for key, item in cd.items():
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or item.get("name") or key)
        test = _extract_test(key, title, item)
        if test is not None:
            summary.chapterTests.append(test)

    return summary


def _build_structure(cd: Dict[str, Any]) -> List[Dict[str, Any]]:
    """从 chapter_dict 重建章节树；章节自带 sections（字典或数组）时展开子节点。"""
    out: List[Dict[str, Any]] = []
    for key, item in cd.items():
        if not isinstance(item, dict):
            continue
        children: List[Dict[str, Any]] = []
        secs = item.get("sections")
        if isinstance(secs, dict):
            for sk, sitem in secs.items():
                if not isinstance(sitem, dict):
                    continue
                children.append({
                    "id": str(sitem.get("id") or sk),
                    "title": str(sitem.get("title") or sk),
                    "type": "section",
                })
        elif isinstance(secs, list):
            for s in secs:
                if not isinstance(s, dict):
                    continue
                sid = s.get("id") or s.get("key") or s.get("title")
                if not sid:
                    continue
                children.append({
                    "id": str(sid),
                    "title": str(s.get("title") or sid),
                    "type": "section",
                })
        out.append({
            "id": str(item.get("chapter_id") or key),
            "title": str(item.get("title") or item.get("name") or key),
            "type": "chapter",
            "children": children,
        })
    return out


def _section_title(kd: Dict[str, Any], key: str) -> str:
    """知识图谱的 sectionTitle：优先用知识点字典里的标题，否则用 key。"""
    item = kd.get(key)
    if isinstance(item, dict) and item.get("title"):
        return str(item["title"])
    return key


def _extract_test(node_id: str, node_title: str,
                  item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """从章节/知识点字典项提取测试题（TestProblem 形状）。

    测试内容可能在 test_content / test_json，或直接挂根层
    （description_md / start_code / checkpoints，见 TESTING_CODE_PARADIGM.md）。
    没有任何测试数据返回 None，避免给前端制造空的测试题条目。
    """
    test = item.get("test_content") if isinstance(item.get("test_content"), dict) else None
    test = test or (item.get("test_json") if isinstance(item.get("test_json"), dict) else None)
    has_test = bool(test) or bool(item.get("checkpoints") or item.get("description_md") or item.get("start_code"))
    if not has_test:
        return None
    t = test or item
    return {
        "id": str(t.get("id") or item.get("test_id") or node_id),
        "nodeId": node_id,
        "nodeTitle": node_title,
        "title": str(t.get("title") or item.get("title") or node_title),
        "descriptionMd": str(t.get("description_md") or t.get("descriptionMd") or ""),
        "startCode": t.get("start_code") or t.get("startCode"),
        "answer": t.get("answer"),
        "checkpoints": t.get("checkpoints") or item.get("checkpoints") or [],
        "testCases": t.get("test_cases") or t.get("testCases") or [],
    }
