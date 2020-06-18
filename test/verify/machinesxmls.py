# This file is part of Cockpit.
#
# Copyright (C) 2020 Red Hat, Inc.
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


TEST_NETWORK_XML = """
<network>
  <name>test_network</name>
  <forward mode='nat'/>
  <bridge name='virbr1' stp='on' delay='0'/>
  <mac address='52:54:00:bc:93:8e'/>
  <ip address='192.168.123.1' netmask='255.255.255.0'>
    <dhcp>
      <range start='192.168.123.2' end='192.168.123.254'/>
    </dhcp>
  </ip>
</network>
"""

TEST_NETWORK2_XML = """
<network>
  <name>test_network2</name>
  <bridge name='virbr1' stp='on' delay='0'/>
  <mac address='52:54:00:79:86:29'/>
  <domain name='test'/>
  <bandwidth>
    <inbound average='1000' peak='9000' burst='5000'/>
    <outbound average='2000' peak='3000' burst='4000'/>
  </bandwidth>
  <ip family='ipv6' address='fd00:e81d:a6d7:55::1' prefix='64'>
    <dhcp>
      <range start='fd00:e81d:a6d7:55::100' end='fd00:e81d:a6d7:55::1ff'/>
      <host name='simon' ip='2001:db8:ca2:2:3::1'/>
      <host id='0:1:0:1:18:aa:62:fe:0:16:3e:44:55:66' ip='2001:db8:ca2:2:3::2'/>
    </dhcp>
  </ip>
  <ip address='192.168.100.1' netmask='255.255.255.0'>
    <dhcp>
      <range start='192.168.100.128' end='192.168.100.170'/>
      <host mac='00:16:3E:5D:C7:9E' name='paul' ip='192.168.122.254'/>
    </dhcp>
  </ip>
</network>
"""

TEST_NETWORK3_XML = """
<network>
  <name>test_network3</name>
  <forward mode='bridge'/>
  <bridge name='br0'/>
</network>
"""

TEST_NETWORK4_XML = """
<network>
  <name>test_network4</name>
</network>
"""

SPICE_XML = """
    <video>
      <model type='vga' heads='1' primary='yes'/>
      <alias name='video0'/>
    </video>
    <graphics type='spice' port='5900' autoport='yes' listen='127.0.0.1'>
      <listen type='address' address='127.0.0.1'/>
      <image compression='off'/>
    </graphics>
"""

VNC_XML = """
    <video>
      <model type='vga' heads='1' primary='yes'/>
      <alias name='video0'/>
    </video>
    <graphics type='vnc' port='5900' autoport='yes' listen='127.0.0.1'>
      <listen type='address' address='127.0.0.1'/>
    </graphics>
"""

CONSOLE_XML = """
    <console type='file'>
      <target type='serial' port='0'/>
      <source path='{log}'/>
    </console>
"""

PTYCONSOLE_XML = """
    <serial type='pty'>
      <source path='/dev/pts/3'/>
      <target port='0'/>
      <alias name='serial0'/>
    </serial>
    <console type='pty' tty='/dev/pts/3'>
      <source path='/dev/pts/3'/>
      <target type='serial' port='0'/>
      <alias name='serial0'/>
    </console>
"""

DOMAIN_XML = """
<domain type='qemu'>
  <name>{name}</name>
  <vcpu>1</vcpu>
  <os>
    <type arch='x86_64'>hvm</type>
    <boot dev='hd'/>
    <boot dev='network'/>
  </os>
  <memory unit='MiB'>256</memory>
  <currentMemory unit='MiB'>256</currentMemory>
  <features>
    <acpi/>
  </features>
  <devices>
    <disk type='file'>
      <driver name='qemu' type='qcow2'/>
      <source file='{image}'/>
      <target dev='vda' bus='virtio'/>
      <serial>SECOND</serial>
    </disk>
    <controller type='scsi' model='virtio-scsi' index='0' id='hot'/>
    <interface type='network'>
      <source network='default' bridge='virbr0'/>
      <target dev='vnet0'/>
    </interface>
    <channel type='unix'>
      <target type='virtio' name='org.qemu.guest_agent.0'/>
      <address type='virtio-serial' controller='0' bus='0' port='1'/>
    </channel>
    {console}
    {graphics}
  </devices>
</domain>
"""

POOL_XML = """
<pool type='dir'>
  <name>images</name>
  <target>
    <path>{path}</path>
  </target>
</pool>
"""

NETWORK_XML_PXE = """<network>
  <name>pxe-nat</name>
  <forward mode='nat'>
    <nat>
      <port start='1024' end='65535'/>
    </nat>
  </forward>
  <bridge name='virbr0' stp='on' delay='0'/>
  <mac address='52:54:00:53:7d:8e'/>
  <ip address='192.168.122.1' netmask='255.255.255.0'>
    <tftp root='/var/lib/libvirt/pxe-config'/>
    <dhcp>
      <range start='192.168.122.2' end='192.168.122.254'/>
      <bootp file='pxe.cfg'/>
    </dhcp>
  </ip>
</network>"""

PXE_SERVER_CFG = """#!ipxe

echo Rebooting in 60 seconds
sleep 60
reboot"""
