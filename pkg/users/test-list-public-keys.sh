#!/bin/sh

set -euf
cd $(dirname $0)

echo "1..4"

# Normalize across various ssh-keygen versions
normalize()
{
    sed -e 's/\([0-9]\+ \)[A-Za-z0-9:]\+ \+/\1FINGERPRINT /' \
        -e 's/authorized_keys is not a public key file.//' \
        -e 's/FINGERPRINT Comment Here (RSA)/FINGERPRINT no comment (RSA)/' \
        -e 's/FINGERPRINT authorized_keys (RSA)/FINGERPRINT no comment (RSA)/'
}

test_compare()
{
    input="mock/ssh/$1-input"
    if /bin/sh ./ssh-list-public-keys.sh < $input | normalize | diff -U3 mock/ssh/$1-output - >&2; then
        echo "ok $1 $input"
    else
        echo "not ok $1 $input"
    fi
}

for n in 1 2 3 4; do
    test_compare $n
done
