import json
import main


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
