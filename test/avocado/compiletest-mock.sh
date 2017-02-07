#!/bin/bash
set +x

BASEPKG="mock rpm-build"
INST=yum
rpm -q dnf && INST=dnf
$INST -y install $BASEPKG
USER=mocktest
useradd $USER
usermod -a -G mock $USER
/bin/cp -rf /root/cockpit /home/$USER
chown -R $USER /home/$USER/cockpit
su $USER -c "cd /home/$USER/cockpit; ./tools/make-rpms"
#&& mock -r fedora-rawhide-x86_64 cockpit-wip-2.*.src.rpm"
PACKAGES=`find /home/$USER/cockpit -type f -name "*.rpm" ! -name "*src*" ! -name "*tests*"`
echo "PACKAGES ARE> $PACKAGES <"
$INST -y install  $PACKAGES
