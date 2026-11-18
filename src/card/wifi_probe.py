#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""录音卡 WiFi 快传通道：命令码探针。

背景：固件里确实有 WiFi 快传能力（`blespp_file_set_device_special_wifi_status_handle`、
`blespp_file_device_notify_app_wifi_status`、`bwifi_softap_start`、`%s wifi trans clock key!!`），
但**这几个函数的 BLE 命令码还没有被逆向出来**。开源协议文档 docs/13 明确写着
「热点 SSID/密码如何下发：推测经 BLE 命令下发，需抓 BLE 确认字段格式」。

这个脚本就是去补上那一块。它做三件事，风险从低到高：

  1) `listen`  —— 纯被动。连上卡片后只订阅通知、什么都不发。
                  用户手动按卡片上的「WiFi 传输」按键组合，我们把它主动推上来的
                  通知原样打出来。**这一步就能拿到通知用的命令码和载荷格式**，
                  而请求方向（手机→卡片）的命令码通常就在它旁边一两个号。
                  零风险，先跑这个。

  2) `probe`   —— 主动枚举。只在**候选窗口**里逐个发命令，每发一个就看：
                  卡片有没有推新通知？电脑这边有没有冒出新热点？
                  默认候选窗口就是 WiFi 通知码附近的几个号，不是全空间扫。
                  任何已知危险码一律拒绝发送（见 DANGEROUS）。

  3) `activate` —— 已经确认命令码之后，直接发那一条把 WiFi 打开，
                  并等卡片把 SSID / 密码 / IP 推上来。

⚠️ 安全约定（和 getcard_bridge.py 同一套，写死不给后门）：
    本程序**永远不发送 0x0041**（清理已传输文件＝永久删除）。
    也不发送 0x0044（删指定文件）—— 探针不需要删任何东西。
    除 WiFi 激活外，不碰卡片上的文件。

用法：
    python wifi_probe.py listen --seconds 45
    python wifi_probe.py probe
    python wifi_probe.py probe --cmds 0x0048,0x0049,0x0051
    python wifi_probe.py activate --cmd 0x0048 --body 01
    python wifi_probe.py ssids                 # 只看电脑现在能扫到哪些热点（不碰蓝牙）
"""

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from getcard_bridge import (  # noqa: E402  复用协议常量，避免两份定义漂移
    CH_CTL_N,
    CH_CTL_W,
    MAGIC,
    SVC_CTL,
    ctrl_frame,
    parse_ctrl,
)

# 绝对不发的命令码：0x0041 会永久删掉卡片上「已传输」的录音，0x0044 删单个文件。
# 探针的目的只是找 WiFi 命令，没有任何理由碰这两个。
DANGEROUS = {0x0041: "清理所有已传输文件（永久删除）", 0x0044: "删除指定文件（永久删除）"}

# 默认候选窗口。依据：卡片把「设置类」命令放在 0x00xx，把「传输类」放在 0x01xx；
# 已知 0x0040 查询 / 0x0042 存储 / 0x0043 列表 / 0x0045 下载回执 / 0x0046 设备时间 /
# 0x0047 MTU / 0x0050 状态，那么 set_wifi 极可能落在 0x0048~0x005F 这段空档里。
# 第二组 0x0141~0x0152 覆盖传输族（0x0140 上线 / 0x0145 下载 / 0x0146 对时 / 0x0147 MTU /
# 0x0150 进度 / 0x0151~0x0152 紧邻进度之后，也是 WiFi 状态通知常见的落点）。
DEFAULT_CMDS = (
    [0x0045, 0x0048, 0x0049, 0x004A, 0x004B, 0x004C, 0x004D, 0x004E, 0x004F]
    + [0x0051, 0x0052, 0x0053, 0x0054, 0x0055, 0x0056, 0x0057, 0x0058]
    + [0x0141, 0x0142, 0x0143, 0x0144, 0x0148, 0x0149, 0x014A, 0x014B]
    + [0x0151, 0x0152, 0x0153, 0x0154, 0x0155]
)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False))


# Windows 控制台默认是 cp936，JSON 里的中文/SSID 直接 print 会变成乱码，
# 调用方（Node）按 utf-8 解就得到一堆问号。这里把标准输出强制成 utf-8。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001  Python < 3.7 或已被重定向
    pass


# ------------------------------------------------------------------ WiFi 扫描


def visible_ssids():
    """电脑当前能看到的 SSID 列表。

    Windows 上 `netsh wlan show networks` 的输出编码跟控制台代码页走，
    中文系统是 cp936；直接 utf-8 解会炸，所以按 cp936 → utf-8 依次试。
    """
    try:
        raw = subprocess.run(
            ["netsh", "wlan", "show", "networks", "mode=bssid"],
            capture_output=True,
            timeout=25,
        ).stdout
    except Exception as exc:  # noqa: BLE001
        log("netsh 失败：%s" % exc)
        return []
    text = None
    for enc in ("cp936", "utf-8", "latin-1"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        return []
    out = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("SSID ") and ":" in s:
            val = s.split(":", 1)[1].strip()
            if val and val not in out:
                out.append(val)
    return out


def looks_like_card_hotspot(ssid):
    """卡片热点的命名规律没有公开文档，先按最可能的几种形状认。

    GetSeed 的 BLE 广播名是 `Get-<MAC 后 6 位>`，热点大概率沿用同一个前缀，
    或者直接用型号 GSC10 / 产品名 getseed。都不中也不代表失败 ——
    调用方会拿「激活前后 SSID 集合的差集」兜底，新冒出来的那个就是它。
    """
    low = ssid.lower()
    return (
        low.startswith("get-")
        or low.startswith("getseed")
        or low.startswith("gsc10")
        or "getseed" in low
        or "得到" in ssid
    )


# ------------------------------------------------------------------ BLE 会话


class ProbeSession:
    """比 getcard_bridge 的 CardSession 更轻：不实现下载，只发命令 + 收通知。"""

    def __init__(self, addr=None):
        self.addr = addr
        self.client = None
        self.events = []          # [(ts, cmd, body_bytes)]
        self.done = None

    async def connect(self, retries=3):
        from bleak import BleakClient, BleakScanner

        dev = None
        for _ in range(retries):
            if self.addr:
                dev = await BleakScanner.find_device_by_address(self.addr, timeout=12.0)
            else:
                dev = await BleakScanner.find_device_by_filter(
                    lambda d, ad: (d.name or ad.local_name or "").startswith("Get-"),
                    timeout=15.0,
                )
            if dev is not None:
                break
        if dev is None:
            raise RuntimeError(
                "没找到录音卡。确认：① 卡片已开机 ② 在电脑 3 米内 "
                "③ 手机的得到 App 已断开连接（把手机蓝牙关掉最省事）"
            )
        log("连接 %s (%s)" % (getattr(dev, "name", "?"), getattr(dev, "address", "?")))
        self.client = BleakClient(dev, timeout=40.0)
        await self.client.connect()
        await self.client.start_notify(CH_CTL_N, self._on_notify)
        log("已连接，MTU 协商中…")
        await asyncio.sleep(1.5)

    async def close(self):
        try:
            if self.client is not None:
                await self.client.stop_notify(CH_CTL_N)
                await self.client.disconnect()
        except Exception:  # noqa: BLE001
            pass

    def _on_notify(self, _sender, data):
        parsed = parse_ctrl(bytes(data))
        if parsed is None:
            # 不是控制通道帧（可能是别的特征推上来的杂包），原样记下更有用
            log("  ← 非控制帧 len=%d hex=%s" % (len(data), bytes(data).hex()))
            return
        cmd, body = parsed
        self.events.append((time.time(), cmd, body))
        log("  ← 通知 cmd=0x%04X len=%d body=%s" % (cmd, len(body), body.hex()))
        if self.done is not None and not self.done.done():
            self.done.set_result(None)

    async def send(self, cmd, body=b""):
        await self.client.write_gatt_char(CH_CTL_W, ctrl_frame(cmd, body), response=False)

    async def wait_event(self, seconds, predicate=None):
        """等一条（满足 predicate 的）通知，超时返回 None。"""
        t0 = time.time()
        start = len(self.events)
        while time.time() - t0 < seconds:
            for ts, cmd, body in self.events[start:]:
                if predicate is None or predicate(cmd, body):
                    return {"cmd": cmd, "body": body.hex(), "text": _text(body)}
            await asyncio.sleep(0.1)
        return None


def _text(body):
    try:
        s = body.decode("utf-8")
    except UnicodeDecodeError:
        return None
    # 只把「看起来像人话」的内容带出去，二进制载荷留在 hex 里
    printable = sum(1 for ch in s if ch.isprintable())
    if s and printable >= len(s) * 0.8:
        return s
    return None


# ------------------------------------------------------------------ 子命令


async def do_listen(args):
    """纯被动：连上后什么都不发，只等卡片主动推通知。"""
    before = set(visible_ssids())
    log("开始被动监听 %d 秒。现在请按卡片上的「WiFi 传输」按键组合。" % args.seconds)
    log("（不同固件组合不同：试长按、连按两下、连按三下。按对了卡片会开始闪灯/开热点。）")
    sess = ProbeSession(args.addr)
    await sess.connect()
    try:
        t0 = time.time()
        while time.time() - t0 < args.seconds:
            await asyncio.sleep(0.5)
            now = set(visible_ssids())
            new = [s for s in now - before if looks_like_card_hotspot(s)]
            if new:
                log("★ 冒出新热点：%s" % ", ".join(new))
                before = now
        events = [
            {"cmd": "0x%04X" % cmd, "len": len(body), "hex": body.hex(), "text": _text(body)}
            for _, cmd, body in sess.events
        ]
        emit({"ok": True, "mode": "listen", "seconds": args.seconds, "events": events})
    finally:
        await sess.close()


async def do_probe(args):
    """主动枚举：只发候选窗口里的码，每发一个观察通知 + 新热点。"""
    cmds = []
    for raw in args.cmds.split(","):
        raw = raw.strip()
        if not raw:
            continue
        cmd = int(raw, 0)
        if cmd in DANGEROUS:
            log("!! 拒绝发送 0x%04X（%s）" % (cmd, DANGEROUS[cmd]))
            continue
        cmds.append(cmd)
    if not cmds:
        emit({"ok": False, "error": "没有可用的候选命令码"})
        return

    before = set(visible_ssids())
    log("候选 %d 个命令码，开始逐个试。" % len(cmds))
    sess = ProbeSession(args.addr)
    await sess.connect()
    hits = []
    try:
        for cmd in cmds:
            if cmd in DANGEROUS:  # 双保险
                continue
            log("→ 发送 cmd=0x%04X" % cmd)
            mark = len(sess.events)
            try:
                await sess.send(cmd, bytes.fromhex(args.body) if args.body else b"")
            except Exception as exc:  # noqa: BLE001
                log("  写失败：%s" % exc)
                continue
            await asyncio.sleep(args.wait)
            fresh = sess.events[mark:]
            now = set(visible_ssids())
            new_ssids = sorted(now - before)
            if fresh or new_ssids:
                hit = {
                    "cmd": "0x%04X" % cmd,
                    "notifications": [
                        {"cmd": "0x%04X" % c, "len": len(b), "hex": b.hex(), "text": _text(b)}
                        for _, c, b in fresh
                    ],
                    "newSsids": new_ssids,
                }
                hits.append(hit)
                log("  ★ 有反应：通知 %d 条，新热点 %s" % (len(fresh), new_ssids or "无"))
                if new_ssids:
                    before = now
        emit({"ok": True, "mode": "probe", "tried": len(cmds), "hits": hits})
    finally:
        await sess.close()


async def do_activate(args):
    """已知命令码后：发它，并把卡片推上来的热点信息解析出来。"""
    cmd = int(args.cmd, 0)
    if cmd in DANGEROUS:
        emit({"ok": False, "error": "拒绝发送危险命令 0x%04X：%s" % (cmd, DANGEROUS[cmd])})
        return
    before = set(visible_ssids())
    sess = ProbeSession(args.addr)
    await sess.connect()
    try:
        body = bytes.fromhex(args.body) if args.body else b""
        log("→ 激活 WiFi：cmd=0x%04X body=%s" % (cmd, body.hex() or "(空)"))
        await sess.send(cmd, body)
        # 等通知里出现热点信息（SSID / 密码 / IP 一般都在 JSON 或 `ssid:...,passwd:...` 里）
        payload = await sess.wait_event(args.wait)
        ssid = None
        passwd = None
        if payload is not None:
            text = payload.get("text") or ""
            for token in text.replace(",", " ").replace(";", " ").split():
                low = token.lower()
                if low.startswith("ssid") and ":" in token:
                    ssid = token.split(":", 1)[1]
                elif low.startswith(("passwd", "password", "pwd")) and ":" in token:
                    passwd = token.split(":", 1)[1]
        # 通知里没带就靠扫热点差集兜底
        new_ssids = sorted(set(visible_ssids()) - before)
        emit(
            {
                "ok": True,
                "mode": "activate",
                "cmd": "0x%04X" % cmd,
                "notification": payload,
                "ssid": ssid,
                "passwd": passwd,
                "newSsids": new_ssids,
                "cardHotspots": [s for s in new_ssids if looks_like_card_hotspot(s)],
            }
        )
    finally:
        await sess.close()


def do_ssids(_args):
    names = visible_ssids()
    emit({"ok": True, "ssids": names, "cardLike": [s for s in names if looks_like_card_hotspot(s)]})


def main():
    ap = argparse.ArgumentParser(description="录音卡 WiFi 快传命令码探针")
    ap.add_argument("mode", choices=["listen", "probe", "activate", "ssids"])
    ap.add_argument("--addr", default=None, help="卡片 BLE 地址（默认按 Get- 前缀自动找）")
    ap.add_argument("--seconds", type=int, default=45, help="listen 监听秒数")
    ap.add_argument("--cmds", default=",".join("0x%04X" % c for c in DEFAULT_CMDS))
    ap.add_argument("--body", default="", help="激活命令的 body（hex，如 01）")
    ap.add_argument("--wait", type=float, default=2.5, help="每条命令后等待秒数")
    ap.add_argument("--cmd", default="0x0048", help="activate 要发的命令码")
    args = ap.parse_args()

    try:
        if args.mode == "ssids":
            do_ssids(args)
            return 0
        if args.mode == "listen":
            asyncio.run(do_listen(args))
        elif args.mode == "probe":
            asyncio.run(do_probe(args))
        else:
            asyncio.run(do_activate(args))
        return 0
    except Exception as exc:  # noqa: BLE001
        emit({"ok": False, "error": str(exc)})
        return 1


if __name__ == "__main__":
    sys.exit(main())
