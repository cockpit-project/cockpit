#!/bin/bash

cat /etc/redhat-release | grep -q Fedora && DISTRO=Fedora
cat /etc/redhat-release | grep -q Red && DISTRO=RH
VERS=`cat /etc/redhat-release | grep Fedora | sed -r 's/.* ([0-9]+) .*/\1/'`

if [ "$VERS" -ge 22 -a "$DISTRO" = "Fedora" ]; then
    dnf -y -q install tar bzip2 gzip unzip zip tar git fontconfig pystache
elif [ "$VERS" -lt 22 -a "$DISTRO" = "Fedora" ]; then
    yum -y -q install tar bzip2 gzip unzip zip tar git yum-utils fontconfig pystache
elif [ "$DISTRO" = "RH" ]; then
    yum -y -q install tar bzip2 gzip unzip zip tar git yum-utils fontconfig pystache
else
    echo 'not known distro'
    exit 1
fi