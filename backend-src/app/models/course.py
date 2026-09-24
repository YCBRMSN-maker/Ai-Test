"""课程管理域的持久化模型。

对应 Go 侧 access-service 的 courses / course_content 两张表，对接教师端
teacher-frontend/src/api/system/course-api.ts 与 course-content-api.ts：

  - courses：课程主信息（编码、标题、状态、meta 等）；
  - course_content：一门课一份正式内容（总览 html、知识点字典、章节字典、
    学习路径、知识图谱字典），后一次保存覆盖前一次（见 DESIGN.md）。

约定：
  - 内部字段 snake_case，对外 DTO 一律 camelCase（见 app/schemas/course.py）；
  - status 取值 draft（停用）/ active（启用），与前端 list.vue 的启停切换一致；
  - meta 存放模板元数据（templateId / checkpointParadigm），由课程生成器写入。
"""
from datetime import datetime
import pytz
from sqlalchemy import Column, Integer, BigInteger, String, DateTime, JSON, Text
from app.db.base_class import Base


def _now() -> datetime:
    """当前时间（上海时区），用于各表的时间列默认值。"""
    return datetime.now(pytz.timezone('Asia/Shanghai'))


class Course(Base):
    """课程主信息。

    Attributes:
        id: 自增主键
        course_code: 课程编码（唯一，前端编码规则：字母/数字/下划线/连字符）
        title: 课程名称
        description: 课程说明
        cover_url: 封面图 URL
        status: draft=停用 / active=启用
        meta: 模板元数据（templateId、checkpointParadigm 等，JSON）
    """
    __tablename__ = "courses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    course_code = Column(String(128), unique=True, index=True, nullable=False)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    cover_url = Column(String(512), nullable=True)
    status = Column(String(32), nullable=False, default="draft")
    meta = Column(JSON, default=dict)
    create_time = Column(DateTime, default=_now, nullable=False)
    update_time = Column(DateTime, default=_now, onupdate=_now, nullable=False)


class CourseContent(Base):
    """课程正式内容（一门课一份，后保存覆盖前保存）。

    Attributes:
        course_id: 关联 courses.id（唯一）
        course_code / title: 冗余保存的课程标识，便于按编码回查
        html: 总览/示例 HTML
        knowledge_dict: 知识点内容字典（含 levels / test_content 等）
        chapter_dict: 章节内容字典（含测试题 test_json 等）
        learning_path: 学习路径 { nodes, edges, dependentEdges }
        knowledge_graph_dict: 每小节（知识点 id）的知识图谱 { nodes, edges }
        scenes: OpenMAIC 式场景序列（场景课件）：{ scenes: [{key, type,
            title, content/slides/questions/html ...}] }。type ∈
            slides（逐页讲解）/ quiz（测验，本地判题）/ interactive（交互 HTML）。
            由场景式生成器（LlmGenerator）写入；与上面传统部件并存，
            学生端场景播放器优先读取本字段渲染。
    """
    __tablename__ = "course_content"

    id = Column(Integer, primary_key=True, autoincrement=True)
    course_id = Column(Integer, unique=True, index=True, nullable=False)
    course_code = Column(String(128), index=True, nullable=False)
    title = Column(String(255), nullable=False)
    html = Column(Text, nullable=True)
    knowledge_dict = Column(JSON, nullable=True)
    chapter_dict = Column(JSON, nullable=True)
    learning_path = Column(JSON, nullable=True)
    knowledge_graph_dict = Column(JSON, nullable=True)
    scenes = Column(JSON, nullable=True)
    create_time = Column(DateTime, default=_now, nullable=False)
    update_time = Column(DateTime, default=_now, onupdate=_now, nullable=False)


class CourseArchiveFile(Base):
    """课程资源管理页「存入历史资料」手动上传的归档文件。

    与 course_content（课程生成器产出）并列的一条独立归档记录：
    原始文件落盘（ARCHIVE_FILES_DIR/<course_id>/），这里只存元数据，
    下载时按 stored_name 取回并以 file_name 作下载文件名。

    Attributes:
        course_id: 关联 courses.id（删除课程时不级联删文件，保留历史资料）
        file_name: 用户上传时的原始文件名（含扩展名，可含中文）
        stored_name: 落盘文件名（uuid 前缀防碰撞，扩展名保持不变）
        size_bytes: 文件字节数（BigInteger，>2GB 的文件也不溢出）
        mime_type: 浏览器上报的 MIME 类型（可能为空串，存 NULL）
        category: 资料类型标签，取值同上传弹窗的 radio：slides/quiz/
            code/interactive/md/doc（前端筛选胶囊按这个分桶）
        notes: 归档备注（选填）
    """
    __tablename__ = "course_archive_files"

    id = Column(Integer, primary_key=True, autoincrement=True)
    course_id = Column(Integer, index=True, nullable=False)
    file_name = Column(String(255), nullable=False)
    stored_name = Column(String(255), nullable=False)
    size_bytes = Column(BigInteger, nullable=False, default=0)
    mime_type = Column(String(255), nullable=True)
    category = Column(String(32), nullable=False, default="doc")
    notes = Column(Text, nullable=True)
    create_time = Column(DateTime, default=_now, nullable=False)
