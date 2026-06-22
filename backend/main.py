from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Text, Float, DateTime, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime, date as date_cls, timedelta
from collections import Counter, defaultdict
import jieba
import jieba.posseg as pseg
import re
import os
import statistics
import json
from dotenv import load_dotenv
import anthropic
import httpx
from google import genai as google_genai
from google.genai import types as genai_types

POSITIVE_EMOTIONS = {"joy", "gratitude", "love"}
NEUTRAL_EMOTIONS  = {"neutral", "surprise"}
NEGATIVE_EMOTIONS = {"anger", "contempt", "disgust", "fear", "frustration", "sadness"}
ALL_EMOTIONS = POSITIVE_EMOTIONS | NEUTRAL_EMOTIONS | NEGATIVE_EMOTIONS

try:
    from transformers import pipeline as hf_pipeline
    _emotion_pipe = hf_pipeline(
        "text-classification",
        model="tabularisai/multilingual-emotion-classification",
        top_k=None,
        device=-1,
    )
    print("[Emotion] 多维情绪模型加载完成")
except Exception as _e:
    _emotion_pipe = None
    print(f"[Emotion] 模型未加载：{_e}")

load_dotenv()
anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

gemini_api_key = os.getenv("GEMINI_API_KEY")
gemini_client = google_genai.Client(api_key=gemini_api_key) if gemini_api_key else None

# DeepSeek（OpenAI 兼容接口），目前仅用于「读者视角」。配置全走 .env。
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")


def _deepseek_chat(system: str, user: str, max_tokens: int) -> str:
    """调 DeepSeek chat/completions（OpenAI 兼容），返回正式回复文本。
    deepseek-v4-pro 是推理模型：reasoning_content 丢弃，只取 content；
    故 max_tokens 要给足（推理 token + 正文）。"""
    if not DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY 未配置")
    resp = httpx.post(
        f"{DEEPSEEK_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {DEEPSEEK_API_KEY}",
                 "Content-Type": "application/json"},
        json={
            "model": DEEPSEEK_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "max_tokens": max_tokens,
            "stream": False,
        },
        timeout=120,
    )
    resp.raise_for_status()
    data = resp.json()
    return (data["choices"][0]["message"].get("content") or "").strip()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 数据库
engine = create_engine(os.getenv("ESSAYS_DB_URL", "sqlite:///./essays.db"))
Base = declarative_base()

class Essay(Base):
    __tablename__ = "essays"
    id = Column(Integer, primary_key=True)
    title = Column(String(200))
    content = Column(Text)
    date = Column(String(10))  # YYYY-MM-DD
    word_count = Column(Integer)
    sentiment_score = Column(Float)
    sentiment_positive = Column(Float)
    sentiment_neutral = Column(Float)
    sentiment_negative = Column(Float)
    emotion_detail = Column(Text)   # JSON: {joy, gratitude, love, neutral, surprise, anger, ...}
    mood_card = Column(Text)        # JSON: {tone, tone_emoji, keywords[], ai_reply, ai_reply_status, generated_at}
    content_rich = Column(Text)     # JSON: BlockNote 块文档（富文本）；content 仍存纯文本供分析/搜索
    letters = Column(Text)          # JSON 数组：读者来信，每封 {id,persona,persona_name,content,created_at}
    created_at = Column(DateTime, default=datetime.now)


class StyleProfile(Base):
    __tablename__ = "style_profile"
    id = Column(Integer, primary_key=True)      # 固定单行，id=1
    content = Column(Text)                       # 注入用的 SOUL 串（用户可改后的最终版）
    rationale = Column(Text)                     # JSON：分维度依据
    source_essay_ids = Column(Text)              # JSON 数组：本次养成用了哪几篇
    generated_at = Column(DateTime, default=datetime.now)
    user_edited = Column(Integer, default=0)     # 0/1


class Draft(Base):
    __tablename__ = "drafts"
    id = Column(Integer, primary_key=True)
    title = Column(String(200))
    content = Column(Text)
    content_rich = Column(Text)                   # JSON: BlockNote 块文档
    letters = Column(Text)          # JSON 数组：随稿子流转的读者来信
    date = Column(String(10))                    # YYYY-MM-DD（用户设定的写作日期）
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now)

Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)


def setup_fts():
    """建 FTS5 虚拟表和同步触发器（幂等，已存在则跳过）"""
    with engine.connect() as conn:
        # trigram tokenizer 支持中文子串匹配，不依赖分词
        conn.execute(text("""
            CREATE VIRTUAL TABLE IF NOT EXISTS essays_fts
            USING fts5(title, content, content='essays', content_rowid='id', tokenize='trigram')
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS essays_ai AFTER INSERT ON essays BEGIN
                INSERT INTO essays_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS essays_au AFTER UPDATE ON essays BEGIN
                UPDATE essays_fts SET title=new.title, content=new.content
                WHERE rowid=new.id;
            END
        """))
        conn.execute(text("""
            CREATE TRIGGER IF NOT EXISTS essays_ad AFTER DELETE ON essays BEGIN
                DELETE FROM essays_fts WHERE rowid=old.id;
            END
        """))
        # 把已有数据灌入 FTS 表（仅在 FTS 表为空时执行）
        result = conn.execute(text("SELECT COUNT(*) FROM essays_fts")).fetchone()
        if result[0] == 0:
            conn.execute(text("""
                INSERT INTO essays_fts(rowid, title, content)
                SELECT id, title, content FROM essays
            """))
        conn.commit()

setup_fts()


MAX_LETTERS = 5


def _parse_letters(raw) -> list:
    try:
        v = json.loads(raw) if raw else []
        return v if isinstance(v, list) else []
    except Exception:
        return []


def _dump_letters(items) -> str:
    return json.dumps((items or [])[:MAX_LETTERS], ensure_ascii=False)


def _gen_letter_id() -> str:
    import uuid
    return "lt_" + uuid.uuid4().hex[:10]


def migrate_db():
    """为旧表补加新列（幂等）"""
    with engine.connect() as conn:
        for col, typ in [
            ("sentiment_positive", "FLOAT"),
            ("sentiment_neutral",  "FLOAT"),
            ("sentiment_negative", "FLOAT"),
            ("emotion_detail",     "TEXT"),
            ("mood_card",          "TEXT"),
            ("content_rich",       "TEXT"),
            ("letters",            "TEXT"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE essays ADD COLUMN {col} {typ}"))
                conn.commit()
            except Exception:
                pass  # 列已存在
        # drafts 表补列
        try:
            conn.execute(text("ALTER TABLE drafts ADD COLUMN content_rich TEXT"))
            conn.commit()
        except Exception:
            pass  # 列已存在
        try:
            conn.execute(text("ALTER TABLE drafts ADD COLUMN letters TEXT"))
            conn.commit()
        except Exception:
            pass  # 列已存在


def compute_emotion_breakdown(content: str):
    """用 tabularisai 模型做11类情绪分析，返回 detail + 三色分布 + sentiment_score。"""
    if not _emotion_pipe:
        return None
    sentences = re.split(r'[。！？\n]', content)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 5]
    if not sentences:
        return None
    results = _emotion_pipe(sentences[:40], truncation=True, max_length=128)
    totals = {e: 0.0 for e in ALL_EMOTIONS}
    for sentence_scores in results:
        for item in sentence_scores:
            label = item["label"].lower()
            if label in totals:
                totals[label] += item["score"]
    n = len(results)
    avg = {k: v / n for k, v in totals.items()}
    total = sum(avg.values()) or 1.0
    norm = {k: v / total for k, v in avg.items()}
    positive = sum(norm[e] for e in POSITIVE_EMOTIONS)
    neutral  = sum(norm[e] for e in NEUTRAL_EMOTIONS)
    negative = sum(norm[e] for e in NEGATIVE_EMOTIONS)
    # sentiment_score = joy + gratitude + love + neutral + surprise
    sentiment_score = positive + neutral
    return {
        "detail": {k: round(v * 100, 1) for k, v in norm.items()},
        "positive": round(positive * 100),
        "neutral":  round(neutral * 100),
        "negative": round(negative * 100),
        "sentiment_score": round(sentiment_score, 3),
    }


def migrate_emotion_breakdown():
    """启动时为没有 emotion_detail 的旧文章补算（幂等）"""
    if not _emotion_pipe:
        return
    session = Session()
    try:
        essays = session.query(Essay).filter(Essay.emotion_detail == None).all()
        if essays:
            print(f"[Emotion] 补算 {len(essays)} 篇旧文章的情绪分布…")
        for essay in essays:
            em = compute_emotion_breakdown(essay.content)
            if em:
                essay.sentiment_score    = em["sentiment_score"]
                essay.sentiment_positive = em["positive"]
                essay.sentiment_neutral  = em["neutral"]
                essay.sentiment_negative = em["negative"]
                essay.emotion_detail     = json.dumps(em["detail"])
        session.commit()
    finally:
        session.close()


migrate_db()
migrate_emotion_breakdown()


# 停用词
STOPWORDS = set([
    # 助词、虚词
    "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
    "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
    "自己", "这", "那", "们", "与", "及", "或", "但", "而", "因为", "所以", "如果",
    "虽然", "然后", "但是", "这个", "那个", "什么", "怎么", "为什么", "这样", "那样",
    # 代词、指示词（无实义）
    "其他", "其它", "其中", "这里", "那里", "这边", "那边", "这些", "那些", "一些",
    "各种", "一种", "这种", "那种", "某些", "有些", "如此", "如何", "一样", "哪些",
    "此外", "另外", "以及", "并且", "不过", "只是", "而且", "即使", "比较",
    # 否定/助动词组合（无区分度）
    "不会", "不能", "不是", "不用", "不要", "不必", "不得", "不行",
    "没有", "没能", "没法",
    # 泛义动词/形容词（高频但无区分度）
    "觉得", "认为", "知道", "感觉", "发现", "看到", "想到", "开始", "继续", "已经",
    "非常", "可能", "应该", "需要", "能够", "可以", "特别", "确实", "真的",
    "一直", "一定", "甚至", "不断", "不停", "有点", "有些", "有时", "显得",
    # 泛义名词
    "时候", "地方", "方面", "问题", "东西", "事情", "情况", "方式", "方法", "内容",
    "原因", "结果", "过程", "意思", "感受", "状态", "方向",
])

def analyze_text(content: str):
    words = [w for w in jieba.cut(content) if len(w) > 1 and w not in STOPWORDS]
    word_count = len(content.replace(" ", "").replace("\n", ""))
    freq = Counter(words)
    top_words = [{"word": w, "count": c} for w, c in freq.most_common(50)]
    sentences = re.split(r'[。！？\n]', content)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 5]
    pos_counts = Counter()
    for word, flag in pseg.cut(content):
        if flag.startswith('n'):
            pos_counts['名词'] += 1
        elif flag.startswith('v'):
            pos_counts['动词'] += 1
        elif flag.startswith('a'):
            pos_counts['形容词'] += 1
    return {
        "word_count": word_count,
        "top_words": top_words,
        "pos_distribution": dict(pos_counts),
    }


# 心绪卡：主导情绪 → 一句"底色"文案 + emoji（陪伴式，不评判）
EMOTION_TONE = {
    "joy":         ("心里是亮的",         "☀️"),
    "gratitude":   ("有一份感激沉在底下",  "🍃"),
    "love":        ("有柔软的东西在涌动",  "🌸"),
    "neutral":     ("平静，但留着回响",    "🍃"),
    "surprise":    ("有些意外轻轻撞了一下", "✨"),
    "anger":       ("有一股没散的火气",    "🔥"),
    "contempt":    ("带着一点疏离",        "🌫️"),
    "disgust":     ("有些抵触和不适",      "🌫️"),
    "fear":        ("藏着一点不安",        "🌙"),
    "frustration": ("卡着一团拧巴",        "🌧️"),
    "sadness":     ("沉沉的，有些低落",    "🌧️"),
}


def compute_mood_card(content: str, em: dict = None, analysis: dict = None) -> dict:
    """本地秒出心绪卡的可见部分（情感基调 + 关键词）。AI 那句回应由 mood-reply 接口异步补。"""
    em = em if em is not None else (compute_emotion_breakdown(content) or {})
    analysis = analysis if analysis is not None else analyze_text(content)
    detail = em.get("detail") or {}
    if detail:
        dominant = max(detail, key=detail.get)
        tone, emoji = EMOTION_TONE.get(dominant, ("记录下来了", "🍃"))
    else:
        tone, emoji = ("记录下来了", "🍃")
    keywords = [w["word"] for w in analysis.get("top_words", [])[:3]]
    return {
        "tone": tone,
        "tone_emoji": emoji,
        "keywords": keywords,
        "ai_reply": None,
        "ai_reply_status": "pending",   # pending | ok | skipped | error
        "generated_at": datetime.now().isoformat(timespec="seconds"),
    }


class EssayCreate(BaseModel):
    title: str
    content: str
    date: str
    content_rich: str | None = None
    letters: list | None = None


@app.post("/essays")
def create_essay(data: EssayCreate):
    if data.letters and len(data.letters) > MAX_LETTERS:
        raise HTTPException(status_code=400, detail="读者信箱最多 5 封")
    analysis = analyze_text(data.content)
    em = compute_emotion_breakdown(data.content) or {}
    mood = compute_mood_card(data.content, em=em, analysis=analysis)
    session = Session()
    essay = Essay(
        title=data.title,
        content=data.content,
        content_rich=data.content_rich,
        date=data.date,
        word_count=analysis["word_count"],
        sentiment_score=em.get("sentiment_score", 0.5),
        sentiment_positive=em.get("positive"),
        sentiment_neutral=em.get("neutral"),
        sentiment_negative=em.get("negative"),
        emotion_detail=json.dumps(em["detail"]) if em.get("detail") else None,
        mood_card=json.dumps(mood, ensure_ascii=False),
        letters=_dump_letters(data.letters or []),
    )
    session.add(essay)
    session.commit()
    session.refresh(essay)
    result = {"id": essay.id, **data.dict(), **analysis, "mood_card": mood}
    session.close()
    return result


@app.get("/essays")
def list_essays(start_date: str = None, end_date: str = None):
    session = Session()
    q = session.query(Essay)
    if start_date:
        q = q.filter(Essay.date >= start_date)
    if end_date:
        q = q.filter(Essay.date <= end_date)
    essays = q.order_by(Essay.date.desc()).all()
    result = [
        {
            "id": e.id,
            "title": e.title,
            "date": e.date,
            "word_count": e.word_count,
            "sentiment_score": e.sentiment_score,
            "content": e.content[:100] + "..." if len(e.content) > 100 else e.content,
        }
        for e in essays
    ]
    session.close()
    return result


@app.get("/essays/search")
def search_essays(q: str = "", start_date: str = None, end_date: str = None):
    """全文搜索：LIKE 匹配 title + content，支持时间范围过滤"""
    session = Session()
    try:
        if q.strip():
            rows = session.execute(text("""
                SELECT id, title, date, word_count, sentiment_score, content
                FROM essays
                WHERE (title LIKE :q OR content LIKE :q)
                ORDER BY date DESC
            """), {"q": f"%{q.strip()}%"}).fetchall()
        else:
            rows = session.execute(text("""
                SELECT id, title, date, word_count, sentiment_score, content
                FROM essays
                ORDER BY date DESC
            """)).fetchall()

        result = []
        for row in rows:
            essay_id, title, date, word_count, sentiment_score, content = row
            if start_date and date < start_date:
                continue
            if end_date and date > end_date:
                continue
            # 从正文里截取关键词上下文作为 snippet
            snippet = ""
            if q.strip() and content:
                idx = content.find(q.strip())
                if idx != -1:
                    start = max(0, idx - 20)
                    end = min(len(content), idx + len(q.strip()) + 30)
                    snippet = ("..." if start > 0 else "") + content[start:end] + ("..." if end < len(content) else "")
            result.append({
                "id": essay_id,
                "title": title,
                "date": date,
                "word_count": word_count,
                "sentiment_score": sentiment_score,
                "snippet": snippet,
            })
        return result
    finally:
        session.close()


@app.get("/essays/random")
def random_essay():
    import random as _random
    session = Session()
    essays = session.query(Essay).all()
    session.close()
    if not essays:
        raise HTTPException(status_code=404, detail="no essays")
    e = _random.choice(essays)
    return {
        "id": e.id,
        "title": e.title,
        "date": e.date,
        "sentiment_score": e.sentiment_score,
        "preview": e.content[:120] + "…" if len(e.content) > 120 else e.content,
    }


@app.get("/essays/{essay_id}")
def get_essay(essay_id: int):
    session = Session()
    essay = session.query(Essay).filter(Essay.id == essay_id).first()
    if not essay:
        raise HTTPException(status_code=404, detail="Not found")
    analysis = analyze_text(essay.content)
    result = {
        "id": essay.id,
        "title": essay.title,
        "content": essay.content,
        "content_rich": essay.content_rich,
        "date": essay.date,
        "sentiment": essay.sentiment_score,
        "emotion_detail": json.loads(essay.emotion_detail) if essay.emotion_detail else None,
        "mood_card": json.loads(essay.mood_card) if essay.mood_card else None,
        "letters": _parse_letters(essay.letters),
        **analysis,
    }
    session.close()
    return result


class LetterIn(BaseModel):
    persona: str
    persona_name: str = ""
    content: str


@app.post("/essays/{essay_id}/letters")
def add_essay_letter(essay_id: int, data: LetterIn):
    session = Session()
    essay = session.query(Essay).filter(Essay.id == essay_id).first()
    if not essay:
        session.close()
        raise HTTPException(status_code=404, detail="Not found")
    letters = _parse_letters(essay.letters)
    if len(letters) >= MAX_LETTERS:
        session.close()
        raise HTTPException(status_code=400, detail="读者信箱已满，最多 5 封")
    letters.append({
        "id": _gen_letter_id(),
        "persona": data.persona,
        "persona_name": data.persona_name,
        "content": data.content,
        "created_at": datetime.now().isoformat(timespec="seconds"),
    })
    essay.letters = _dump_letters(letters)
    session.commit()
    session.close()
    return letters


@app.delete("/essays/{essay_id}/letters/{letter_id}")
def delete_essay_letter(essay_id: int, letter_id: str):
    session = Session()
    essay = session.query(Essay).filter(Essay.id == essay_id).first()
    if not essay:
        session.close()
        raise HTTPException(status_code=404, detail="Not found")
    letters = [lt for lt in _parse_letters(essay.letters) if lt.get("id") != letter_id]
    essay.letters = _dump_letters(letters)
    session.commit()
    session.close()
    return letters


class EssayUpdate(BaseModel):
    title: str
    content: str
    date: str
    content_rich: str | None = None


@app.put("/essays/{essay_id}")
def update_essay(essay_id: int, data: EssayUpdate):
    session = Session()
    essay = session.query(Essay).filter(Essay.id == essay_id).first()
    if not essay:
        session.close()
        raise HTTPException(status_code=404, detail="Not found")
    analysis = analyze_text(data.content)
    em = compute_emotion_breakdown(data.content) or {}
    mood = compute_mood_card(data.content, em=em, analysis=analysis)  # 最新一张覆盖
    essay.title = data.title
    essay.content = data.content
    essay.content_rich = data.content_rich
    essay.date = data.date
    essay.word_count = analysis["word_count"]
    essay.sentiment_score    = em.get("sentiment_score", 0.5)
    essay.sentiment_positive = em.get("positive")
    essay.sentiment_neutral  = em.get("neutral")
    essay.sentiment_negative = em.get("negative")
    essay.emotion_detail     = json.dumps(em["detail"]) if em.get("detail") else None
    essay.mood_card          = json.dumps(mood, ensure_ascii=False)
    session.commit()
    result = {"id": essay.id, **data.dict(), **analysis, "mood_card": mood}
    session.close()
    return result


@app.post("/essays/{essay_id}/mood-reply")
def essay_mood_reply(essay_id: int):
    """异步生成今日心绪卡里那句『陪伴式回应』，写回 mood_card.ai_reply。"""
    session = Session()
    essay = session.query(Essay).filter(Essay.id == essay_id).first()
    if not essay:
        session.close()
        raise HTTPException(status_code=404, detail="随笔不存在")
    content = (essay.content or "").strip()
    mood = json.loads(essay.mood_card) if essay.mood_card else compute_mood_card(content)

    # 太短的随笔跳过 AI，避免无意义调用
    if len(content) < 30:
        mood["ai_reply"] = None
        mood["ai_reply_status"] = "skipped"
        essay.mood_card = json.dumps(mood, ensure_ascii=False)
        session.commit()
        session.close()
        return mood

    prompt = f"""你在读一个人刚写完的随笔。请用一句话（40字以内）温柔地回应 TA，像一个懂 TA 的老朋友。
要求：
- 不评判、不总结、不喊鼓励口号
- 可以点出文字里反复出现的、或微妙没说透的东西
- 第二人称「你」，口语，不要引号
只返回这一句话本身。

随笔：
{content[:1500]}"""

    try:
        message = anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=120,
            messages=[{"role": "user", "content": prompt}],
        )
        reply = message.content[0].text.strip().strip('「」"' "'").strip()
        mood["ai_reply"] = reply
        mood["ai_reply_status"] = "ok"
    except Exception as e:
        print(f"[mood-reply] {essay_id} error: {e}")
        mood["ai_reply"] = None
        mood["ai_reply_status"] = "error"

    essay.mood_card = json.dumps(mood, ensure_ascii=False)
    session.commit()
    session.close()
    return mood


def _sample_excerpts(essays, per_essay_cap: int = 400, total_cap: int = 800) -> str:
    """从文章列表取未改写摘录，保留原始换行与标点（节奏不可压平）。
    每篇至多 per_essay_cap 字，累计到 total_cap 即停。"""
    parts = []
    total = 0
    for e in essays:
        if total >= total_cap:
            break
        content = (e.content or "").strip()
        if not content:
            continue
        snippet = content[:per_essay_cap]
        if len(content) > per_essay_cap:
            snippet += "…"
        title = (getattr(e, "title", "") or "").strip() or "无题"
        parts.append(f"【{title}】\n{snippet}")
        total += len(snippet)
    return "\n\n".join(parts)


_SOUL_LABELS = [("节奏", "rhythm"), ("意象", "imagery"), ("情绪", "emotion"),
                ("用词", "diction"), ("手法", "signature")]


def _parse_soul_output(raw: str) -> dict:
    """解析「标签分段」格式 → {soul, rationale}。
    不用 JSON：中文风格串里常含引号/标点，会冲破 JSON；标签分段对此免疫。
    期望格式：
        【SOUL】
        <100-200字风格指令>
        【节奏】…【意象】…【情绪】…【用词】…【手法】…
    解析失败时把整段（去围栏后）当 soul 兜底，绝不抛异常。"""
    text = (raw or "").strip()
    # 去掉可能的 ``` 围栏
    fence = re.search(r"```(?:\w+)?\s*(.+?)\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1).strip()
    # 逐维抓 rationale（一行一句）
    rationale = {}
    for zh, key in _SOUL_LABELS:
        m = re.search(rf"【{zh}】[:：]?\s*(.+)", text)
        if m:
            v = m.group(1).strip()
            if v:
                rationale[key] = v
    # 抓 SOUL：从【SOUL】到第一个维度标签（或文末）之间
    soul = ""
    m = re.search(r"【SOUL】[:：]?\s*(.+?)\s*(?=【(?:节奏|意象|情绪|用词|手法)】|$)",
                  text, re.DOTALL)
    if m:
        soul = m.group(1).strip()
    if not soul:
        # 兜底：去掉所有【…】标签行，剩下的当 soul；再不行就用整段
        stripped = re.sub(r"【[^】]*】[:：]?[^\n]*", "", text).strip()
        soul = stripped or text
    return {"soul": soul, "rationale": rationale}


# ── 写作工具面板 ──
# 无状态文本变换：选中一段文字 → AI 辅助。四类：缩减/同义替换/比喻/扩展。
# style_profile 为可选；缺省时走降级分支（仅要求贴合原文与上下文，不强加风格）。
class AssistRequest(BaseModel):
    text: str
    context: str = ""
    style_profile: str = ""


def _assist_system(style_profile: str) -> str:
    sp = (style_profile or "").strip()
    if sp:
        style_line = (f"该作者的写作风格为：{sp}。"
                      "所有建议必须与该风格保持一致，不要改变作者的声音和语气。")
    else:
        style_line = "保持与原文及上下文一致的语气和风格，不要改变作者的声音。"
    return f"你是写作助手。{style_line}\n直接输出建议内容，不要解释、不要加前缀。"


def _load_soul_content() -> str:
    """从库里读当前 SOUL 文档的 content；没有则返回空串（走降级分支）。"""
    session = Session()
    try:
        row = session.query(StyleProfile).filter(StyleProfile.id == 1).first()
        return (row.content or "").strip() if row else ""
    finally:
        session.close()


def _parse_options(raw: str) -> list:
    """把「每行一个选项（可能带 1. / - 编号）」的输出解析成列表。"""
    out = []
    for line in (raw or "").splitlines():
        s = line.strip()
        if not s:
            continue
        s = re.sub(r'^\s*\d+[\.\、\)]\s*', '', s)   # 去 "1." "1、" "1)"
        s = re.sub(r'^\s*[-•·]\s*', '', s)           # 去 "- " "• "
        s = s.strip().strip('「」""\'').strip()
        if s:
            out.append(s)
    return out[:4]


def _assist_call(data: AssistRequest, user: str, max_tokens: int, parse_options: bool, model: str,
                 system: str = None):
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="选中文字不能为空")
    # system 为 None 时默认注入 SOUL；显式传入（如比喻）则用传入的，不注入 SOUL
    sys_prompt = system if system is not None else _assist_system(_load_soul_content())
    try:
        message = anthropic_client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=sys_prompt,
            messages=[{"role": "user", "content": user}],
        )
        raw = message.content[0].text.strip()
        if parse_options:
            return {"options": _parse_options(raw)}
        return {"result": raw.strip('「」""\'').strip()}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[assist] error: {e}")
        raise HTTPException(status_code=502, detail="AI 调用失败，请稍后再试")


def _ctx_line(ctx: str) -> str:
    ctx = (ctx or "").strip()
    return f"\n上下文（前后各一句）：{ctx}" if ctx else ""


def _cap(text: str, factor: float, lo: int, hi: int) -> int:
    """按选中文字长度自适应 max_tokens：避免长选区被截断，同时设上限防跑飞。
    factor 大致是「输出相对输入的倍数」（多候选时要乘候选数）。中文约 1 字≈1 token。"""
    return max(lo, min(hi, int(len(text or "") * factor) + 120))


@app.post("/assist/reduce")
def assist_reduce(data: AssistRequest):
    user = (
        "请将以下文字压缩至原来约一半的长度。\n"
        "要求：保留核心意思和情感，删去冗余表达，保持作者的句式风格，直接输出压缩后的文字。\n\n"
        f"原文：{data.text.strip()}"
    )
    return _assist_call(data, user, max_tokens=_cap(data.text, 1.5, 256, 1024), parse_options=False, model="claude-haiku-4-5-20251001")


@app.post("/assist/synonyms")
def assist_synonyms(data: AssistRequest):
    user = (
        "请为以下文字提供 3 个同义或近义的替代表达。\n"
        "要求：保持原意，贴合上下文语境，风格与作者一致，每个选项单独一行，不要额外解释。\n\n"
        f"选中文字：{data.text.strip()}" + _ctx_line(data.context)
    )
    return _assist_call(data, user, max_tokens=_cap(data.text, 4, 320, 2048), parse_options=True, model="claude-sonnet-4-6")


METAPHOR_SYSTEM = (
    "你是一位精于比喻的中文写作高手。请完全自由地探索喻体、比喻方式与遣词造句，"
    "不必受作者既有风格的约束，大胆出新意。"
    "只输出比喻本身，每个一行，不要解释、不要加前缀。"
)


@app.post("/assist/metaphor")
def assist_metaphor(data: AssistRequest):
    user = (
        "请为下面这段文字提供 2-3 个比喻。\n"
        "要求：\n"
        "1. 先抓住这段文字真正想表达的核心关系或感受，再为这个内核打比方；不要逐字给整段套比喻。\n"
        "2. 如果选中文字里本身已经含有一个比喻，就顺着它的思路，给出 2-3 个【平行的、全新的】比喻"
        "（保留同样的表达结构，但换用不同的喻体），作为可替换或扩充的备选。\n"
        "3. 喻体要新鲜多样、彼此不同，避免陈词滥调，也不要与原文已有的喻体重复。\n"
        "4. 每个比喻单独一行，直接输出。\n\n"
        f"选中文字：{data.text.strip()}" + _ctx_line(data.context)
    )
    return _assist_call(data, user, max_tokens=_cap(data.text, 1.5, 400, 1024), parse_options=True,
                        model="claude-opus-4-8", system=METAPHOR_SYSTEM)


@app.post("/assist/expand")
def assist_expand(data: AssistRequest):
    user = (
        "请将以下文字扩展至约 2 倍长度。\n"
        "要求：补充细节、感受或场景描写，自然融入原文语境，保持作者风格，直接输出扩展后的文字。\n\n"
        f"原文：{data.text.strip()}" + _ctx_line(data.context)
    )
    return _assist_call(data, user, max_tokens=_cap(data.text, 3, 512, 2048), parse_options=False, model="claude-sonnet-4-6")


# ── 读者视角 ──
# 选一个人格读者，读完整篇 → 回一封第一人称的信。读整篇、不依赖选区、不注入 SOUL。
READER_PERSONAS = {
    "poet": {
        "name": "诗人",
        "system": (
            "你是一位诗人。读一篇文章时，你只在意意象、节奏和语言的质地——"
            "哪一句的画面让你停住，哪里的词太顺、像借来的，哪里的节奏泄了气。"
        ),
    },
    "novelist": {
        "name": "小说家",
        "system": (
            "你是一位小说家。读一篇文章时，你只在意人物、场景与细节——"
            "作者是把它「演」出来了，还是在「讲」；现场是否立住，有没有一张脸、一个动作。"
        ),
    },
    "philosopher": {
        "name": "哲学家",
        "system": (
            "你是一位哲学家。读一篇文章时，你追问它底下「真正在问什么」，"
            "把一个具体的场景上升为一个普遍的问题，温和地往深里带；你深化，不抬杠。"
        ),
    },
    "editor": {
        "name": "编辑",
        "system": (
            "你是一位编辑。读一篇文章时，你只看整体的骨架与气——"
            "开头抓不抓人、中段塌不塌、结尾兑不兑现承诺、有没有一以贯之的线。用人话说，不抖术语。"
        ),
    },
    "debater": {
        "name": "辩论家",
        "system": (
            "你是一位辩论家。读一篇文章时，你专挑它的立论与逻辑漏洞——"
            "那个不成立的「所以」、偷换的前提、回避的反例；你认真反驳，要求论断站得住。"
        ),
    },
}

_READER_TASK = (
    "现在请你读完下面这篇文章，然后像一个真实的人，给作者本人写一封第一人称的信："
    "有体温，不打分，不逐句批改；抓住真正打动你、或硌着你的地方来说，可以点名某个具体句子；"
    "结尾不必强行总结。约 400–800 字。只输出信的正文，不要加标题或前缀。"
)


class AssistReaderRequest(BaseModel):
    title: str = ""
    content: str
    persona: str


@app.post("/assist/reader")
def assist_reader(data: AssistReaderRequest):
    content = (data.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="文章内容不能为空")
    p = READER_PERSONAS.get(data.persona)
    if not p:
        raise HTTPException(status_code=400, detail="未知的读者")
    sys_prompt = f"{p['system']}\n{_READER_TASK}"
    user = f"标题：{(data.title or '无题').strip()}\n\n正文：\n{content}"
    try:
        # 读者视角走 DeepSeek（推理模型，max_tokens 给足以容纳推理 + 信文）
        letter = _deepseek_chat(sys_prompt, user, max_tokens=5000)
        return {"letter": letter}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[reader] error: {e}")
        raise HTTPException(status_code=502, detail="AI 调用失败，请稍后再试")


# ── 找引文 ──
# 为选中论断联网检索 2–3 条带出处的证据。用 web_search 服务端工具，不注入 SOUL。
CITE_SYSTEM = (
    "你是一名严谨的资料员。为用户给出的论断，用联网检索找 2–3 条真实、可查证的证据"
    "（名人名句、科学依据或历史事实皆可）。每条必须有真实可查的出处；"
    "宁缺毋滥，绝不编造名言、数据或年份；查不到确切出处就不要给。\n"
    "只输出证据，每条单独一行，严格用以下格式（用 ||| 分隔三段，不要加编号或解释）：\n"
    "证据原文 ||| 出处（作者/著作/机构）||| 来源链接\n"
    "如果没有任何可确证的证据，只输出一行：无"
)

_WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search"}


class AssistCiteRequest(BaseModel):
    text: str
    context: str = ""


def _parse_cite_lines(raw: str) -> list:
    """解析「原文 ||| 出处 ||| URL」每行一条 → [{quote, source, url}]，最多 3 条。"""
    out = []
    for line in (raw or "").splitlines():
        s = line.strip()
        if not s or "|||" not in s:
            continue
        parts = [p.strip() for p in s.split("|||")]
        quote = parts[0]
        source = parts[1] if len(parts) > 1 else ""
        url = parts[2] if len(parts) > 2 else ""
        if quote:
            out.append({"quote": quote, "source": source, "url": url})
    return out[:3]


@app.post("/assist/cite")
def assist_cite(data: AssistCiteRequest):
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="选中文字不能为空")
    user = f"论断：{text}" + _ctx_line(data.context)
    messages = [{"role": "user", "content": user}]
    try:
        # web_search 是服务端工具，API 自跑检索循环；pause_turn 时回填续跑（上限 3 轮）
        for _ in range(3):
            message = anthropic_client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                system=CITE_SYSTEM,
                tools=[_WEB_SEARCH_TOOL],
                messages=messages,
            )
            if getattr(message, "stop_reason", None) != "pause_turn":
                break
            messages.append({"role": "assistant", "content": message.content})
        raw = "".join(getattr(b, "text", "") for b in message.content).strip()
        return {"options": _parse_cite_lines(raw)}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[cite] error: {e}")
        raise HTTPException(status_code=502, detail="AI 调用失败，请稍后再试")


# ── 风格 SOUL 文档 ──
class StyleProfileGenerateRequest(BaseModel):
    essay_ids: list[int]


def _build_soul_prompt(portrait: dict, excerpts: str) -> str:
    return (
        "以下是某作者的写作风格量化数据与若干篇原文摘录。\n\n"
        "## 量化锚点（客观统计，供参考，勿照搬数字）\n"
        f"- 情感基调：{portrait.get('tone')}\n"
        f"- 句式偏好：{portrait.get('sentence_style')}（平均句长 {portrait.get('avg_sentence_length')} 字）\n"
        f"- 词汇丰富度：{portrait.get('vocab_richness')}（TTR={portrait.get('ttr')}）\n"
        f"- 标点习惯：{portrait.get('punct_style')}\n"
        f"- 段落风格：{portrait.get('para_style')}\n"
        f"- 篇幅偏好：{portrait.get('volume_style')}\n"
        f"- 灵魂词汇：{', '.join(portrait.get('soul_words', []))}\n\n"
        "## 原文摘录（保留了原始断句与节奏，请重点感受其节奏与意象）\n"
        f"{excerpts}\n\n"
        "请分两步：\n"
        "第一步（在心里分析，不要输出）：从五个维度刻画该作者的风格——\n"
        "  1) 句子节奏与长短  2) 意象/感官/比喻倾向  3) 情绪表达方式（克制/外放/叙事）\n"
        "  4) 用词（口语/书面/文学性）  5) 标志性手法（标点、留白、重复、转折等）\n"
        "第二步（输出）：把以上压缩成一段 100–200 字的密集风格指令，可直接注入用于指挥 AI 模仿该风格写作。\n\n"
        "请严格按以下格式输出，不要使用 JSON、不要加任何额外说明文字（风格串里可自由使用引号和标点）：\n"
        "【SOUL】\n（这里写 100-200 字的风格指令）\n\n"
        "【节奏】（一句话）\n【意象】（一句话）\n【情绪】（一句话）\n【用词】（一句话）\n【手法】（一句话）"
    )


SOUL_SYSTEM = (
    "你是一名法医语言学家 + 中文写作风格分析师，擅长从文本中识别作者独有的声音，"
    "并把它压缩成可直接用于指导写作的风格指令。只描述特征，不评价好坏，"
    "不使用「该作者/这位作者」等人称，直接描述风格本身。"
)


@app.post("/style-profile/generate")
def generate_style_profile(req: StyleProfileGenerateRequest):
    if not req.essay_ids:
        raise HTTPException(status_code=400, detail="请至少选择一篇文章")
    session = Session()
    essays = session.query(Essay).filter(Essay.id.in_(req.essay_ids)).order_by(Essay.date).all()
    if not essays:
        session.close()
        raise HTTPException(status_code=400, detail="选中的文章不存在")
    portrait = compute_portrait(essays)
    excerpts = _sample_excerpts(essays)
    try:
        message = anthropic_client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=800,
            system=SOUL_SYSTEM,
            messages=[{"role": "user", "content": _build_soul_prompt(portrait, excerpts)}],
        )
        parsed = _parse_soul_output(message.content[0].text)
    except HTTPException:
        raise
    except Exception as e:
        session.close()
        print(f"[soul] generate error: {e}")
        raise HTTPException(status_code=502, detail="AI 调用失败，请稍后再试")

    row = session.query(StyleProfile).filter(StyleProfile.id == 1).first()
    if not row:
        row = StyleProfile(id=1)
        session.add(row)
    row.content = parsed["soul"]
    row.rationale = json.dumps(parsed["rationale"], ensure_ascii=False)
    row.source_essay_ids = json.dumps([e.id for e in essays])
    row.generated_at = datetime.now()
    row.user_edited = 0
    session.commit()
    result = {
        "content": row.content,
        "rationale": parsed["rationale"],
        "source_essay_ids": [e.id for e in essays],
        "generated_at": row.generated_at.isoformat(),
        "user_edited": 0,
    }
    session.close()
    return result


@app.get("/style-profile")
def get_style_profile():
    session = Session()
    row = session.query(StyleProfile).filter(StyleProfile.id == 1).first()
    if not row:
        session.close()
        return {"exists": False}
    # 自上次养成后，更新过/新建过的文章数（按 created_at 粗略估计）
    new_count = 0
    if row.generated_at:
        new_count = session.query(Essay).filter(Essay.created_at > row.generated_at).count()
    try:
        rationale = json.loads(row.rationale) if row.rationale else {}
    except Exception:
        rationale = {}
    try:
        ids = json.loads(row.source_essay_ids) if row.source_essay_ids else []
    except Exception:
        ids = []
    result = {
        "exists": True,
        "content": row.content or "",
        "rationale": rationale,
        "source_essay_ids": ids,
        "generated_at": row.generated_at.isoformat() if row.generated_at else None,
        "user_edited": int(row.user_edited or 0),
        "new_essays_since": new_count,
    }
    session.close()
    return result


class StyleProfileUpdateRequest(BaseModel):
    content: str


@app.put("/style-profile")
def update_style_profile(req: StyleProfileUpdateRequest):
    session = Session()
    row = session.query(StyleProfile).filter(StyleProfile.id == 1).first()
    if not row:
        row = StyleProfile(id=1, source_essay_ids="[]", rationale="{}")
        session.add(row)
    row.content = (req.content or "").strip()
    row.user_edited = 1
    row.generated_at = datetime.now()
    session.commit()
    try:
        ids = json.loads(row.source_essay_ids) if row.source_essay_ids else []
    except Exception:
        ids = []
    try:
        rationale = json.loads(row.rationale) if row.rationale else {}
    except Exception:
        rationale = {}
    result = {
        "content": row.content,
        "rationale": rationale,
        "source_essay_ids": ids,
        "generated_at": row.generated_at.isoformat(),
        "user_edited": 1,
    }
    session.close()
    return result


# ── 草稿箱 ──
class DraftRequest(BaseModel):
    title: str = ""
    content: str
    date: str = ""
    content_rich: str | None = None
    letters: list | None = None


def _draft_dict(d) -> dict:
    return {
        "id": d.id,
        "title": d.title or "",
        "content": d.content or "",
        "content_rich": d.content_rich,
        "letters": _parse_letters(d.letters),
        "date": d.date or "",
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "updated_at": d.updated_at.isoformat() if d.updated_at else None,
    }


@app.post("/drafts")
def create_draft(data: DraftRequest):
    if not (data.content or "").strip():
        raise HTTPException(status_code=400, detail="草稿内容不能为空")
    if data.letters and len(data.letters) > MAX_LETTERS:
        raise HTTPException(status_code=400, detail="读者信箱最多 5 封")
    session = Session()
    now = datetime.now()
    d = Draft(title=data.title or "", content=data.content, content_rich=data.content_rich,
              date=data.date or "", letters=_dump_letters(data.letters or []),
              created_at=now, updated_at=now)
    session.add(d)
    session.commit()
    result = _draft_dict(d)
    session.close()
    return result


@app.get("/drafts")
def list_drafts():
    session = Session()
    rows = session.query(Draft).order_by(Draft.updated_at.desc(), Draft.id.desc()).all()
    result = [_draft_dict(d) for d in rows]
    session.close()
    return result


@app.put("/drafts/{draft_id}")
def update_draft(draft_id: int, data: DraftRequest):
    if data.letters and len(data.letters) > MAX_LETTERS:
        raise HTTPException(status_code=400, detail="读者信箱最多 5 封")
    session = Session()
    d = session.query(Draft).filter(Draft.id == draft_id).first()
    if not d:
        session.close()
        raise HTTPException(status_code=404, detail="草稿不存在")
    d.title = data.title or ""
    d.content = data.content
    d.content_rich = data.content_rich
    d.letters = _dump_letters(data.letters or [])
    d.date = data.date or ""
    d.updated_at = datetime.now()
    session.commit()
    result = _draft_dict(d)
    session.close()
    return result


@app.delete("/drafts/{draft_id}")
def delete_draft(draft_id: int):
    session = Session()
    d = session.query(Draft).filter(Draft.id == draft_id).first()
    if not d:
        session.close()
        raise HTTPException(status_code=404, detail="草稿不存在")
    session.delete(d)
    session.commit()
    session.close()
    return {"ok": True}


@app.delete("/essays/{essay_id}")
def delete_essay(essay_id: int):
    session = Session()
    essay = session.query(Essay).filter(Essay.id == essay_id).first()
    if not essay:
        raise HTTPException(status_code=404, detail="Not found")
    session.delete(essay)
    session.commit()
    session.close()
    return {"ok": True}


@app.get("/stats/overview")
def overview(start_date: str = None, end_date: str = None):
    session = Session()
    query = session.query(Essay)
    if start_date:
        query = query.filter(Essay.date >= start_date)
    if end_date:
        query = query.filter(Essay.date <= end_date)
    essays = query.all()
    if not essays:
        session.close()
        return {"total_essays": 0}
    heatmap = [{"date": e.date, "count": 1, "word_count": e.word_count} for e in essays]
    sentiment_trend = sorted(
        [{"date": e.date, "score": e.sentiment_score, "title": e.title} for e in essays],
        key=lambda x: x["date"]
    )
    all_content = " ".join([e.content for e in essays])
    analysis = analyze_text(all_content)
    session.close()
    return {
        "total_essays": len(essays),
        "total_words": sum(e.word_count for e in essays),
        "avg_sentiment": round(sum(e.sentiment_score for e in essays) / len(essays), 3),
        "heatmap": heatmap,
        "sentiment_trend": sentiment_trend,
        "top_words": analysis["top_words"],
    }


@app.get("/stats/sentiment-timeline")
def sentiment_timeline(granularity: str = "month", start_date: str = None, end_date: str = None):
    """按时间粒度（year/month/week/day）返回情感分布聚合数据。周以周一为起始日。"""
    session = Session()
    query = session.query(Essay).filter(Essay.sentiment_positive != None)
    if start_date:
        query = query.filter(Essay.date >= start_date)
    if end_date:
        query = query.filter(Essay.date <= end_date)
    essays = query.order_by(Essay.date.asc()).all()
    session.close()

    if not essays:
        return []

    def group_key(date_str: str):
        d = date_cls.fromisoformat(date_str)
        if granularity == "year":
            return str(d.year)
        if granularity == "month":
            return f"{d.year}-{d.month:02d}"
        if granularity == "week":
            monday = d - timedelta(days=d.weekday())  # weekday() 0=周一
            return f"{monday.month}/{monday.day}～"
        return f"{d.month}/{d.day}"  # day

    groups: dict = defaultdict(list)
    # 保留插入顺序（Python 3.7+ dict 有序）
    for e in essays:
        groups[group_key(e.date)].append(e)

    result = []
    for label, group in groups.items():
        n = len(group)
        avg_pos = round(sum(e.sentiment_positive for e in group) / n)
        avg_neu = round(sum(e.sentiment_neutral  for e in group) / n)
        avg_neg = round(sum(e.sentiment_negative for e in group) / n)
        avg_neu += 100 - (avg_pos + avg_neu + avg_neg)  # 修正四舍五入差
        result.append({
            "label": label,
            "positive": avg_pos,
            "neutral":  avg_neu,
            "negative": avg_neg,
            "essays":   n,
        })
    return result


def compute_portrait(essays):
    all_content = " ".join([e.content for e in essays])
    scores = [e.sentiment_score for e in essays]
    mean_s = statistics.mean(scores)
    std_s = statistics.stdev(scores) if len(scores) > 1 else 0
    if mean_s > 0.7:
        tone = "整体积极明朗"
    elif mean_s > 0.55:
        tone = "情绪平和中性"
    else:
        tone = "整体偏向内敛沉郁"
    if std_s > 0.12:
        tone += "，情绪起伏较大"
    elif std_s < 0.05:
        tone += "，情绪非常稳定"
    sentences = re.split(r'[。！？]', all_content)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 2]
    avg_sent_len = statistics.mean([len(s) for s in sentences]) if sentences else 0
    if avg_sent_len > 28:
        sentence_style = "长句型"
    elif avg_sent_len < 14:
        sentence_style = "短句型"
    else:
        sentence_style = "长短句混用"
    pos_counts = Counter()
    for word, flag in pseg.cut(all_content):
        if len(word) < 2:
            continue
        if flag.startswith('n'):
            pos_counts['名词'] += 1
        elif flag.startswith('v'):
            pos_counts['动词'] += 1
        elif flag.startswith('a'):
            pos_counts['形容词'] += 1
    total_pos = sum(pos_counts.values()) or 1
    pos_ratios = {k: round(v / total_pos, 3) for k, v in pos_counts.items()}
    dominant_pos = max(pos_counts, key=pos_counts.get) if pos_counts else "名词"
    if dominant_pos == "名词":
        pos_style = "画面构建型（名词主导，善于描绘场景）"
    elif dominant_pos == "动词":
        pos_style = "动作叙事型（动词主导，叙事流动感强）"
    else:
        pos_style = "感受表达型（形容词主导，情感细腻）"
    words = [w for w in jieba.cut(all_content) if len(w) > 1 and w not in STOPWORDS]
    ttr = len(set(words)) / len(words) if words else 0
    if ttr > 0.6:
        vocab_richness = "词汇非常丰富多样"
    elif ttr > 0.4:
        vocab_richness = "词汇丰富度适中"
    else:
        vocab_richness = "词汇偏向集中重复（风格统一）"
    self_words = ["我", "自己", "我的", "我们"]
    self_count = sum(all_content.count(w) for w in self_words)
    self_ratio = self_count / (len(all_content) / 100) if all_content else 0
    if self_ratio > 3:
        self_orientation = "高度自我叙述（以第一视角观察和感受为主）"
    elif self_ratio > 1.5:
        self_orientation = "内外兼顾（自我与外部观察并重）"
    else:
        self_orientation = "向外观察型（更多聚焦外部世界）"
    past_words = ["曾经", "以前", "之前", "此前", "此先", "那时", "记得", "那年", "过去", "当时", "回忆"]
    future_words = ["将来", "未来", "以后", "打算", "希望", "计划", "会", "想要", "之后", "期望"]
    past_count = sum(all_content.count(w) for w in past_words)
    future_count = sum(all_content.count(w) for w in future_words)
    if past_count > future_count * 1.5:
        time_orient = "回望型（偏向回忆与过去）"
    elif future_count > past_count * 1.5:
        time_orient = "展望型（偏向未来与期待）"
    else:
        time_orient = "当下型（专注于此刻的记录与感受）"
    ellipsis_count = all_content.count("……") + all_content.count("...")
    question_count = all_content.count("？") + all_content.count("?")
    dash_count = all_content.count("——") + all_content.count("--")
    per_essay = len(essays)
    punct_habits = []
    if ellipsis_count / per_essay > 2:
        punct_habits.append("爱用省略号（意犹未尽）")
    if question_count / per_essay > 2:
        punct_habits.append("多用问句（善于自我追问）")
    if dash_count / per_essay > 1:
        punct_habits.append("常用破折号（思维跳跃）")
    punct_style = "、".join(punct_habits) if punct_habits else "标点使用较为常规"
    paragraphs = [p.strip() for p in all_content.split('\n') if len(p.strip()) > 10]
    avg_para_len = statistics.mean([len(p) for p in paragraphs]) if paragraphs else 0
    if avg_para_len > 120:
        para_style = "长段沉浸型（思维绵密，不急于换行）"
    elif avg_para_len < 50:
        para_style = "短段利落型（节奏明快，善用留白）"
    else:
        para_style = "段落适中"
    word_counts = [e.word_count for e in essays]
    avg_words = statistics.mean(word_counts)
    if avg_words > 2500:
        volume_style = "每篇篇幅较长，倾向深度展开"
    elif avg_words < 800:
        volume_style = "每篇篇幅简短，倾向精炼表达"
    else:
        volume_style = "篇幅适中"
    # 灵魂词汇：按词性分类，统计跨篇出现次数
    pos_buckets = {"n": Counter(), "v": Counter(), "a": Counter()}  # 名词/动词/形容词
    essay_word_pos = []  # 每篇的 {word: flag} 去重集合
    for e in essays:
        word_pos_set = {}
        for word, flag in pseg.cut(e.content):
            if len(word) < 2 or word in STOPWORDS:
                continue
            root = flag[0] if flag else ""
            if root in ("n", "v", "a"):
                word_pos_set[word] = root
        essay_word_pos.append(word_pos_set)

    # 统计每个词出现在几篇文章里
    cross_count = {"n": Counter(), "v": Counter(), "a": Counter()}
    for wp in essay_word_pos:
        for word, pos in wp.items():
            cross_count[pos][word] += 1

    threshold = max(2, len(essays) // 3)

    def _pick_pos(counter, n=10):
        # 门槛优先（跨篇复现 >= threshold），不足 n 个时按高频补满
        picked = [w for w, c in counter.most_common(30) if c >= threshold]
        if len(picked) < n:
            for w, _ in counter.most_common(n):
                if w not in picked:
                    picked.append(w)
                if len(picked) >= n:
                    break
        return picked[:n]

    soul_words_nouns = _pick_pos(cross_count["n"])
    soul_words_verbs = _pick_pos(cross_count["v"])
    soul_words_adjs  = _pick_pos(cross_count["a"])
    # 兼容旧字段：合并列表
    soul_words = soul_words_nouns + soul_words_verbs + soul_words_adjs
    return {
        "tone": tone,
        "sentence_style": sentence_style,
        "avg_sentence_length": round(avg_sent_len, 1),
        "pos_style": pos_style,
        "pos_ratios": pos_ratios,
        "vocab_richness": vocab_richness,
        "ttr": round(ttr, 3),
        "self_orientation": self_orientation,
        "time_orient": time_orient,
        "punct_style": punct_style,
        "para_style": para_style,
        "volume_style": volume_style,
        "soul_words": soul_words,
        "soul_words_by_pos": {
            "nouns": soul_words_nouns,
            "verbs": soul_words_verbs,
            "adjs": soul_words_adjs,
        },
        "avg_sentiment": round(mean_s, 3),
        "sentiment_std": round(std_s, 3),
        "avg_words_per_essay": round(avg_words),
    }


@app.get("/stats/portrait")
def get_portrait():
    session = Session()
    essays = session.query(Essay).order_by(Essay.date).all()
    session.close()
    if len(essays) < 2:
        raise HTTPException(status_code=400, detail="至少需要2篇随笔才能生成画像")
    return compute_portrait(essays)


@app.post("/stats/deep-analysis")
def deep_analysis():
    """原有接口保留，供现有画像页使用"""
    session = Session()
    essays = session.query(Essay).order_by(Essay.date).all()
    session.close()
    if len(essays) < 2:
        raise HTTPException(status_code=400, detail="至少需要2篇随笔")
    portrait = compute_portrait(essays)
    excerpts = "\n\n".join([
        f"【{e.date} · {e.title}】\n{e.content[:200]}"
        for e in essays
    ])
    prompt = f"""你是一位擅长文学分析的评论家。以下是一位写作者的写作风格数据和文章摘录，请你完成两件事：

## 写作风格数据
- 情感基调：{portrait['tone']}
- 句式偏好：{portrait['sentence_style']}（平均句长{portrait['avg_sentence_length']}字）
- 词性倾向：{portrait['pos_style']}
- 词汇丰富度：{portrait['vocab_richness']}（TTR={portrait['ttr']}）
- 自我取向：{portrait['self_orientation']}
- 时间取向：{portrait['time_orient']}
- 标点习惯：{portrait['punct_style']}
- 段落风格：{portrait['para_style']}
- 篇幅偏好：{portrait['volume_style']}
- 灵魂词汇：{', '.join(portrait['soul_words'])}

## 文章摘录
{excerpts}

## 请你完成：

**一、写作画像（150字以内）**
用有文学质感的语言，描绘这位写作者的写作人格。不要只是重复数据，要有洞察和温度。

**二、最像哪位作家（给出1-2位，中文作家优先）**
从以下维度分析相似性：句式节奏、情感基调、观察视角、意象选择。
给出作家名字 + 相似之处的具体说明（每位100字以内）。"""
    message = anthropic_client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}]
    )
    return {
        "portrait": portrait,
        "analysis": message.content[0].text
    }


# ═══════════════════════════════════════════════════════════
# 半成品仓库（Draft Vault）
# ═══════════════════════════════════════════════════════════

VALID_CATEGORIES = ["散文苗子", "小说点子", "金句警句", "未完成的思考", "观察笔记"]

# ── 数据模型 ──

class Fragment(Base):
    __tablename__ = "fragments"
    id = Column(Integer, primary_key=True)
    essay_id = Column(Integer)
    content = Column(Text, nullable=False)
    categories = Column(Text)       # JSON 数组，如 ["散文苗子"]
    themes = Column(Text)           # JSON 数组，如 ["父亲"]
    quality_score = Column(Float)
    embedding = Column(Text)        # JSON 数组存 float 向量
    ai_title = Column(Text)
    ai_hint = Column(Text)          # 续写建议（为"继续想"留扩展空间）
    user_hidden = Column(Integer, default=0)
    extracted_at = Column(DateTime, default=datetime.now)


class ThemeCluster(Base):
    __tablename__ = "theme_clusters"
    id = Column(Integer, primary_key=True)
    theme_name = Column(Text)
    fragment_ids = Column(Text)     # JSON 数组，如 [1, 3, 7]
    updated_at = Column(DateTime, default=datetime.now)


# ── DB 迁移（幂等） ──

def migrate_vault_db():
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE essays ADD COLUMN fragments_extracted INTEGER DEFAULT 0"))
            conn.commit()
        except Exception:
            pass
    Fragment.__table__.create(engine, checkfirst=True)
    ThemeCluster.__table__.create(engine, checkfirst=True)


migrate_vault_db()

# ── Embedding 模型（懒加载） ──

_embedding_model = None


def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        from sentence_transformers import SentenceTransformer
        _embedding_model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
    return _embedding_model


def generate_embedding(text_content: str) -> list:
    model = get_embedding_model()
    embedding = model.encode(text_content, normalize_embeddings=True)
    return embedding.tolist()


# ── 段落切分 ──

def split_paragraphs(content: str) -> list:
    parts = re.split(r"\n\n+|\n", content)
    return [p.strip() for p in parts if len(p.strip()) >= 30]


# ── Claude Haiku 批量分类 ──

def classify_fragments_with_claude(paragraphs: list) -> list:
    if not paragraphs:
        return []

    numbered = "\n\n".join([f"[{i}] {p}" for i, p in enumerate(paragraphs)])

    prompt = f"""你是写作素材分析师。分析以下编号段落，判断每段是否是"半成品"——即可进一步发展成正式作品的素材。

打分标准（quality_score 0.0-1.0）：
- 具体性：有具体场景/意象/细节（而非泛泛感慨）
- 独特性：视角或观察不落俗套
- 情感厚度：有真实情绪，不是流水账
- 发展空间：还有可继续展开的余地

类别（从以下枚举中选，可多选）：
- 散文苗子：有场景或意象，情绪饱满但缺少结尾/升华
- 小说点子：含人物+冲突+场景中至少两要素
- 金句警句：独立判断性短句，长度<60字，有概括力
- 未完成的思考：提出问题但未给答案，含疑问或"也许""不知道"
- 观察笔记：对外部世界的客观记录，非情绪宣泄

段落列表：
{numbered}

严格以JSON数组返回，长度必须等于段落数量：
[
  {{
    "index": 0,
    "is_valuable": true,
    "categories": ["散文苗子"],
    "quality_score": 0.82,
    "ai_title": "建议标题（10字以内，无合适标题则为null）",
    "ai_hint": "一句话续写建议（20字以内，is_valuable为false则为null）"
  }}
]
只返回JSON数组，不要其他文字。"""

    try:
        message = anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}]
        )
        raw = message.content[0].text.strip()
        # 去掉 markdown 代码块
        raw = re.sub(r"```[a-z]*\n?", "", raw).strip().rstrip("`").strip()
        # 提取第一个 JSON 数组（防止前后有多余文字）
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if match:
            raw = match.group(0)
        return json.loads(raw)
    except Exception as e:
        print(f"[vault] classify error: {e}")
        return []


# ── 单篇随笔分析 ──

def analyze_essay_fragments(essay_id: int):
    session = Session()
    try:
        essay = session.query(Essay).filter(Essay.id == essay_id).first()
        if not essay:
            return

        paragraphs = split_paragraphs(essay.content)
        classifications = classify_fragments_with_claude(paragraphs) if paragraphs else []

        for item in classifications:
            if not item.get("is_valuable"):
                continue
            idx = item.get("index", 0)
            if idx >= len(paragraphs):
                continue
            cats = [c for c in item.get("categories", []) if c in VALID_CATEGORIES]
            if not cats:
                continue

            fragment = Fragment(
                essay_id=essay_id,
                content=paragraphs[idx],
                categories=json.dumps(cats, ensure_ascii=False),
                themes=json.dumps([], ensure_ascii=False),
                quality_score=round(item.get("quality_score", 0.5), 3),
                embedding=json.dumps(generate_embedding(paragraphs[idx])),
                ai_title=item.get("ai_title"),
                ai_hint=item.get("ai_hint"),
                user_hidden=0,
            )
            session.add(fragment)

        session.commit()
        with engine.connect() as conn:
            conn.execute(text("UPDATE essays SET fragments_extracted=1 WHERE id=:id"), {"id": essay_id})
            conn.commit()
    except Exception as e:
        print(f"[vault] analyze_essay {essay_id} error: {e}")
        session.rollback()
    finally:
        session.close()


# ── 主题聚类 ──

def recluster_themes():
    session = Session()
    try:
        fragments = session.query(Fragment).filter(Fragment.user_hidden == 0).all()
        if len(fragments) < 5:
            return

        import numpy as np
        from sklearn.cluster import KMeans

        embeddings = np.array([json.loads(f.embedding) for f in fragments])
        # 簇数：每6-8个片段一组，上限10组，下限3组
        n_clusters = max(3, min(10, len(fragments) // 7))
        labels = KMeans(n_clusters=n_clusters, random_state=42, n_init=10).fit_predict(embeddings)

        cluster_map = {}
        for fragment, label in zip(fragments, labels):
            cluster_map.setdefault(int(label), []).append(fragment)

        if not cluster_map:
            return

        # 给每个簇命名
        cluster_texts = "\n\n".join([
            f"簇{label}:\n" + "\n".join([f"- {f.content[:80]}" for f in frags[:3]])
            for label, frags in cluster_map.items()
        ])
        naming_prompt = f"""以下是从日记中提取的几组相关片段，请为每组起一个简洁的主题名（4-8个汉字）。

{cluster_texts}

严格以JSON对象返回，key是簇编号字符串，value是主题名：
{{"0": "父亲与沉默", "1": "城市孤独感"}}
只返回JSON，不要其他文字。"""

        message = anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[{"role": "user", "content": naming_prompt}]
        )
        raw = message.content[0].text.strip()
        if raw.startswith("```"):
            raw = re.sub(r"```[a-z]*\n?", "", raw).strip().rstrip("`").strip()
        theme_names = json.loads(raw)

        session.query(ThemeCluster).delete()
        for label, frags in cluster_map.items():
            session.add(ThemeCluster(
                theme_name=theme_names.get(str(label), f"主题{label + 1}"),
                fragment_ids=json.dumps([f.id for f in frags]),
            ))
        session.commit()
    except Exception as e:
        print(f"[vault] recluster error: {e}")
        session.rollback()
    finally:
        session.close()


# ── API 端点 ──

@app.get("/vault/status")
def vault_status():
    with engine.connect() as conn:
        pending = conn.execute(
            text("SELECT COUNT(*) FROM essays WHERE fragments_extracted = 0 OR fragments_extracted IS NULL")
        ).scalar()
    session = Session()
    try:
        by_category = {}
        fragments = session.query(Fragment).filter(Fragment.user_hidden == 0).all()
        for f in fragments:
            for cat in json.loads(f.categories or "[]"):
                by_category[cat] = by_category.get(cat, 0) + 1
        hidden_count = session.query(Fragment).filter(Fragment.user_hidden == 1).count()
        return {
            "pending_essays": pending,
            "total_fragments": len(fragments),
            "by_category": by_category,
            "hidden_count": hidden_count,
        }
    finally:
        session.close()


@app.post("/vault/analyze")
def vault_analyze():
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id FROM essays WHERE fragments_extracted = 0 OR fragments_extracted IS NULL")
        ).fetchall()
    essay_ids = [row[0] for row in rows]

    for essay_id in essay_ids:
        analyze_essay_fragments(essay_id)

    if essay_ids:
        recluster_themes()

    return {"analyzed": len(essay_ids)}


@app.get("/vault/fragments")
def list_fragments(category: str = None, hidden_only: bool = False):
    session = Session()
    try:
        # 加载所有随笔的日期供返回
        essays_map = {e.id: e.date for e in session.query(Essay).all()}

        fragments = (
            session.query(Fragment)
            .filter(Fragment.user_hidden == (1 if hidden_only else 0))
            .order_by(Fragment.quality_score.desc())
            .all()
        )
        result = []
        for f in fragments:
            cats = json.loads(f.categories or "[]")
            if category and category not in cats:
                continue
            result.append({
                "id": f.id,
                "essay_id": f.essay_id,
                "essay_date": essays_map.get(f.essay_id),
                "content": f.content,
                "categories": cats,
                "themes": json.loads(f.themes or "[]"),
                "quality_score": f.quality_score,
                "ai_title": f.ai_title,
                "ai_hint": f.ai_hint,
                "extracted_at": f.extracted_at.isoformat() if f.extracted_at else None,
            })
        return result
    finally:
        session.close()


@app.get("/vault/themes")
def list_themes():
    session = Session()
    try:
        clusters = session.query(ThemeCluster).order_by(ThemeCluster.updated_at.desc()).all()
        result = []
        for c in clusters:
            frag_ids = json.loads(c.fragment_ids or "[]")
            frags = (
                session.query(Fragment)
                .filter(Fragment.id.in_(frag_ids), Fragment.user_hidden == 0)
                .all()
            )
            result.append({
                "id": c.id,
                "theme_name": c.theme_name,
                "fragment_count": len(frags),
                "fragments": [
                    {
                        "id": f.id,
                        "content": f.content,
                        "ai_title": f.ai_title,
                        "quality_score": f.quality_score,
                        "categories": json.loads(f.categories or "[]"),
                    }
                    for f in frags
                ],
            })
        return result
    finally:
        session.close()


class FragmentFeedback(BaseModel):
    hidden: bool


@app.patch("/vault/fragments/{fragment_id}")
def update_fragment_feedback(fragment_id: int, data: FragmentFeedback):
    session = Session()
    try:
        fragment = session.query(Fragment).filter(Fragment.id == fragment_id).first()
        if not fragment:
            raise HTTPException(status_code=404, detail="Fragment not found")
        fragment.user_hidden = 1 if data.hidden else 0
        session.commit()
        return {"ok": True}
    finally:
        session.close()


DEEP_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "literaryPersona": {
            "type": "object",
            "properties": {
                "author": {"type": "string"},
                "reasoning": {"type": "string"},
                "similarities": {
                    "type": "object",
                    "properties": {
                        "style": {"type": "string"},
                        "countryOrigin": {"type": "string"},
                        "logic": {"type": "string"},
                        "spirit": {"type": "string"},
                    },
                    "required": ["style", "countryOrigin", "logic", "spirit"],
                },
            },
            "required": ["author", "reasoning", "similarities"],
        },
        "wordCloud": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"text": {"type": "string"}, "weight": {"type": "number"}},
                "required": ["text", "weight"],
            },
        },
        "dimensions": {
            "type": "object",
            "properties": {
                "lexical":   {"type": "object", "properties": {"label": {"type": "string"}, "metrics": {"type": "array", "items": {"type": "object", "properties": {"label": {"type": "string"}, "value": {"type": "number"}}, "required": ["label", "value"]}}}, "required": ["label", "metrics"]},
                "syntactic": {"type": "object", "properties": {"label": {"type": "string"}, "metrics": {"type": "array", "items": {"type": "object", "properties": {"label": {"type": "string"}, "value": {"type": "number"}}, "required": ["label", "value"]}}}, "required": ["label", "metrics"]},
                "affective": {"type": "object", "properties": {"label": {"type": "string"}, "metrics": {"type": "array", "items": {"type": "object", "properties": {"label": {"type": "string"}, "value": {"type": "number"}}, "required": ["label", "value"]}}}, "required": ["label", "metrics"]},
                "narrative": {"type": "object", "properties": {"label": {"type": "string"}, "metrics": {"type": "array", "items": {"type": "object", "properties": {"label": {"type": "string"}, "value": {"type": "number"}}, "required": ["label", "value"]}}}, "required": ["label", "metrics"]},
            },
            "required": ["lexical", "syntactic", "affective", "narrative"],
        },
        "structure": {
            "type": "object",
            "properties": {
                "nodes": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "type": {"type": "string"},
                        },
                        "required": ["title", "description", "type"],
                    },
                }
            },
            "required": ["nodes"],
        },
        "keyPoints": {"type": "array", "items": {"type": "string"}},
        "sentiment": {
            "type": "object",
            "properties": {
                "score": {"type": "number"},
                "label": {"type": "string"},
                "intensity": {"type": "number"},
            },
            "required": ["score", "label", "intensity"],
        },
    },
    "required": ["literaryPersona", "wordCloud", "dimensions", "structure", "keyPoints", "sentiment"],
}


@app.post("/essays/{essay_id}/deep-analysis")
def essay_deep_analysis(essay_id: int):
    if not gemini_client:
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY 未配置")

    session = Session()
    essay = session.query(Essay).filter(Essay.id == essay_id).first()
    session.close()
    if not essay:
        raise HTTPException(status_code=404, detail="随笔不存在")
    if len(essay.content) < 100:
        raise HTTPException(status_code=400, detail="文章太短，无法深度分析（至少需要100字）")

    # 本地统计数据作为参考
    local = analyze_text(essay.content)
    sentences = re.split(r'[。！？]', essay.content)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 2]
    avg_sent_len = round(statistics.mean([len(s) for s in sentences]), 1) if sentences else 0

    prompt = f"""你是一位中文文学评论家，擅长分析个人随笔。请对以下随笔进行深度文学分析。

要求：
1. 所有返回内容使用中文
2. 推荐作家优先选择中国当代或古典作家，其次才是外国作家
3. wordCloud 提取 15-20 个最具意象性的词汇，weight 为 1-10 的整数
4. dimensions 四个层面各给 3 个指标，value 为 0-100 的整数，指标名称用中文
5. structure.nodes 给出 3-5 个叙事节点，type 只能是以下之一：introduction / argument / narrative_point / conclusion
6. keyPoints 给出 3 条核心意蕴，每条一句话，要有洞察力，不要重复统计数据
7. sentiment.score 范围 -1.0 到 1.0，正值偏积极，负值偏消极；label 用四字短语描述情感质地

参考数据（本地统计，仅供参考）：
- 平均句长：{avg_sent_len} 字
- 词性分布：{local['pos_distribution']}
- 情感得分（0-1）：{round(essay.sentiment_score, 3) if essay.sentiment_score else 'N/A'}

随笔原文：
【{essay.date} · {essay.title}】

{essay.content}"""

    try:
        response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=DEEP_ANALYSIS_SCHEMA,
            ),
        )
        result = json.loads(response.text)
        return result
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="AI 返回格式异常，请重试")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"分析失败：{str(e)}")


# ── 托管编译后的前端（Phase 0：单进程同源提供前端 + API）──
# 必须放在所有 API 路由注册之后，避免根挂载抢占接口路由。
_DIST_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "dist")
if os.path.isdir(_DIST_DIR):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=_DIST_DIR, html=True), name="frontend")
    print(f"[Frontend] 已托管前端静态文件：{_DIST_DIR}")
else:
    print(f"[Frontend] 未找到前端构建产物（{_DIST_DIR}），仅提供 API。先在 frontend/ 运行 npm run build")
