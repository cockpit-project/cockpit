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
import { logDebug } from './utils.jsx';

let kubeMethods = null;

export function initMiddleware(_kubeMethods) {
    kubeMethods = _kubeMethods;
}

async function vmDelete({ vm }) {
    const selfLink = vm.metadata.selfLink; // example: /apis/kubevirt.io/v1alpha1/namespaces/kube-system/virtualmachines/testvm
    logDebug('vmDelete(), selfLink: ', selfLink);
    return await kubeMethods.delete(selfLink); // no value is returned (empty promise). An exception is thrown in case of failure
}

export { vmDelete };
