#!/bin/sh
set -eu

adb start-server

if [ -n "${WS_SCRCPY_ADB_TARGET:-}" ]; then
    (
        while true; do
            if [ "$(timeout 5 adb -s "$WS_SCRCPY_ADB_TARGET" get-state 2>/dev/null || true)" != device ]; then
                timeout 5 adb connect "$WS_SCRCPY_ADB_TARGET" >/dev/null 2>&1 || true
            fi
            sleep 5
        done
    ) &
fi

exec "$@"
