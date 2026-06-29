import json
import pytest
import main


@pytest.fixture
def vault_db():
    """清空 vault 相关表（Essay / Fragment / ThemeCluster），保证隔离。"""
    def _clear():
        s = main.Session()
        s.query(main.Fragment).delete()
        s.query(main.ThemeCluster).delete()
        s.query(main.Essay).delete()
        s.commit()
        s.close()
    _clear()
    yield
    _clear()


def _seed_essay(content, title="t"):
    s = main.Session()
    e = main.Essay(title=title, content=content, date="2026-06-01", word_count=len(content))
    s.add(e)
    s.flush()
    eid = e.id
    s.commit()
    s.close()
    return eid


# 一段够长（split_paragraphs 要求 ≥30 字）的正文
_LONG = "这是一段足够长的随笔文字，用来测试半成品仓库的分析流程，字数确保超过三十个字符没有问题。"


def _patch_deepseek(monkeypatch, return_text):
    """把 main._deepseek_chat 换成假对象，记录最近一次 (system, user, max_tokens, model)。"""
    cap = {}

    def fake(system, user, max_tokens, model=None):
        cap.update(system=system, user=user, max_tokens=max_tokens, model=model)
        return return_text

    monkeypatch.setattr(main, "_deepseek_chat", fake)
    return cap


def test_classify_fragments_uses_deepseek_vault_model(monkeypatch):
    payload = json.dumps([
        {"index": 0, "is_valuable": True, "categories": ["金句警句"],
         "quality_score": 0.8, "ai_title": "灯", "ai_hint": "再写一句"},
    ], ensure_ascii=False)
    cap = _patch_deepseek(monkeypatch, payload)

    out = main.classify_fragments(["夜里十一点的便利店，灯亮着，像一座不睡的小岛。"])

    assert len(out) == 1 and out[0]["categories"] == ["金句警句"]
    assert cap["model"] == main.DEEPSEEK_VAULT_MODEL          # 走仓库专用模型
    assert cap["max_tokens"] >= 4000                          # 推理模型留足预算


def test_classify_fragments_strips_markdown_fences(monkeypatch):
    fenced = "```json\n[{\"index\":0,\"is_valuable\":true,\"categories\":[\"观察笔记\"],\"quality_score\":0.6}]\n```"
    _patch_deepseek(monkeypatch, fenced)

    out = main.classify_fragments(["窗外的雨下了一整天，没有要停的意思。"])

    assert len(out) == 1 and out[0]["categories"] == ["观察笔记"]


def test_classify_fragments_empty_input_skips_call(monkeypatch):
    called = {"n": 0}
    monkeypatch.setattr(main, "_deepseek_chat",
                        lambda *a, **k: called.__setitem__("n", called["n"] + 1) or "[]")
    assert main.classify_fragments([]) == []
    assert called["n"] == 0                                   # 无段落不应调模型


# ── #4 失败语义：classify 失败抛错，不吞成 [] ──

def test_classify_fragments_raises_on_bad_json(monkeypatch):
    _patch_deepseek(monkeypatch, "这不是 JSON，只是一段闲话。")
    with pytest.raises(Exception):
        main.classify_fragments(["随便一段够长的文字凑够三十个字符以上用于触发分类逻辑。"])


def test_classify_fragments_raises_on_api_error(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("network down")
    monkeypatch.setattr(main, "_deepseek_chat", boom)
    with pytest.raises(Exception):
        main.classify_fragments(["随便一段够长的文字凑够三十个字符以上用于触发分类逻辑。"])


# ── #4 标记语义：成功才标记，失败保留待重试 ──

def test_analyze_marks_extracted_when_no_valuable(monkeypatch, vault_db):
    eid = _seed_essay(_LONG)
    monkeypatch.setattr(main, "classify_fragments", lambda paras: [])   # 成功但没料
    res = main.analyze_essay_fragments(eid)
    assert res["ok"] is True and res["fragments"] == 0
    assert eid not in main._pending_essay_ids()                          # 已标记，不再 pending


def test_analyze_does_not_mark_on_classify_failure(monkeypatch, vault_db):
    eid = _seed_essay(_LONG)

    def boom(paras):
        raise RuntimeError("classify failed")
    monkeypatch.setattr(main, "classify_fragments", boom)
    res = main.analyze_essay_fragments(eid)
    assert res["ok"] is False and res["error"]
    assert eid in main._pending_essay_ids()                             # 未标记，留待重试


def test_analyze_short_essay_marked_without_calling_model(monkeypatch, vault_db):
    eid = _seed_essay("太短了。")                                        # <30 字，无段落
    called = {"n": 0}
    monkeypatch.setattr(main, "classify_fragments",
                        lambda paras: called.__setitem__("n", called["n"] + 1) or [])
    res = main.analyze_essay_fragments(eid)
    assert res["ok"] is True and called["n"] == 0                       # 没调模型
    assert eid not in main._pending_essay_ids()                        # 仍标记，别永远 pending


# ── #8 后台 worker：逐篇进度 + 失败明细 ──

def test_run_vault_job_tracks_progress_and_failures(monkeypatch, vault_db):
    ok_id = _seed_essay(_LONG, title="ok")
    fail_id = _seed_essay(_LONG + " FAILMARK", title="fail")

    def fake_classify(paras):
        if any("FAILMARK" in p for p in paras):
            raise RuntimeError("boom")
        return [{"index": 0, "is_valuable": True, "categories": ["金句警句"],
                 "quality_score": 0.7, "ai_title": "标题", "ai_hint": "续写"}]
    monkeypatch.setattr(main, "classify_fragments", fake_classify)
    monkeypatch.setattr(main, "generate_embedding", lambda t: [0.1] * 8)

    main._vault_job.update(running=True, total=2, done=0, failed=[],
                           started_at=None, finished_at=None)
    main._run_vault_job([ok_id, fail_id])

    assert main._vault_job["done"] == 2
    assert main._vault_job["running"] is False                         # finally 收尾
    assert [f["essay_id"] for f in main._vault_job["failed"]] == [fail_id]
    pending = main._pending_essay_ids()
    assert ok_id not in pending and fail_id in pending                 # 成功标记、失败保留
    n = main.Session().query(main.Fragment).filter(main.Fragment.essay_id == ok_id).count()
    assert n == 1


def test_vault_analyze_no_pending_returns_not_started(client, vault_db):
    main._vault_job.update(running=False)
    r = client.post("/vault/analyze").json()
    assert r["started"] is False and r["running"] is False and r["total"] == 0
