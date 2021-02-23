/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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
import { systemd_client, SD_OBJ, SD_MANAGER, clock_realtime_now } from "./services.jsx";

import moment from "moment";

moment.locale(cockpit.language);

export function create_timer({ name, description, command, delay, delayUnit, delayNumber, repeat, repeatPatterns, specificTime }) {
    const timer_unit = {};
    const repeat_array = repeatPatterns;
    timer_unit.name = name.replace(/\s/g, '');
    timer_unit.Description = description;
    timer_unit.Command = command;
    timer_unit.boot_time = delayNumber;
    timer_unit.boot_time_unit = delayUnit;

    if (delay == "specific-time" && repeat == "no") {
        var today = new Date(clock_realtime_now);
        timer_unit.OnCalendar = "OnCalendar=" + today.getFullYear() + "-" + (today.getMonth() + 1) + "-" + today.getDate() + " " + specificTime + ":00";
    } else if (repeat == "hourly") {
        timer_unit.repeat_minute = repeat_array.map(function(item) {
            return Number(item.minute);
        });
        timer_unit.OnCalendar = "OnCalendar=*-*-* *:" + timer_unit.repeat_minute.join(",");
    } else if (repeat == "daily") {
        timer_unit.OnCalendar = repeat_array.map(function(item) {
            return "OnCalendar=*-*-* " + item.time + ":00";
        });
    } else if (repeat == "weekly") {
        timer_unit.OnCalendar = repeat_array.map(function(item) {
            return "OnCalendar=" + item.day + " *-*-* " + item.time + ":00";
        });
    } else if (repeat == "monthly") {
        timer_unit.OnCalendar = repeat_array.map(function(item) {
            return "OnCalendar=*-*-" + item.day + " " + item.time + ":00";
        });
    } else if (repeat == "yearly") {
        timer_unit.OnCalendar = repeat_array.map(function(item) {
            return "OnCalendar=*-" + moment(item.date).format('MM') + "-" + moment(item.date).format('DD') + " " + item.time + ":00";
        });
    }
    if (repeat != "hourly" && delay == "specific-time")
        timer_unit.OnCalendar = timer_unit.OnCalendar.toString().replace(/,/g, "\n");
    return create_timer_file({ timer_unit, delay });
}

function create_timer_file({ timer_unit, delay }) {
    var unit = "[Unit]\nDescription=";
    var service = "\n[Service]\nExecStart=";
    var timer = "\n[Timer]\n";
    var install = "[Install]\nWantedBy=timers.target\n";
    var service_file = unit + timer_unit.Description + service + timer_unit.Command + "\n";
    var timer_file = " ";
    if (delay == "system-boot") {
        var boottimer = timer + "OnBootSec=" + timer_unit.boot_time + timer_unit.boot_time_unit + "\n";
        timer_file = unit + timer_unit.Description + boottimer;
    } else if (timer_unit.OnCalendar) {
        var calendartimer = timer + timer_unit.OnCalendar + "\n";
        timer_file = unit + timer_unit.Description + calendartimer;
    }
    timer_file += install;
    // writing to file
    var service_path = "/etc/systemd/system/" + timer_unit.name + ".service";
    var file = cockpit.file(service_path, { superuser: 'try' });
    file.replace(service_file)
            .catch(error => console.log(error.toString()));
    var timer_path = "/etc/systemd/system/" + timer_unit.name + ".timer";
    file = cockpit.file(timer_path, { superuser: 'try' });
    return file.replace(timer_file)
            .then(tag => {
                return systemd_client.call(SD_OBJ, SD_MANAGER, "EnableUnitFiles", [[timer_unit.name + ".timer"], false, false]);
            })
            .then(() => {
                /* Executing daemon reload after file operations is necessary -
                 * see https://github.com/systemd/systemd/blob/main/src/systemctl/systemctl.c [enable_unit function]
                 */
                systemd_client.call(SD_OBJ, SD_MANAGER, "Reload", null);
            })
            .then(() => {
                // start calendar timers
                if (timer_unit.OnCalendar)
                    return systemd_client.call(SD_OBJ, SD_MANAGER, "StartUnit", [timer_unit.name + ".timer", "replace"]);
            });
}
