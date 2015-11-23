#! /bin/bash
# -*- coding: utf-8 -*-

# This file is part of Cockpit.
#
# Copyright (C) 2015 Red Hat, Inc.
#
# Cockpit is free software; you can redistribute it and/or modify it
# under the terms of the GNU Lesser General Public License as published by
# the Free Software Foundation; either version 2.1 of the License, or
# (at your option) any later version.
#
# Cockpit is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
# Lesser General Public License for more details.
#
# You should have received a copy of the GNU Lesser General Public License
# along with Cockpit; If not, see <http://www.gnu.org/licenses/>.

set -e
set -o pipefail

function echolog() {
    echo "`date -u '+%Y%m%d-%H:%M:%S'` IPA GUEST: $@"
}

DOMAIN=`hostname -d`
ALLPASSW="foobarfoo"

KDOMAIN=`echo $DOMAIN | tr '[:lower:]' '[:upper:]'`

if rpm -q freeipa-server >/dev/null; then
    echolog "FreeIPA already configured"
else
    echolog "Installing and configuring FreeIPA"

    set -eufx
    yum  install -y freeipa-server bind bind-dyndb-ldap rng-tools bind-utils

    setenforce 0
    sed -i 's/SELINUX=enforcing.*$/SELINUX=permissive/' /etc/selinux/config

    rngd -r /dev/urandom

    ipa-server-install -U -p $ALLPASSW -P $ALLPASSW -a $ALLPASSW -n $DOMAIN -r $KDOMAIN --setup-dns --no-forwarders
    SERV_PARMS="--add-service http --add-service https --add-service ldap --add-service ldaps --add-service kerberos --add-service dns --add-service ntp"
    firewall-cmd --permanent $SERV_PARMS
    firewall-cmd  $SERV_PARMS
fi
