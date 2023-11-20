#! /bin/sh

set -eu

# clevis-luks-passphrase [--type] DEV
#
# Try to recover a passphrase via clevis that will open DEV, and
# output it on stdout.  Such a passphrase can be used for things like
# resizing of LUKSv2 containers, or adding/changing keys.
#
# If "--type" is given, this tool writes just "clevis" to stdout when
# a passphrase is found, instead of the actual passphrase.  This is
# useful to limit exposure of the passphrase when all you want to know
# is whether "clevis luks unlock" can be expected to succeed.

opt_type=no
if [ $# -gt 1 ] && [ "$1" = "--type" ]; then
    opt_type=yes
    shift
fi

if [ $# -ne 1 ]; then
    echo "usage: $0 [--type] DEV" >&2
    exit 1
fi

DEV="$1"

if cryptsetup isLuks --type luks1 "$DEV"; then

    # The UUID that clevis uses for its luksmeta slots,
    # see for example /usr/bin/clevis-luks-bind
    #
    CLEVIS_UUID=cb6e8904-81ff-40da-a84a-07ab9ab5715e

    luksmeta test -d "$DEV" 2>/dev/null || exit 0

    luksmeta show -d "$DEV" | while read slot state uuid; do
        if [ "$state" = "active" ] && [ "$uuid" = "$CLEVIS_UUID" ]; then
            if pp=$(luksmeta load -d "$DEV" -s "$slot" | clevis decrypt); then
                if [ "$opt_type" = yes ]; then
                    echo clevis
                else
                    printf '%s\n' "$pp"
                fi
                break
            fi
        fi
    done

elif cryptsetup isLuks --type luks2 "$DEV"; then
    for id in `cryptsetup luksDump "$DEV" | sed -rn 's|^\s+([0-9]+): clevis|\1|p'`; do
        tok=`cryptsetup token export --token-id "$id" "$DEV"`
        jwe=`printf '%s\n' "$tok" | jose fmt -j- -Og jwe -o- | jose jwe fmt -i- -c`

        if pt=`printf '%s' "$jwe" | clevis decrypt`; then
            if [ "$opt_type" = yes ]; then
                echo clevis
            else
                printf '%s\n' "$pt"
            fi
            break
        fi
    done
fi
