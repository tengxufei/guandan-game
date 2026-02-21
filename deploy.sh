#!/bin/bash

echo "======================================"
echo "  三人惯蛋游戏 - 快速部署脚本"
echo "======================================"
echo ""

# 检查是否安装了 git
if ! command -v git &> /dev/null; then
    echo "❌ 错误: 未安装 git"
    echo "请先安装 git: https://git-scm.com/downloads"
    exit 1
fi

# 检查是否在正确的目录
if [ ! -f "server.js" ] || [ ! -f "index.html" ]; then
    echo "❌ 错误: 请在项目根目录运行此脚本"
    exit 1
fi

echo "📋 步骤 1: 准备部署文件..."
echo ""

# 创建部署用的临时目录
DEPLOY_DIR="deploy-temp"
rm -rf $DEPLOY_DIR
mkdir -p $DEPLOY_DIR

# 复制后端文件
cp server.js $DEPLOY_DIR/
cp package.json $DEPLOY_DIR/

# 创建前端目录
mkdir -p $DEPLOY_DIR/frontend
cp index.html $DEPLOY_DIR/frontend/
cp style.css $DEPLOY_DIR/frontend/
cp game.js $DEPLOY_DIR/frontend/

# 创建 .gitignore
cat > $DEPLOY_DIR/.gitignore << EOF
node_modules/
.DS_Store
*.log
.env
EOF

echo "✅ 文件准备完成"
echo ""

# 检查是否已经初始化了 git
if [ -d ".git" ]; then
    echo "📋 Git 仓库已存在"
    echo ""
else
    echo "📋 步骤 2: 初始化 Git 仓库..."
    git init
    echo "✅ Git 仓库初始化完成"
    echo ""
fi

echo "📋 步骤 3: 添加文件到 Git..."
git add .
echo "✅ 文件已添加"
echo ""

echo "📋 步骤 4: 创建初始提交..."
git commit -m "Initial commit: 三人惯蛋游戏" 2>/dev/null || echo "⚠️  没有新的更改需要提交"
echo ""

echo "======================================"
echo "  接下来的步骤"
echo "======================================"
echo ""
echo "📋 步骤 5: 创建 GitHub 仓库"
echo ""
echo "1. 访问 https://github.com/new"
echo "2. 创建一个新的仓库，命名为 'guandan-game'"
echo "3. 不要初始化 README、.gitignore 或 license"
echo "4. 点击 'Create repository'"
echo ""
echo "📋 步骤 6: 推送代码到 GitHub"
echo ""
echo "运行以下命令（替换 YOUR_USERNAME 为你的 GitHub 用户名）："
echo ""
echo "git remote add origin https://github.com/YOUR_USERNAME/guandan-game.git"
echo "git branch -M main"
echo "git push -u origin main"
echo ""
echo "📋 步骤 7: 部署到 Render"
echo ""
echo "1. 访问 https://render.com"
echo "2. 点击 'New +' -> 'Web Service'"
echo "3. 连接你的 GitHub 仓库 'guandan-game'"
echo "4. 配置："
echo "   - Name: guandan-game-server"
echo "   - Environment: Node"
echo "   - Build Command: npm install"
echo "   - Start Command: node server.js"
echo "   - Instance Type: Free"
echo "5. 点击 'Create Web Service'"
echo ""
echo "📋 步骤 8: 部署前端到 Cloudflare Pages"
echo ""
echo "1. 访问 https://dash.cloudflare.com/"
echo "2. 左侧菜单选择 'Workers & Pages'"
echo "3. 点击 'Create application'"
echo "4. 选择 'Pages' 标签 -> 'Upload assets'"
echo "5. 上传以下文件："
echo "   - index.html"
echo "   - style.css"
echo "   - game.js (修改 WS_URL 为你的 Render URL)"
echo ""
echo "📋 步骤 9: 修改 game.js 中的 WebSocket URL"
echo ""
echo "打开 game.js，将第一行改为你的 Render 服务 URL："
echo ""
echo "const WS_URL = 'wss://guandan-game-server.onrender.com';"
echo ""
echo "======================================"
echo "  部署完成！"
echo "======================================"
echo ""
echo "🎉 部署完成后，你将获得："
echo "   - 后端 URL: https://guandan-game-server.onrender.com"
echo "   - 前端 URL: https://guandan-game.pages.dev"
echo ""
echo "分享前端 URL 给朋友，开始游戏吧！"
echo ""
echo "📖 详细部署指南请查看: ONLINE_DEPLOY.md"
echo ""