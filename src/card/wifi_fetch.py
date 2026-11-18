#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""录音卡 WiFi 快传通道：数据面探测。

BLE 那条路只有 25 KB/s，一小时录音要传十几分钟；卡片自己带 2.4G WiFi，
官方 App 的做法是「BLE 拿到热点凭证 → 连卡片热点 → 走 HTTP 高速下载」。
这个脚本负责后半段：连上卡片热点，把它的传输服务找出来。

三个阶段（每一步都能单独跑，失败就停在那一步，不会瞎试）：

  1) `join`    —— 用 netsh 建一个 WLAN profile 并连上卡片热点。
                  凭证从命令行给（`--ssid` / `--pass`），因为 SSID 和密码要由
                  wifi_probe.py 从 BLE 通知里拿到，两个脚本不耦合。
  2) `scan`    —— 连上之后枚举网关 IP，扫常见端口（80/8080/8000/443/22/9000），
                  看卡片到底开了什么服务。这一步决定后面是 HTTP 还是裸 TCP。
  3) `fetch`   —— 按扫出来的端口去试下载：
                  HTTP 就试常见路径（/、/files、/list、/recode、/usb/recode …），
                  把 200 的响应存下来；不是 HTTP 就退化成裸 TCP 探握手。

⚠️ 安全约定：
    * 只读。不向卡片发任何删除/格式化命令。
    * 用完自动 `leave` 恢复原来的 WiFi（否则你电脑会一直挂在卡片热点上，
      那个热点没有互联网，浏览器会全部打不开，很容易以为断网了）。
    * profile 用完即删，不留在系统里。

用法：
    python wifi_fetch.py join  --ssid Get-A78A67 --pass 12345678
    python wifi_fetch.py scan
    python wifi_fetch.py fetch --port 80 --out DIR
    python wifi_fetch.py leave
"""

import argparse
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

PROFILE_NAME = "dsh-getnote-card"

# 卡片上常见会开这些端口：80/8080 是 HTTP，8000/9000 是各种小 web 服务，
# 443 是 HTTPS，22 是某些方案留的调试口（不连，只探测）。
COMMON_PORTS = [80, 8080, 8000, 9000, 443, 22, 5000, 8888]

# 官方固件里录音落盘路径是 /usb/recode（见 FIRMWARE.md 3.4 节），
# 所以 HTTP 服务很可能直接把这个目录映射出来。这里按可能性排序试。
HTTP_PATHS = [
    "/",
    "/list",
    "/files",
    "/filelist",
    "/files/list",
    "/recode",
    "/usb/recode",
    "/recordings",
    "/api/files",
    "/api/list",
    "/index.html",
]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False))


def run(cmd, timeout=40):
    """跑一条命令，返回 (code, text)。输出编码按 cp936 → utf-8 依次试。"""
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except Exception as exc:  # noqa: BLE001
        return -1, str(exc)
    raw = proc.stdout + proc.stderr
    for enc in ("cp936", "utf-8", "latin-1"):
        try:
            return proc.returncode, raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return proc.returncode, raw.decode("utf-8", "replace")


# ------------------------------------------------------------------ 1) join


def profile_xml(ssid, password):
    """Windows 的 WLAN profile XML。

    卡片热点是 WPA2-Personal + AES（BES SoftAP 的标准配置）。
    `authentication` 用 WPA2PSK、`encryption` 用 AES；
    万一卡片用的是开放热点（没密码），password 传空串时走 open 分支。
    """
    if password:
        security = (
            "<authEncryption>"
            "<authentication>WPA2PSK</authentication>"
            "<encryption>AES</encryption>"
            "<useOneX>false</useOneX>"
            "</authEncryption>"
            "<sharedKey>"
            "<keyType>passPhrase</keyType>"
            "<protected>false</protected>"
            f"<keyMaterial>{_esc(password)}</keyMaterial>"
            "</sharedKey>"
        )
    else:
        security = (
            "<authEncryption>"
            "<authentication>open</authentication>"
            "<encryption>none</encryption>"
            "<useOneX>false</useOneX>"
            "</authEncryption>"
        )
    return (
        '<?xml version="1.0"?>'
        '<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">'
        f"<name>{_esc(ssid)}</name>"
        "<SSIDConfig><SSID>"
        f"<name>{_esc(ssid)}</name>"
        "</SSID></SSIDConfig>"
        "<connectionType>ESS</connectionType>"
        "<connectionMode>manual</connectionMode>"
        "<MSM><security>"
        f"{security}"
        "</security></MSM>"
        "</WLANProfile>"
    )


def _esc(s):
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def current_ssid():
    code, text = run(["netsh", "wlan", "show", "interfaces"])
    if code != 0:
        return None
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("SSID") and "BSSID" not in s and ":" in s:
            val = s.split(":", 1)[1].strip()
            if val:
                return val
    return None


def do_join(args):
    before = current_ssid()
    tmp = os.path.join(os.environ.get("TEMP", "."), f"{PROFILE_NAME}.xml")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(profile_xml(args.ssid, args.passwd))
    log("写入 profile：%s" % tmp)

    # 同名 profile 先删掉，否则 add 会因为「已存在」而静默保留旧密码
    run(["netsh", "wlan", "delete", "profile", f"name={PROFILE_NAME}"])
    code, text = run(["netsh", "wlan", "add", "profile", f"filename={tmp}", "user=current"])
    if code != 0:
        emit({"ok": False, "stage": "add-profile", "error": text.strip()})
        return

    code, text = run(
        ["netsh", "wlan", "connect", f"name={PROFILE_NAME}", f"ssid={args.ssid}"], timeout=60
    )
    log(text.strip())

    # 连上要几秒，等接口真的报出这个 SSID 再往下走
    t0 = time.time()
    while time.time() - t0 < 25:
        if current_ssid() == args.ssid:
            break
        time.sleep(1.5)

    now = current_ssid()
    if now != args.ssid:
        emit(
            {
                "ok": False,
                "stage": "connect",
                "error": f"没连上 {args.ssid}（当前是 {now}）",
                "previousSsid": before,
                "hint": "卡片热点可能没开、密码不对，或者离得太远。",
            }
        )
        return

    ip, gw = interface_ip()
    emit(
        {
            "ok": True,
            "stage": "join",
            "ssid": now,
            "previousSsid": before,
            "ip": ip,
            "gateway": gw,
            "profile": PROFILE_NAME,
        }
    )


def interface_ip():
    """拿 WLAN 的 IPv4 与默认网关。"""
    code, text = run(["ipconfig"])
    if code != 0:
        return None, None
    ip = None
    gw = None
    for line in text.splitlines():
        s = line.strip()
        m = re.search(r"IPv4[^:]*:\s*([0-9.]+)", s)
        if m and ip is None:
            ip = m.group(1)
        m = re.search(r"(?:Default Gateway|默认网关)[^:]*:\s*([0-9.]+)", s)
        if m and gw is None:
            gw = m.group(1)
    # 卡片热点一定是私有网段，取第一个私有地址更稳
    if ip and not ip.startswith(("192.168.", "10.", "172.")):
        ip = None
    return ip, gw


# ------------------------------------------------------------------ 2) scan


def tcp_probe(host, port, timeout=1.2):
    """裸 TCP 连一下看端口开不开。不用 nmap：用户机器上大概率没装。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return True
    except Exception:  # noqa: BLE001
        return False
    finally:
        try:
            s.close()
        except Exception:  # noqa: BLE001
            pass


def do_scan(args):
    ip, gw = interface_ip()
    host = args.host or gw
    if not host:
        emit({"ok": False, "error": "没拿到网关地址，先确认已经连上卡片热点（先跑 join）"})
        return
    log("探测网关 %s …" % host)
    open_ports = [p for p in COMMON_PORTS if tcp_probe(host, p)]
    emit(
        {
            "ok": True,
            "stage": "scan",
            "ip": ip,
            "gateway": gw,
            "host": host,
            "openPorts": open_ports,
            "hint": (
                "有 80/8080 就接着跑 fetch --port 那个端口；"
                "一个都没开说明卡片这个固件没走 HTTP，需要 Wireshark 抓官方 App 的 TCP 流。"
            ),
        }
    )


# ------------------------------------------------------------------ 3) fetch


def http_get(url, timeout=6):
    req = urllib.request.Request(url, headers={"User-Agent": "dsh-getnote-card/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(64 * 1024)
            return resp.status, resp.headers.get("content-type", ""), body
    except urllib.error.HTTPError as exc:
        return exc.code, exc.headers.get("content-type", "") if exc.headers else "", b""
    except Exception as exc:  # noqa: BLE001
        return None, str(exc), b""


def do_fetch(args):
    ip, gw = interface_ip()
    host = args.host or gw
    if not host:
        emit({"ok": False, "error": "没拿到网关地址，先跑 join"})
        return
    port = args.port
    scheme = "https" if port == 443 else "http"
    base = f"{scheme}://{host}:{port}" if port not in (80, 443) else f"{scheme}://{host}"

    hits = []
    for path in HTTP_PATHS:
        url = base + path
        status, ctype, body = http_get(url)
        if status is None:
            log("  %-22s 连不上（%s）" % (path, ctype))
            continue
        log("  %-22s HTTP %s  %s  %dB" % (path, status, ctype, len(body)))
        if status == 200:
            hits.append(
                {
                    "path": path,
                    "status": status,
                    "contentType": ctype,
                    "bytes": len(body),
                    "head": body[:400].decode("utf-8", "replace"),
                }
            )
            if args.out:
                os.makedirs(args.out, exist_ok=True)
                safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", path.strip("/") or "root")
                with open(os.path.join(args.out, safe), "wb") as fh:
                    fh.write(body)

    emit(
        {
            "ok": True,
            "stage": "fetch",
            "base": base,
            "hits": hits,
            "hint": (
                "hits 里带文件名的那个就是文件列表接口，下一步按它给的名字逐个 GET 就能拉音频；"
                "一条 200 都没有说明端口对了但路径不对，用 Wireshark 抓官方 App 请求最省时间。"
            ),
        }
    )


# ------------------------------------------------------------------ 4) leave


def do_leave(_args):
    # 先断开，再删 profile：顺序反了的话 Windows 会认为「正在使用」而删不掉，
    # 下次 join 就带着旧密码去连，表现成「密码明明是对的却连不上」。
    run(["netsh", "wlan", "disconnect"])
    time.sleep(2)
    run(["netsh", "wlan", "delete", "profile", f"name={PROFILE_NAME}"])
    emit({"ok": True, "stage": "leave", "currentSsid": current_ssid()})


def main():
    ap = argparse.ArgumentParser(description="录音卡 WiFi 快传数据面探测")
    ap.add_argument("mode", choices=["join", "scan", "fetch", "leave"])
    ap.add_argument("--ssid", default=None)
    ap.add_argument("--pass", dest="passwd", default="")
    ap.add_argument("--host", default=None, help="卡片 IP（默认用网关）")
    ap.add_argument("--port", type=int, default=80)
    ap.add_argument("--out", default=None, help="把 200 的响应存到这个目录")
    args = ap.parse_args()

    try:
        if args.mode == "join":
            if not args.ssid:
                emit({"ok": False, "error": "join 需要 --ssid（密码可选 --pass）"})
                return 1
            do_join(args)
        elif args.mode == "scan":
            do_scan(args)
        elif args.mode == "fetch":
            do_fetch(args)
        else:
            do_leave(args)
        return 0
    except Exception as exc:  # noqa: BLE001
        emit({"ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
