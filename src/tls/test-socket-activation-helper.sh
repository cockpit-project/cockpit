#!/bin/sh
set -eu

if ! type curl >/dev/null 2>&1 || ! type nc >/dev/null 2>&1; then
    echo "1..0 # SKIP: curl or nc not installed"
    exit 0
fi

echo "1..6"

# start activation helper
SOCKET_DIR=$(mktemp -d --tmpdir socks.XXXXXX)
COCKPIT_WS_PROCESS_IDLE=1 ./socket-activation-helper ./cockpit-ws "$SOCKET_DIR" &
HELPER_PID=$!
trap "kill $HELPER_PID; rm -r '$SOCKET_DIR'" EXIT INT QUIT PIPE

# wait until it is ready
for timeout in `seq 50`; do
    curl --silent --head --unix "$SOCKET_DIR/http.sock" http://dummy/cockpit/login >/dev/null && break
    sleep 0.2
done

# expected results; we can't really login, but it should get sufficiently far
SUCCESS="HTTP/1.1 [45]0"
REDIRECT="HTTP/1.1 301"

# args: <socketname> <expected output>
expect_curl() {
    OUT=$(curl --silent --show-error --head --unix "$SOCKET_DIR/$1" http://dummy/cockpit/login)
    if ! echo "$OUT" | grep -q "$2"; then
        echo "FAIL: output does not contain $2" >&2
        echo "$OUT" >&2
        exit 1
    fi
}

# args: <socketname> <expected output>
expect_nc() {
    OUT=$(nc --unixsock "$SOCKET_DIR/$1" </dev/null)
    if ! echo "$OUT" | grep -q "$2"; then
        echo "FAIL: output does not contain $2" >&2
        echo "$OUT" >&2
        exit 1
    fi
}


expect_curl http.sock "$SUCCESS"
# second call to existing instance
expect_curl http.sock "$SUCCESS"
# wait for idle timeout
sleep 2
expect_curl http.sock "$SUCCESS"
echo "ok 1 http.sock"


expect_curl http-redirect.sock "$REDIRECT"
echo "ok 2 http-redirect.sock"


expect_nc https-factory.sock "^https@0.sock$"
echo "ok 3 https-factory #0"


expect_curl https@0.sock "$SUCCESS"
# second call to existing instance
expect_curl https@0.sock "$SUCCESS"
# wait for idle timeout
sleep 2
expect_curl https@0.sock "$SUCCESS"
echo "ok 4 https@0.sock"


expect_nc https-factory.sock "^https@1.sock$"
echo "ok 5 https-factory #1"


expect_curl https@1.sock "$SUCCESS"
echo "ok 6 https@1.sock"
