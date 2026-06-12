import os
import tempfile
import pytest

# 在导入 main 之前，把 DB 指向临时文件，避免污染真实 essays.db
_tmp_db = os.path.join(tempfile.gettempdir(), "soul_test_essays.db")
if os.path.exists(_tmp_db):
    os.remove(_tmp_db)
os.environ["ESSAYS_DB_URL"] = f"sqlite:///{_tmp_db}"
# 给 anthropic client 一个占位 key，保证 import 期不报错（实际调用会被 mock）
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")

import main  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def db():
    """每个测试开始清空相关表，结束再清空，保证隔离。"""
    def _clear():
        s = main.Session()
        s.query(main.Essay).delete()
        try:
            s.query(main.StyleProfile).delete()
        except Exception:
            pass
        try:
            s.query(main.Draft).delete()
        except Exception:
            pass
        s.commit()
        s.close()
    _clear()
    yield main.Session
    _clear()


@pytest.fixture
def seed_essays(db):
    """插入 3 篇带 sentiment_score 的随笔，返回它们的 id。"""
    s = main.Session()
    ids = []
    samples = [
        ("雨", "窗外在下雨。我看着，没有说话。雨点敲在玻璃上，很轻。", 0.45),
        ("旧信", "翻出一封旧信。字迹淡了。那年的事，像隔着一层毛玻璃。", 0.50),
        ("夜路", "一个人走夜路。路灯把影子拉长。风很凉，心里却空落落的。", 0.40),
    ]
    for title, content, score in samples:
        e = main.Essay(title=title, content=content, date="2026-01-01",
                       word_count=len(content), sentiment_score=score)
        s.add(e)
        s.flush()
        ids.append(e.id)
    s.commit()
    s.close()
    return ids


@pytest.fixture
def mock_anthropic(monkeypatch):
    """把 anthropic_client.messages.create 换成可编程的假对象。
    用法：mock_anthropic.set_text("返回内容")；断言用 mock_anthropic.captured["model"]。
    captured 始终是最近一次调用的 kwargs。"""
    class _Resp:
        def __init__(self, text):
            self.content = [type("B", (), {"text": text})()]
    state = {"text": "pong", "captured": {}}

    def capturing_create(*args, **kwargs):
        state["captured"].clear()
        state["captured"].update(kwargs)
        return _Resp(state["text"])

    monkeypatch.setattr(main.anthropic_client.messages, "create", capturing_create)

    class Ctl:
        @property
        def captured(self):
            return state["captured"]
        def set_text(self, t):
            state["text"] = t
    return Ctl()
