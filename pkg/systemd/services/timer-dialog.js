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

import $ from "jquery";
import cockpit from "cockpit";
import { mustache } from "mustache";
import { systemd_client, SD_OBJ, SD_MANAGER, clock_realtime_now, updateTime } from "./services.jsx";
import "bootstrap-datepicker/dist/js/bootstrap-datepicker";

import moment from "moment";

moment.locale(cockpit.language);
const _ = cockpit.gettext;

var timer_unit = { };
var repeat_array = [];
var error = false;
var repeat_option;

function set_boot_time_unit(value) {
    value = Number(value);
    switch (value) {
    case 1:
        timer_unit.boot_time_unit = "sec";
        break;
    case 60:
        timer_unit.boot_time_unit = "min"; // 60sec
        break;
    case 3600:
        timer_unit.boot_time_unit = "hr"; // 60*60sec
        break;
    case 604800:
        timer_unit.boot_time_unit = "weeks"; // 7*24*60*60sec
        break;
    }
}

// Validation of Inputs
function check_inputs() {
    error = false; // made global to show existing errors when + and x are clicked.
    var str = $("#servicename").val();
    if (str.trim().length < 1) {
        $("#servicename-error").text(_("This field cannot be empty."));
        $("#servicename-error-row").show();
        $("#servicename").addClass('has-error');
        error = true;
    } else if (!/^[a-zA-Z0-9:_.@-]+$/.test(str)) {
        $("#servicename-error").text(_("Only alphabets, numbers, : , _ , . , @ , - are allowed."));
        $("#servicename-error-row").show();
        $("#servicename").addClass('has-error');
        error = true;
    }
    str = $("#description")
            .val()
            .trim();
    if (str.length < 1) {
        $("#description-error").text(_("This field cannot be empty."));
        $("#description-error-row").show();
        $("#description").addClass('has-error');
        error = true;
    }
    str = $("#command")
            .val()
            .trim();
    if (str.length < 1) {
        $("#command-error").text(_("This field cannot be empty."));
        $("#command-error-row").show();
        $("#command").addClass('has-error');
        error = true;
    }
    if (timer_unit.Calendar_or_Boot == "Boot") {
        str = $("#boot-time").val();
        if (!/^[0-9]+$/.test(str.trim())) {
            $("#boot-error").text(_("Invalid number."));
            $("#boot-error-row").show();
            $("#boot-time").addClass('has-error');
            error = true;
        }
    } else {
        // Calendar timer cases
        var i = 0;
        if (timer_unit.repeat.index === 0) {
            var hr = $("#hr")
                    .val()
                    .trim();
            var min = $("#min")
                    .val()
                    .trim();
            $("#hr-error").text("");
            $("#min-error").text("");
            if (!(/^[0-9]+$/.test(hr) && hr <= 23 && hr >= 0)) {
                $("#hr-error").text(_("Hour needs to be a number between 0-23"));
                $("#specific-time-error-row").show();
                $("#hr").addClass('has-error');
                error = true;
            }
            if (!(/^[0-9]+$/.test(min) && min <= 59 && min >= 0)) {
                $("#min-error").text(_("Minute needs to be a number between 0-59"));
                $("#specific-time-error-row").show();
                $("#min").addClass('has-error');
                error = true;
            }
        } else if (timer_unit.repeat.index === 60) {
            for (; i < repeat_array.length; i++) {
                if (!(/^[0-9]+$/.test(repeat_array[i].minutes.trim()) && repeat_array[i].minutes.trim() <= 59 && repeat_array[i].minutes.trim() >= 0)) {
                    $("[data-index='" + i + "'][data-content='minutes']").addClass('has-error');
                    $("[data-index='" + i + "'][data-content='min-error']").text(_("Minute needs to be a number between 0-59"));
                    error = true;
                }
            }
        } else {
            for (; i < repeat_array.length; i++) {
                if (!(/^[0-9]+$/.test(repeat_array[i].minutes.trim()) && repeat_array[i].minutes.trim() <= 59 && repeat_array[i].minutes.trim() >= 0)) {
                    error = true;
                    $("[data-index='" + i + "'][data-content='minutes']").addClass('has-error');
                    $("[data-index='" + i + "'][data-content='min-error']").text(_("Minute needs to be a number between 0-59"));
                }
                if (!(/^[0-9]+$/.test(repeat_array[i].hours.trim()) && repeat_array[i].hours.trim() <= 23 && repeat_array[i].hours.trim() >= 0)) {
                    error = true;
                    $("[data-index='" + i + "'][data-content='hours']").addClass('has-error');
                    $("[data-index='" + i + "'][data-content='hr-error']").text(_("Hour needs to be a number between 0-23"));
                }
                if (timer_unit.repeat.index === 525600) {
                    if (isNaN(repeat_array[i].date_to_parse.getTime()) || repeat_array[i].date_to_parse.getTime() < 0) {
                        error = true;
                        $("[data-index='" + i + "'][data-content='datepicker']").addClass('has-error');
                        $("[data-index='" + i + "'][data-content='date-error']").text(_("Invalid date format."));
                    }
                }
                if (timer_unit.repeat.index === 44640 && repeat_array[i].days_value === '31')
                    $("[data-index='" + i + "'][data-content='day-error']").html(_("This day doesn't exist in all months.<br> The timer will only be executed in months that have 31st."));
            }
        }
    }
    return error;
}

function repeat_options(val) {
    // removes all error messages when any repeat options is clicked
    if ($("#specific-time-error-row").is(":visible")) {
        $("#specific-time-error-row").hide();
        $("#hr").removeClass("has-error");
        $("#min").removeClass("has-error");
    }
    repeat_option.map(function(item) {
        if (item.index === val)
            timer_unit.repeat = item;
    });
    if (val === 0) {
        $("#specific-time-without-repeat").prop("hidden", false);
        $("#repeat-time-option").hide();
        $("#close_button").hide();
        $("#hr").val("00");
        $("#min").val("00");
    } else {
        $("#specific-time-without-repeat").prop("hidden", true);
        $("#repeat-time-option").show();
        repeat_array = [];
        repeat_element();
    }
}

function repeat_element() {
    var repeat_contents = {
        index: repeat_array.length,
        close: "enabled",
        hours: "00",
        minutes: "00",
        days_value: "1",
        days_text: "Monday",
        date_to_parse: new Date(clock_realtime_now),
        date: moment().format("YYYY-MM-DD")
    };
    if (timer_unit.repeat.index === 44640)
        repeat_contents.days_text = "1st";
    sync_repeat();
    repeat_array.push(repeat_contents);
    if (repeat_array.length === 1)
        repeat_array[0].close = "disabled";
    else
        repeat_array[0].close = "enabled";
    display_repeat();
    if (error)
        check_inputs();
}

function display_repeat() {
    $("#repeat-time").html(mustache.render(timer_unit.repeat.render, { repeat: repeat_array }));
    if (timer_unit.repeat.index === 525600) {
        var nowDate = new Date(clock_realtime_now);
        var today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), 0, 0, 0, 0);
        for (var i = 0; i < repeat_array.length; i++) {
            $("[data-index='" + i + "'][data-content='datepicker']").datepicker({
                autoclose: true,
                todayHighlight: true,
                format: 'yyyy-mm-dd',
                orientation:"top auto",
                container:'#timer-dialog',
                startDate: today
            });
        }
    }
}

function sync_repeat() {
    var i = 0;
    if (timer_unit.repeat.index === 60) {
        for (; i < repeat_array.length; i++) {
            repeat_array[i].minutes = $("[data-index='" + i + "'][data-content='minutes']")
                    .val()
                    .trim();
        }
    } else if (timer_unit.repeat.index === 1440) {
        for (; i < repeat_array.length; i++) {
            repeat_array[i].minutes = $("[data-index='" + i + "'][data-content='minutes']")
                    .val()
                    .trim();
            repeat_array[i].hours = $("[data-index='" + i + "'][data-content='hours']")
                    .val()
                    .trim();
        }
    } else if (timer_unit.repeat.index === 10080) {
        for (; i < repeat_array.length; i++) {
            repeat_array[i].minutes = $("[data-index='" + i + "'][data-content='minutes']")
                    .val()
                    .trim();
            repeat_array[i].hours = $("[data-index='" + i + "'][data-content='hours']")
                    .val()
                    .trim();
            repeat_array[i].days_text = $("span", $("[data-content='week-days'][data-index='" + i + "']"))
                    .first()
                    .text();
            repeat_array[i].days_value = $("span", $("[data-content='week-days'][data-index='" + i + "']"))
                    .first()
                    .attr("value");
        }
    } else if (timer_unit.repeat.index === 44640) {
        for (; i < repeat_array.length; i++) {
            repeat_array[i].minutes = $("[data-index='" + i + "'][data-content='minutes']")
                    .val()
                    .trim();
            repeat_array[i].hours = $("[data-index='" + i + "'][data-content='hours']")
                    .val()
                    .trim();
            repeat_array[i].days_text = $("span", $("[data-content='month-days'][data-index='" + i + "']"))
                    .first()
                    .text();
            repeat_array[i].days_value = $("span", $("[data-content='month-days'][data-index='" + i + "']"))
                    .first()
                    .attr("value");
        }
    } else if (timer_unit.repeat.index === 525600) {
        for (; i < repeat_array.length; i++) {
            repeat_array[i].minutes = $("[data-index='" + i + "'][data-content='minutes']")
                    .val()
                    .trim();
            repeat_array[i].hours = $("[data-index='" + i + "'][data-content='hours']")
                    .val()
                    .trim();
            repeat_array[i].date_to_parse = new Date($("[data-index='" + i + "'] .bootstrap-datepicker").val());
            repeat_array[i].date = moment(repeat_array[i].date_to_parse).format('YYYY-MM-DD');
        }
    }
}

function set_boot_or_calendar(value) {
    if (value == 1) {
        // boot timer
        $("#boot").show();
        $("#boot-error-row").hide();
        $("#specific-time-without-repeat").prop("hidden", true);
        $("#specific-time-error-row").hide();
        $("#repeat-options").prop("hidden", true);
        $("#repeat-time-option").hide();
        $("#boot-time").val("00");
        $("#boot-time").removeClass("has-error");
        timer_unit.Calendar_or_Boot = "Boot";
    } else if (value == 2) {
        // calendar timer
        $("#boot").hide();
        $("#boot-error-row").hide();
        $("#specific-time-error-row").hide();
        $("#repeat-options").prop("hidden", false);
        repeat_options(0);
        $("span", $("#drop-repeat"))
                .first()
                .text(_("Don't repeat"));
        timer_unit.Calendar_or_Boot = "Calendar";
    }
}

// Initialises create timer modal to default options.
function timer_init() {
    $("#timer-dialog #command").val("");
    $("#timer-dialog #description").val("");
    $("#timer-dialog #servicename").val("");
    set_boot_or_calendar(1);
    $("#timer-dialog span", $("#timer-dialog #boot-or-specific-time"))
            .first()
            .text(_("After system boot"));
    $("#timer-dialog span", $("#timer-dialog #drop-time"))
            .first()
            .text(_("Seconds"));
    $("#timer-dialog span", $("#timer-dialog #drop-time"))
            .first()
            .attr("value", "1");
    $("#timer-dialog .form-control").removeClass("has-error");
    $("#timer-dialog .has-error").hide();
    repeat_array = [];
    timer_unit = {
        Calendar_or_Boot: "Boot",
        boot_time_unit:"sec",
        repeat: repeat_option[0]
    };
}

function create_timer() {
    sync_repeat();
    var error = check_inputs();
    if (error) {
        $('#create-timer-spinner').prop("hidden", true);
        return;
    }
    timer_unit.name = $("#servicename")
            .val()
            .replace(/\s/g, '');
    timer_unit.Description = $("#description").val();
    timer_unit.Command = $("#command").val();
    timer_unit.boot_time = $("#boot-time").val();

    if (timer_unit.repeat.index === 0) {
        timer_unit.repeat_hour = Number($("#hr")
                .val()
                .trim());
        timer_unit.repeat_minute = Number($("#min")
                .val()
                .trim());
        var today = new Date(clock_realtime_now);
        timer_unit.OnCalendar = "OnCalendar=" + today.getFullYear() + "-" + (today.getMonth() + 1) + "-" + today.getDate() + " " + timer_unit.repeat_hour + ":" + timer_unit.repeat_minute + ":00";
    } else if (timer_unit.repeat.index === 60) {
        timer_unit.repeat_minute = repeat_array.map(function(item) {
            return Number(item.minutes);
        });
        timer_unit.OnCalendar = "OnCalendar=*-*-* *:" + timer_unit.repeat_minute + ":00";
    } else if (timer_unit.repeat.index === 1440) {
        timer_unit.OnCalendar = repeat_array.map(function(item) {
            return "OnCalendar=*-*-* " + Number(item.hours) + ":" + Number(item.minutes) + ":00";
        });
    } else if (timer_unit.repeat.index === 10080) {
        timer_unit.OnCalendar = repeat_array.map(function(item) {
            return "OnCalendar=" + item.days_text.slice(0, 3) + " *-*-* " + Number(item.hours) + ":" + Number(item.minutes) + ":00";
        });
    } else if (timer_unit.repeat.index === 44640) {
        timer_unit.OnCalendar = repeat_array.map(function(item) {
            return "OnCalendar=*-*-" + item.days_value + " " + Number(item.hours) + ":" + Number(item.minutes) + ":00";
        });
    } else if (timer_unit.repeat.index === 525600) {
        timer_unit.OnCalendar = repeat_array.map(function(item) {
            return "OnCalendar=*-" + moment(item.date_to_parse).format('MM') + "-" + moment(item.date_to_parse).format('DD') + " " + Number(item.hours) + ":" + Number(item.minutes) + ":00";
        });
    }
    if (timer_unit.repeat.index !== 60)
        timer_unit.OnCalendar = timer_unit.OnCalendar.toString().replace(/,/g, "\n");
    create_timer_file();
}

function create_timer_file() {
    var unit = "[Unit]\nDescription=";
    var service = "\n[Service]\nExecStart=";
    var timer = "\n[Timer]\n";
    var install = "[Install]\nWantedBy=timers.target\n";
    var service_file = unit + timer_unit.Description + service + timer_unit.Command + "\n";
    var timer_file = " ";
    if (timer_unit.Calendar_or_Boot == "Boot") {
        var boottimer = timer + "OnBootSec=" + timer_unit.boot_time + timer_unit.boot_time_unit + "\n";
        timer_file = unit + timer_unit.Description + boottimer;
    } else if (timer_unit.Calendar_or_Boot == "Calendar") {
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
    file.replace(timer_file)
            .then(tag => {
                systemd_client.call(SD_OBJ, SD_MANAGER, "EnableUnitFiles", [[timer_unit.name + ".timer"], false, false])
                        .then(() => systemd_client.call(SD_OBJ, SD_MANAGER, "Reload", null).then(() => {
                            $('#create-timer-spinner').prop("hidden", true);
                            $("#timer-dialog").modal("toggle");
                        }))
                        .catch(error => {
                            $('#create-timer-spinner').prop("hidden", true);
                            console.warn("Failed to enable timer unit:", error.toString());
                        });
                // start calendar timers
                if (timer_unit.Calendar_or_Boot == "Calendar") {
                    systemd_client.call(SD_OBJ, SD_MANAGER, "StartUnit", [timer_unit.name + ".timer", "replace"])
                            .catch(error => console.warn("Failed to start timer unit:", error.toString()));
                }
            })
            .catch(error => {
                $('#create-timer-spinner').prop("hidden", false);
                console.log(error.toString());
            });
}

export function onCreateTimer() {
    timer_init();
    $("#timer-dialog").modal("show");
    updateTime();
}

export function timerDialogSetup() {
    const repeat_hourly_template = $("#repeat-hourly-tmpl").html();
    mustache.parse(repeat_hourly_template);
    const repeat_daily_template = $("#repeat-daily-tmpl").html();
    mustache.parse(repeat_daily_template);
    const repeat_weekly_template = $("#repeat-weekly-tmpl").html();
    mustache.parse(repeat_weekly_template);
    const repeat_monthly_template = $("#repeat-monthly-tmpl").html();
    mustache.parse(repeat_monthly_template);
    const repeat_yearly_template = $("#repeat-yearly-tmpl").html();
    mustache.parse(repeat_yearly_template);

    /* Available Options for timer creation
     * Don't Repeat   : 0
     * Repeat Hourly  : 60     (60min)
     * Repeat Daily   : 1440   (60*24min)
     * Repeat Weekly  : 10080  (60*24*7min)
     * Repeat Monthly : 44640  (60*24*31min)
     * Repeat Yearly  : 525600 (60*24*365min)
     */
    repeat_option = [
        { index: 0, render: "" },
        { index: 60, render: repeat_hourly_template },
        { index: 1440, render: repeat_daily_template },
        { index: 10080, render: repeat_weekly_template },
        { index: 44640, render: repeat_monthly_template },
        { index: 525600, render: repeat_yearly_template }
    ];

    timer_init();
    $('#create-timer-spinner').prop("hidden", true);

    $("#timer-dialog").on("click", "#timer-save-button", function() {
        $('#create-timer-spinner').prop("hidden", false);
        create_timer();
    });

    // Removes error notification when user starts typing in the error-field.
    $("#timer-dialog").on("keypress", ".form-control", function() {
        $(this).removeClass("has-error");
        if ($(this).attr("id") == "hr")
            $("#hr-error").text("");
        else if ($(this).attr("id") == "min")
            $("#min-error").text("");
        else if ($(this).attr("data-content") == "hours")
            $(this)
                    .siblings("[data-content='hr-error']")
                    .text("");
        else if ($(this).attr("data-content") == "minutes")
            $(this)
                    .siblings("[data-content='min-error']")
                    .text("");
        else
            $(this)
                    .parents("tr")
                    .next()
                    .hide();
    });

    /* HACK - bootstrap datepicker positions itself incorrectly on modals
     * that has scroll bar. This hack finds how much user has scrolled
     * and places the datepicker element accordingly.
     * scroll_top: the amount user scrolled when datepicker is absent
     * scroll_top_datepicker: the amount user scrolled when datepicker is present.
     */
    var scroll_top = 0;
    var scroll_top_datepicker = 0;
    // Datepicker is hidden initially and gets positioned correctly when clicked.
    $("#timer-dialog").on('click', "[data-content='datepicker']", function() {
        scroll_top = $("#timer-dialog").scrollTop();
        $(this).removeClass("has-error");
        $("[data-index='" + $(this).attr('data-index') + "'][data-content='date-error']").text("");
        $(".datepicker-dropdown").css("margin-top", $("#timer-dialog").scrollTop());
        $(".datepicker-dropdown").css("visibility", "visible");
        $(".datepicker-dropdown .next").show();
        $(".datepicker-dropdown .prev").show();
    });

    // This avoids datepicker incorrect positioning when a click occurs inside it.
    $("#timer-dialog").on('click', ".datepicker.datepicker-dropdown.dropdown-menu", function() {
        if (scroll_top_datepicker > scroll_top)
            $(".datepicker.datepicker-dropdown.dropdown-menu").css("margin-top", scroll_top_datepicker);
        else
            $(".datepicker.datepicker-dropdown.dropdown-menu").css("margin-top", scroll_top);
    });
    // Calculates the new position when mouse enters the header of datepicker.
    $("#timer-dialog").on('mouseenter', ".datepicker.datepicker-dropdown [class*='datepicker-'] thead", function() {
        scroll_top_datepicker = $("#timer-dialog").scrollTop();
    });

    $("#timer-dialog .form-table-ct").on("click", "[value]", ".btn-group.bootstrap-select.dropdown.form-control", function(ev) {
        var target = $(this).closest(".btn-group.bootstrap-select.dropdown.form-control");
        $("span", target)
                .first()
                .text(ev.target.text);
        $("span", target)
                .first()
                .attr("value", ev.currentTarget.value);
        switch (target.attr('id')) {
        case "boot-or-specific-time":
            set_boot_or_calendar(Number(ev.currentTarget.value));
            break;
        case "drop-time":
            set_boot_time_unit(Number(ev.currentTarget.value));
            break;
        case "drop-repeat":
            repeat_options(Number(ev.currentTarget.value));
            break;
        }
    });

    $("#repeat-time-option").on("click", "[data-content=add]", repeat_element);

    $(".form-table-ct").on("click", "[data-content=close]", function() {
        sync_repeat();
        repeat_array.splice($(this).attr('data-index'), 1);
        for (var i = 0; i < repeat_array.length; i++) {
            repeat_array[i].index = i;
        }
        if (repeat_array.length === 1)
            repeat_array[0].close = "disabled";
        else
            repeat_array[0].close = "enabled";
        display_repeat();
        if (error)
            check_inputs();
    });
}
