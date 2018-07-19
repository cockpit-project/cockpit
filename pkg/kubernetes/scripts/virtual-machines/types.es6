/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

// @flow
import {VM_KIND, VMI_KIND} from './constants.es6';
export type Labels = { [string]: string };
export type Annotations = Object;

// https://github.com/kubevirt/kubevirt/blob/master/pkg/api/v1/types.go

export type VmEntityMetadata = {
    clusterName: string,
    creationTimestamp: string,
    generation: number,
    labels: Labels,
    name: string,
    namespace: string,
    resourceVersion: string,
    selfLink: string,
    uid: string,
}

export type VmiSpec = {
    domain: {
        devices: {
            console: Array<Object>,
            disks: Array<Object>,
            graphics: Array<Object>,
            interfaces: Array<Object>,
            video: Array<Object>,
            [string]: any
        },
        memory: {
            unit: string,
            value: number
        },
        os: {
            bootOrder?: mixed,
            type: Object
        },
        type: string
    },
    volumes: ?Array<Object>,
}

export type Vm = {
    apiVersion: string,
    kind: VM_KIND,
    metadata: VmEntityMetadata,
    spec: {
        // Running controls whether the associatied VirtualMachineInstance is created or not
        running: boolean,
        template: {
            metadata: Object,
            spec: VmiSpec,
        }
    },
    status: {
        // Created indicates if the virtual machine is created in the cluster
        created: boolean,
        // Ready indicates if the virtual machine is running and ready
        ready: boolean,
        // Hold the state information of the VirtualMachine and its VirtualMachineInstance
        conditions: Array<Object>,
    }
}

export type Vmi = {
    apiVersion: string,
    kind: VMI_KIND,
    metadata: VmEntityMetadata,
    spec: VmiSpec,
    status: ?{
        graphics?: mixed,
        nodeName: string,
        phase: ?string
    }
}

export type Message = {
    message: string,
    detail: Object,
}

export type VmUi = {
    isVisible: boolean,
    message: Message,
}

export type PersistenVolume = {
    'kind': 'PersistentVolume',
    'apiVersion': string,
    'metadata': {
        'name': string,
        'selfLink': string,
        'uid': string,
        'resourceVersion': string,
        'creationTimestamp': string,
        'labels': Labels,
        'annotations': Annotations,
    },
    'spec': {
        'capacity': {
            'storage': string
        },
        'iscsi': {
            'targetPortal': string,
            'iqn': string,
            'lun': number,
            'iscsiInterface': string
        },
        'accessModes': Array<Object>,
        'claimRef': {
            'kind': 'PersistentVolumeClaim',
            'namespace': string,
            'name': string,
            'uid': string,
            'apiVersion': string,
            'resourceVersion': string
        },
        'persistentVolumeReclaimPolicy': string
    },
    'status': ?{
        'phase': ?string
    }
}

export type PersistenVolumes = Array<PersistenVolume>;

export type PodMetadata = {
    'name': string,
    'generateName': ?string,
    'namespace': string,
    'selfLink': string,
    'uid': string,
    'resourceVersion': string,
    'creationTimestamp': string,
    'labels': Labels,
    'annotations': Annotations
};

export type PodSpec = Object; // TODO: define when needed

export type Pod = {
    'kind': 'Pod',
    'apiVersion': string,
    'metadata': PodMetadata,
    'spec': PodSpec,
    'status': ?{
        'phase': ?string
    }
};

export type Pods = Array<Pod>;

export type PodMetrics = {
    'cpu': {
        usageNanoCores: number,
    },
    'network': {
        rxBytes: number,
        txBytes: number,
    },
    'memory': {
        usageBytes: number,
    },
};

export type PodMetricsList = Array<PodMetrics>;
