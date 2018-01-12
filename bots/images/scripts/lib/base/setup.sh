#! /bin/sh

upgrade() {
    # https://bugzilla.redhat.com/show_bug.cgi?id=1483553
    dnf -v -y update  2>err.txt
    ecode=$?
    if [ $ecode -ne 0 ] ; then
        grep -q -F -e "BDB1539 Build signature doesn't match environment" err.txt
        if [ $? -eq 0 ]; then
            set -eu
            rpm --rebuilddb
            dnf -v -y update
        else
            cat err.txt
            exit ${ecode}
        fi
    fi
}

upgrade

set -eu

dnf install -y sed findutils glib-networking json-glib libssh openssl python3

dnf clean all
