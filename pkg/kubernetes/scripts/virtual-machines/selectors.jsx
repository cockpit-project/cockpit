/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

import { getValueOrDefault, VM_UID_LABEL } from "./utils.jsx";

/**
 * Returns pod corresponding to the given vm.
 */
export function getPod(vm, pods) {
    if (!pods) {
        return null;
    }

    const vmId = vm.metadata.uid;
    if (!vmId) {
        return null;
    }

    return pods.find(pod => getValueOrDefault(() => pod.metadata.labels[VM_UID_LABEL], null) === vmId);
}
