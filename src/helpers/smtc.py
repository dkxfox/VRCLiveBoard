import asyncio, json, sys, os, ctypes
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

# 父进程(Node)死亡检测: 防止主程序被强制关闭后本助手变成孤儿进程
_PARENT = os.getppid()
def parent_alive():
    if _PARENT <= 1:
        return True
    try:
        h = ctypes.windll.kernel32.OpenProcess(0x1000, False, _PARENT)
        if h:
            ctypes.windll.kernel32.CloseHandle(h)
            return True
        return ctypes.windll.kernel32.GetLastError() == 5  # 拒绝访问 = 仍存在
    except Exception:
        return True
from winsdk.windows.media.control import GlobalSystemMediaTransportControlsSessionManager

# SMTC 媒体会话读取(Python winsdk 投影,不依赖 .NET WinRT)
# 用法: python -u smtc.py         -> 每 2 秒输出一行 JSON(变化时才输出)
#       python -u smtc.py --once  -> 输出一次后退出(诊断用)

async def snapshot():
    try:
        mgr = await GlobalSystemMediaTransportControlsSessionManager.request_async()
        sessions = mgr.get_sessions()
        playing = None
        fallback = None
        for s in sessions:
            try:
                props = await s.try_get_media_properties_async()
            except Exception:
                continue
            title = (props.title or '').strip()
            if not title:
                continue
            status = None
            pos_ms = 0
            try:
                info = s.get_playback_info()
                status = int(info.playback_status)
                pos_ms = int(info.position.total_seconds() * 1000)
            except Exception:
                pass
            item = {
                "title": title,
                "artist": (props.artist or '').strip(),
                "album": (props.album_title or '').strip(),
                "source": (s.source_app_user_model_id or ''),
                "status": status,
                "position_ms": pos_ms
            }
            if status == 4 and playing is None:  # 4 = Playing
                playing = item
            if fallback is None:
                fallback = item
        return playing or fallback or {}
    except Exception:
        return {}

async def main_once():
    print(json.dumps(await snapshot(), ensure_ascii=False), flush=True)

async def main_loop():
    last = None
    while True:
        if not parent_alive():
            break
        cur = json.dumps(await snapshot(), ensure_ascii=False)
        if cur != last:
            print(cur, flush=True)
            last = cur
        await asyncio.sleep(2)

if '--once' in sys.argv:
    asyncio.run(main_once())
else:
    asyncio.run(main_loop())
