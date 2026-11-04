#!/bin/sh
set -eu
if [ "${APP_ROLE:-api}" = "worker" ]; then
    exec sh start-worker.sh
fi
exec sh start.sh
