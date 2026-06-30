import main

SOUL_OUT = "【SOUL】\n克制短句。\n【节奏】短\n【意象】具体\n【情绪】克制\n【用词】口语\n【手法】留白"


def _gen(client, ids):
    return client.post("/style-profiles/generate", json={"essay_ids": ids})


def test_first_generate_auto_activates(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    r = _gen(client, seed_essays).json()
    g = client.get("/style-profiles").json()
    assert g["active_id"] == r["id"]
    assert len(g["profiles"]) == 1


def test_max_three_slots(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    for _ in range(3):
        assert _gen(client, seed_essays).status_code == 200
    assert _gen(client, seed_essays).status_code == 400          # 第 4 个被拒


def test_second_generate_does_not_steal_default(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    a = _gen(client, seed_essays).json()
    _gen(client, seed_essays)                                    # 第二个
    assert client.get("/style-profiles").json()["active_id"] == a["id"]


def test_activate_switches_bundle(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text("【SOUL】\n风格甲。\n【节奏】a\n【意象】b\n【情绪】c\n【用词】d\n【手法】e")
    a = _gen(client, seed_essays).json()
    mock_anthropic.set_text("【SOUL】\n风格乙。\n【节奏】a\n【意象】b\n【情绪】c\n【用词】d\n【手法】e")
    b = _gen(client, seed_essays).json()
    client.post(f"/style-profiles/{b['id']}/activate")
    assert "风格乙" in main._load_soul_bundle()["content"]
    client.post(f"/style-profiles/{a['id']}/activate")
    assert "风格甲" in main._load_soul_bundle()["content"]


def test_regenerate_overwrites_keeps_name(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    a = _gen(client, seed_essays).json()
    client.put(f"/style-profiles/{a['id']}", json={"name": "日常随笔"})
    mock_anthropic.set_text("【SOUL】\n新风格。\n【节奏】a\n【意象】b\n【情绪】c\n【用词】d\n【手法】e")
    r = client.post(f"/style-profiles/{a['id']}/generate", json={"essay_ids": seed_essays}).json()
    assert r["name"] == "日常随笔"          # 名字不变
    assert "新风格" in r["content"]          # 内容被覆盖


def test_delete_active_reassigns(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    a = _gen(client, seed_essays).json()
    b = _gen(client, seed_essays).json()
    client.post(f"/style-profiles/{b['id']}/activate")
    r = client.delete(f"/style-profiles/{b['id']}").json()
    assert r["active_id"] == a["id"]        # 删默认 → 回退剩余最小 id


def test_delete_to_zero_keeps_shared_taboo(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    a = _gen(client, seed_essays).json()
    client.put("/soul-settings", json={"taboo": "共用禁令保留ZZZ"})
    client.delete(f"/style-profiles/{a['id']}")
    g = client.get("/style-profiles").json()
    assert g["active_id"] is None and g["profiles"] == []
    b = main._load_soul_bundle()
    assert b["content"] == "" and b["samples"] == []
    assert b["taboo"].startswith("共用禁令保留")     # 删到 0 槽，禁止项仍来自共用配置


def test_name_empty_becomes_null(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    a = _gen(client, seed_essays).json()
    r = client.put(f"/style-profiles/{a['id']}", json={"name": "  "}).json()
    assert r["name"] is None


def test_regenerate_missing_slot_404(client, db, seed_essays, mock_anthropic):
    mock_anthropic.set_text(SOUL_OUT)
    assert client.post("/style-profiles/9999/generate", json={"essay_ids": seed_essays}).status_code == 404


def test_activate_missing_slot_404(client, db):
    assert client.post("/style-profiles/9999/activate").status_code == 404
