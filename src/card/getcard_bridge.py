#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""得到录音卡（GetSeed / GSC10）电脑直连桥。

这是一个「只做协议、不做业务」的小程序：DSH 插件用子进程调用它，
它在 stdout 上输出**一个** JSON 对象，所有过程日志走 stderr。

协议来源：对官方 App 抓包 + 固件逆向得出的 BLE 明文协议
（控制通道 00009100 / 写 9101 / 通知 9102，帧头 FCFCFCFC + CRC32）。
录音文件本身是 Ogg Opus 明文，不需要任何密钥，也不需要账号。

⚠️ 安全约定（刻意写死，不给调用方留后门）：
    本程序**永远不发送 0x0041（清理已传输文件）**。
    那条命令会把卡片上「已同步」的录音永久删掉，官方 App 每次连接都会先发它。
    这里只提供 0x0044（按文件名删除单个），而且要显式传 --delete-after。
    默认行为是纯只读：只下载，不动卡片上的任何文件。

用法（由插件调用，一般不手动跑）：
    python getcard_bridge.py scan  [--timeout 8]
    python getcard_bridge.py info
    python getcard_bridge.py list
    python getcard_bridge.py pull  --out DIR [--names a.ogg,b.ogg] [--all] [--delete-after]
    python getcard_bridge.py doctor            # 只检查环境，不碰蓝牙
"""

import argparse
import asyncio
import json
import os
import struct
import sys
import time
import zlib
from datetime import datetime

# ---------------------------------------------------------------- 协议常量

SVC_CTL = "00009100-0000-1000-8000-57616c6b697a"
CH_CTL_W = "00009101-0000-1000-8000-57616c6b697a"
CH_CTL_N = "00009102-0000-1000-8000-57616c6b697a"

C_QUERY = 0x0050
C_LIST = 0x0043
C_DELETE = 0x0044
C_STORAGE = 0x0042
C_DEV_TIME = 0x0046
C_MTU_RPT = 0x0047
C_DOWNLOAD = 0x0145
C_FILE_INFO = 0x0245
C_DATA = 0x0345
C_DONE = 0x0445
C_ERR = 0x0545
C_TIME_SYNC = 0x0146
C_DEV_UP = 0x0140

ERR_NOT_FOUND = 0x5A
MAGIC = b"\xfc\xfc\xfc\xfc"


def ctrl_frame(cmd, body=b""):
    """控制通道帧：magic(4) + cmd(2LE) + len(2LE) + body + crc32(4LE)。"""
    pkt = MAGIC + struct.pack("<H", cmd) + struct.pack("<H", len(body)) + body
    return pkt + struct.pack("<I", zlib.crc32(pkt) & 0xFFFFFFFF)


def parse_ctrl(v):
    if len(v) < 8 or v[:4] != MAGIC:
        return None
    ln = struct.unpack("<H", v[6:8])[0]
    if len(v) < 8 + ln:
        return None
    return struct.unpack("<H", v[4:6])[0], v[8 : 8 + ln]


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- 会话


class CardSession:
    def __init__(self, addr=None):
        self.addr = addr
        self.client = None
        self.device = None
        self.list_buf = None
        self.dl = None
        self.mtu = None
        self.storage = None
        self.dev_time = None
        self.del_ack = None
        self.err = None

    async def connect(self, retries=3):
        from bleak import BleakClient, BleakScanner

        log("[连接] 扫描卡片…")
        if self.addr:
            dev = await BleakScanner.find_device_by_address(self.addr, timeout=15.0)
        else:
            dev = await BleakScanner.find_device_by_filter(
                lambda d, ad: (d.name or ad.local_name or "").startswith("Get-"),
                timeout=15.0,
            )
        if not dev:
            raise RuntimeError(
                "没找到录音卡。请确认：卡片已开机、在 3 米内、"
                "并且手机上的得到大脑 App 已断开连接（蓝牙一次只能被一个设备占用）。"
            )
        self.device = dev
        log("[连接] %s (%s)" % (dev.name, dev.address))

        last = None
        for i in range(retries):
            try:
                cli = BleakClient(dev, timeout=40.0)
                await cli.connect()
                self.client = cli
                break
            except Exception as e:  # noqa: BLE001
                last = e
                log("[重试 %d/%d] %s" % (i + 1, retries, e))
                await asyncio.sleep(1.5)
        else:
            raise RuntimeError("连接失败：%s" % last)

        log("[连接] 成功 mtu=%d" % self.client.mtu_size)
        await self.client.start_notify(CH_CTL_N, self._on_notify)
        await asyncio.sleep(0.4)
        return self

    async def close(self):
        if not self.client:
            return
        try:
            await self.client.stop_notify(CH_CTL_N)
        except Exception:  # noqa: BLE001
            pass
        try:
            await self.client.disconnect()
        except Exception:  # noqa: BLE001
            pass

    def _on_notify(self, _s, data):
        p = parse_ctrl(bytes(data))
        if not p:
            return
        cmd, body = p
        if cmd == C_LIST:
            self.list_buf = body.decode("utf-8", "replace")
        elif cmd == C_DATA and self.dl is not None and len(body) >= 4:
            off = struct.unpack("<I", body[0:4])[0]
            self.dl["chunks"].append((off, body[4:]))
            self.dl["got"] = max(self.dl["got"], off)
            self.dl["n"] += 1
        elif cmd == C_FILE_INFO and self.dl is not None and len(body) >= 4:
            self.dl["size"] = struct.unpack("<I", body[0:4])[0]
            log("    文件大小 %d B" % self.dl["size"])
        elif cmd == C_DONE and self.dl is not None:
            self.dl["done"] = True
            if len(body) >= 4:
                self.dl["done_size"] = struct.unpack("<I", body[0:4])[0]
        elif cmd == C_ERR:
            self.err = body[:1]
            if body[:1] and body[0] == ERR_NOT_FOUND:
                log("    !! 设备回：文件不存在 (0x5a)")
        elif cmd in (C_MTU_RPT, 0x0147) and len(body) >= 5:
            self.mtu = struct.unpack("<H", body[3:5])[0]
        elif cmd == C_DEV_TIME:
            self.dev_time = body.decode("utf-8", "replace")
        elif cmd == C_STORAGE and len(body) >= 8:
            self.storage = {
                "raw": body.hex(),
                "free_kb": struct.unpack("<I", body[4:8])[0],
            }
        elif cmd == C_DELETE:
            self.del_ack = body[:1]

    async def _send(self, cmd, body=b""):
        await self.client.write_gatt_char(CH_CTL_W, ctrl_frame(cmd, body), response=False)

    async def time_sync(self):
        ts = datetime.now().strftime("%Y%m%d%H%M%S").encode()
        await self._send(C_TIME_SYNC, ts)
        await asyncio.sleep(0.4)

    async def get_list(self, timeout=5.0):
        self.list_buf = None
        await self._send(C_QUERY, b"")
        await asyncio.sleep(0.3)
        await self._send(C_LIST, bytes.fromhex("0100000005000000"))
        t0 = time.time()
        while self.list_buf is None and time.time() - t0 < timeout:
            await asyncio.sleep(0.1)
        return self.parse_list(self.list_buf or "")

    @staticmethod
    def parse_list(txt):
        """设备回的是明文 CSV：序号,文件名,YYYY-MM-DD HH:MM:SS,字节数; 逐条以 ; 分隔。"""
        out = []
        for seg in (txt or "").split(";"):
            seg = seg.strip()
            if not seg:
                continue
            p = seg.split(",")
            if len(p) < 4:
                continue
            out.append(
                {
                    "index": p[0],
                    "name": p[1],
                    "time": p[2],
                    "size": int(p[3]) if p[3].isdigit() else 0,
                }
            )
        return out

    async def download(self, name, timeout_s=180):
        self.dl = {"chunks": [], "got": 0, "n": 0, "size": 0, "done": False}
        self.err = None
        await self._send(C_DOWNLOAD, b"\x00\x00\x00\x00" + name.encode())
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            await asyncio.sleep(0.15)
            d = self.dl
            if self.err is not None and not d["n"]:
                break
            if d["done"]:
                break
            if d["size"] and d["got"] >= d["size"]:
                break
        await asyncio.sleep(0.4)
        d = self.dl
        if self.err == ERR_NOT_FOUND or (d["n"] == 0 and not d["size"]):
            raise RuntimeError("文件不存在（设备回 0x0545/0x5a）：%s" % name)
        total = d["size"] or d["got"]
        if total <= 0:
            raise RuntimeError("没收到数据：%s" % name)
        buf = bytearray(total)
        for off, seg in d["chunks"]:
            # ★ offset 是「本块的结束位置」，起始 = offset - len
            st = max(0, off - len(seg))
            e = min(total, st + len(seg))
            buf[st:e] = seg[: e - st]
        return bytes(buf)

    async def delete(self, name, wait=3.0):
        self.del_ack = None
        await self._send(C_DELETE, name.encode())
        t0 = time.time()
        while time.time() - t0 < wait and self.del_ack is None:
            await asyncio.sleep(0.1)
        return self.del_ack == b"\x01"

    async def device_status(self):
        self.dev_time = None
        self.storage = None
        self.mtu = None
        for cmd in (C_DEV_TIME, C_MTU_RPT, C_STORAGE):
            await self._send(cmd, b"")
            await asyncio.sleep(0.55)
        await asyncio.sleep(0.3)
        return {
            "deviceTime": self.dev_time,
            "mtu": self.mtu,
            "freeKb": (self.storage or {}).get("free_kb"),
            "freeGb": round(((self.storage or {}).get("free_kb") or 0) / 1024 / 1024, 2)
            if self.storage
            else None,
        }


def ogg_duration(raw):
    """从最后一个 Ogg 页的 granule position 估时长（Opus 固定 48kHz 时钟）。"""
    try:
        i, gp = 0, 0
        while i + 27 <= len(raw) and raw[i : i + 4] == b"OggS":
            gp = struct.unpack("<q", raw[i + 6 : i + 14])[0]
            nseg = raw[i + 26]
            blen = sum(raw[i + 27 : i + 27 + nseg])
            i += 27 + nseg + blen
        return gp / 48000.0
    except Exception:  # noqa: BLE001
        return 0.0


# ---------------------------------------------------------------- 子命令


async def do_scan(args):
    from bleak import BleakScanner

    log("[扫描] %d 秒…" % args.timeout)
    devs = await BleakScanner.discover(timeout=float(args.timeout), return_adv=True)
    all_rows, cards = [], []
    for addr, (d, adv) in devs.items():
        name = d.name or adv.local_name or ""
        row = {"addr": addr, "name": name, "rssi": adv.rssi}
        all_rows.append(row)
        if name.startswith("Get-"):
            cards.append(row)
    all_rows.sort(key=lambda r: -(r["rssi"] or -999))
    return {"ok": True, "cards": cards, "devices": all_rows}


async def do_info(args):
    s = await CardSession(args.addr).connect()
    try:
        await s.time_sync()
        st = await s.device_status()
        files = await s.get_list()
        return {
            "ok": True,
            "device": {"name": s.device.name, "address": s.device.address},
            "status": st,
            "fileCount": len(files),
        }
    finally:
        await s.close()


async def do_list(args):
    s = await CardSession(args.addr).connect()
    try:
        await s.time_sync()
        files = await s.get_list()
        for f in files:
            f["duration"] = None
        return {
            "ok": True,
            "device": {"name": s.device.name, "address": s.device.address},
            "files": files,
        }
    finally:
        await s.close()


async def do_pull(args):
    outdir = os.path.abspath(args.out)
    os.makedirs(outdir, exist_ok=True)
    s = await CardSession(args.addr).connect()
    try:
        await s.time_sync()
        files = await s.get_list()
        if not files:
            return {"ok": True, "downloaded": [], "skipped": [], "note": "卡片上没有录音"}
        if args.all:
            targets = files
        else:
            want = [n.strip() for n in (args.names or "").split(",") if n.strip()]
            targets = [f for f in files if f["name"] in want]
        if not targets:
            return {"ok": False, "error": "要下载的文件不在卡片上", "files": files}

        downloaded, skipped = [], []
        for f in targets:
            dst = os.path.join(outdir, f["name"])
            if os.path.exists(dst) and not args.force:
                skipped.append({"name": f["name"], "reason": "already-downloaded", "path": dst})
                log("[跳过] %s（本地已有）" % f["name"])
                continue
            log("[下载] %s (%d B)" % (f["name"], f["size"]))
            raw = await s.download(f["name"])
            is_ogg = raw[:4] == b"OggS"
            tmp = dst + ".part"
            with open(tmp, "wb") as fh:
                fh.write(raw)
            os.replace(tmp, dst)
            item = {
                "name": f["name"],
                "time": f["time"],
                "path": dst,
                "bytes": len(raw),
                "ogg": is_ogg,
                "duration": round(ogg_duration(raw), 1) if is_ogg else 0,
            }
            if args.delete_after and is_ogg:
                item["deletedOnCard"] = await s.delete(f["name"])
            downloaded.append(item)
            log("  -> %s %dB %.1fs" % (f["name"], len(raw), item["duration"]))
        return {"ok": True, "downloaded": downloaded, "skipped": skipped}
    finally:
        await s.close()


def do_doctor(_args):
    info = {"ok": True, "python": sys.version.split()[0]}
    try:
        import bleak  # noqa: F401
        import importlib.metadata as md

        info["bleak"] = md.version("bleak")
        info["bleakReady"] = True
    except Exception as e:  # noqa: BLE001
        info["bleakReady"] = False
        info["bleakError"] = str(e)
    return info


# ---------------------------------------------------------------- 入口


def main():
    ap = argparse.ArgumentParser(description="得到录音卡电脑直连桥（只读优先）")
    ap.add_argument("command", choices=["scan", "info", "list", "pull", "doctor"])
    ap.add_argument("--addr", default=None)
    ap.add_argument("--timeout", type=int, default=8)
    ap.add_argument("--out", default=".")
    ap.add_argument("--names", default="")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--delete-after", action="store_true")
    args = ap.parse_args()

    fn = {
        "scan": do_scan,
        "info": do_info,
        "list": do_list,
        "pull": do_pull,
        "doctor": do_doctor,
    }[args.command]

    try:
        result = fn(args)
        if asyncio.iscoroutine(result):
            result = asyncio.run(result)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as e:  # noqa: BLE001
        print(
            json.dumps({"ok": False, "error": str(e) or e.__class__.__name__}, ensure_ascii=False)
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
