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
import { getHostAddress } from './helpers.es6';

export function getAllIcons (state) {
    return state.config && state.config.providerState ? state.config.providerState.icons : {};
}

export function getCurrentHost (hosts) {
    const currentHostAddress = getHostAddress();
    const hostId = Object.getOwnPropertyNames(hosts).filter(hostId => currentHostAddress === hosts[hostId].address);
    return hostId ? hosts[hostId] : undefined;
}

export function isVmManagedByOvirt (providerState, vmId) {
    return vmId && providerState && !!providerState.vms[vmId];
}
