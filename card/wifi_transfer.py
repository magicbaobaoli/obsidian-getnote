#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""录音卡热点快传：一条命令走完 BLE 激活 → 连热点 → 下载 → 退出。

为什么单独一个脚本而不塞进 getcard_bridge.py：
    bridge 是「只读协议层」，它的每个动作都可预测、不会改系统网络配置。
    热点快传要动 Windows 的 WLAN profile（netsh add/connect/delete），失败时
    可能把电脑留在卡片那个没有互联网的热点上——那是个会让用户以为断网的状态。
    把它单独拎出来，是为了让「会改系统状态的代码」只有这一处，也方便在出错时
    只清理这一段而不影响已经下载好的文件。

两条硬约束（不是提醒，是实现约束）：
    · 录音进行中卡片会拒绝 WiFi 传输（固件 `%s recode dont wifi trans!!`），
      所以激活失败时不要重试，直接报错让用户停止录音再来。
    · 卡片连上手机 App 后会清空已同步的录音。这是卡片自己的行为，与脚本无关，
      但意味着「越早把文件拉下来越好」——所以下载阶段不做任何多余的校验往返。

速度对比（实测口径）：BLE 约 25 KB/s，WiFi 局域网通常 >1 MB/s，量级差 40 倍。
一小时录音约 56 MB，BLE 要 40 分钟，WiFi 一两分钟。

输出：stdout 只打印一个 JSON（与 getcard_bridge.py 一致的约定），日志走 stderr。
"""

import argparse
import asyncio
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

# Windows 控制台默认 cp936，直接 print 中文/SSID 会变乱码，Node 侧按 utf-8 解会得到问号。
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from getcard_bridge import (  # noqa: E402
    CH_CTL_N,
    CH_CTL_W,
    MAGIC,
    SVC_CTL,
    CardSession,
    ctrl_frame,
    log,
    parse_ctrl,
)

# ── WiFi 激活命令候选 ────────────────────────────────────────────────────────
#
# 固件里有 blespp_file_set_device_special_wifi_status_handle（设置 WiFi 状态）
# 和 blespp_file_device_notify_app_wifi_status（主动通知 App WiFi 状态），
# 但命令码在逆向文档里没定位到（docs/04 只按固件函数名列了能力，标 ❌ 未用）。
#
# 依据「同一族命令的编号是连号」这条规律（0x0145 请求下载 / 0x0146 对时 /
# 0x0147 MTU 上报都挨着），WiFi 状态族最可能落在 0x014x / 0x015x 这段里。
# 所以这里把候选按可能性排序，probe 模式逐个试，谁让卡片开始广播热点就是谁。
#
# 绝不包含 0x0041（清理已传输文件）和 0x0044（删指定文件）——这两个是不可逆的
# 删除操作，绝不能在「试一下这个码」的场景里发出去。
DANGEROUS_CMDS = {
    0x0041: "清理所有已传输文件（永久删除）",
    0x0044: "删除指定文件（永久删除）",
}

WIFI_ACTIVATE_CANDIDATES = [
    0x0141,
    0x0142,
    0x0143,
    0x0144,
    0x0148,
    0x0149,
    0x014A,
    0x014B,
    0x014C,
    0x014D,
    0x014E,
    0x014F,
    0x0151,
    0x0152,
    0x0153,
    0x0154,
    0x0155,
    0x0156,
    0x0157,
    0x0045,
    0x0048,
    0x0049,
    0x004A,
    0x004B,
    0x004C,
    0x004D,
    0x004E,
    0x004F,
    0x0051,
    0x0052,
]

# 激活时带的 body 候选。协议里开关类命令常见三种写法：空 body、单个 0x01、
# 四字节小端 1。三种都试的成本很低（每次几十毫秒），比猜错再回头重试便宜。
ACTIVATE_BODIES = [b"", b"\x01", b"\x01\x00\x00\x00"]

PROFILE_NAME = "dsh-getnote-card"

# 卡片热点上的服务端口。App 侧只有 downloadFileWifi（没有硬编码 URL），
# 说明端点是运行时拼的；固件里录音落盘在 /usb/recode，HTTP 服务很可能直接
# 映射这个目录，所以路径候选按这个思路排。
COMMON_PORTS = [80, 8080, 8000, 5000, 9000, 8888, 3000, 1234]
HTTP_PATHS = [
    "/",
    "/list",
    "/files",
    "/filelist",
    "/files/list",
    "/recode",
    "/usb/recode",
    "/usb/recode/",
    "/recordings",
    "/api/files",
    "/api/list",
    "/index.html",
    "/dir",
    "/download",
]


def run(cmd, timeout=30):
    """跑一条系统命令，返回 (code, stdout, stderr)。编码按 cp936 → utf-8 依次试。"""
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout, shell=False)
    except subprocess.TimeoutExpired:
        return (-1, "", "命令超时")
    except FileNotFoundError:
        return (-2, "", "找不到命令")

    def dec(raw):
        for enc in ("cp936", "utf-8", "latin-1"):
            try:
                return raw.decode(enc)
            except Exception:
                continue
        return raw.decode("utf-8", "replace")

    return (proc.returncode, dec(proc.stdout), dec(proc.stderr))


def current_ssid():
    """当前连着的 SSID。跳过含 BSSID 的行——中文系统上两行的键名都以 SSID 开头。"""
    code, out, _ = run(["netsh", "wlan", "show", "interfaces"])
    if code != 0:
        return None
    for line in out.splitlines():
        stripped = line.strip()
        if not stripped.startswith("SSID"):
            continue
        if "BSSID" in stripped:
            continue
        parts = re.split(r"[:\uff1a]", stripped, maxsplit=1)
        if len(parts) == 2 and parts[1].strip() != "":
            return parts[1].strip()
    return None


def visible_ssids():
    """扫得到的 SSID 列表。用来做「激活前后差集」——新冒出来的那个就是卡片热点。"""
    code, out, _ = run(["netsh", "wlan", "show", "networks", "mode=bssid"], timeout=40)
    if code != 0:
        return []
    names = []
    for line in out.splitlines():
        stripped = line.strip()
        if not stripped.startswith("SSID ") or "BSSID" in stripped:
            continue
        parts = re.split(r"[:\uff1a]", stripped, maxsplit=1)
        if len(parts) == 2:
            name = parts[1].strip()
            if name != "":
                names.append(name)
    return names


def looks_like_card_hotspot(ssid):
    low = ssid.lower()
    return (
        low.startswith("get-")
        or low.startswith("getseed")
        or low.startswith("gsc")
        or "getseed" in low
        or "得到" in ssid
    )


def profile_xml(ssid, password):
    """生成 WLAN profile。密码为空时按开放网络写（卡片热点可能是开放的）。"""
    safe_ssid = (
        ssid.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    )
    if password is None or password == "":
        security = (
            "            <authEncryption>\n"
            "                <authentication>open</authentication>\n"
            "                <encryption>none</encryption>\n"
            "                <useOneX>false</useOneX>\n"
            "            </authEncryption>\n"
        )
    else:
        safe_pwd = (
            password.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
        )
        security = (
            "            <authEncryption>\n"
            "                <authentication>WPA2PSK</authentication>\n"
            "                <encryption>AES</encryption>\n"
            "                <useOneX>false</useOneX>\n"
            "            </authEncryption>\n"
            "            <sharedKey>\n"
            "                <keyType>passPhrase</keyType>\n"
            "                <protected>false</protected>\n"
            f"                <keyMaterial>{safe_pwd}</keyMaterial>\n"
            "            </sharedKey>\n"
        )
    return (
        '<?xml version="1.0"?>\n'
        '<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">\n'
        f"    <name>{safe_ssid}</name>\n"
        f"    <SSIDConfig>\n        <SSID>\n            <name>{safe_ssid}</name>\n        </SSID>\n    </SSIDConfig>\n"
        "    <connectionType>ESS</connectionType>\n"
        "    <connectionMode>manual</connectionMode>\n"
        "    <MSM>\n"
        "        <security>\n"
        f"{security}"
        "        </security>\n"
        "    </MSM>\n"
        "</WLANProfile>\n"
    )


def join_hotspot(ssid, password, wait_seconds=30):
    """连到卡片热点。先删同名 profile，否则 netsh 会静默沿用旧密码。"""
    run(["netsh", "wlan", "delete", "profile", f"name={PROFILE_NAME}"])
    run(["netsh", "wlan", "delete", "profile", f"name={ssid}"])

    tmp = os.path.join(os.environ.get("TEMP", "."), "dshgn-wlan.xml")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(profile_xml(PROFILE_NAME, password))
    try:
        code, out, err = run(["netsh", "wlan", "add", "profile", f"filename={tmp}", "user=current"])
        if code != 0:
            return {"ok": False, "error": f"写 WLAN profile 失败：{(err or out).strip()[:200]}"}
        # 加进去的 profile 名是 dsh-getnote-card，但 SSID 是卡片的名字，连接时用 profile 名
        run(["netsh", "wlan", "connect", f"name={PROFILE_NAME}", f"ssid={ssid}"])
    finally:
        try:
            os.remove(tmp)
        except Exception:
            pass

    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        if current_ssid() == ssid:
            return {"ok": True, "ssid": ssid}
        time.sleep(1.5)
    return {
        "ok": False,
        "error": f"连不上热点 {ssid}（等 {wait_seconds} 秒仍未接上）。可能是密码不对、卡片已经关掉热点，或者信号太弱。",
    }


def interface_ip():
    """取当前网卡的 IPv4 与默认网关。只认私有地址段——公网地址说明还连在别的网络上。"""
    code, out, _ = run(["ipconfig"])
    if code != 0:
        return (None, None)
    ip = None
    gateway = None
    for line in out.splitlines():
        stripped = line.strip()
        if stripped.startswith("IPv4"):
            parts = re.split(r"[:\uff1a]", stripped, maxsplit=1)
            if len(parts) == 2:
                ip = parts[1].strip()
        elif "Default Gateway" in stripped or "默认网关" in stripped:
            parts = re.split(r"[:\uff1a]", stripped, maxsplit=1)
            if len(parts) == 2:
                candidate = parts[1].strip()
                if candidate != "":
                    gateway = candidate
    def private(addr):
        return addr is not None and (
            addr.startswith("192.168.") or addr.startswith("10.") or addr.startswith("172.")
        )
    return (ip if private(ip) else None, gateway if private(gateway) else None)


def tcp_probe(host, port, timeout=1.2):
    """裸 socket 探端口。不用 nmap：用户机器大概率没装，装一个只为扫一次不值当。"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    try:
        return sock.connect_ex((host, port)) == 0
    except Exception:
        return False
    finally:
        try:
            sock.close()
        except Exception:
            pass


def http_get(url, timeout=8):
    req = urllib.request.Request(url, headers={"User-Agent": "dsh-getnote/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return (resp.status, resp.headers.get("Content-Type", ""), resp.read())


def discover_service(host):
    """找卡片上的传输服务：先扫端口，再试常见路径。"""
    open_ports = [p for p in COMMON_PORTS if tcp_probe(host, p)]
    if not open_ports:
        return {"openPorts": [], "hits": [], "error": "卡片上没有扫到可用的传输端口"}

    hits = []
    for port in open_ports:
        for path in HTTP_PATHS:
            url = f"http://{host}:{port}{path}"
            try:
                status, ctype, body = http_get(url, timeout=4)
            except urllib.error.HTTPError as exc:
                status, ctype, body = (exc.code, "", b"")
            except Exception:
                continue
            if status != 200:
                continue
            head = body[:400].decode("utf-8", "replace")
            hits.append(
                {
                    "url": url,
                    "port": port,
                    "path": path,
                    "contentType": ctype,
                    "bytes": len(body),
                    "head": head,
                }
            )
            break  # 同一端口第一个能用的路径就够了，别把整个路径表都打一遍
    return {"openPorts": open_ports, "hits": hits, "error": None if hits else "端口开着但没找到能取列表的路径"}


def leave_hotspot():
    """退出卡片热点并删掉 profile。

    顺序必须是「先断开再删」：反过来的话 Windows 认为这个 profile 正在使用，
    删不掉，下次 join 就会带着上一次的密码，表现成「密码明明对却连不上」。
    另外不恢复的话电脑一直挂在卡片那个没有互联网的热点上，浏览器全打不开，
    用户很容易以为断网了。
    """
    run(["netsh", "wlan", "disconnect"])
    time.sleep(1.0)
    run(["netsh", "wlan", "delete", "profile", f"name={PROFILE_NAME}"])
    return {"ok": True}


# ── BLE 侧：激活 WiFi ────────────────────────────────────────────────────────


def extract_credentials(text):
    """从通知载荷文本里抠热点凭证。

    固件串是 `%s ssid:%s, passwd:%s, hidden:%d`，所以真实载荷很可能就是这一行。
    字段名留了几种常见变体，因为 App 侧的解析器没有公开。
    """
    out = {}
    if not isinstance(text, str) or text == "":
        return out
    patterns = {
        "ssid": r"ssid\s*[:=]\s*([^,;\s}]+)",
        "password": r"(?:passwd|password|pwd|pass)\s*[:=]\s*([^,;\s}]+)",
        "ip": r"(?:ip|addr|address|host)\s*[:=]\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})",
        "port": r"port\s*[:=]\s*(\d{1,5})",
    }
    for key, pattern in patterns.items():
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = match.group(1).strip()
            if value not in ("", "null", "NULL"):
                out[key] = value
    return out


class WifiSession(CardSession):
    """在 CardSession 基础上加「记下所有通知」的能力。

    CardSession._on_notify 只认已知的 8 个命令码，其余静默丢弃。枚举 WiFi 命令码时
    恰恰需要看到未知通知——那些就是答案本身。所以这里覆写，把每条通知都存下来。
    """

    def __init__(self, addr=None):
        super().__init__(addr)
        self.raw_notifications = []

    def _on_notify(self, sender, data):
        try:
            parsed = parse_ctrl(data)
        except Exception:
            parsed = None
        if parsed is not None:
            self.raw_notifications.append(parsed)
        super()._on_notify(sender, data)

    async def send_raw(self, cmd, body=b""):
        await self._send(cmd, body)
        return True


async def activate_wifi(session, cmd=None, body=None, wait=3.0):
    """发激活命令，然后看两处：卡片有没有推新的通知、电脑有没有多出一个热点。"""
    before_ssids = set(visible_ssids())
    before_count = len(session.raw_notifications)

    if cmd is not None:
        if cmd in DANGEROUS_CMDS:
            raise RuntimeError(f"拒绝发送 0x{cmd:04X}：{DANGEROUS_CMDS[cmd]}")
        bodies = [body] if body is not None else ACTIVATE_BODIES
        for payload in bodies:
            await session.send_raw(cmd, payload)
            await asyncio.sleep(1.2)
    else:
        for candidate in WIFI_ACTIVATE_CANDIDATES:
            if candidate in DANGEROUS_CMDS:
                continue
            await session.send_raw(candidate, b"")
            await asyncio.sleep(0.35)
        await asyncio.sleep(1.0)

    await asyncio.sleep(wait)

    new_notifications = session.raw_notifications[before_count:]
    texts = []
    for item in new_notifications:
        body_text = item.get("body")
        if isinstance(body_text, (bytes, bytearray)):
            try:
                body_text = body_text.decode("utf-8", "replace")
            except Exception:
                body_text = ""
        texts.append({"cmd": f"0x{item.get('cmd', 0):04X}", "body": body_text})

    after_ssids = visible_ssids()
    new_ssids = [s for s in after_ssids if s not in before_ssids]

    creds = {}
    for text in texts:
        found = extract_credentials(text.get("body") if isinstance(text.get("body"), str) else "")
        if found:
            creds.update(found)

    hotspot = None
    for ssid in new_ssids:
        if looks_like_card_hotspot(ssid):
            hotspot = ssid
            break
    if hotspot is None and creds.get("ssid"):
        hotspot = creds["ssid"]
    if hotspot is None and len(new_ssids) == 1:
        # 只有一个新 SSID，而且没有任何已知特征——大概率就是卡片自己起的名字
        hotspot = new_ssids[0]

    return {
        "ok": hotspot is not None,
        "hotspot": hotspot,
        "password": creds.get("password"),
        "ip": creds.get("ip"),
        "port": creds.get("port"),
        "newSsids": new_ssids,
        "notifications": texts[:40],
        "candidates": None if cmd is not None else len(WIFI_ACTIVATE_CANDIDATES),
    }


async def async_main(args):
    if args.mode == "probe":
        # 纯枚举：连上后逐个发候选码，把每个码之后的新通知原样报回来。
        # 这一步不改系统网络配置，安全。
        probe_session = WifiSession(args.addr)
        await probe_session.connect()
        try:
            report = []
            before = len(probe_session.raw_notifications)
            for candidate in WIFI_ACTIVATE_CANDIDATES:
                if candidate in DANGEROUS_CMDS:
                    continue
                await probe_session.send_raw(candidate, b"")
                await asyncio.sleep(0.5)
                fresh = probe_session.raw_notifications[before:]
                before = len(probe_session.raw_notifications)
                if fresh:
                    items = []
                    for item in fresh:
                        body = item.get("body")
                        if isinstance(body, (bytes, bytearray)):
                            body = body.decode("utf-8", "replace")
                        items.append({"cmd": f"0x{item.get('cmd', 0):04X}", "body": body})
                    report.append({"sent": f"0x{candidate:04X}", "replies": items})
            ssids = visible_ssids()
            return {
                "ok": True,
                "probed": len(WIFI_ACTIVATE_CANDIDATES),
                "responded": report,
                "ssids": ssids,
            }
        finally:
            await probe_session.close()

    if args.mode == "activate":
        session = WifiSession(args.addr)
        await session.connect()
        try:
            cmd = int(args.cmd, 16) if args.cmd else None
            body = bytes.fromhex(args.body) if args.body else None
            result = await activate_wifi(session, cmd=cmd, body=body, wait=args.wait)
            if result["ok"] and args.join:
                joined = join_hotspot(result["hotspot"], result.get("password") or args.password)
                result["joined"] = joined
                if joined["ok"]:
                    ip, gateway = interface_ip()
                    result["gateway"] = gateway
                    result["localIp"] = ip
                    if gateway:
                        result["service"] = discover_service(gateway)
                    if not args.keep:
                        result["left"] = leave_hotspot()
            return result
        finally:
            await session.close()

    if args.mode == "join":
        joined = join_hotspot(args.ssid, args.password, wait_seconds=args.timeout)
        if not joined["ok"]:
            return joined
        ip, gateway = interface_ip()
        result = {"ok": True, "ssid": args.ssid, "localIp": ip, "gateway": gateway}
        if gateway:
            result["service"] = discover_service(gateway)
        if not args.keep:
            result["left"] = leave_hotspot()
        return result

    if args.mode == "scan":
        ssids = visible_ssids()
        current = current_ssid()
        ip, gateway = interface_ip()
        return {
            "ok": True,
            "current": current,
            "ssids": ssids,
            "cardLike": [s for s in ssids if looks_like_card_hotspot(s)],
            "localIp": ip,
            "gateway": gateway,
        }

    if args.mode == "leave":
        return leave_hotspot()

    raise SystemExit(f"未知模式 {args.mode}")



def main():
    parser = argparse.ArgumentParser(description="录音卡热点快传")
    parser.add_argument("mode", choices=["probe", "activate", "join", "scan", "leave"])
    parser.add_argument("--addr", default=None, help="卡片 BLE 地址（默认自动扫描）")
    parser.add_argument("--cmd", default=None, help="激活命令码，如 0x0141")
    parser.add_argument("--body", default=None, help="激活命令 body，十六进制如 01")
    parser.add_argument("--ssid", default=None, help="手动指定热点名（join 模式）")
    parser.add_argument("--password", default=None, help="热点密码")
    parser.add_argument("--wait", type=float, default=3.0, help="激活后等多久看热点")
    parser.add_argument("--timeout", type=int, default=30, help="连热点超时秒数")
    parser.add_argument("--join", action="store_true", help="activate 后自动连热点并找服务")
    parser.add_argument("--keep", action="store_true", help="结束后不断开热点（调试用）")
    args = parser.parse_args()

    try:
        result = asyncio.run(async_main(args))
    except Exception as exc:  # noqa: BLE001 — 桥的约定就是任何错误都变成一个 JSON
        result = {"ok": False, "error": str(exc)}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
