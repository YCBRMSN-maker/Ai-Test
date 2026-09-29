"""课程管理域的 Pydantic 模型（camelCase DTO）。

与 teacher-frontend/src/api/system/course-api.ts 的 CourseForm / CoursePageVO、
course-content-api.ts 的 CourseContentSummary / SaveContentPayload 契约一致，
因此字段名直接用 camelCase（纯线上 DTO，不映射 ORM 列名）。
"""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class CourseVO(BaseModel):
    """课程视图（对齐前端 CoursePageVO / CourseForm，绝不含内部字段）。"""
    id: int
    courseCode: str
    title: str
    description: Optional[str] = None
    coverUrl: Optional[str] = None
    status: str = "draft"
    meta: Optional[Dict[str, Any]] = None
    createTime: Optional[str] = None
    updateTime: Optional[str] = None


class CourseCreateRequest(BaseModel):
    """新增课程请求。课程编码沿用前端规则：字母/数字/下划线/连字符。"""
    courseCode: str = Field(..., pattern=r"^[A-Za-z0-9_-]+$",
                            min_length=1, max_length=128, description="课程编码")
    title: str = Field(..., min_length=1, max_length=255, description="课程名称")
    description: Optional[str] = Field(None, max_length=500, description="课程说明")
    coverUrl: Optional[str] = Field(None, max_length=512, description="封面图 URL")
    status: str = Field("draft", pattern=r"^(draft|active)$", description="状态：draft/active")
    meta: Optional[Dict[str, Any]] = None


class CourseUpdateRequest(CourseCreateRequest):
    """更新课程请求：在新增字段之上带 id。"""
    id: int = Field(..., description="课程 ID")


class SaveContentRequest(BaseModel):
    """保存课程内容请求（对齐前端 SaveContentPayload）。

    以 courseCode 定位课程（课程编码唯一），内容整体覆盖式保存。
    """
    courseCode: str = Field(..., min_length=1, max_length=128, description="课程编码")
    title: str = Field(..., min_length=1, max_length=255, description="课程名称")
    html: Optional[str] = Field(None, description="总览/示例 HTML")
    knowledgeDict: Optional[Dict[str, Any]] = None
    chapterDict: Optional[Dict[str, Any]] = None
    learningPath: Optional[Dict[str, Any]] = Field(
        None, description="学习路径 { nodes, edges, dependentEdges }")
    knowledgeGraphDict: Optional[Dict[str, Any]] = None


class CourseContentSummary(BaseModel):
    """课程内容汇总（对齐前端 CourseContentSummary）。

    各部件从 course_content 各字典回读重建；字段形状保持前端契约，
    未保存的部分返回空容器（前端按 .length/?. 容错）。
    """
    courseId: int
    templateId: str = ""
    checkpointParadigm: str = "web"
    structure: List[Dict[str, Any]] = Field(default_factory=list)
    learningPath: Optional[Dict[str, Any]] = None
    example: Optional[Dict[str, Any]] = None
    knowledgeGraphs: List[Dict[str, Any]] = Field(default_factory=list)
    knowledgePoints: List[Dict[str, Any]] = Field(default_factory=list)
    sectionTests: List[Dict[str, Any]] = Field(default_factory=list)
    chapterTests: List[Dict[str, Any]] = Field(default_factory=list)
    scenes: Optional[Dict[str, Any]] = None  # OpenMAIC 式场景序列 {scenes: [...]}


class CourseArchiveFileVO(BaseModel):
    """手动存入的历史资料文件视图（课程资源管理页消费）。

    fileName 原样返回用户上传时的名字（可含中文/空格）；
    sizeBytes 单位字节，前端自行格式化。
    """
    id: int
    courseId: int
    courseCode: str = ""
    courseName: str = ""
    fileName: str
    sizeBytes: int = 0
    mimeType: Optional[str] = None
    category: str = "doc"
    notes: Optional[str] = None
    createTime: Optional[str] = None
