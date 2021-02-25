#!/bin/sh
set -eux

export TEST_DIR
export SOURCE

TEST_DIR="$(realpath $(dirname $(dirname "$0")))"
if [ -d source ]; then
    # path for standard-test-source
    SOURCE="$(pwd)/source"
else
    SOURCE="$(realpath $TEST_DIR/..)"
fi
LOGS="$(pwd)/logs"
mkdir -p "$LOGS"
chmod a+w "$LOGS"
