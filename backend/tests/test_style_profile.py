def test_app_boots(client):
    # /essays 是已有接口，能 200 即说明 app 正常起来了
    r = client.get("/essays")
    assert r.status_code == 200
