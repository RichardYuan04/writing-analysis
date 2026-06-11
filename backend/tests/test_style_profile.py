import main


def test_app_boots(client):
    # /essays 是已有接口，能 200 即说明 app 正常起来了
    r = client.get("/essays")
    assert r.status_code == 200


def test_style_profile_model_exists_and_empty(db):
    s = db()
    # 表存在且初始为空
    assert s.query(main.StyleProfile).count() == 0
    s.close()


def test_sample_excerpts_preserves_text_and_caps_total():
    class E:
        def __init__(self, title, content):
            self.title = title
            self.content = content
    essays = [
        E("甲", "第一句。\n第二句换行保留。"),
        E("乙", "另一篇内容。"),
    ]
    out = main._sample_excerpts(essays, per_essay_cap=400, total_cap=800)
    # 标题分隔 + 原文（含换行）都在
    assert "【甲】" in out and "【乙】" in out
    assert "第二句换行保留。" in out
    assert "\n" in out  # 节奏（换行）被保留


def test_sample_excerpts_truncates_long_essay():
    class E:
        def __init__(self, content):
            self.title = "x"
            self.content = content
    long = "啊" * 1000
    out = main._sample_excerpts([E(long)], per_essay_cap=400, total_cap=800)
    # 单篇被截到 ~400 字（含省略号），不会整篇 1000 字塞进去
    assert out.count("啊") <= 401


def test_sample_excerpts_stops_at_total_cap():
    class E:
        def __init__(self, i):
            self.title = f"t{i}"
            self.content = "字" * 300
    essays = [E(i) for i in range(10)]
    out = main._sample_excerpts(essays, per_essay_cap=400, total_cap=800)
    # 累计到 ~800 就停，不会把 10 篇全放进来
    assert out.count("字") <= 900


def test_parse_soul_json_plain():
    raw = '{"soul":"偏好短句，重意象。","rationale":{"rhythm":"短","imagery":"多","emotion":"克制","diction":"书面","signature":"留白"}}'
    out = main._parse_soul_json(raw)
    assert out["soul"].startswith("偏好短句")
    assert out["rationale"]["rhythm"] == "短"


def test_parse_soul_json_with_code_fence():
    raw = '```json\n{"soul":"x","rationale":{}}\n```'
    out = main._parse_soul_json(raw)
    assert out["soul"] == "x"
    assert out["rationale"] == {}


def test_parse_soul_json_with_surrounding_text():
    raw = '好的，分析如下：\n{"soul":"y","rationale":{"rhythm":"短"}}\n以上。'
    out = main._parse_soul_json(raw)
    assert out["soul"] == "y"


def test_parse_soul_json_fallback_on_garbage():
    raw = '这不是 JSON，只是一段风格描述：偏好短句。'
    out = main._parse_soul_json(raw)
    # 兜底：soul 用原文，rationale 为空 dict，不抛异常
    assert out["soul"] == raw.strip()
    assert out["rationale"] == {}
