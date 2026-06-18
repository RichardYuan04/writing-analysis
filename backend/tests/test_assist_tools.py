import main


def test_reader_returns_letter(client, mock_anthropic):
    mock_anthropic.set_text("读你这篇时，我先听见了灯。……")
    r = client.post("/assist/reader", json={
        "title": "夜里十一点的便利店",
        "content": "我买了一瓶水，其实并不渴。",
        "persona": "poet",
    })
    assert r.status_code == 200
    assert r.json()["letter"].startswith("读你这篇时")


def test_reader_uses_opus_and_persona_system(client, mock_anthropic):
    mock_anthropic.set_text("ok")
    client.post("/assist/reader", json={
        "title": "T", "content": "C", "persona": "debater",
    })
    cap = mock_anthropic.captured
    assert cap["model"] == "claude-opus-4-8"
    # 辩论家的人格设定进了 system，且没有注入 SOUL 风格指令
    assert "辩论家" in cap["system"]
    assert "写作风格为" not in cap["system"]


def test_reader_rejects_bad_persona(client, mock_anthropic):
    r = client.post("/assist/reader", json={
        "title": "T", "content": "C", "persona": "nobody",
    })
    assert r.status_code == 400


def test_reader_rejects_empty_content(client, mock_anthropic):
    r = client.post("/assist/reader", json={
        "title": "T", "content": "  ", "persona": "poet",
    })
    assert r.status_code == 400
