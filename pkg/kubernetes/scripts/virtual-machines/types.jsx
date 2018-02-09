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

export type Labels = {[string]: string};
export type Annotations = Object;

export type Vm = {
    apiVersion: string,
    kind: 'VirtualMachine',
    metadata: {
        clusterName: string,
        creationTimestamp: string,
        generation: number,
        labels: Labels,
        name: string,
        namespace: string,
        resourceVersion: string,
        selfLink: string,
        uid: string
    },
    spec: {
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
        }
    },
    status: ?{
        graphics?: mixed,
        nodeName: string,
        phase: ?string
    }
}

export type VmMessages = {
  message: string,
  detail: Object,
}

export type PersistenVolume = {
    "kind": "PersistentVolume",
    "apiVersion": string,
    "metadata": {
        "name": string,
        "selfLink": string,
        "uid": string,
        "resourceVersion": string,
        "creationTimestamp": string,
        "labels": Labels,
        "annotations": Annotations,
    },
    "spec": {
        "capacity": {
            "storage": string
        },
        "iscsi": {
            "targetPortal": string,
            "iqn": string,
            "lun": number,
            "iscsiInterface": string
        },
        "accessModes": Array<Object>,
        "claimRef": {
            "kind": "PersistentVolumeClaim",
            "namespace": string,
            "name": string,
            "uid": string,
            "apiVersion": string,
            "resourceVersion": string
        },
        "persistentVolumeReclaimPolicy": string
    },
    "status": ?{
        "phase": ?string
    }
}

export type PersistenVolumes = Array<PersistenVolume>;

export type PodMetadata = {
    "name": string,
    "generateName": ?string,
    "namespace": string,
    "selfLink": string,
    "uid": string,
    "resourceVersion": string,
    "creationTimestamp": string,
    "labels": Labels,
    "annotations": Annotations
};

export type PodSpec = Object; // TODO: define when needed

export type Pod = {
    "kind": "Pod",
    "apiVersion": string,
    "metadata": PodMetadata,
    "spec": PodSpec,
    "status": ?{
        "phase": ?string
    }
};

export type Pods = Array<Pod>;
