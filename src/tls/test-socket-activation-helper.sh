#!/bin/sh
set -eu
SOCKET_DIR=$(mktemp -d --tmpdir socks.XXXXXX)

echo "1..3"

# start activation helper
COCKPIT_WS_PROCESS_IDLE=1 ./socket-activation-helper ./cockpit-ws "$SOCKET_DIR" &
HELPER_PID=$!
trap " kill $HELPER_PID; rm -r '$SOCKET_DIR'" EXIT INT QUIT PIPE

# args: <socketname> <expected output>
expect_curl() {
    OUT=$(curl --silent --show-error --unix "$SOCKET_DIR/$1" http://dummy/cockpit/login)
    if ! echo "$OUT" | grep -q "$2"; then
        echo "FAIL: output does not contain $2" >&2
        echo "$OUT" >&2
        exit 1
    fi
}


expect_curl http.sock "<h1>Internal error in login process</h1>"
# second call to existing instance
expect_curl http.sock "<h1>Internal error in login process</h1>"
# wait for idle timeout
sleep 2
expect_curl http.sock "<h1>Internal error in login process</h1>"
echo "ok 1 http.sock"


expect_curl http-redirect.sock "<body>Please use TLS</body>"
echo "ok 2 http-redirect.sock"


expect_curl https.sock "<h1>Internal error in login process</h1>"
# second call to existing instance
expect_curl https.sock "<h1>Internal error in login process</h1>"
# wait for idle timeout
sleep 2
expect_curl https.sock "<h1>Internal error in login process</h1>"
echo "ok 3 https.sock"
