#!/bin/sh

set -eu
port="22"
host="localhost"

parse_addr() {
    if [ -n "$1" ]; then
        case "$1" in
            *:*)
                t="$1"
                p=${t##*:}
                h=${t%:*}
                ;;
            *)
                p="$1"
                h="localhost"
                ;;
        esac

        # checks that port is an integer
        if [ "$p" -eq "$p" ] 2>/dev/null; then
            port="$p"
            host="$h"
            if [ "$host" = "[::]" ]; then
                host="::"
            fi
        fi
    fi
}

# Try to find where sshd might be listening

# Check sshd_config, only works for root
config=$(sshd -T | grep "listenaddress " | cut -d' ' -f2-)
echo "$config" | while IFS='\n' read line; do
    parse_addr "$line"
done

# Check with systemd
systemd=$(systemctl show --property=Listen sshd.socket || systemctl show --property=Listen ssh.socket || true)
echo "$systemd" | while IFS='=' read -r name value; do
    if [ "$name" = "ListenStream" ]; then
        parse_addr "$value"
    fi
done

keys=$(ssh-keyscan -t dsa,ecdsa,ed25519,rsa -p "$port" "$host" || ssh-keyscan -t ecdsa,ed25519,rsa -p "$port" "$host" || true)
if [ -n "$keys" ]; then
    # Some versions of ssh-keygen don't support -f reading from stdin
    # so write a tmpfile
    tmp=$(mktemp)
    echo "$keys" > "$tmp"

    # Not all ssh-keygen version support -E in those cases just output the default
    (ssh-keygen -l -f "$tmp" -E md5 && ssh-keygen -l -f "$tmp" -E sha256) || ssh-keygen -l -f "$tmp"
    rm "$tmp"
fi
