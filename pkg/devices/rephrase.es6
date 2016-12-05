/*jshint esversion: 6 */
/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */
import cockpit from 'cockpit';

const _ = cockpit.gettext;

/**
 * Taken from http://pci-ids.ucw.cz/
 */
const pciClassNames = {
    'unclassified device': _('Unclassified device'),
    'mass storage controller': _('Mass storage controller'),
    'network controller': _('Network controller'),
    'display controller': _('Display controller'),
    'multimedia controller': _('Multimedia controller'),
    'memory controller': _('Memory controller'),
    'bridge': _('Bridge'),
    'communication controller': _('Communication controller'),
    'generic system peripheral': _('Generic system peripheral'),
    'input device controller': _('Input device controller'),
    'docking station': _('Docking station'),
    'processor': _('Processor'),
    'serial bus controller': _('Serial bus controller'),
    'wireless controller': _('Wireless controller'),
    'intelligent controller': _('Intelligent controller'),
    'satellite communications controller': _('Satellite communications controller'),
    'encryption controller': _('Encryption controller'),
    'signal processing controller': _('Signal processing controller'),
    'processing accelerators': _('Processing accelerators'),
    'non-essential instrumentation': _('Non-Essential Instrumentation'),
    'coprocessor': _('Coprocessor'),
    'unassigned class': _('Unassigned class'),

    'non-vga unclassified device': _('Non-VGA unclassified device'),
    'vga compatible unclassified device': _('VGA compatible unclassified device'),

    'scsi storage controller': _('SCSI storage controller'),
    'ide interface': _('IDE interface'),
    'floppy disk controller': _('Floppy disk controller'),
    'ipi bus controller': _('IPI bus controller'),
    'raid bus controller': _('RAID bus controller'),
    'ata controller': _('ATA controller'),
    'sata controller': _('SATA controller'),
    'serial attached scsi controller': _('Serial Attached SCSI controller'),
    'non-volatile memory controller': _('Non-Volatile memory controller'),

    'ethernet controller': _('Ethernet controller'),
    'token ring network controller': _('Token ring network controller'),
    'fddi network controller': _('FDDI network controller'),
    'atm network controller': _('ATM network controller'),
    'isdn controller': _('ISDN controller'),
    'worldfip controller': _('WorldFip controller'),
    'picmg controller': _('PICMG controller'),
    'infiniband controller': _('Infiniband controller'),
    'fabric controller': _('Fabric controller'),

    'vga compatible controller': _('VGA compatible controller'),
    'xga compatible controller': _('XGA compatible controller'),
    '3d controller': _('3D controller'),

    'multimedia video controller': _('Multimedia video controller'),
    'multimedia audio controller': _('Multimedia audio controller'),
    'computer telephony device': _('Computer telephony device'),
    'audio device': _('Audio device'),

    'ram memory': _('RAM memory'),
    'flash memory': _('FLASH memory'),

    'host bridge': _('Host bridge'),
    'isa bridge': _('ISA bridge'),
    'eisa bridge': _('EISA bridge'),
    'microchannel bridge': _('MicroChannel bridge'),
    'pci bridge': _('PCI bridge'),
    'pcmcia bridge': _('PCMCIA bridge'),
    'nubus bridge': _('NuBus bridge'),
    'cardbus bridge': _('CardBus bridge'),
    'raceway bridge': _('RACEway bridge'),
    'semi-transparent pci-to-pci bridge': _('Semi-transparent PCI-to-PCI bridge'),
    'infiniband to pci host bridge': _('InfiniBand to PCI host bridge'),

    'serial controller': _('Serial controller'),
    'parallel controller': _('Parallel controller'),
    'multiport serial controller': _('Multiport serial controller'),
    'modem': _('Modem'),
    'gpib controller': _('GPIB controller'),
    'smard card controller': _('Smard Card controller'),

    'pic': _('PIC'),
    'dma controller': _('DMA controller'),
    'timer': _('Timer'),
    'rtc': _('RTC'),
    'pci hot-plug controller': _('PCI Hot-plug controller'),
    'sd host controller': _('SD Host controller'),
    'iommu': _('IOMMU'),
    'system peripheral': _('System peripheral'),

    'keyboard controller': _('Keyboard controller'),
    'digitizer pen': _('Digitizer Pen'),
    'mouse controller': _('Mouse controller'),
    'scanner controller': _('Scanner controller'),
    'gameport controller': _('Gameport controller'),

    'generic docking station': _('Generic Docking Station'),

    'firewire (ieee 1394)': _('FireWire (IEEE 1394)'),
    'access bus': _('ACCESS Bus'),
    'ssa': _('SSA'),
    'usb controller': _('USB controller'),
    'fibre channel': _('Fibre Channel'),
    'smbus': _('SMBus'),
    'infiniband': _('InfiniBand'),
    'ipmi smic interface': _('IPMI SMIC interface'),
    'sercos interface': _('SERCOS interface'),
    'canbus': _('CANBUS'),

    'irda controller': _('IRDA controller'),
    'consumer ir controller': _('Consumer IR controller'),
    'rf controller': _('RF controller'),
    'bluetooth': _('Bluetooth'),
    'broadband': _('Broadband'),
    '802.1a controller': _('802.1a controller'),
    '802.1b controller': _('802.1b controller'),

    'satellite tv controller': _('Satellite TV controller'),
    'satellite audio communication controller': _('Satellite audio communication controller'),
    'satellite voice communication controller': _('Satellite voice communication controller'),
    'satellite data communication controller': _('Satellite data communication controller'),

    'network and computing encryption device': _('Network and computing encryption device'),
    'entertainment encryption device': _('Entertainment encryption device'),

    'dpio module': _('DPIO module'),
    'performance counters': _('Performance counters'),
    'communication synchronizer': _('Communication synchronizer'),
    'signal processing management': _('Signal processing management'),
};

export function rephraseClassName (name) {
    const lcName = name.toLowerCase();
    return pciClassNames[lcName] ? pciClassNames[lcName] : name;
}
