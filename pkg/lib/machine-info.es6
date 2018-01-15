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

import cockpit from "cockpit";

var machine_info_promises = { };

export function machine_info(address) {
    var pr = machine_info_promises[address];
    var dfd;
    if (!pr) {
        dfd = cockpit.defer();
        machine_info_promises[address] = pr = dfd.promise();

        cockpit.spawn(["cat", "/proc/meminfo", "/proc/cpuinfo"], { host: address }).
            done(function(text) {
                var info = { };
                var match = text.match(/MemTotal:[^0-9]*([0-9]+) [kK]B/);
                var total_kb = match && parseInt(match[1], 10);
                if (total_kb)
                    info.memory = total_kb*1024;

                info.cpus = 0;
                var re = new RegExp("^processor", "gm");
                while (re.test(text))
                    info.cpus += 1;
                dfd.resolve(info);
            }).
            fail(function() {
                dfd.reject();
            });
    }
    return pr;
}
