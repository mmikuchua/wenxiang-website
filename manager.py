#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
文享智配 交互式管理终端
功能：
  1. 启动开发服务器（自动使用虚拟环境）
  2. 启动 ngrok 公网隧道
  3. 初始化数据库
  4. 进入交互式 Python shell
  5. 从文件导入活动数据
  6. 列出所有 API 路由
  7. 运行测试
  8. 诊断 ngrok 连接问题
  0. 退出
"""

import os
import sys
import subprocess
import argparse
import json
import csv
import socket
import requests
from pathlib import Path

# 尝试导入 colorama，用于彩色输出；若未安装则提供降级方案
try:
    from colorama import init, Fore, Back, Style
    init(autoreset=True)
    COLOR_ENABLED = True
except ImportError:
    class Fore:
        RED = GREEN = YELLOW = BLUE = MAGENTA = CYAN = WHITE = RESET = ''
    Back = Style = Fore
    COLOR_ENABLED = False
    print("建议安装 colorama 以获得彩色输出: pip install colorama")

BASE_DIR = Path(__file__).resolve().parent

# ---------- 辅助函数 ----------
def print_c(color, message):
    print(f"{color}{message}{Fore.RESET}")

def print_header(title):
    print()
    print_c(Fore.CYAN + Style.BRIGHT, "=" * 60)
    print_c(Fore.CYAN + Style.BRIGHT, f" {title}")
    print_c(Fore.CYAN + Style.BRIGHT, "=" * 60)

def print_success(message):
    print_c(Fore.GREEN, f"✅ {message}")

def print_error(message):
    print_c(Fore.RED, f"❌ {message}")

def print_info(message):
    print_c(Fore.BLUE, f"ℹ️ {message}")

def print_warning(message):
    print_c(Fore.YELLOW, f"⚠️ {message}")

def wait_for_key():
    input("\n按回车键返回菜单...")

# ---------- 命令函数 ----------
def cmd_runserver(args=None):
    """启动开发服务器（自动使用虚拟环境中的 Python）"""
    print_header("启动开发服务器")
    host = getattr(args, 'host', '0.0.0.0')
    port = getattr(args, 'port', 8000)
    reload_flag = '--reload' if getattr(args, 'reload', False) else ''

    # 确定 Python 解释器路径（优先使用当前解释器，如果在虚拟环境中则直接使用；否则尝试虚拟环境中的 Python）
    python_exe = sys.executable
    if 'venv' not in python_exe and 'virtualenv' not in python_exe:
        venv_python = BASE_DIR / 'venv' / 'Scripts' / 'python.exe'
        if venv_python.exists():
            python_exe = str(venv_python)
            print_info(f"使用虚拟环境 Python: {python_exe}")
        else:
            print_warning("未检测到虚拟环境，将使用系统 Python，请确保已安装 uvicorn")

    cmd = [python_exe, '-m', 'uvicorn', 'backend.main:app', '--host', host, '--port', str(port)]
    if reload_flag:
        cmd.append('--reload')

    print_info(f"执行命令: {' '.join(cmd)}")
    print_warning("服务器启动后，按 Ctrl+C 停止并返回菜单")
    try:
        os.chdir(BASE_DIR)
        subprocess.run(cmd)
    except KeyboardInterrupt:
        print_info("\n服务器已停止")
    wait_for_key()

def cmd_ngrok(args=None):
    """启动 ngrok 隧道"""
    print_header("启动 ngrok 公网隧道")
    port = getattr(args, 'port', 8000)
    ngrok_path = subprocess.run("where ngrok", shell=True, capture_output=True, text=True)
    if ngrok_path.returncode != 0:
        print_error("未找到 ngrok，请确保 ngrok 已安装并添加到 PATH")
        print_info("下载地址: https://ngrok.com/download")
        wait_for_key()
        return
    cmd = f"ngrok http {port}"
    print_info(f"执行命令: {cmd}")
    print_warning("隧道启动后，按 Ctrl+C 停止并返回菜单")
    try:
        os.system(cmd)
    except KeyboardInterrupt:
        print_info("\n隧道已停止")
    wait_for_key()

def cmd_initdb(args=None):
    print_header("初始化数据库")
    try:
        sys.path.insert(0, str(BASE_DIR))
        from backend.database import init_db
        init_db()
        print_success("数据库初始化成功 (表已创建)")
    except Exception as e:
        print_error(f"初始化失败: {e}")
    wait_for_key()

def cmd_shell(args=None):
    print_header("进入交互式 Python shell")
    try:
        sys.path.insert(0, str(BASE_DIR))
        from backend.database import SessionLocal
        from backend.models import UserResponse, Activity
        from sqlalchemy import text
        banner = f"""
{Fore.CYAN}文享智配 交互式 Shell{Fore.RESET}
可用变量:
    {Fore.YELLOW}SessionLocal{Fore.RESET} - 数据库会话工厂
    {Fore.YELLOW}UserResponse{Fore.RESET} - 用户问卷模型
    {Fore.YELLOW}Activity{Fore.RESET}     - 活动模型
    {Fore.YELLOW}db{Fore.RESET}           - 一个数据库会话实例 (已创建)
    {Fore.YELLOW}text{Fore.RESET}         - SQLAlchemy text 函数

示例:
    {Fore.GREEN}db.query(UserResponse).count(){Fore.RESET}
    {Fore.GREEN}db.query(Activity).limit(5).all(){Fore.RESET}
"""
        db = SessionLocal()
        import code
        code.interact(banner=banner, local=locals())
    except Exception as e:
        print_error(f"启动 shell 失败: {e}")
    wait_for_key()

def cmd_import_activities(args=None):
    print_header("导入活动数据")
    if args and getattr(args, 'file', None):
        file_path = args.file
    else:
        file_path = input("请输入数据文件路径 (JSON 或 CSV): ").strip()
        if not file_path:
            print_warning("已取消")
            wait_for_key()
            return

    if not os.path.exists(file_path):
        print_error(f"文件不存在: {file_path}")
        wait_for_key()
        return

    try:
        sys.path.insert(0, str(BASE_DIR))
        from backend.database import SessionLocal
        from backend.models import Activity
        db = SessionLocal()
        count = 0
        if file_path.endswith('.json'):
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                for item in data:
                    act = Activity(
                        source_id=item.get('id'),
                        name=item.get('name'),
                        type=item.get('type'),
                        time=item.get('time'),
                        address=item.get('address'),
                        price=item.get('price'),
                        highlights=item.get('highlights'),
                        guide_link=item.get('guide_link'),
                        source=item.get('source'),
                    )
                    db.add(act)
                    count += 1
        elif file_path.endswith('.csv'):
            with open(file_path, 'r', encoding='utf-8-sig') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    act = Activity(
                        source_id=row.get('source_id'),
                        name=row.get('name'),
                        type=row.get('type'),
                        time=row.get('time'),
                        address=row.get('address'),
                        price=row.get('price'),
                        highlights=row.get('highlights'),
                        guide_link=row.get('guide_link'),
                        source=row.get('source'),
                    )
                    db.add(act)
                    count += 1
        else:
            print_error("不支持的文件格式，请使用 .json 或 .csv")
            wait_for_key()
            return
        db.commit()
        print_success(f"成功导入 {count} 条活动记录")
    except Exception as e:
        print_error(f"导入失败: {e}")
    finally:
        db.close()
    wait_for_key()

def cmd_list_routes(args=None):
    print_header("API 路由列表")
    try:
        sys.path.insert(0, str(BASE_DIR))
        from backend.main import app
        for route in app.routes:
            methods = ','.join(route.methods) if hasattr(route, 'methods') else 'ANY'
            print(f"{Fore.YELLOW}{methods:10}{Fore.RESET} {route.path}")
    except Exception as e:
        print_error(f"获取路由失败: {e}")
    wait_for_key()

def cmd_test(args=None):
    print_header("运行测试")
    test_dir = BASE_DIR / 'tests'
    if not test_dir.exists():
        print_warning("未找到 tests 文件夹，跳过测试")
    else:
        cmd = "pytest tests/"
        print_info(f"执行: {cmd}")
        os.chdir(BASE_DIR)
        os.system(cmd)
    wait_for_key()

def cmd_diagnose(args=None):
    print_header("诊断 ngrok 连接问题")
    issues = []
    try:
        resp = requests.get("http://localhost:8000", timeout=3)
        if resp.status_code == 200:
            print_success("✅ 本地服务运行正常 (http://localhost:8000 可访问)")
        else:
            print_error(f"❌ 本地服务返回状态码 {resp.status_code}")
            issues.append("服务返回异常状态码")
    except requests.ConnectionError:
        print_error("❌ 无法连接到 http://localhost:8000，服务可能未启动")
        issues.append("服务未启动")
    except Exception as e:
        print_error(f"❌ 检查服务时出错: {e}")
        issues.append("检查异常")

    try:
        result = subprocess.run(['netstat', '-ano'], capture_output=True, text=True, shell=True)
        if f":8000" in result.stdout:
            print_success("✅ 端口 8000 已被监听")
        else:
            print_error("❌ 端口 8000 未被监听")
            issues.append("端口未监听")
    except Exception as e:
        print_warning(f"⚠️ 无法检查端口监听: {e}")

    print_info("🔍 检查防火墙规则...")
    try:
        rule_check = subprocess.run(
            'netsh advfirewall firewall show rule name="ngrok-test"',
            capture_output=True, text=True, shell=True
        )
        if rule_check.returncode != 0:
            print_warning("⚠️ 可能没有管理员权限，若连接有问题，请以管理员身份运行：")
            print_info('    netsh advfirewall firewall add rule name="ngrok 8000" dir=in action=allow protocol=tcp localport=8000')
        else:
            print_success("✅ 防火墙检查通过")
    except Exception:
        pass

    if issues:
        print("\n" + "="*60)
        print_warning("发现问题，请按以下步骤修复：")
        if "服务未启动" in issues or "端口未监听" in issues:
            print_info("1. 确保 FastAPI 服务已启动：")
            print_info("   python manager.py runserver")
        if "防火墙" in str(issues):
            print_info("2. 以管理员身份运行 PowerShell，执行：")
            print_info('   netsh advfirewall firewall add rule name="ngrok 8000" dir=in action=allow protocol=tcp localport=8000')
        print_info("3. 重新启动 ngrok： ngrok http 8000")
    else:
        print_success("\n✅ 未发现明显问题，请检查 ngrok 是否正确启动。")
    wait_for_key()

# ---------- 交互菜单 ----------
def show_menu():
    print()
    print_c(Fore.CYAN + Style.BRIGHT, "╔════════════════════════════════════╗")
    print_c(Fore.CYAN + Style.BRIGHT, "║     文享智配 管理终端            ║")
    print_c(Fore.CYAN + Style.BRIGHT, "╚════════════════════════════════════╝")
    print()
    print(f"  {Fore.GREEN}1.{Fore.RESET} 启动开发服务器")
    print(f"  {Fore.GREEN}2.{Fore.RESET} 启动 ngrok 隧道")
    print(f"  {Fore.GREEN}3.{Fore.RESET} 初始化数据库")
    print(f"  {Fore.GREEN}4.{Fore.RESET} 进入交互式 Shell")
    print(f"  {Fore.GREEN}5.{Fore.RESET} 导入活动数据")
    print(f"  {Fore.GREEN}6.{Fore.RESET} 列出 API 路由")
    print(f"  {Fore.GREEN}7.{Fore.RESET} 运行测试")
    print(f"  {Fore.GREEN}8.{Fore.RESET} 诊断 ngrok 连接问题")
    print(f"  {Fore.GREEN}0.{Fore.RESET} 退出")
    print()

def interactive_mode():
    while True:
        show_menu()
        choice = input("请输入数字选择: ").strip()
        if choice == '1':
            cmd_runserver()
        elif choice == '2':
            cmd_ngrok()
        elif choice == '3':
            cmd_initdb()
        elif choice == '4':
            cmd_shell()
        elif choice == '5':
            cmd_import_activities()
        elif choice == '6':
            cmd_list_routes()
        elif choice == '7':
            cmd_test()
        elif choice == '8':
            cmd_diagnose()
        elif choice == '0':
            print_info("感谢使用，再见！")
            sys.exit(0)
        else:
            print_warning("无效输入，请重新选择")

def main():
    parser = argparse.ArgumentParser(description="文享智配管理脚本", add_help=False)
    parser.add_argument('command', nargs='?', help='直接执行命令（不加参数则进入交互菜单）')
    parser.add_argument('--host', default='0.0.0.0', help='服务器主机 (默认 0.0.0.0)')
    parser.add_argument('--port', '-p', type=int, default=8000, help='端口 (默认 8000)')
    parser.add_argument('--reload', action='store_true', help='启用热重载')
    parser.add_argument('--file', '-f', help='导入文件路径')
    parser.add_argument('--help', '-h', action='store_true', help='显示帮助')
    args = parser.parse_args()

    if args.help or (args.command and args.command in ['-h', '--help']):
        print(__doc__)
        return

    if not args.command:
        interactive_mode()
        return

    cmd_map = {
        'runserver': cmd_runserver,
        'ngrok': cmd_ngrok,
        'initdb': cmd_initdb,
        'shell': cmd_shell,
        'import': cmd_import_activities,
        'routes': cmd_list_routes,
        'test': cmd_test,
        'diagnose': cmd_diagnose,
    }
    func = cmd_map.get(args.command)
    if func:
        func(args)
    else:
        print_error(f"未知命令: {args.command}")
        print_info("可用命令: runserver, ngrok, initdb, shell, import, routes, test, diagnose")
        print_info("或直接运行 python manager.py 进入交互菜单")

if __name__ == '__main__':
    main()