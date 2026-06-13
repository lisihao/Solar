"""
修复CORS配置并添加显式OPTIONS支持
"""

# 读取main.py
with open("main.py", "r", encoding="utf-8") as f:
    content = f.read()

# 修改CORS配置，添加expose_headers
old_cors = """# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:3003",
        "http://localhost:3004",
        "http://localhost:3005",
        "http://localhost:3006",
        "http://localhost:3007",
        "http://localhost:3008",
        "http://localhost:4000"
    ],  # 前端和后端
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)"""

new_cors = """# 配置 CORS - 使用正则表达式匹配所有localhost端口
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost:\d+",  # 允许所有localhost端口
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allow_headers=["*"],
    expose_headers=["*"],
    max_age=3600,  # OPTIONS预检缓存时间
)"""

content = content.replace(old_cors, new_cors)

# 写回文件
with open("main.py", "w", encoding="utf-8") as f:
    f.write(content)

print("✅ CORS配置已更新，使用正则表达式匹配所有localhost端口")
