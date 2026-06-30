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


def test_parse_soul_output_labeled():
    raw = "【SOUL】\n偏好短句，善用感官意象，情绪克制。\n\n【节奏】短句为主\n【意象】感官意象\n【情绪】克制\n【用词】书面\n【手法】留白"
    out = main._parse_soul_output(raw)
    assert out["soul"] == "偏好短句，善用感官意象，情绪克制。"
    assert out["rationale"]["rhythm"] == "短句为主"
    assert out["rationale"]["signature"] == "留白"


def test_parse_soul_output_quotes_dont_break_parsing():
    # 风格串里含引号/标点 —— 这正是 JSON 方案翻车的根因，标签分段必须免疫
    raw = '【SOUL】\n善用「留白」，句子像"一封写给自己的信"，克制而有余味。\n\n【节奏】长短交错\n【意象】丰富'
    out = main._parse_soul_output(raw)
    assert "留白" in out["soul"]
    assert '"一封写给自己的信"' in out["soul"]
    assert out["rationale"]["rhythm"] == "长短交错"


def test_parse_soul_output_with_code_fence():
    raw = '```\n【SOUL】\nx的风格\n【节奏】短\n```'
    out = main._parse_soul_output(raw)
    assert out["soul"] == "x的风格"
    assert out["rationale"]["rhythm"] == "短"


def test_parse_soul_output_fallback_no_marker():
    raw = '偏好短句，情绪克制。'
    out = main._parse_soul_output(raw)
    # 无标签时整段当 soul，rationale 为空，不抛异常
    assert out["soul"] == "偏好短句，情绪克制。"
    assert out["rationale"] == {}


def test_generate_requires_essay_ids(client, db):
    r = client.post("/style-profiles/generate", json={"essay_ids": []})
    assert r.status_code == 400


def test_generate_creates_row_and_uses_sonnet(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text("【SOUL】\n偏好短句，善用感官意象，情绪克制。\n\n【节奏】短句为主\n【意象】感官意象\n【情绪】克制\n【用词】书面\n【手法】留白")
    r = client.post("/style-profiles/generate", json={"essay_ids": seed_essays})
    assert r.status_code == 200
    body = r.json()
    assert body["content"].startswith("偏好短句")
    assert body["rationale"]["rhythm"] == "短句为主"
    assert sorted(body["source_essay_ids"]) == sorted(seed_essays)
    # 用了 Sonnet
    assert mock_anthropic.captured.get("model") == "claude-sonnet-4-6"
    s = main.Session()
    assert s.query(main.StyleProfile).count() == 1
    row = s.query(main.StyleProfile).first()
    assert row.user_edited == 0
    s.close()


def test_generate_creates_separate_slots(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text("【SOUL】\n第一版")
    client.post("/style-profiles/generate", json={"essay_ids": seed_essays})
    mock_anthropic.set_text("【SOUL】\n第二版")
    client.post("/style-profiles/generate", json={"essay_ids": seed_essays})
    s = main.Session()
    assert s.query(main.StyleProfile).count() == 2   # 各建一槽，不再 upsert 单行
    s.close()


def test_list_style_profiles_empty(client, db):
    r = client.get("/style-profiles")
    assert r.status_code == 200
    body = r.json()
    assert body["active_id"] is None
    assert body["profiles"] == []
    assert body["taboo"] == main.DEFAULT_TABOO


def test_list_style_profiles_after_generate(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text("【SOUL】\n偏好短句。\n\n【节奏】短")
    g = client.post("/style-profiles/generate", json={"essay_ids": seed_essays}).json()
    body = client.get("/style-profiles").json()
    assert body["active_id"] == g["id"]
    p = body["profiles"][0]
    assert p["content"] == "偏好短句。"
    assert p["rationale"]["rhythm"] == "短"
    assert p["new_essays_since"] == 0  # 生成后没有更新的文章


def test_put_style_profile_sets_user_edited(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text("【SOUL】\n原始版")
    g = client.post("/style-profiles/generate", json={"essay_ids": seed_essays}).json()
    r = client.put(f"/style-profiles/{g['id']}", json={"content": "我手改后的风格串"})
    assert r.status_code == 200
    assert r.json()["content"] == "我手改后的风格串"
    assert r.json()["user_edited"] == 1
    assert sorted(r.json()["source_essay_ids"]) == sorted(seed_essays)  # 选篇不变


def test_put_missing_slot_404(client, db):
    r = client.put("/style-profiles/9999", json={"content": "凭空写一版"})
    assert r.status_code == 404


def test_assist_reduce_uses_haiku(client, db, mock_anthropic):
    mock_anthropic.set_text("压缩后的文字")
    r = client.post("/assist/reduce", json={"text": "一段需要压缩的较长的文字内容。"})
    assert r.status_code == 200
    assert mock_anthropic.captured["model"] == "claude-haiku-4-5-20251001"


def test_assist_metaphor_uses_opus(client, db, mock_anthropic):
    mock_anthropic.set_text("1. 像一根抽走的细线\n2. 像午后停电")
    r = client.post("/assist/metaphor", json={"text": "一种说不清的失落。"})
    assert r.status_code == 200
    assert mock_anthropic.captured["model"] == "claude-opus-4-8"


def test_assist_synonyms_and_expand_use_sonnet(client, db, mock_anthropic):
    mock_anthropic.set_text("候选")
    client.post("/assist/synonyms", json={"text": "怅然若失的感觉。"})
    assert mock_anthropic.captured["model"] == "claude-sonnet-4-6"
    client.post("/assist/expand", json={"text": "他走了。"})
    assert mock_anthropic.captured["model"] == "claude-sonnet-4-6"


def test_assist_injects_soul_when_present(client, db, seed_essays, mock_anthropic):
    # 先造一份 SOUL 文档（自动成为默认槽）
    mock_anthropic.set_text("【SOUL】\n偏好短句，情绪克制。")
    client.post("/style-profiles/generate", json={"essay_ids": seed_essays})
    # 再调 reduce，断言 system 注入了 SOUL 内容
    mock_anthropic.set_text("压缩结果")
    client.post("/assist/reduce", json={"text": "一段较长的需要压缩的文字。"})
    sys_prompt = mock_anthropic.captured["system"]
    assert "偏好短句，情绪克制。" in sys_prompt


def test_assist_metaphor_does_not_inject_soul(client, seed_essays, mock_anthropic):
    # 即使存在 SOUL 文档，比喻也完全放开、不注入它
    mock_anthropic.set_text("【SOUL】\n善用感官意象，情绪克制。")
    client.post("/style-profiles/generate", json={"essay_ids": seed_essays})
    mock_anthropic.set_text("1. 像一根被抽走的细线\n2. 像午后忽然停电")
    client.post("/assist/metaphor", json={"text": "一种说不清的失落。"})
    sys_prompt = mock_anthropic.captured["system"]
    assert "善用感官意象" not in sys_prompt      # 不带 SOUL 的意象
    assert "该作者的写作风格为" not in sys_prompt  # 不注入 SOUL
    assert "比喻" in sys_prompt                   # 用了比喻专属 system


def test_assist_degrades_without_soul(client, db, mock_anthropic):
    mock_anthropic.set_text("压缩结果")
    client.post("/assist/reduce", json={"text": "一段较长的需要压缩的文字。"})
    sys_prompt = mock_anthropic.captured["system"]
    # 走降级分支：不含「该作者的写作风格为」，含降级文案
    assert "该作者的写作风格为" not in sys_prompt
    assert "保持与原文及上下文一致" in sys_prompt
