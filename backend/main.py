from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine, Column, Integer, String, Text, Float, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from datetime import datetime
from collections import Counter
import jieba
import jieba.posseg as pseg
from snownlp import SnowNLP
import re
import os
import statistics
from dotenv import load_dotenv
import anthropic

load_dotenv()
anthropic_client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 数据库
engine = create_engine("sqlite:///./essays.db")
Base = declarative_base()

class Essay(Base):
    __tablename__ = "essays"
    id = Column(Integer, primary_key=True)
    title = Column(String(200))
    content = Column(Text)
    date = Column(String(10))  # YYYY-MM-DD
    word_count = Column(Integer)
    sentiment_score = Column(Float)
    created_at = Column(DateTime, default=datetime.now)

Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)

# 停用词（常见无意义词）
STOPWORDS = set(["的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
                  "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
                  "自己", "这", "那", "们", "与", "及", "或", "但", "而", "因为", "所以", "如果",
                  "虽然", "然后", "但是", "这个", "那个", "什么", "怎么", "为什么", "这样", "那样"])

def analyze_text(content: str):
    # 分词
    words = [w for w in jieba.cut(content) if len(w) > 1 and w not in STOPWORDS]
    word_count = len(content.replace(" ", "").replace("\n", ""))

    # 词频
    freq = Counter(words)
    top_words = [{"word": w, "count": c} for w, c in freq.most_common(50)]

    # 情感分析
    sentences = re.split(r'[。！？\n]', content)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 5]
    if sentences:
        scores = [SnowNLP(s).sentiments for s in sentences[:20]]
        sentiment = sum(scores) / len(scores)
    else:
        sentiment = 0.5

    # 词性分析
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
        "sentiment": round(sentiment, 3),
        "pos_distribution": dict(pos_counts),
    }


class EssayCreate(BaseModel):
    title: str
    content: str
    date: str  # YYYY-MM-DD


@app.post("/essays")
def create_essay(data: EssayCreate):
    analysis = analyze_text(data.content)
    session = Session()
    essay = Essay(
        title=data.title,
        content=data.content,
        date=data.date,
        word_count=analysis["word_count"],
        sentiment_score=analysis["sentiment"],
    )
    session.add(essay)
    session.commit()
    session.refresh(essay)
    result = {"id": essay.id, **data.dict(), **analysis}
    session.close()
    return result


@app.get("/essays")
def list_essays():
    session = Session()
    essays = session.query(Essay).order_by(Essay.date.desc()).all()
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
        "date": essay.date,
        **analysis,
    }
    session.close()
    return result


class EssayUpdate(BaseModel):
    title: str
    content: str
    date: str


@app.put("/essays/{essay_id}")
def update_essay(essay_id: int, data: EssayUpdate):
    session = Session()
    essay = session.query(Essay).filter(Essay.id == essay_id).first()
    if not essay:
        session.close()
        raise HTTPException(status_code=404, detail="Not found")
    analysis = analyze_text(data.content)
    essay.title = data.title
    essay.content = data.content
    essay.date = data.date
    essay.word_count = analysis["word_count"]
    essay.sentiment_score = analysis["sentiment"]
    session.commit()
    result = {"id": essay.id, **data.dict(), **analysis}
    session.close()
    return result


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

    # 日历热力图数据
    heatmap = [{"date": e.date, "count": 1, "word_count": e.word_count} for e in essays]

    # 情感趋势
    sentiment_trend = sorted(
        [{"date": e.date, "score": e.sentiment_score, "title": e.title} for e in essays],
        key=lambda x: x["date"]
    )

    # 全部文章合并词云
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


def compute_portrait(essays):
    """计算写作画像的所有本地维度（全部基于统计，无需API）"""
    all_content = " ".join([e.content for e in essays])
    scores = [e.sentiment_score for e in essays]

    # ── 1. 情感基调（相对标准：在用户自己的分布里评估）──
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

    # ── 2. 句式偏好 ──
    sentences = re.split(r'[。！？]', all_content)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 2]
    avg_sent_len = statistics.mean([len(s) for s in sentences]) if sentences else 0
    if avg_sent_len > 28:
        sentence_style = "长句型"
    elif avg_sent_len < 14:
        sentence_style = "短句型"
    else:
        sentence_style = "长短句混用"

    # ── 3. 词性倾向 ──
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

    # ── 4. 词汇丰富度 TTR ──
    words = [w for w in jieba.cut(all_content) if len(w) > 1 and w not in STOPWORDS]
    ttr = len(set(words)) / len(words) if words else 0
    if ttr > 0.6:
        vocab_richness = "词汇非常丰富多样"
    elif ttr > 0.4:
        vocab_richness = "词汇丰富度适中"
    else:
        vocab_richness = "词汇偏向集中重复（风格统一）"

    # ── 5. 自我中心度 ──
    self_words = ["我", "自己", "我的", "我们"]
    self_count = sum(all_content.count(w) for w in self_words)
    self_ratio = self_count / (len(all_content) / 100) if all_content else 0
    if self_ratio > 3:
        self_orientation = "高度自我叙述（以第一视角观察和感受为主）"
    elif self_ratio > 1.5:
        self_orientation = "内外兼顾（自我与外部观察并重）"
    else:
        self_orientation = "向外观察型（更多聚焦外部世界）"

    # ── 6. 时间取向 ──
    past_words = ["曾经", "以前", "那时", "记得", "那年", "过去", "当时", "回忆"]
    future_words = ["将来", "未来", "以后", "打算", "希望", "计划", "会", "想要"]
    past_count = sum(all_content.count(w) for w in past_words)
    future_count = sum(all_content.count(w) for w in future_words)
    if past_count > future_count * 1.5:
        time_orient = "回望型（偏向回忆与过去）"
    elif future_count > past_count * 1.5:
        time_orient = "展望型（偏向未来与期待）"
    else:
        time_orient = "当下型（专注于此刻的记录与感受）"

    # ── 7. 标点习惯 ──
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

    # ── 8. 段落长度偏好 ──
    paragraphs = [p.strip() for p in all_content.split('\n') if len(p.strip()) > 10]
    avg_para_len = statistics.mean([len(p) for p in paragraphs]) if paragraphs else 0
    if avg_para_len > 120:
        para_style = "长段沉浸型（思维绵密，不急于换行）"
    elif avg_para_len < 50:
        para_style = "短段利落型（节奏明快，善用留白）"
    else:
        para_style = "段落适中"

    # ── 9. 写作节律 ──
    word_counts = [e.word_count for e in essays]
    avg_words = statistics.mean(word_counts)
    if avg_words > 1200:
        volume_style = "每篇篇幅较长，倾向深度展开"
    elif avg_words < 500:
        volume_style = "每篇篇幅简短，倾向精炼表达"
    else:
        volume_style = "篇幅适中"

    # ── 10. 灵魂词汇（跨多篇出现的词）──
    essay_word_sets = []
    for e in essays:
        ws = set(w for w in jieba.cut(e.content) if len(w) > 1 and w not in STOPWORDS)
        essay_word_sets.append(ws)
    word_essay_count = Counter()
    for ws in essay_word_sets:
        for w in ws:
            word_essay_count[w] += 1
    soul_words = [w for w, c in word_essay_count.most_common(20) if c >= max(2, len(essays) // 3)][:6]

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
    session = Session()
    essays = session.query(Essay).order_by(Essay.date).all()
    session.close()
    if len(essays) < 2:
        raise HTTPException(status_code=400, detail="至少需要2篇随笔")

    portrait = compute_portrait(essays)

    # 每篇取前200字作为风格样本
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
