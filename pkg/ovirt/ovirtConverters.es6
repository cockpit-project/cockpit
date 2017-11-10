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

/**
 * @param cluster - parsed oVirt resource
 */
export function clusterConverter(cluster) {
    return {
        id: cluster.id,
        name: cluster.name,
        // TODO: add more, if needed
    };
}

export function hostConverter(host) {
    return {
        id: host.id,
        name: host.name,
        address: host.address,
        clusterId: host.cluster ? host.cluster.id : undefined,
        status: host.status,
        memory: host.memory,
        cpu: host.cpu ? {
            name: host.cpu.name,
            speed: host.cpu.speed,
            topology: host.cpu.topology ? {
                sockets: host.cpu.topology.sockets,
                cores: host.cpu.topology.cores,
                threads: host.cpu.topology.threads
            } : undefined
        } : undefined,
        // summary
        // vdsm version
        // libvirt_version
    };
}

export function templateConverter(template) {
    return {
        id: template.id,
        name: template.name,
        description: template.description,
        cpu: {
            architecture: template.cpu.architecture,
            topology: {
                sockets: template.cpu.topology.sockets,
                cores: template.cpu.topology.cores,
                threads: template.cpu.topology.threads
            }
        },
        memory: template.memory,
        creationTime: template.creation_time,

        highAvailability: template.high_availability,
        icons: {
            largeId: template.large_icon ? template.large_icon.id : undefined,
            smallId: template.small_icon ? template.small_icon.id : undefined,
        },
        os: {
            type: template.os.type
        },
        stateless: template.stateless,
        type: template.type, // server, desktop
        version: {
            name: template.version ? template.version.name : undefined,
            number: template.version ? template.version.number : undefined,
            baseTemplateId: template.version && template.version.base_template ? template.version.base_template.id : undefined,
        },

        // bios
        // display
        // migration
        // memory_policy
        // os.boot
        // start_paused
        // usb
    };
}

export function vmConverter(vm) {
    return {
        id: vm.id,
        name: vm.name,
        state: mapOvirtStatusToLibvirtState(vm.status),
        description: vm.description,
        highAvailability: vm.high_availability,
        icons: {
            largeId: vm.large_icon && vm.large_icon.id || undefined,
            smallId: vm.small_icon && vm.small_icon.id || undefined,
        },
        memory: vm.memory,
        cpu: {
            architecture: vm.cpu.architecture,
            topology: {
                sockets: vm.cpu.topology.sockets,
                cores: vm.cpu.topology.cores,
                threads: vm.cpu.topology.threads
            }
        },
        origin: vm.origin,
        os: {
            type: vm.os.type
        },
        type: vm.type, // server, desktop
        stateless: vm.stateless,
        clusterId: vm.cluster.id,
        templateId: vm.template.id,
        hostId: vm.host ? vm.host.id : undefined,
        fqdn: vm.fqdn,
        startTime: vm.start_time, // in milliseconds since 1970/01/01
    };
}

function mapOvirtStatusToLibvirtState(ovirtStatus) {
    switch (ovirtStatus) {// TODO: finish - add additional states
        case 'up': return 'running';
        case 'down': return 'shut off';
        default:
            return ovirtStatus;
    }
}

export function oVirtIconToInternal(ovirtIcon) {
    return {
        id: ovirtIcon.id,
        type: ovirtIcon['media_type'],
        data: ovirtIcon.data,
    };
}
