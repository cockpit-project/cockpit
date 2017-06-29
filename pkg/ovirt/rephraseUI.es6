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
import { logDebug } from '../machines/helpers.es6';

const transform = {
    'hostStatus': {
        'preparing_for_maintenance': _("Preparing for Maintenance"),
        'up': _("up"),
        'down': _("down"),
        'error': _("error"),
        'initializing': _("initializing"),
        'install_failed': _("installation failed"),
        'maintenance': _("maintenance"),
        'non_operational': _("non operational"),
        'non_responsive': _("non responsive"),
        'pending_approval': _("pending approval"),
        'connecting': _("connecting"),
        'reboot': _("reboot"),
        'unassigned': _("unassigned"),
        'installing_os': _("installing OS"),
        'kdumping': _("kdumping"),
    },
    'stateless': {
        'true': _("yes"),
        'false': _("no"),
    },
};


function rephraseUI(key, original) {
    if (!(key in transform)) {
        logDebug(`ovirt rephraseUI(key='${key}', original='${original}'): unknown key`);
        return original;
    }

    if (!(original in transform[key])) {
        logDebug(`ovirt rephraseUI(key='${key}', original='${original}'): unknown original value`);
        return original;
    }

    return transform[key][original];
}

export default rephraseUI;
