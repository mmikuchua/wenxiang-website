# data/

后端运行时目录，不进入版本库。

- `responses.db`：启动 `backend/main.py` 后自动创建，保存问卷记录（SQLite，WAL 模式）。
- 删除该文件后重启即清空全部云端记录。

站点本身不依赖这个目录；纯静态部署（GitHub Pages）时问卷只存在用户浏览器里。
