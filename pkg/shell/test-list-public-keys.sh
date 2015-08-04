#!/bin/sh

set -euf
cd $(dirname $0)

echo "1..3"

function normalize_fp()
{
	sed -e 's/\([0-9]\+ \)[a-z0-9:]\+ \+/\1FINGERPRINT /'
}

function test_compare()
{
    input="mock/ssh/$1-input"
    if /bin/sh ./ssh-list-public-keys.sh < $input | normalize_fp | diff -U3 mock/ssh/$1-output - >&2; then
        echo "ok $1 $input"
    else
        echo "not ok $1 $input"
    fi
}

for n in 1 2 3; do
    test_compare $n
done
