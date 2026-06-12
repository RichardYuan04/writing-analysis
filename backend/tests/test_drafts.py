import main


def test_create_draft(client, db):
    r = client.post("/drafts", json={"title": "未完成", "content": "写到一半的内容", "date": "2026-06-12"})
    assert r.status_code == 200
    body = r.json()
    assert body["id"] > 0
    assert body["title"] == "未完成"
    assert body["content"] == "写到一半的内容"
    assert body["date"] == "2026-06-12"
    assert "updated_at" in body


def test_create_draft_rejects_empty_content(client, db):
    r = client.post("/drafts", json={"title": "x", "content": "   ", "date": "2026-06-12"})
    assert r.status_code == 400
