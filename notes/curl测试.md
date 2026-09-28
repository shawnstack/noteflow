# curl 测试命令

## 1. GET 请求（简单测试）

```bash
curl -v https://httpbin.org/get
```

## 2. POST JSON 请求

```bash
curl -X POST https://httpbin.org/post \
  -H "Content-Type: application/json" \
  -d '{"name": "NoteFlow", "action": "test"}'
```

## 3. 带查询参数与超时设置

```bash
curl -s -o /dev/null -w "HTTP状态码: %{http_code}\n耗时: %{time_total}s\n" \
  --max-time 10 "https://httpbin.org/get?note=你好"
```

## 4. 本地回环测试（无需外网）

```bash
curl -v http://127.0.0.1:8080/health || echo "本地服务未启动"
```
