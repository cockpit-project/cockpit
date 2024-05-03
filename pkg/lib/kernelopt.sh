#!/bin/sh
# Helper to add, modify, and remove a kernel command line option. This supports
# grub and zipl, i. e. x86, arm64, and s390x. Either grubby (Fedora, RHEL) or
# update-grub (Debian, Ubuntu) needs to be available.
#
# Copyright (C) 2019 Red Hat, Inc
set -eu

error() {
    echo "$1" >&2
    exit 1
}

grub() {
    key="${2%=*}"  # split off optional =value

    # For the non-BLS case, or if someone overrides those with grub2-mkconfig
    # or update-grub, change it in /etc/default/grub
    if [ -e /etc/default/grub ]; then
        if [ "$1" = set ]; then
            # replace existing argument, otherwise append it
            sed -i.bak -r "/^[[:space:]]*GRUB_CMDLINE_LINUX\b/ { s/$key(=[^[:space:]\"]*)?/$2/g; t; s/\"$/ $2\"/ }" /etc/default/grub
        else
            sed -i.bak -r "/^[[:space:]]*GRUB_CMDLINE_LINUX\b/ s/$key(=[^[:space:]\"]*)?//g" /etc/default/grub
        fi
    fi

    # on Fedora and RHEL, use grubby; this covers grub and BLS; s390x's zipl also supports BLS there
    if type grubby >/dev/null 2>&1; then
        if [ "$1" = set ]; then
            grubby --args="$2" --update-kernel=ALL
        else
            grubby --remove-args="$2" --update-kernel=ALL
        fi

    # on Debian/Ubuntu, use update-grub, which reads from /etc/default/grub
    elif [ -e /etc/default/grub ] && type update-grub >/dev/null 2>&1; then
        update-grub

    # on OSTree, the kernel config is inside the image
    elif cur=$(rpm-ostree kargs 2>&1); then
        if [ "$1" = set ]; then
            # replace if already present; can happen in the middle (must be separated by space) or at the beginning of line
            if [ "${cur% $key *}" != "$cur" ] || [ "${cur% $key=*}" != "$cur" ] || [ "${cur#${key}[ =]}" != "$cur" ]; then
                rpm-ostree kargs --replace="$2"
            else
                rpm-ostree kargs --append="$2"
            fi
        else
            rpm-ostree kargs --delete="$key"
        fi
    else
        error "No supported grub update mechanism found (grubby, update-grub, or rpm-ostree)"
    fi
}

update_zipl() {
    if type zipl >/dev/null 2>&1; then
        zipl
    fi
}

#
# main
#

if [ -z "${2:-}" ] || [ -n "${3:-}" ] || [ "$1" != "set" -a "$1" != "remove" ]; then
    error "Usage: '$0 set <option>[=<value>]' or '$0 remove <option>'"
fi

grub "$1" "$2"
update_zipl
