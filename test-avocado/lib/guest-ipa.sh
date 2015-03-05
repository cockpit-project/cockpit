#! /bin/bash

DOMAIN=`hostname -d`
ALLPASSW="foobarfoo"

KDOMAIN=`echo $DOMAIN | tr '[:lower:]' '[:upper:]'`

if rpm -q freeipa-server; then
    echo "IPA probably already installed and properly configured"
else
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
