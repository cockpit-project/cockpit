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

export type Vm = {
    apiVersion: string,
    kind: 'VirtualMachine',
    metadata: {
        clusterName: string,
        creationTimestamp: string,
        generation: number,
        labels: {[string]: string},
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
