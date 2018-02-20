#!/bin/sh

NAME="`systemctl --no-legend list-unit-files libvirtd.service libvirt-bin.service |  head -n1 | cut -f1 -d' '`"

if [ -n "$NAME" ]; then
    # get id name because libvirt-bin is primary in ubuntu 1604
    systemctl  --property=Id show "$NAME" | cut -c 4-
fi
