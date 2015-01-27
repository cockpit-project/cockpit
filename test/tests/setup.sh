#!/bin/bash

yum -y virt-install virt-manager libvirt qemu-kvm libvirt-daemon-kvm qemu-kvm-tools
#yum -y install nodejs npm
#npm -g install phantomjs

yum -y install yum-plugin-copr
yum -y copr enable lmr/Autotest
yum -y install avocado
yum -y install avocado-virt

# because of troubles with cockpit recompiled to /opt/ instead of /usr
#setenforce 0

lib/create_test_machine.sh testd fedora-21

/bin/cp -r * /usr/share/avocado/tests
#cp * ~/tmp/root/avocado/tests/ -rf; cp -rf * /usr/share/avocado/tests/
# avocado run checklogin.py
# avocado run --vm --vm-domain $NAME --vm-username root  --vm-password  testvm --vm-hostname $IP inittest.sh checklogin.py failtest.py skiptest.py passtest.py
# cat /root/avocado/job-results/latest/job.log 

