install
text
shutdown
lang en_US.UTF-8
keyboard us
network --bootproto dhcp
rootpw foobar
firewall --enabled --ssh
selinux --enforcing
timezone --utc America/New_York
bootloader --location=mbr --append="console=ttyS0,115200 rd_NO_PLYMOUTH"
zerombr
clearpart --all --initlabel
autopart

%packages
@core
%end

%post
mkdir /root/.ssh
chmod 700 /root/.ssh
echo "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQDUOtNJdBEXyKxBB898rdT54ULjMGuO6v4jLXmRsdRhR5Id/lKNc9hsdioPWUePgYlqML2iSV72vKQoVhkyYkpcsjr3zvBny9+5xej3+TBLoEMAm2hmllKPmxYJDU8jQJ7wJuRrOVOnk0iSNF+FcY/yaQ0owSF02Nphx47j2KWc0IjGGlt4fl0fmHJuZBA2afN/4IYIIsEWZziDewVtaEjWV3InMRLllfdqGMllhFR+ed2hQz9PN2QcapmEvUR4UCy/mJXrke5htyFyHi8ECfyMMyYeHwbWLFQIve4CWix9qtksvKjcetnxT+WWrutdr3c9cfIj/c0v/Zg/c4zETxtp cockpit-test" > /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
mkdir -p /etc/sysconfig/network-scripts
echo "BOOTPROTO="dhcp"
DEVICE="eth0"
ONBOOT="yes"" > /etc/sysconfig/network-scripts/ifcfg-eth0
echo "BOOTPROTO="none"
DEVICE="eth1"
ONBOOT="no"" > /etc/sysconfig/network-scripts/ifcfg-eth1
sed -i "s/GRUB_TIMEOUT.*/GRUB_TIMEOUT=0/" /etc/default/grub
grub2-mkconfig -o /boot/grub2/grub.cfg
grubby --update-kernel=ALL --args="net.ifnames=0 biosdevname=0"
%end
