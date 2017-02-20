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
 * Application-wide constants
 * TODO: make this configurable by user
 */
const VMS_CONFIG = {
    DefaultRefreshInterval: 10000, // in ms
    Virsh: {
        ConnectionParams: ['-c', 'qemu:///system']
    },
    isDev: false // TODO: make it configurable based on process.env.NODE_ENV
};

export default VMS_CONFIG;
