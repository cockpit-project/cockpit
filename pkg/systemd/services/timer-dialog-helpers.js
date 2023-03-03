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
import s_bus from "./busnames.js";
import { systemd_client, clock_realtime_now } from "./services.jsx";

export function create_timer({ name, description, command, delay, delayUnit, delayNumber, repeat, repeatPatterns, specificTime, owner }) {
    const timer_unit = {};
    const repeat_array = repeatPatterns;
    timer_unit.name = name.replace(/\s/g, '');
    timer_unit.Description = description;
    timer_unit.Command = command;
    timer_unit.boot_time = delayNumber;
    timer_unit.boot_time_unit = delayUnit;

    function month_day_str(d) {
        const month_str = (d.getMonth() + 1).toString();
        const day_str = (d.getDate()).toString();
        return `${month_str.padStart(2, '0')}-${day_str.padStart(2, '0')}`;
    }

    if (delay == "specific-time" && repeat == "no") {
        const today = new Date(clock_realtime_now);
        timer_unit.OnCalendar = `OnCalendar=${today.getFullYear()}-${month_day_str(today)} ${specificTime}:00`;
    } else if (repeat == "minutely") {
        timer_unit.repeat_second = repeat_array.map(item => Number(item.second));
        timer_unit.OnCalendar = "OnCalendar=*-*-* *:*:" + timer_unit.repeat_second.join(",");
    } else if (repeat == "hourly") {
        timer_unit.repeat_minute = repeat_array.map(item => Number(item.minute));
        timer_unit.OnCalendar = "OnCalendar=*-*-* *:" + timer_unit.repeat_minute.join(",");
    } else if (repeat == "daily") {
        timer_unit.OnCalendar = repeat_array.map(item => `OnCalendar=*-*-* ${item.time}:00`);
    } else if (repeat == "weekly") {
        timer_unit.OnCalendar = repeat_array.map(item => `OnCalendar=${item.day} *-*-* ${item.time}:00`);
    } else if (repeat == "monthly") {
        timer_unit.OnCalendar = repeat_array.map(item => `OnCalendar=*-*-${item.day} ${item.time}:00`);
    } else if (repeat == "yearly") {
        timer_unit.OnCalendar = repeat_array.map(item => `OnCalendar=*-${month_day_str(new Date(item.date))} ${item.time}:00`);
    }
    if (repeat != "hourly" && repeat != "minutely" && delay == "specific-time")
        timer_unit.OnCalendar = timer_unit.OnCalendar.toString().replaceAll(",", "\n");
    return create_timer_file({ timer_unit, delay, owner });
}

function create_timer_file({ timer_unit, delay, owner }) {
    const unit = "[Unit]\nDescription=";
    const service = "\n[Service]\nExecStart=";
    const timer = "\n[Timer]\n";
    const install = "[Install]\nWantedBy=timers.target\n";
    const service_file = unit + timer_unit.Description + service + timer_unit.Command + "\n";
    let timer_file = " ";
    if (delay == "system-boot") {
        const boottimer = timer + "OnBootSec=" + timer_unit.boot_time + timer_unit.boot_time_unit + "\n";
        timer_file = unit + timer_unit.Description + boottimer;
    } else if (timer_unit.OnCalendar) {
        const calendartimer = timer + timer_unit.OnCalendar + "\n";
        timer_file = unit + timer_unit.Description + calendartimer;
    }
    timer_file += install;
    // writing to file
    const service_path = "/etc/systemd/system/" + timer_unit.name + ".service";
    const timer_path = "/etc/systemd/system/" + timer_unit.name + ".timer";
    return cockpit.file(service_path, { superuser: 'try' }).replace(service_file)
            .then(() => cockpit.file(timer_path, { superuser: 'try' }).replace(timer_file))
            .then(tag => systemd_client[owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "EnableUnitFiles", [[timer_unit.name + ".timer"], false, false]))
            /* Executing daemon reload after file operations is necessary -
            * see https://github.com/systemd/systemd/blob/main/src/systemctl/systemctl.c [enable_unit function] */
            .then(() => systemd_client[owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "Reload", null))
            .then(() => {
                // start calendar timers
                if (timer_unit.OnCalendar)
                    return systemd_client[owner].call(s_bus.O_MANAGER, s_bus.I_MANAGER, "StartUnit", [timer_unit.name + ".timer", "replace"]);
            });
}
