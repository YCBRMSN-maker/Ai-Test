"""课程管理域的仓储实现。

数据访问一律走 SQLAlchemy ORM；Course 与 CourseContent 为 1:1 关系，
course_content 按 course_id 整体覆盖保存（后保存覆盖前保存）。
"""
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.course import Course, CourseContent


class CRUDCourse:
    """courses 表操作。"""

    def list_all(self, db: Session, status: Optional[str] = None) -> List[Course]:
        """课程列表（可选手工按状态过滤），按 id 升序。"""
        q = db.query(Course)
        if status:
            q = q.filter(Course.status == status)
        return q.order_by(Course.id.asc()).all()

    def get_by_id(self, db: Session, course_id: int) -> Optional[Course]:
        """按主键取课程。"""
        return db.query(Course).filter(Course.id == course_id).first()

    def get_by_code(self, db: Session, course_code: str) -> Optional[Course]:
        """按课程编码取课程（编码唯一）。"""
        return db.query(Course).filter(Course.course_code == course_code).first()

    def create(self, db: Session, *, course_code: str, title: str,
               description: Optional[str], cover_url: Optional[str],
               status: str, meta: Optional[Dict[str, Any]]) -> Course:
        """创建课程。"""
        db_obj = Course(
            course_code=course_code,
            title=title,
            description=description,
            cover_url=cover_url,
            status=status,
            meta=meta if meta is not None else {},
        )
        db.add(db_obj)
        db.commit()
        db.refresh(db_obj)
        return db_obj

    def update(self, db: Session, course: Course, *, course_code: str, title: str,
               description: Optional[str], cover_url: Optional[str],
               status: str, meta: Optional[Dict[str, Any]]) -> Course:
        """更新课程（update_time 由模型 onupdate 自动刷新）。"""
        course.course_code = course_code
        course.title = title
        course.description = description
        course.cover_url = cover_url
        course.status = status
        course.meta = meta if meta is not None else course.meta or {}
        db.add(course)
        db.commit()
        db.refresh(course)
        return course

    def delete(self, db: Session, course: Course) -> None:
        """删除课程（连带删除其正式内容，保持 1:1 一致性）。"""
        content = db.query(CourseContent).filter(
            CourseContent.course_id == course.id).first()
        if content is not None:
            db.delete(content)
        db.delete(course)
        db.commit()


class CRUDCourseContent:
    """course_content 表操作。"""

    def get_by_course_id(self, db: Session, course_id: int) -> Optional[CourseContent]:
        """按课程 ID 取内容。"""
        return db.query(CourseContent).filter(
            CourseContent.course_id == course_id).first()

    def upsert(self, db: Session, *, course: Course, title: str,
               html: Optional[str], knowledge_dict: Optional[Dict[str, Any]],
               chapter_dict: Optional[Dict[str, Any]],
               learning_path: Optional[Dict[str, Any]],
               knowledge_graph_dict: Optional[Dict[str, Any]],
               scenes: Optional[Dict[str, Any]] = None) -> CourseContent:
        """覆盖保存：course_id 已存在则整份更新，否则新建。

        scenes：OpenMAIC 式场景序列（可选），场景式生成器写入。
        """
        db_obj = self.get_by_course_id(db, course.id)
        if db_obj is None:
            db_obj = CourseContent(
                course_id=course.id,
                course_code=course.course_code,
                title=title,
            )
            db.add(db_obj)
        db_obj.course_code = course.course_code
        db_obj.title = title
        db_obj.html = html
        db_obj.knowledge_dict = knowledge_dict
        db_obj.chapter_dict = chapter_dict
        db_obj.learning_path = learning_path
        db_obj.knowledge_graph_dict = knowledge_graph_dict
        db_obj.scenes = scenes
        db.commit()
        db.refresh(db_obj)
        return db_obj


course = CRUDCourse()
course_content = CRUDCourseContent()
