import main
import pytest


@pytest.fixture
def mock_deepseek(monkeypatch):
    """把 main._deepseek_chat 换成可编程假对象。
    set_text 设返回的信文；captured 记录最近一次的 (system, user, max_tokens)。"""
    state = {"text": "letter-ok", "captured": {}}

    def fake(system, user, max_tokens):
        state["captured"] = {"system": system, "user": user, "max_tokens": max_tokens}
        return state["text"]

    monkeypatch.setattr(main, "_deepseek_chat", fake)

    class Ctl:
        @property
        def captured(self):
            return state["captured"]
        def set_text(self, t):
            state["text"] = t
    return Ctl()


def test_reader_returns_letter(client, mock_deepseek):
    mock_deepseek.set_text("读你这篇时，我先听见了灯。……")
    r = client.post("/assist/reader", json={
        "title": "夜里十一点的便利店",
        "content": "我买了一瓶水，其实并不渴。",
        "persona": "poet",
    })
    assert r.status_code == 200
    assert r.json()["letter"].startswith("读你这篇时")


def test_reader_calls_deepseek_with_persona_system(client, mock_deepseek):
    client.post("/assist/reader", json={
        "title": "T", "content": "C", "persona": "debater",
    })
    cap = mock_deepseek.captured
    # 辩论家的人格设定进了 system，且没有注入 SOUL 风格指令
    assert "辩论家" in cap["system"]
    assert "写作风格为" not in cap["system"]
    # 推理模型要给足 max_tokens（容纳推理 + 信文）
    assert cap["max_tokens"] >= 4000


def test_reader_rejects_bad_persona(client):
    r = client.post("/assist/reader", json={
        "title": "T", "content": "C", "persona": "nobody",
    })
    assert r.status_code == 400


def test_reader_rejects_empty_content(client):
    r = client.post("/assist/reader", json={
        "title": "T", "content": "  ", "persona": "poet",
    })
    assert r.status_code == 400


def test_cite_parses_quote_source_url(client, mock_anthropic):
    mock_anthropic.set_text(
        "知人者智，自知者明。 ||| 老子《道德经》 ||| https://example.com/a\n"
        "我思故我在。 ||| 笛卡尔 ||| https://example.com/b"
    )
    r = client.post("/assist/cite", json={"text": "认识自己很重要", "context": ""})
    assert r.status_code == 200
    opts = r.json()["options"]
    assert len(opts) == 2
    assert opts[0] == {
        "quote": "知人者智，自知者明。",
        "source": "老子《道德经》",
        "url": "https://example.com/a",
    }


def test_cite_uses_sonnet_and_web_search_no_soul(client, mock_anthropic):
    mock_anthropic.set_text("x ||| y ||| z")
    client.post("/assist/cite", json={"text": "论断", "context": ""})
    cap = mock_anthropic.captured
    assert cap["model"] == "claude-sonnet-4-6"
    tool_types = [t.get("type") for t in cap["tools"]]
    assert "web_search_20260209" in tool_types
    assert "写作风格为" not in (cap.get("system") or "")


def test_cite_empty_results_returns_empty_options(client, mock_anthropic):
    mock_anthropic.set_text("没有查到可靠的出处。")
    r = client.post("/assist/cite", json={"text": "论断", "context": ""})
    assert r.status_code == 200
    assert r.json()["options"] == []


def test_cite_rejects_empty_text(client, mock_anthropic):
    r = client.post("/assist/cite", json={"text": "  ", "context": ""})
    assert r.status_code == 400


# ── /assist/continue：续写（注入 SOUL，把 hint 带进 user）──

def test_continue_returns_result_and_uses_sonnet(client, mock_anthropic):
    mock_anthropic.set_text("夜更深了，便利店的灯还亮着，像替谁守着一盏。")
    r = client.post("/assist/continue", json={
        "text": "我买了一瓶水，其实并不渴。", "hints": ["把'灯'这个意象再推一层"],
    })
    assert r.status_code == 200
    assert r.json()["result"].startswith("夜更深了")
    cap = mock_anthropic.captured
    assert cap["model"] == "claude-sonnet-4-6"


def test_continue_injects_soul_taboo_and_hint(client, mock_anthropic, db):
    mock_anthropic.set_text("续写内容")
    client.post("/assist/continue", json={
        "text": "原文一句。", "hints": ["朝孤独的反面写"],
    })
    cap = mock_anthropic.captured
    # 无 SOUL 时 system 回落 DEFAULT_TABOO（含「AI 腔」），证明走了 SOUL 注入路径
    assert "AI 腔" in cap["system"]
    # hint 与原文进了发给模型的 user 消息
    user_msg = cap["messages"][0]["content"]
    assert "朝孤独的反面写" in user_msg
    assert "原文一句" in user_msg


def test_continue_rejects_empty_text(client, mock_anthropic):
    r = client.post("/assist/continue", json={"text": "  ", "hints": []})
    assert r.status_code == 400
