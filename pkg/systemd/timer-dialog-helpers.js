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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import s_bus from "./busnames.js";
import { systemd_client, clock_realtime_now } from "./services.jsx";
import { CockpitManagedMarker } from "./service-details.jsx";

export function from_boot_usec(value) {
    const result = { delay: "system-boot" };
    const seconds = Math.floor(value / 1e6); // Convert from microseconds

    if (seconds % 604800 === 0) {
        result.delayNumber = seconds / 604800;
        result.delayUnit = "weeks";
    } else if (seconds % 3600 === 0) {
        result.delayNumber = seconds / 3600;
        result.delayUnit = "hours";
    } else if (seconds % 60 === 0) {
        result.delayNumber = seconds / 60;
        result.delayUnit = "minutes";
    } else {
        result.delayNumber = seconds;
        result.delayUnit = "seconds";
    }

    return result;
}

export function from_on_calendar(patterns) {
    const joined = patterns.join('\n').trim();
    let result = null;

    const minutely = /^\*-\*-\* \*:\*:(\d{1,2}(?:,\d{1,2})*)$/;
    const hourly = /^\*-\*-\* \*:(\d{1,2}(?:,\d{1,2})*)(?::00)?$/;
    const daily = /^\*-\*-\* (\d{2}:\d{2})(?::00)?$/;
    const weekly = /^([A-Za-z]{3}) \*-\*-\* (\d{2}:\d{2})(?::00)?$/;
    const monthly = /^\*-\*-(\d{1,2}) (\d{2}:\d{2})(?::00)?$/;
    const yearly = /^\*-(\d{2}-\d{2}) (\d{2}:\d{2})(?::00)?$/;
    const specific = /^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})(?::00)?$/;

    if (minutely.test(joined)) {
        const match = joined.match(minutely);
        const seconds = match[1];
        result = {
            repeat: "minutely",
            repeatPatterns: seconds.split(",").map(second => ({ second }))
        };
    }

    if (hourly.test(joined)) {
        const match = joined.match(hourly);
        const minutes = match[1];
        result = {
            repeat: "hourly",
            repeatPatterns: minutes.split(",").map(minute => ({ minute }))
        };
    }

    if (patterns.every(line => daily.test(line))) {
        result = {
            repeat: "daily",
            repeatPatterns: patterns.map(line => {
                const match = line.match(daily);
                const time = match[1];
                return { time };
            })
        };
    }

    if (patterns.every(line => weekly.test(line))) {
        result = {
            repeat: "weekly",
            repeatPatterns: patterns.map(line => {
                const match = line.match(weekly);
                const weekDay = match[1].toLowerCase();
                const time = match[2];
                return { day: weekDay, time };
            })
        };
    }

    if (patterns.every(line => monthly.test(line))) {
        result = {
            repeat: "monthly",
            repeatPatterns: patterns.map(line => {
                const match = line.match(monthly);
                const day = Number(match[1]);
                const time = match[2];
                return { day, time };
            })
        };
    }

    if (patterns.every(line => yearly.test(line))) {
        result = {
            repeat: "yearly",
            repeatPatterns: patterns.map((line) => {
                const match = line.match(yearly);
                const monthAndDay = match[1];
                const time = match[2];
                return { date: `${(new Date(clock_realtime_now)).getFullYear()}-${monthAndDay}`, time }; // specific year isn't important
            })
        };
    }

    if (specific.test(joined)) {
        result = {
            repeat: "no",
            repeatPatterns: [],
            specificTime: joined.match(specific)[1]
        };
    }

    if (result) {
        result.delay = "specific-time";
        result.repeatPatterns = result.repeatPatterns.map((item, index) => {
            return { key: index, ...item };
        });

        return result;
    } else {
        return null;
    }
}

/* Escape STR so that it is parsed as a single argument in a
   ExecStart= line.  We need to escape spaces, newlines, quotes, and
   backslashes by prepending a backslash.  We also need to escape
   specifiers by prepending a "%" character.
 */

function escape_systemd_exec_arg(str) {
    return str
            .replaceAll("\\", "\\\\")
            .replaceAll(" ", "\\s")
            .replaceAll("\t", "\\t")
            .replaceAll("\n", "\\n")
            .replaceAll("\"", "\\\"")
            .replaceAll("'", "\\'")
            .replaceAll("%", "%%");
}

export function create_timer({ name, description, command, delay, delayUnit, delayNumber, repeat, repeatPatterns, specificTime, owner }) {
    const timer_unit = {};
    const repeat_array = repeatPatterns;
    timer_unit.name = name.replace(/\s/g, '');
    timer_unit.Description = description;
    timer_unit.Command = "/bin/sh -c " + escape_systemd_exec_arg(command);
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
    const service_file = CockpitManagedMarker + unit + timer_unit.Description + service + timer_unit.Command + "\n";
    let timer_file = CockpitManagedMarker;
    if (delay == "system-boot") {
        const boottimer = timer + "OnBootSec=" + timer_unit.boot_time + timer_unit.boot_time_unit + "\n";
        timer_file += unit + timer_unit.Description + boottimer;
    } else if (timer_unit.OnCalendar) {
        const calendartimer = timer + timer_unit.OnCalendar + "\n";
        timer_file += unit + timer_unit.Description + calendartimer;
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
