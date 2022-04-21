#! /bin/sh

set -euf

# Print the name of default key, if any.

for f in id_dsa id_ecdsa id_ecdsa_sk id_ed25519 id_ed25519_sk id_rsa; do
    p=$HOME/.ssh/$f
    if test -f "$p"; then
        echo "$p"
        if ! ssh-keygen -y -P "" -f "$p" >/dev/null 2>/dev/null; then
            echo "encrypted"
        fi
        exit 0
    fi
done
