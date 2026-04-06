#!/usr/bin/env python3
"""
HeartMath Inner Balance → WebSocket Bridge
Connects to Inner Balance BLE sensor, streams HR + R-R intervals to browser.
Usage: python3 heartmath-bridge.py
"""

import asyncio
import json
import time
from bleak import BleakClient, BleakScanner
import websockets

DEVICE_NAME = "HeartMath-HRV-W4647"
HR_MEASUREMENT_UUID = "00002a37-0000-1000-8000-00805f9b34fb"
BATTERY_UUID = "00002a19-0000-1000-8000-00805f9b34fb"
WS_PORT = 8765

clients = set()
latest_data = {"hr": 0, "rr": [], "battery": 0, "connected": False, "ts": 0}


def parse_hr_measurement(sender, data):
    """Parse BLE Heart Rate Measurement characteristic."""
    flags = data[0]
    hr_16bit = flags & 0x01
    offset = 1

    if hr_16bit:
        hr = int.from_bytes(data[offset:offset + 2], "little")
        offset += 2
    else:
        hr = data[offset]
        offset += 1

    # Skip energy expended if present
    if (flags >> 3) & 0x01:
        offset += 2

    # R-R intervals (1/1024 sec units → ms)
    rr_intervals = []
    while offset + 1 < len(data):
        rr_raw = int.from_bytes(data[offset:offset + 2], "little")
        rr_ms = round(rr_raw * 1000 / 1024, 1)
        rr_intervals.append(rr_ms)
        offset += 2

    latest_data["hr"] = hr
    latest_data["rr"] = rr_intervals
    latest_data["ts"] = time.time()

    # Broadcast to all connected WebSocket clients
    msg = json.dumps({
        "type": "hr",
        "hr": hr,
        "rr": rr_intervals,
        "battery": latest_data["battery"],
        "ts": latest_data["ts"],
    })
    for ws in clients.copy():
        asyncio.ensure_future(ws.send(msg))


async def ws_handler(websocket):
    """Handle WebSocket connections from the browser."""
    clients.add(websocket)
    print(f"[WS] Client connected ({len(clients)} total)")

    # Send connection status
    await websocket.send(json.dumps({
        "type": "status",
        "connected": latest_data["connected"],
        "battery": latest_data["battery"],
        "device": DEVICE_NAME,
    }))

    try:
        async for msg in websocket:
            pass  # Client messages ignored for now
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        clients.discard(websocket)
        print(f"[WS] Client disconnected ({len(clients)} total)")


async def ble_loop():
    """Main BLE connection loop with auto-reconnect."""
    while True:
        try:
            print(f"[BLE] Scanning for {DEVICE_NAME}...")
            device = await BleakScanner.find_device_by_name(DEVICE_NAME, timeout=15.0)

            if not device:
                print("[BLE] Device not found. Retrying in 5s...")
                await asyncio.sleep(5)
                continue

            print(f"[BLE] Found {device.name}, connecting...")

            async with BleakClient(device) as client:
                # Read battery
                battery_data = await client.read_gatt_char(BATTERY_UUID)
                latest_data["battery"] = battery_data[0]
                latest_data["connected"] = True

                print(f"[BLE] Connected! Battery: {latest_data['battery']}%")

                # Notify all WS clients
                status_msg = json.dumps({
                    "type": "status",
                    "connected": True,
                    "battery": latest_data["battery"],
                    "device": DEVICE_NAME,
                })
                for ws in clients.copy():
                    asyncio.ensure_future(ws.send(status_msg))

                # Subscribe to HR notifications
                await client.start_notify(HR_MEASUREMENT_UUID, parse_hr_measurement)

                # Keep alive while connected
                while client.is_connected:
                    await asyncio.sleep(1)

                print("[BLE] Device disconnected.")
                latest_data["connected"] = False

        except Exception as e:
            print(f"[BLE] Error: {e}")
            latest_data["connected"] = False
            await asyncio.sleep(3)


async def main():
    print(f"[WS] Starting WebSocket server on ws://localhost:{WS_PORT}")
    ws_server = await websockets.serve(ws_handler, "localhost", WS_PORT)

    print("[BLE] Starting BLE connection loop...")
    await ble_loop()


if __name__ == "__main__":
    asyncio.run(main())
