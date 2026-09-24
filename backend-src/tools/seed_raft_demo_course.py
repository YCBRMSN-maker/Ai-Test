# -*- coding: utf-8 -*-
"""造一门 CS-401《分布式系统与共识算法》演示课程（第09讲为 Raft）。

在 backend 容器内运行：
    docker cp _seed_raft.py ats-comp-backend:/tmp/_seed_raft.py
    docker exec ats-comp-backend python /tmp/_seed_raft.py
"""
import sys
import json

sys.path.insert(0, "/app/backend")

from app.db.database import SessionLocal                     # noqa: E402
from app.crud.crud_course import course as crud_course       # noqa: E402
from app.crud.crud_course import course_content as crud_cc   # noqa: E402
from app.models.course import Course                         # noqa: E402

COURSE_CODE = "CS-401"
COURSE_TITLE = "分布式系统与共识算法"

# 9 讲：标题 / 三小节 / 要点（要点用来生成讲解页与测验）
LECTURES = [
    dict(
        title="分布式系统导论与体系结构",
        sections=["从单机到分布式：动机与场景", "分布式系统的核心挑战", "典型架构与部署形态"],
        points=[
            "分布式系统 = 一组通过网络协作的独立计算机，对外表现为单一系统",
            "三大动机：可扩展性、容错高可用、地理就近与低延迟",
            "核心挑战：网络不可靠、节点随时故障、物理时钟不同步、并发没有全局序",
            "典型形态：客户端-服务器、对等网络、微服务、无共享集群",
        ],
    ),
    dict(
        title="CAP 定理与一致性权衡",
        sections=["CAP 三角的准确含义", "一致性与可用性的取舍", "BASE 与最终一致性"],
        points=[
            "CAP：网络分区发生时，一致性（C）与可用性（A）不可兼得，只能二选一",
            "CA 系统只在无分区的单机/局域场景成立，广域分布式必须容忍 P",
            "CP 选择一致性：分区时拒绝写入，如 ZooKeeper、etcd",
            "AP 选择可用性：分区时降级为最终一致，如 Cassandra、Dynamo",
        ],
    ),
    dict(
        title="一致性模型与线性一致性",
        sections=["线性一致性", "顺序一致性与因果一致性", "客户端会话保证"],
        points=[
            "线性一致：所有操作表现为在某个全局时间点原子生效，且尊重真实时间先后",
            "顺序一致：存在一个全局顺序，但不必与真实时钟一致",
            "因果一致：只保证有因果关系的操作被所有节点按同序看到",
            "会话保证：读己之写、单调读、单调写，缓解最终一致的观感问题",
        ],
    ),
    dict(
        title="时间、逻辑时钟与因果序",
        sections=["物理时钟与 NTP 校正", "Lamport 逻辑时钟", "向量时钟与因果判定"],
        points=[
            "物理时钟受漂移与 NTP 校正影响，不能作为分布式全序的依据",
            "Lamport 逻辑时钟：每个事件打计数，消息携带计数并取 max+1，给出偏序",
            "向量时钟：每个节点维护长度 N 的计数向量，可判定并发与因果",
            "因果序是分布式系统的「真序」，全序需要共识算法来构造",
        ],
    ),
    dict(
        title="复制技术与状态机复制",
        sections=["主从复制与多副本", "状态机复制模型", "复制日志与快照"],
        points=[
            "复制提升可用性与读吞吐，但引入一致性代价",
            "状态机复制：确定性状态机 + 相同初始状态 + 相同操作序列 → 相同状态",
            "复制日志是操作序列的载体，日志一致即可保证副本一致",
            "快照与日志压缩：避免日志无限增长，加快新副本追赶",
        ],
    ),
    dict(
        title="Paxos 共识算法",
        sections=["Paxos 的提案与批准", "Multi-Paxos 与领导者", "Paxos 的工程难题"],
        points=[
            "Paxos 用多数派两阶段（Prepare / Accept）保证单值达成一致",
            "提案编号单调递增，多数派交集保证不会同时批准两个不同值",
            "Multi-Paxos 选出一个稳定领导者，跳过 Prepare 阶段提升吞吐",
            "工程难题：活锁、乱序、状态机难以实现，催生了 Raft",
        ],
    ),
    dict(
        title="分布式事务与两阶段提交",
        sections=["两阶段提交 2PC", "三阶段提交与补偿事务", "分布式事务的工程实践"],
        points=[
            "2PC：协调者先 Prepare 再 Commit，任一参与者拒绝则整体回滚",
            "2PC 的缺陷：协调者单点阻塞、参与者长时间持锁",
            "3PC 引入预提交与超时缓解阻塞，但仍无法彻底解决分区问题",
            "工程实践：Saga 补偿、TCC、基于共识的复制事务",
        ],
    ),
    dict(
        title="故障检测与领导者选举",
        sections=["故障模型与心跳机制", "租约与选举超时", "脑裂与多数派约束"],
        points=[
            "故障模型：崩溃-停止、崩溃-恢复、拜占庭；工程上多假设崩溃-恢复",
            "心跳与超时：超时阈值要在误判与检测延迟之间折中",
            "租约机制：用带期限的授权避免频繁选举，但依赖时钟假设",
            "多数派约束：任何决策需过半节点同意，杜绝脑裂下的双主",
        ],
    ),
    dict(
        title="Raft共识算法原理与分布式领导者选举实现",
        sections=["Raft 的角色、任期与状态", "领导者选举的完整流程", "日志复制与安全性约束"],
        points=[
            "Raft 把共识拆成三块：领导者选举、日志复制、安全性，用强领导者简化推理",
            "三种角色：Leader / Follower / Candidate；任期（term）单调递增作为逻辑时钟",
            "选举：Follower 超时未收心跳 → 转 Candidate → 拉票 → 过半即当选",
            "日志复制：Leader 收到写请求先落本地日志，再 AppendEntries 并行复制到多数派后提交",
            "安全性：选举限制（日志不够新不能当选）+ 提交规则（只能提交当前任期的日志）",
            "工程实现：etcd、TiKV、Consul 均以 Raft 为共识内核",
        ],
        formulas=[
            "共识 = 领导者选举 + 日志复制 + 安全性",
            "term 单调递增，小 term 一律退让",
            "当选条件：得票 > ⌊N/2⌋",
            "提交条件：日志已复制到多数派 且 属于当前 term",
            "选举限制：candidate 的日志至少与多数派一样新",
            "心跳间隔 << 选举超时，抑制无谓选举",
        ],
    ),
]


# ---- 课程级数据（OBE 教学大纲用；写进每份大纲材料，供 A4 文档预览器渲染）----
COURSE_INFO = {
    "name": COURSE_TITLE, "code": COURSE_CODE,
    "credit": "3.0", "hours": "48", "teacher": "张明",
    "major": "计算机科学与技术 / 软件工程",
}
ASSESSMENT = [
    {"name": "平时作业", "weight": 15},
    {"name": "课堂测验", "weight": 15},
    {"name": "实验报告", "weight": 20},
    {"name": "期末闭卷考试", "weight": 50},
]
OBE_MATRIX = [
    {"goal": "目标 1：掌握分布式系统核心原理",
     "indicator": "1.2 能运用数学与工程知识分析复杂工程问题", "level": "H"},
    {"goal": "目标 2：能实现并验证共识算法",
     "indicator": "3.2 能设计 / 开发满足特定需求的系统", "level": "M"},
    {"goal": "目标 3：具备容错与性能权衡能力",
     "indicator": "4.3 能在设计中考虑安全、健康、法律等约束", "level": "L"},
]
MEMO = [
    "第 1–4 周重在建立「一致性模型 / 因果序」的直觉，不要过早陷入 Paxos 细节。",
    "第 5–6 周安排一次课堂辩论：CP 还是 AP？结合真实系统（etcd / Cassandra）举证。",
    "第 9 周 Raft 是本课程重点，务必让学生动手实现领导者选举与日志复制。",
    "期末复习课串讲四条主线：多数派、任期、选举限制、提交规则。",
]


def _schedule():
    """16 周进度：前 9 周逐讲推进，其后安排实验 / 复习 / 答辩。"""
    tail = [
        ("综合实验一：实现 Raft 领导者选举", "实验"),
        ("综合实验二：日志复制与快照", "实验"),
        ("分布式事务与 Saga 案例研讨", "研讨"),
        ("期末复习：考点串讲", "讲授"),
        ("课程设计中期检查", "答辩"),
        ("课程设计终期答辩", "答辩"),
        ("期末闭卷考试", "考试"),
    ]
    rows = []
    for i in range(16):
        if i < len(LECTURES):
            rows.append({"week": i + 1, "topic": LECTURES[i]["title"], "mode": "讲授 + 研讨"})
        else:
            t, m = tail[i - len(LECTURES)]
            rows.append({"week": i + 1, "topic": t, "mode": m})
    return rows


def scene_slides(no, title, points, formulas=None):
    formulas = formulas or []
    slides = [{"title": "%s · 导览" % title,
               "bullets": ["本讲目标与知识地图", "关键概念与术语", "与前后讲的衔接"],
               "boardNotes": ["板书：本讲在课程脉络中的位置", "标注先修知识点与后续衔接"],
               "teacherNotes": ["用 1 分钟说明本讲要解决的问题。", "点出与上一讲、下一讲的衔接。"]}]
    for i, p in enumerate(points):
        slides.append({
            "title": "要点 %d" % (i + 1),
            "bullets": [p],
            "formula": (formulas[i] if i < len(formulas) else None),
            "boardNotes": ["板书推导：%s" % p[:36], "标注关键前提、边界条件与常见误区"],
            "teacherNotes": ["先抛出问题，再给出结论。", "结合板书逐步推导，随时确认学生跟上。"],
        })
    slides.append({"title": "小结", "bullets": ["回顾本讲关键结论", "课后思考与练习"],
                   "boardNotes": ["板书：本讲结论汇总 + 与下一讲的接口"],
                   "teacherNotes": ["串起本讲主线，布置课后任务与预习范围。"]})
    return {"key": "ch%d-slides" % no, "type": "slides",
            "title": "%s · 讲解" % title, "slides": slides}


def scene_quiz(no, title, points):
    qs = []
    for i, p in enumerate(points[:3]):
        qs.append({
            "question": "关于「%s」，下列说法正确的是？" % p.split("：")[0][:34],
            "options": ["%s" % p[:52], "与上述结论完全相反的说法",
                        "该结论仅在单机场景成立", "以上都不对"],
            "answer": 0,
            "points": [10, 15, 20][i % 3],
            "explanation": "正确选项即本讲的核心结论：%s" % p[:60],
            "rubric": ["选对得满分", "错选、多选不得分", "漏选按 0 分计"],
        })
    return {"key": "ch%d-quiz" % no, "type": "quiz",
            "title": "%s · 测验" % title, "questions": qs,
            "stats": {"pass": 82 + no, "avg": 72 + no, "max": 94 + (no % 4)}}


def scene_code(no, title):
    main_py = (
        "# 第%d讲 实验工程 · %s\n"
        "from raft.core import RaftNode\n\n\n"
        "def build_cluster(n: int = 5):\n"
        "    \"\"\"构建一个 n 节点的 Raft 集群。\"\"\"\n"
        "    peers = list(range(n))\n"
        "    return [RaftNode(node_id=i, peers=peers) for i in peers]\n\n\n"
        "def main() -> None:\n"
        "    nodes = build_cluster()\n"
        "    leader = nodes[0].start_election()\n"
        "    print(\"elected leader:\", leader.node_id)\n\n\n"
        "if __name__ == \"__main__\":\n"
        "    main()\n"
    ) % (no, title)
    core_py = (
        "class RaftNode:\n"
        "    \"\"\"Raft 节点：角色、任期与日志。\"\"\"\n\n"
        "    FOLLOWER, CANDIDATE, LEADER = 0, 1, 2\n\n"
        "    def __init__(self, node_id, peers):\n"
        "        self.node_id = node_id\n"
        "        self.peers = peers\n"
        "        self.role = self.FOLLOWER\n"
        "        self.current_term = 0\n"
        "        self.voted_for = None\n"
        "        self.log = []\n\n"
        "    def start_election(self):\n"
        "        self.role = self.CANDIDATE\n"
        "        self.current_term += 1\n"
        "        votes = 1\n"
        "        for peer in self.peers:\n"
        "            if peer != self.node_id:\n"
        "                votes += 1  # 简化：假定投票请求均被批准\n"
        "        if votes > len(self.peers) // 2:\n"
        "            self.role = self.LEADER\n"
        "        return self\n"
    )
    cfg = (
        "{\n"
        "  \"election_timeout_ms\": [150, 300],\n"
        "  \"heartbeat_interval_ms\": 50,\n"
        "  \"cluster_size\": 5,\n"
        "  \"snapshot_threshold\": 1000\n"
        "}\n"
    )
    test_py = (
        "from main import build_cluster\n\n\n"
        "def test_cluster_size():\n"
        "    assert len(build_cluster(5)) == 5\n\n\n"
        "def test_elect_leader():\n"
        "    nodes = build_cluster()\n"
        "    leaders = [n for n in nodes if n.start_election().role == 2]\n"
        "    assert leaders, \"至少应选出一个领导者\"\n"
    )
    return {
        "key": "ch%d-code" % no, "type": "code",
        "title": "%s · 编程练习" % title,
        "description": "本讲实验工程源码：实现核心机制的最小可运行版本。",
        "fileName": "main.py",
        "initialCode": main_py,
        "files": [
            {"name": "main.py", "code": main_py},
            {"name": "raft/core.py", "code": core_py},
            {"name": "config.json", "code": cfg},
            {"name": "tests/test_election.py", "code": test_py},
        ],
        "console": [
            "$ python -m pytest tests/ -q",
            "collected 2 items",
            "..",
            "2 passed in 0.41s",
            "$ python main.py",
            "elected leader: 0",
        ],
        "testCases": [{"input": "cluster_size=5", "expected": "elected leader: 0"}],
    }


_DEMO_CSS = (
    "*{box-sizing:border-box}"
    "body{margin:0;padding:18px 20px;font:14px/1.7 'PingFang SC','Microsoft YaHei',system-ui,sans-serif;color:#1e293b;background:#f8fafc}"
    "h2{margin:0 0 3px;font-size:17px}.sub{margin:0 0 14px;font-size:12.5px;color:#64748b}"
    ".panel{background:#fff;border:1px solid #e6e9f0;border-radius:12px;padding:13px 15px;margin-bottom:11px}"
    ".row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}"
    "button{font:inherit;font-size:12.5px;padding:6px 13px;border-radius:9px;border:1px solid #dbe2ee;background:#fff;color:#334155;cursor:pointer}"
    "button:hover{border-color:#2f5fff;color:#2f5fff}"
    "button.primary{background:#1e293b;border-color:#1e293b;color:#fff}"
    "button.primary:hover{background:#2f5fff;border-color:#2f5fff;color:#fff}"
    "input[type=range]{width:170px;vertical-align:middle}"
    ".nodes{display:flex;gap:9px;flex-wrap:wrap;margin-top:11px}"
    ".node{width:92px;padding:9px 6px;border-radius:11px;border:2px solid #e2e8f0;background:#fff;text-align:center;font-size:11.5px;transition:.25s}"
    ".node b{display:block;font-size:12.5px;margin-bottom:2px}"
    ".node.candidate{border-color:#f59e0b;background:#fffbeb}"
    ".node.leader{border-color:#22c55e;background:#f0fdf4}"
    ".node.dead{border-color:#fca5a5;background:#fef2f2;color:#b91c1c}"
    ".node.voted{border-color:#60a5fa;background:#eff6ff}"
    ".log{margin-top:11px;background:#0f172a;color:#cbd5e1;border-radius:10px;padding:9px 12px;font:11.5px/1.75 'SF Mono',Consolas,monospace;max-height:140px;overflow:auto}"
    ".log b{color:#7dd3fc}"
    ".stat{display:flex;gap:18px;font-size:12.5px;color:#475569;margin-top:9px;flex-wrap:wrap}"
    ".stat b{color:#1e293b}"
    ".chip{font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid #e2e8f0;background:#fff;color:#475569;margin:0 6px 6px 0;display:inline-block}"
    ".chip.on{border-color:#2f5fff;color:#2f5fff;background:#eff6ff}"
)


def _demo(title, subtitle, body, script):
    return ("<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
            "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<title>__T__ · 交互演示</title><style>" + _DEMO_CSS + "</style></head><body>"
            "<h2>__T__</h2><p class=\"sub\">" + subtitle + "</p>" + body +
            "<script>" + script + "</script></body></html>").replace("__T__", title)


# 每讲一个真正可交互的演示（不是占位）。key = 讲号。
_DEMOS = {
    1: (
        "点击节点可「拔网线」，观察系统在部分节点失联时是否仍能对外服务。",
        '<div class="panel"><div class="row"><button class="primary" id="ping">发送请求</button>'
        '<button id="reset">全部恢复</button></div><div class="nodes" id="nodes"></div>'
        '<div class="stat">存活 <b id="alive">5</b>/5　·　请求结果 <b id="res">—</b></div>'
        '<div class="log" id="log"></div></div>',
        "var N=5,dead={};function render(){var h='';for(var i=0;i<N;i++)h+='<div class=\"node'+(dead[i]?' dead':'')+'\" data-i=\"'+i+'\"><b>节点 '+i+'</b>'+(dead[i]?'已失联':'在线')+'</div>';"
        "document.getElementById('nodes').innerHTML=h;document.getElementById('alive').textContent=N-Object.keys(dead).length;}"
        "function log(t){var l=document.getElementById('log');l.innerHTML+='<div>'+t+'</div>';l.scrollTop=l.scrollHeight;}"
        "document.getElementById('nodes').onclick=function(e){var n=e.target.closest('[data-i]');if(!n)return;var i=+n.dataset.i;"
        "if(dead[i])delete dead[i];else dead[i]=1;log((dead[i]?'节点 '+i+' 失联':'节点 '+i+' 恢复'));render();};"
        "document.getElementById('reset').onclick=function(){dead={};render();log('全部节点已恢复');};"
        "document.getElementById('ping').onclick=function(){var a=N-Object.keys(dead).length;"
        "var ok=a>N/2;document.getElementById('res').textContent=ok?'成功（多数派 '+a+'/'+N+' 可用）':'失败（只剩 '+a+'/'+N+'，未过半数）';"
        "log('收到请求 → 需要多数派('+Math.floor(N/2)+'+1)，实际存活 '+a+' → '+(ok?'<b>成功</b>':'<b>拒绝</b>'));};render();"
    ),
    2: (
        "网络分区发生时，一致性（C）与可用性（A）只能保一个。切换看看各自会发生什么。",
        '<div class="panel"><div class="row"><button id="cap-c" class="primary">选择一致性 C</button>'
        '<button id="cap-a">选择可用性 A</button></div>'
        '<div class="stat">分区状态 <b id="part">未分区</b>　·　写入结果 <b id="res">—</b></div>'
        '<div class="log" id="log"></div></div>',
        "var mode='C';function log(t){var l=document.getElementById('log');l.innerHTML+='<div>'+t+'</div>';}"
        "function set(m){mode=m;document.getElementById('part').textContent='网络分区中（少数派与多数派失联）';"
        "if(m==='C'){document.getElementById('res').textContent='少数派拒绝写入，保证一致';log('CP：少数派<b>拒绝服务</b>，宁可不可用也不返回旧数据');}"
        "else{document.getElementById('res').textContent='少数派仍可写，但可能读到旧值';log('AP：少数派<b>继续服务</b>，代价是短暂不一致');}}"
        "document.getElementById('cap-c').onclick=function(){set('C');};document.getElementById('cap-a').onclick=function(){set('A');};"
    ),
    3: (
        "线性一致性要求：读到的值必须「不早于」写入真实生效的时间点。点击时间线验证。",
        '<div class="panel"><div class="row"><button class="primary" id="w">在 t=2 写入 X=1</button>'
        '<button id="r">在 t=4 读取 X</button></div>'
        '<div class="stat">时间线 <b id="tl">—</b>　·　判定 <b id="verdict">—</b></div>'
        '<div class="log" id="log"></div></div>',
        "var wrote=false,read=false;function log(t){var l=document.getElementById('log');l.innerHTML+='<div>'+t+'</div>';}"
        "document.getElementById('w').onclick=function(){wrote=true;document.getElementById('tl').textContent='写入 X=1 生效于 t=2';log('写入完成 → X=1 在 <b>t=2</b> 生效');};"
        "document.getElementById('r').onclick=function(){if(!wrote){document.getElementById('verdict').textContent='还没写入，读到 X=0 合法';log('t=4 读取 → 0（此时确实还没写入）');return;}"
        "document.getElementById('verdict').textContent='读到 X=1 → 线性一致 ✓';log('t=4 读取 → <b>1</b>（写入在 t=2 已生效，读到 1 才合法）');};"
    ),
    4: (
        "Lamport 逻辑时钟：消息携带计数、接收方取 max+1。点击发消息看计数怎么走。",
        '<div class="panel"><div class="row"><button class="primary" id="send">A → B 发一条消息</button>'
        '<button id="send2">B → C 发一条消息</button><button id="reset">重置</button></div>'
        '<div class="nodes" id="nodes"></div><div class="log" id="log"></div></div>',
        "var c=[0,0,0];function render(){var h='';for(var i=0;i<3;i++)h+='<div class=\"node\"><b>'+'ABC'[i]+'</b>时钟 '+c[i]+'</div>';document.getElementById('nodes').innerHTML=h;}"
        "function log(t){var l=document.getElementById('log');l.innerHTML+='<div>'+t+'</div>';}"
        "function send(a,b){c[a]++;c[b]=Math.max(c[a],c[b])+1;render();log('<b>'+'ABC'[a]+'</b> 发送(计数 '+c[a]+') → <b>'+'ABC'[b]+'</b> 取 max+1 → 本地时钟 '+c[b]);}"
        "document.getElementById('send').onclick=function(){send(0,1);};document.getElementById('send2').onclick=function(){send(1,2);};"
        "document.getElementById('reset').onclick=function(){c=[0,0,0];render();document.getElementById('log').innerHTML='';};render();"
    ),
    5: (
        "主从复制：写入先落主节点，再并行复制到从节点，多数派确认后才算提交。",
        '<div class="panel"><div class="row"><button class="primary" id="w">提交一次写入</button>'
        '<button id="reset">重置</button></div><div class="nodes" id="nodes"></div>'
        '<div class="stat">已提交日志 <b id="idx">0</b>　·　副本一致 <b id="sync">—</b></div>'
        '<div class="log" id="log"></div></div>',
        "var idx=0,f=[0,0,0];function render(){var h='';for(var i=0;i<3;i++)h+='<div class=\"node'+(i===0?' leader':'')+'\"><b>'+(i===0?'主节点':'从节点 '+i)+'</b>日志 '+f[i]+'</div>';"
        "document.getElementById('nodes').innerHTML=h;document.getElementById('idx').textContent=idx;}"
        "function log(t){var l=document.getElementById('log');l.innerHTML+='<div>'+t+'</div>';}"
        "document.getElementById('w').onclick=function(){idx++;f[0]=idx;log('写入 #'+idx+' → 主节点落盘');"
        "setTimeout(function(){f[1]=idx;log('→ 从节点 1 已复制');render();},250);"
        "setTimeout(function(){f[2]=idx;log('→ 从节点 2 已复制，<b>多数派确认，提交</b>');"
        "document.getElementById('sync').textContent='3/3 一致';render();},500);render();};"
        "document.getElementById('reset').onclick=function(){idx=0;f=[0,0,0];document.getElementById('log').innerHTML='';document.getElementById('sync').textContent='—';render();};render();"
    ),
    6: (
        "Paxos 两阶段：先 Prepare 抢提案编号，再 Accept 让多数派接受。",
        '<div class="panel"><div class="row"><button class="primary" id="p">1. Prepare(编号 n)</button>'
        '<button id="a">2. Accept(值 V)</button><button id="reset">重置</button></div>'
        '<div class="nodes" id="nodes"></div>'
        '<div class="stat">阶段 <b id="ph">空闲</b>　·　多数派 <b id="q">0</b>/3</div>'
        '<div class="log" id="log"></div></div>',
        "var n=0,acc=[0,0,0],ph='空闲';function render(){var h='';for(var i=0;i<3;i++)h+='<div class=\"node'+(acc[i]?' voted':'')+'\"><b>接受者 '+i+'</b>已接受编号 '+acc[i]+'</div>';"
        "document.getElementById('nodes').innerHTML=h;document.getElementById('q').textContent=acc.filter(function(x){return x;}).length;document.getElementById('ph').textContent=ph;}"
        "function log(t){var l=document.getElementById('log');l.innerHTML+='<div>'+t+'</div>';}"
        "document.getElementById('p').onclick=function(){n++;ph='Prepare 阶段';var ok=0;acc=acc.map(function(x){if(x<n){ok++;return n;}return x;});render();"
        "log('Prepare(n='+n+') → 收到 '+ok+' 个承诺（>1 即过半）');};"
        "document.getElementById('a').onclick=function(){if(!n){log('先执行 Prepare');return;}ph='Accept 阶段';log('Accept(n='+n+', V) → 多数派接受，<b>值 V 达成一致</b>');render();};"
        "document.getElementById('reset').onclick=function(){n=0;acc=[0,0,0];ph='空闲';document.getElementById('log').innerHTML='';render();};render();"
    ),
    7: (
        "两阶段提交：协调者先问「能提交吗」，全员同意才 Commit，否则 Abort。",
        '<div class="panel"><div class="row"><button class="primary" id="go">发起 2PC</button>'
        '<button id="fail">让参与者 2 投反对票</button><button id="reset">重置</button></div>'
        '<div class="nodes" id="nodes"></div>'
        '<div class="stat">结果 <b id="res">—</b></div><div class="log" id="log"></div></div>',
        "var fail=false,vote=[0,0,0];function render(){var h='';for(var i=0;i<3;i++)h+='<div class=\"node'+(vote[i]===1?' voted':vote[i]===-1?' dead':'')+'\"><b>参与者 '+i+'</b>'+(vote[i]===1?'同意':vote[i]===-1?'反对':'待投票')+'</div>';"
        "document.getElementById('nodes').innerHTML=h;}"
        "function log(t){var l=document.getElementById('log');l.innerHTML+='<div>'+t+'</div>';}"
        "document.getElementById('fail').onclick=function(){fail=!fail;log(fail?'参与者 2 将投<b>反对票</b>':'参与者 2 恢复同意');};"
        "document.getElementById('go').onclick=function(){vote=[1,1,1];if(fail)vote[2]=-1;render();log('Phase 1 Prepare → 投票：'+vote.join(', '));"
        "setTimeout(function(){var all=vote.every(function(v){return v===1;});document.getElementById('res').textContent=all?'Commit（全体同意）':'Abort（有反对票，整体回滚）';"
        "log('Phase 2 → <b>'+(all?'Commit':'Abort')+'</b>');},400);};"
        "document.getElementById('reset').onclick=function(){fail=false;vote=[0,0,0];document.getElementById('res').textContent='—';document.getElementById('log').innerHTML='';render();};render();"
    ),
    8: (
        "选举超时是「误判」与「发现延迟」的折中：调大调小各有什么代价？",
        '<div class="panel"><div class="row">选举超时 <input type="range" id="to" min="50" max="600" step="50" value="200">'
        '<b id="tov">200ms</b></div><div class="nodes" id="nodes"></div>'
        '<div class="stat">误判风险 <b id="fp">—</b>　·　发现延迟 <b id="lat">—</b></div>'
        '<div class="log" id="log"></div></div>',
        "function render(){var t=+document.getElementById('to').value;document.getElementById('tov').textContent=t+'ms';"
        "var fp=t<150?'高（网络抖动就会误触发选举）':t<300?'低（工程推荐区间 150–300ms）':'极低';"
        "var lat=t<150?'很快':t<300?'适中':'较慢（故障后要等更久才发现）';"
        "document.getElementById('fp').textContent=fp;document.getElementById('lat').textContent=lat;"
        "document.getElementById('nodes').innerHTML='<div class=\"node leader\"><b>Leader</b>每 50ms 心跳</div><div class=\"node\"><b>Follower</b>'+t+'ms 未收心跳即转 Candidate</div>';}"
        "document.getElementById('to').oninput=render;render();"
    ),
    9: (
        "Raft 领导者选举：Follower 超时 → 转 Candidate → 拉票 → 过半当选。点「开始选举」看全过程。",
        '<div class="panel"><div class="row"><button class="primary" id="go">开始选举</button>'
        '<button id="kill">停掉节点 3</button><button id="reset">重置</button></div>'
        '<div class="nodes" id="nodes"></div>'
        '<div class="stat">任期 term <b id="term">0</b>　·　领导者 <b id="leader">—</b>　·　得票 <b id="votes">0</b>/5</div>'
        '<div class="log" id="log"></div></div>',
        "var N=5,role=[],term=0,leader=-1,dead={};"
        "function init(){role=[];for(var i=0;i<N;i++)role.push('Follower');}"
        "function render(){var h='';for(var i=0;i<N;i++){var r=dead[i]?'dead':(i===leader?'leader':role[i].toLowerCase());"
        "h+='<div class=\"node '+r+'\"><b>节点 '+i+'</b>'+(dead[i]?'已停机':role[i])+'</div>';}"
        "document.getElementById('nodes').innerHTML=h;document.getElementById('term').textContent=term;"
        "document.getElementById('leader').textContent=leader<0?'—':'节点 '+leader;}"
        "function log(t){var l=document.getElementById('log');l.innerHTML+='<div>'+t+'</div>';l.scrollTop=l.scrollHeight;}"
        "function elect(){term++;var cand=-1;for(var i=0;i<N;i++)if(!dead[i]){cand=i;break;}"
        "if(cand<0){log('没有存活节点，无法选举');return;}"
        "role[cand]='Candidate';leader=-1;render();log('任期 term → <b>'+term+'</b>，节点 '+cand+' 超时未收心跳，转为 <b>Candidate</b>');"
        "var votes=1;var alive=[];for(var i=0;i<N;i++)if(!dead[i]&&i!==cand)alive.push(i);"
        "var k=0;(function step(){if(k>=alive.length)return;var v=alive[k++];"
        "if(Math.random()>0.15){votes++;log('节点 '+v+' 投票给 '+cand+'（当前 '+votes+'/'+N+'）');}"
        "else{log('节点 '+v+' 本轮未投票');}"
        "document.getElementById('votes').textContent=votes;"
        "if(votes>Math.floor(N/2)){role[cand]='Leader';leader=cand;render();log('得票 '+votes+' > 半数，<b>节点 '+cand+' 当选 Leader</b>');return;}"
        "setTimeout(step,320);})();}"
        "document.getElementById('go').onclick=function(){document.getElementById('votes').textContent='0';elect();};"
        "document.getElementById('kill').onclick=function(){dead[3]=dead[3]?0:1;if(dead[3]&&leader===3){leader=-1;log('Leader 节点 3 停机，集群将重新选举');}render();};"
        "document.getElementById('reset').onclick=function(){dead={};term=0;leader=-1;init();document.getElementById('votes').textContent='0';document.getElementById('log').innerHTML='';render();};"
        "init();render();"
    ),
}


def scene_interactive(no, title):
    sub, body, script = _DEMOS.get(no, _DEMOS[1])
    return {"key": "ch%d-interactive" % no, "type": "interactive",
            "title": "%s · 交互演示" % title,
            "description": sub, "html": _demo(title, sub, body, script)}


def scene_handout(no, title, points):
    """教学大纲与板书解析：一讲一份的「讲义型」材料。
    title 直接用讲标题（不带「· xxx」后缀），条目名就是「第09讲：Raft共识算法原理与…」。
    """
    return {
        "key": "ch%d-handout" % no, "type": "handout", "title": title,
        "description": "教学大纲与板书解析：含课程知识脉络图谱、期末考点批注、算法推导板书及课后作业答案。",
        "courseInfo": COURSE_INFO,
        "schedule": _schedule(),
        "assessment": ASSESSMENT,
        "obeMatrix": OBE_MATRIX,
        "memo": MEMO,
        "outline": ["本讲教学目标与重难点", "知识脉络与先修关系", "课堂板书推导要点", "课后作业与参考解答"],
        "boardNotes": points,
        "examPoints": ["期末高频考点：%s" % points[0][:28], "易错点：多数派与任期约束的边界条件"],
        "homework": ["实现本讲核心机制的最小可运行版本并提交实验报告",
                     "阅读指定论文并写一页读书笔记"],
    }


def scene_video(no, title, points):
    """课堂实录视频：章节打点 + 同步字幕（真实视频源需另行接入，这里给归档结构）。"""
    p0 = points[0] if points else ""
    p1 = points[1] if len(points) > 1 else ""
    chapters = [
        {"t": "00:00", "title": "课堂导入与本节目标"},
        {"t": "04:15", "title": "回顾上一讲：%s" % p0[:20]},
        {"t": "11:30", "title": "核心讲解：%s" % (p1[:20] or title[:20])},
        {"t": "23:40", "title": "板书推导与例题"},
        {"t": "36:05", "title": "课堂练习与答疑"},
    ]
    transcript = [
        {"t": "00:12", "text": "同学们好，本节我们讲「%s」。" % title},
        {"t": "00:48", "text": "先明确本节要解决的问题，再进入核心机制。"},
        {"t": "11:35", "text": "这里的关键是：%s" % p0[:38]},
        {"t": "23:52", "text": "我们把这个过程在板书上推一遍，注意边界条件。"},
        {"t": "36:20", "text": "最后留几分钟答疑，课后请完成实验与思考题。"},
    ]
    return {"key": "ch%d-video" % no, "type": "video",
            "title": "%s · 课堂实录" % title,
            "duration": "45:00", "chapters": chapters, "transcript": transcript}


def _section_md(title, points, si):
    """给一个小节生成 Markdown 讲义正文。
    素材只用本讲已有的要点（不编造额外事实），保证「讲义」和「讲解/测验」口径一致。"""
    ps = points[si::3] or points[:2]
    lines = ["## " + title, ""]
    for p in ps[:2]:
        lines.append("- " + p)
    lines += ["", "### 要点解析", ""]
    for p in ps[:2]:
        lines += ["**" + p.split("：")[0][:30] + "**", "", "> " + p, ""]
    lines += ["### 课堂小结", "",
              "本小节与前后小节共同构成本讲的知识脉络；复习时建议先复述上面的要点，再回到板书推导。", ""]
    return "\n".join(lines)


def build():
    chapter_dict = {}
    knowledge_dict = {}
    scenes = []
    lp_nodes, lp_edges = [], []

    for i, lec in enumerate(LECTURES):
        no = i + 1
        cid = "ch%d" % no
        chapter_dict[cid] = {
            "chapter_id": cid,
            "title": lec["title"],
            "sections": [{"id": "%s-%d" % (cid, si + 1), "title": st,
                          "md": _section_md(st, lec["points"], si)}
                         for si, st in enumerate(lec["sections"])],
        }
        knowledge_dict[cid] = {
            "title": lec["title"],
            "topic_id": cid,
            "levels": ["理解", "应用"],
        }
        scenes.append(scene_handout(no, lec["title"], lec["points"]))
        scenes.append(scene_slides(no, lec["title"], lec["points"], lec.get("formulas")))
        scenes.append(scene_quiz(no, lec["title"], lec["points"]))
        scenes.append(scene_code(no, lec["title"]))
        scenes.append(scene_interactive(no, lec["title"]))
        scenes.append(scene_video(no, lec["title"], lec["points"]))
        lp_nodes.append({"id": cid, "title": lec["title"]})
        if i:
            lp_edges.append({"source": "ch%d" % i, "target": cid})

    # 课程总览 HTML：定位 + 章节脉络 + 学习建议
    toc = "".join("<li><b>第%02d讲</b>　%s</li>" % (i + 1, l["title"])
                  for i, l in enumerate(LECTURES))
    html = (
        "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
        "<title>%s · 课程总览</title></head><body>"
        "<h1>%s</h1>"
        "<p class=\"sub\">CS-401 · 2024-2025 第一学期（秋）· 分布式系统与共识算法</p>"
        "<h2>课程定位</h2>"
        "<p>面向计算机专业高年级与研究生，系统讲解分布式系统的核心原理："
        "一致性模型、复制、共识算法（Paxos / Raft）、分布式事务与容错，"
        "配套可运行的代码实验与交互演示。</p>"
        "<h2>章节脉络</h2><ol>%s</ol>"
        "<h2>学习建议</h2>"
        "<p>先建立一致性模型与因果序的直觉，再进入 Paxos/Raft；"
        "务必动手实现一个简化版 Raft，领导者选举与日志复制各跑一遍。</p>"
        "</body></html>" % (COURSE_TITLE, COURSE_TITLE, toc)
    )

    # 知识图谱：一张课程级图谱（key = root，与既有课程保持一致）
    kg_nodes = [{"id": "ch%d" % (i + 1), "label": l["title"]}
                for i, l in enumerate(LECTURES)]
    kg_edges = [{"source": "ch%d" % i, "target": "ch%d" % (i + 1)}
                for i in range(1, len(LECTURES))]

    return {
        "html": html,
        "knowledge_dict": knowledge_dict,
        "chapter_dict": chapter_dict,
        "learning_path": {"nodes": lp_nodes, "edges": lp_edges,
                          "dependent_edges": lp_edges},
        "knowledge_graph_dict": {"root": {"nodes": kg_nodes, "edges": kg_edges}},
        "scenes": {"scenes": scenes},
    }


def main():
    db = SessionLocal()
    try:
        existing = db.query(Course).filter(Course.course_code == COURSE_CODE).first()
        if existing is not None:
            crud_course.delete(db, existing)
            print("已删除旧同名课程 id=%s" % existing.id)

        c = crud_course.create(
            db, course_code=COURSE_CODE, title=COURSE_TITLE,
            description="分布式系统核心原理：一致性、复制、Paxos/Raft 共识、分布式事务与容错。",
            cover_url=None, status="active",
            meta={"source": "demo", "templateId": "", "checkpointParadigm": "web",
                  "courseType": "distributed-systems",
                  "allowedRuntimes": ["web", "python"]},
        )
        print("已创建课程 id=%s code=%s title=%s" % (c.id, c.course_code, c.title))

        payload = build()
        crud_cc.upsert(db, course=c, title=COURSE_TITLE,
                       html=payload["html"],
                       knowledge_dict=payload["knowledge_dict"],
                       chapter_dict=payload["chapter_dict"],
                       learning_path=payload["learning_path"],
                       knowledge_graph_dict=payload["knowledge_graph_dict"],
                       scenes=payload["scenes"])
        print("已写入内容：%d 讲 / %d 个场景 / 总览 HTML %d 字"
              % (len(payload["chapter_dict"]), len(payload["scenes"]["scenes"]),
                 len(payload["html"])))

        # 归档时间设到 2024 年秋季 —— 学期由课程时间推导，
        # 这样前端才会显示「2024-2025 第一学期 (秋)」而不是当前年份。
        # 用裸 SQL 兜底：ORM 的 onupdate 会在 commit 时把 update_time 改回 now。
        from sqlalchemy import text
        for sql in (
            "UPDATE courses SET create_time='2024-09-02 09:30:00', "
            "update_time='2024-11-18 16:20:00' WHERE id=:i",
            "UPDATE course_content SET create_time='2024-09-02 09:30:00', "
            "update_time='2024-11-18 16:20:00' WHERE course_id=:i",
        ):
            db.execute(text(sql), {"i": c.id})
        db.commit()
        print("已将课程归档时间设为 2024-09（学期 → 2024-2025 第一学期 (秋)）")
    finally:
        db.close()


if __name__ == "__main__":
    main()
