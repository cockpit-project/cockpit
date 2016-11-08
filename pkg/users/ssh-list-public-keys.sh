#!/bin/sh

dir=$(mktemp -d)
cd "$dir"

process()
{
    if [ -z "$1" ]; then
        return
    fi
    case "$1" in
    \#*)
        ;;
    *)
        echo "$1"> authorized_keys
        echo "$(LC_ALL=C ssh-keygen -l -f authorized_keys)"
        echo "$1"
        ;;
    esac
}

sed -e '$a\' | while read -r line; do
    process "$line"
done

rm -f "$dir/authorized_keys"
rmdir "$dir"
