#! /bin/bash

DOMAIN=cockpit.lan
set -eufx
#yes | --enablerepo=updates-testing
yum  install -y freeipa-server bind bind-dyndb-ldap rng-tools

setenforce 0
sed -i 's/SELINUX=enforcing.*$/SELINUX=permissive/' /etc/selinux/config

rngd -r /dev/urandom

ipa-server-install -U -p foobarfoo -r foobarfoo -a foobarfoo -n $DOMAIN -r COCKPIT.LAN --setup-dns --no-forwarders

firewall-cmd --permanent \
             --add-service http \
             --add-service https \
             --add-service ldap \
             --add-service ldaps \
             --add-service kerberos \
             --add-service dns \
             --add-service ntp


