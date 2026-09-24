from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List

class Settings(BaseSettings):
    """
    应用程序配置设置类，从环境变量或.env文件加载所有配置项。
    使用Pydantic进行数据验证和类型检查。

    包含服务器配置、API密钥、模型设置、数据库连接、文件路径等配置项。
    在应用启动时会自动验证必需的配置项是否存在。
    """
    # Server
    BACKEND_PORT: int = 8000

    # OpenAI (for chat completions)
    TUTOR_OPENAI_API_KEY: str = ""
    TUTOR_OPENAI_MODEL: str = "minimax-m2.7"
    TUTOR_OPENAI_API_BASE: str = "https://api.minimaxi.com/v1"


    # Embedding API (can be different from OpenAI)
    TUTOR_EMBEDDING_API_KEY: str = ""
    TUTOR_EMBEDDING_API_BASE: str = "https://api.minimaxi.com/v1"
    TUTOR_EMBEDDING_MODEL: str = "minimax-m2.7"

    # Translation API (can be different from OpenAI)
    TUTOR_TRANSLATION_API_KEY: str = ""
    TUTOR_TRANSLATION_API_BASE: str = "https://api.minimaxi.com/v1"
    TUTOR_TRANSLATION_MODEL: str = "minimax-m2.7"


    # Model configuration tells Pydantic where to find the .env file.
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding='utf-8',
        extra='ignore',
        case_sensitive=True
    )

    PROJECT_NAME: str = "Adaptive Tutor System"
    API_V1_STR: str = "/api/v1"

    # TODO: 到时候可能需要约束，不能放所有都进来
    BACKEND_CORS_ORIGINS: List[str] = ["*"]

    DATABASE_URL: str = "sqlite:///./app/db/database.db"

    # File paths
    DATA_DIR: str = "./app/data"
    DOCUMENTS_DIR: str = "./app/data/documents"
    VECTOR_STORE_DIR: str = "./app/data/vector_store"
    KB_ANN_FILENAME: str = "kb.ann"
    KB_CHUNKS_FILENAME: str = "kb_chunks.json"
    
    # ML Models paths
    MODELS_BASE_DIR: str = "./models"
    PROGRESS_CLUSTERING_MODEL_DIR: str = "./models/progress_clustering"

    # LLM Settings
    LLM_MAX_TOKENS: int = 65536
    LLM_TEMPERATURE: float = 0.7

    # Module enable/disable flags
    ENABLE_RAG_SERVICE: bool = False
    ENABLE_SENTIMENT_ANALYSIS: bool = False
    ENABLE_CLUSTERING_SERVICE: bool = False
    ENABLE_TRANSLATION_SERVICE: bool = False
    
    # Redis 配置
    REDIS_URL: str = "redis://localhost:6380/0"
    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6380
    # REDIS_PASSWORD: str = ""

    # Course Generation (coursegen) 课程生成引擎配置
    COURSEGEN_DEFAULT_TOKEN_BUDGET: int = 2000000      # 创建任务时的默认 token 预算，0 表示无上限
    COURSEGEN_MAX_TURNS: int = 200                     # driver 单次驱动最大回合数（防死循环兜底）
    COURSEGEN_TURN_GAP: float = 0.1                    # 两个 episode 之间的间隔（秒）；真实 LLM 场景仅防忙轮询
    COURSEGEN_DESIGN_REVIEW_FRACTION: float = 0.15     # 设计评审检查点：超过该比例预算后必须有 approved 评审
    COURSEGEN_MAX_REVIEW_ONLY_RUNS: int = 3            # 连续「只评审不干活」的最大轮数
    COURSEGEN_REVIEW_ONLY_TOKEN_THRESHOLD: int = 100   # 单轮 token 消耗低于该值视为「没干活」
    COURSEGEN_EPISODE_CONCURRENCY: int = 3             # dispatch_work 并发 worker 数
    COURSEGEN_MAX_PLANNER_ITERATIONS: int = 16         # planner 单轮 agent 循环最大迭代
    COURSEGEN_MAX_WORKER_ITERATIONS: int = 40          # worker 单次 agent 循环最大迭代
    COURSEGEN_QUEUE: str = "submit_queue"              # 驱动任务的 Celery 队列（先复用现有 worker）
    COURSEGEN_LLM_MODE: str = "openai"                 # LLM 客户端模式：openai=真实兼容接口 / mock=确定性脚本
    COURSEGEN_LOCAL_STEP_GAP: float = 3.2              # 本地生成：每章开始前的间隔（秒），5 章 + 组装 ≈ 20 秒
    COURSEGEN_OUTLINE_TIMEOUT_SECONDS: float = 60.0    # 一句话主题 → 大纲 的 LLM 调用超时（秒）
    COURSEGEN_LLM_TIMEOUT_SECONDS: float = 30.0        # LLM 引导生成：单章扩知识点的 LLM 调用超时（秒）
    COURSEGEN_SCENE_TIMEOUT_SECONDS: float = 90.0      # 场景式生成：单章生成场景内容的 LLM 调用超时（秒）

# Create a single, globally accessible instance of the settings.
# This will raise a validation error on startup if required settings are missing.
settings = Settings()
