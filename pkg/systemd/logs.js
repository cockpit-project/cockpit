/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

import '../lib/patternfly/patternfly-cockpit.scss';

import $ from "jquery";
import "bootstrap/js/dropdown";

import cockpit from "cockpit";
import { journal } from "journal";
import { superuser } from "superuser";

import ReactDOM from 'react-dom';
import React from 'react';
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { JournalOutput } from "cockpit-components-logs-panel.jsx";
import { LogEntry } from "./logDetails.jsx";
import { ExclamationCircleIcon } from '@patternfly/react-icons';

// We open a couple of long-running channels with { superuser: "try" },
// so we need to reload the page if the access level changes.
//
superuser.reload_page_on_change();

function JournalLogs({ logs }) {
    return <>{logs}</>;
}

$(function() {
    cockpit.translate();
    const _ = cockpit.gettext;

    let update_services_list = true;
    let current_services = new Set();
    let the_journal = null;

    function manage_start_box(loading, show_icon, title, text, action, onAction) {
        ReactDOM.render(
            React.createElement(EmptyStatePanel, {
                loading: loading,
                icon: show_icon ? ExclamationCircleIcon : undefined,
                title: title,
                paragraph: text,
                action: action,
                onAction: onAction,
            }),
            document.getElementById("start-box"));
    }

    // Listing of all logs
    function journalbox(match, priority, tag, keep_following, grep, boot, since, until) {
        const self = {};
        const out = new JournalOutput(cockpit.location.options);

        const query_count = 5000;
        const query_more = 1000;

        const renderer = journal.renderer(out);
        const procs = [];
        const following_procs = [];
        let running = true;

        let loading_services = false;

        let no_logs = true;

        function query_error(error) {
            /* TODO: blank slate */
            console.error(cockpit.message(error));
        }

        function prepend_entries(entries) {
            if (entries.length > 0)
                no_logs = false;
            for (let i = 0; i < entries.length; i++) {
                renderer.prepend(entries[i]);
                current_services.add(entries[i].SYSLOG_IDENTIFIER);
            }
            renderer.prepend_flush();
            show_service_filters();
            ReactDOM.render(React.createElement(JournalLogs, { logs: out.logs }), document.getElementById("journal-logs"));
        }

        function append_entries(entries) {
            if (entries.length > 0)
                no_logs = false;
            for (let i = 0; i < entries.length; i++)
                renderer.append(entries[i]);
            renderer.append_flush();
            ReactDOM.render(React.createElement(JournalLogs, { logs: out.logs }), document.getElementById("journal-logs"));
        }

        function didnt_reach_start(first) {
            if (no_logs)
                ReactDOM.unmountComponentAtNode(document.getElementById("journal-logs"));
            manage_start_box(false, no_logs,
                             no_logs ? _("No logs found") : "",
                             no_logs ? _("You may try to load older entries.") : "",
                             _("Load earlier entries"),
                             () => {
                                 let count = 0;
                                 let stopped = null;
                                 manage_start_box(true, false, no_logs ? ("Loading...") : null, "", "");
                                 procs.push(journal.journalctl(match, { follow: false, reverse: true, cursor: first, priority: priority, grep: grep })
                                         .fail(query_error)
                                         .stream(function(entries) {
                                             if (!running)
                                                 return;
                                             if (entries[0].__CURSOR == first)
                                                 entries.shift();
                                             count += entries.length;
                                             append_entries(entries);
                                             if (count >= query_more) {
                                                 stopped = entries[entries.length - 1].__CURSOR;
                                                 didnt_reach_start(stopped);
                                                 this.stop();
                                             }
                                         })
                                         .done(function() {
                                             if (!running)
                                                 return;
                                             if (no_logs) {
                                                 ReactDOM.unmountComponentAtNode(document.getElementById("journal-logs"));
                                                 manage_start_box(false, true, _("No logs found"), _("Can not find any logs using the current combination of filters."));
                                             } else if (count < query_more)
                                                 ReactDOM.unmountComponentAtNode(document.getElementById("start-box"));
                                         }));
                             });
        }

        function follow(cursor) {
            following_procs.push(journal.journalctl(match, { follow: true, count: 0, cursor: cursor || null, priority: priority, until: until, grep: grep })
                    .fail(query_error)
                    .stream(function(entries) {
                        if (!running)
                            return;
                        if (entries[0].__CURSOR == cursor)
                            entries.shift();
                        if (entries.length > 0 && no_logs)
                            ReactDOM.unmountComponentAtNode(document.getElementById("start-box"));
                        prepend_entries(entries);
                    }));
        }
        self.follow = follow;

        function clear_service_list() {
            if (loading_services) {
                $('#journal-service-menu').empty()
                        .append($('<option selected disabled>').text(_("Loading...")));
                return;
            }

            $('#journal-service-menu').empty()
                    .append($('<option value="*">').text(_("All")))
                    .append($('<option value="" role="separator" className="divider" disabled>').text("──────────"));
            fit_filters();
        }

        function load_service_filters(match, options) {
            loading_services = true;
            current_services = new Set();
            const service_options = Object.assign({ output: "verbose" }, options);
            let cmd = journal.build_cmd(match, service_options)[0].join(" ");
            cmd += " | grep SYSLOG_IDENTIFIER= | sort -u";
            cockpit.spawn(["sh", "-ec", cmd], { host: options.host, superuser: "try" })
                    .then(function(entries) {
                        entries.split("\n").forEach(function(entry) {
                            if (entry)
                                current_services.add(entry.substr(entry.indexOf('=') + 1));
                        });
                    })
                    .done(function () {
                        loading_services = false;
                        show_service_filters();
                    });
        }

        function show_service_filters() {
            clear_service_list();

            if (loading_services)
                return;

            // Sort and put into list
            Array.from(current_services).sort((a, b) =>
                a.toLowerCase().localeCompare(b.toLowerCase())
            )
                    .forEach(unit => $('#journal-service-menu').append($('<option value="' + unit + '"' + (unit === tag ? ' selected>' : '>')).text(unit)));
        }

        ReactDOM.unmountComponentAtNode(document.getElementById("journal-logs"));
        manage_start_box(true, false, _("Loading..."), "", "");

        const options = {
            follow: false,
            reverse: true,
            priority: priority,
            grep: grep,
            boot: boot,
            since: since,
            until: until,
        };

        let last = keep_following ? null : 1;
        let count = 0;
        let oldest = null;
        let stopped = false;
        const all = boot === undefined && since === undefined && until === undefined;

        const tags_match = [];
        match.forEach(function (field) {
            if (!field.startsWith("SYSLOG_IDENTIFIER"))
                tags_match.push(field);
        });

        if (update_services_list) {
            clear_service_list();
            load_service_filters(tags_match, options);
        }

        // Show the journalctl query in inline help
        const cmd = journal.build_cmd(match, options);
        const filtered_cmd = cmd[0].filter(i => i !== "-q" && i !== "--output=json");
        if (filtered_cmd[filtered_cmd.length - 1] == "--")
            filtered_cmd.pop();

        document.getElementById("journal-query").innerHTML = filtered_cmd.join(" ");

        procs.push(journal.journalctl(match, options)
                .fail(query_error)
                .stream(function(entries) {
                    if (!running)
                        return;
                    if (!last) {
                        last = entries[0].__CURSOR;
                        follow(last);
                    }
                    count += entries.length;
                    append_entries(entries);
                    oldest = entries[entries.length - 1].__CURSOR;
                    if (count >= query_count) {
                        stopped = true;
                        didnt_reach_start(oldest);
                        this.stop();
                    }
                })
                .done(function() {
                    if (!running)
                        return;
                    if (no_logs) {
                        ReactDOM.unmountComponentAtNode(document.getElementById("journal-logs"));
                        manage_start_box(false, true, _("No logs found"), _("Can not find any logs using the current combination of filters."));
                    } else if (count < query_count)
                        ReactDOM.unmountComponentAtNode(document.getElementById("start-box"));
                    if (!last) {
                        following_procs.push(journal.journalctl(match, {
                            follow: true, count: 0,
                            boot: options.boot,
                            since: options.since,
                            until: options.until,
                            priority: priority,
                            grep: grep,
                        })
                                .fail(query_error)
                                .stream(function(entries) {
                                    if (!running)
                                        return;
                                    if (entries.length > 0 && no_logs)
                                        ReactDOM.unmountComponentAtNode(document.getElementById("start-box"));
                                    prepend_entries(entries);
                                }));
                    }
                    if (!all || stopped)
                        didnt_reach_start(oldest);
                }));

        self.stop = function stop() {
            running = false;
            $.each(procs, function(i, proc) {
                proc.stop();
            });
            $.each(following_procs, function(i, proc) {
                proc.stop();
            });
        };

        self.stop_following = function stop_following() {
            $.each(following_procs, function(i, proc) {
                proc.stop();
            });
        };

        return self;
    }

    function update_query() {
        const match = [];
        const options = cockpit.location.options;

        const grep = options.grep || "";
        let full_grep = "";

        const prio_level = options.prio || "err";
        full_grep += "priority:" + prio_level + " ";

        // Set selected item into priority select menu
        const prio_options = [...document.getElementById('journal-prio-menu').children];
        prio_options.forEach(p => {
            if (p.getAttribute('value') === prio_level)
                p.selected = true;
            else
                p.selected = false;
        });

        let follow = !(options.follow && options.follow === "false");

        if (options.boot && options.boot !== "0") // Don't follow if specific boot is picked
            follow = false;

        const follow_button = document.getElementById("journal-follow");
        if (follow) {
            follow_button.textContent = _("Pause");
            follow_button.setAttribute("data-following", true);
        } else {
            follow_button.textContent = _("Resume");
            follow_button.setAttribute("data-following", false);
        }

        if (options.service) {
            let s = options.service;
            if (!s.endsWith(".service"))
                s = s + ".service";
            match.push(...['_SYSTEMD_UNIT=' + s, "+", "COREDUMP_UNIT=" + s, "+", "UNIT=" + s]);
            full_grep += "service:" + options.service + " ";
        }

        if (options.tag && options.tag !== "*") {
            match.push('SYSLOG_IDENTIFIER=' + options.tag);
            full_grep += "identifier:" + options.tag + " ";
        }

        if (options.boot)
            full_grep += "boot:" + options.boot + " ";

        if (options.since)
            full_grep += "since:" + options.since.replace(" ", "\\ ") + " ";

        if (options.until)
            full_grep += "until:" + options.until.replace(" ", "\\ ") + " ";

        // Other filters may be passed as well
        Object.keys(options).forEach(k => {
            if (k === k.toUpperCase() && options[k]) {
                options[k].split(",").forEach(v => match.push(k + "=" + v));
                full_grep += k + '=' + options[k] + " ";
            }
        });

        full_grep += grep;
        document.getElementById("journal-grep").value = full_grep;

        if (the_journal)
            the_journal.stop();

        the_journal = journalbox(match, prio_level, options.tag, follow, grep, options.boot, options.since, options.until);
    }

    function update() {
        const path = cockpit.location.path;
        if (path.length === 0) {
            ReactDOM.unmountComponentAtNode(document.getElementById('journal-entry'));
            update_query();
            $("#journal").show();
        } else if (path.length == 1) {
            $("#journal").hide();
            ReactDOM.render(React.createElement(LogEntry), document.getElementById("journal-entry"));
        } else { /* redirect */
            console.warn("not a journal location: " + path);
            cockpit.location = '';
        }
        $("body").show();
    }

    function check_grep() {
        // Sometimes `journalctl` can be compiled without `PCRE2` which means
        // that `--grep` is not usable. Hide the search box in such cases.
        cockpit.spawn(["journalctl", "--version"])
                .then(m => {
                    if (m.indexOf("-PCRE2") !== -1) {
                        document.querySelector(".text-search").hidden = true;
                        fit_filters();
                    }
                });
    }

    function fit_filters() {
        if ($(".filters-toggle button").is(":hidden")) {
            $("#journal .content-header-extra").toggleClass("toggle-filters-closed");
            $(".filters-toggle").prop("hidden", false);
            $(".filters-toggle button").text(_("Show filters"));
        } else {
            $(".filters-toggle button").text(_("Hide filters"));
        }
    }

    function split_search(text) {
        let last_i = 0;
        const words = [];

        // Add space so the following loop can always pick group on space (without trailing
        // space the last group would not be recognized and it would need a special check)
        if (text.length && text[text.length - 1] !== " ")
            text += " ";

        for (let i = 1; i < text.length; i++) {
            if (text[i] === " " && text[i - 1] !== "\\") {
                words.push(text.substring(last_i, i).replace("\\ ", " "));
                last_i = i + 1;
            }
        }
        return words;
    }

    function parse_search(value) {
        const new_items = {};
        const values = split_search(value)
                .filter(item => {
                    let s = item.split("=");
                    if (s.length === 2 && s[0] === s[0].toUpperCase()) {
                        new_items[s[0]] = s[1];
                        return false;
                    }

                    const well_know_keys = ["since", "until", "boot", "priority", "follow", "service", "identifier"];
                    const map_keys = (key) => {
                        if (key === "priority")
                            return "prio";
                        if (key === "identifier")
                            return "tag";
                        return key;
                    };
                    s = item.split(/:(.*)/);
                    if (s.length >= 2 && well_know_keys.includes(s[0])) {
                        new_items[map_keys(s[0])] = s[1];
                        return false;
                    }

                    return true;
                });
        new_items.grep = values.join(" ");
        return new_items;
    }

    $(cockpit).on("locationchanged", function() {
        update_services_list = true;
        update();
    });

    $('#journal-cmd-copy').on('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        try {
            navigator.clipboard.writeText(document.getElementById("journal-query").innerHTML)
                    .then(() => {
                        let icon = ev.target;
                        if (ev.target.nodeName == "BUTTON")
                            icon = ev.target.firstElementChild;
                        icon.classList.remove("fa-clipboard");
                        icon.classList.add("fa-check");
                        icon.classList.add("green-icon");
                        setTimeout(() => {
                            icon.classList.remove("fa-check");
                            icon.classList.remove("green-icon");
                            icon.classList.add("fa-clipboard");
                        }, 3000);
                    })
                    .catch(e => console.error('Text could not be copied: ', e ? e.toString() : ""));
        } catch (error) {
            console.error('Text could not be copied: ', error.toString());
        }
    });

    function onFilter(e) {
        if (e.type == "keyup" && e.keyCode !== 13) // Only accept enter for entering
            return;

        const options = parse_search(document.getElementById("journal-grep").value);
        update_services_list = true;
        const key = $(this).attr("data-key");
        const val = $(this).attr("data-value");

        // Remove all parameters which can be set up using filters
        delete options.boot;
        delete options.since;

        cockpit.location.go([], $.extend(options, { [key]: val }));
    }

    $('#logs-predefined-filters a').on('click', onFilter);
    $('#logs-predefined-filters a').on('keyup', onFilter);

    $('#journal-prio-menu').on('change', function() {
        const options = parse_search(document.getElementById("journal-grep").value);
        update_services_list = true;
        cockpit.location.go([], $.extend(options, { prio: $(this).val() }));
    });

    $('#journal-service-menu').on("change", function() {
        const options = parse_search(document.getElementById("journal-grep").value);
        update_services_list = false;
        cockpit.location.go([], $.extend(options, { tag: $(this).val() }));
    });

    $('#journal-follow').on("click", function() {
        const state = $(this).attr("data-following") === "true";
        if (state) {
            $(this).text(_("Resume"));
            $(this).attr("data-following", false);
            the_journal.stop_following();
        } else {
            $(this).text(_("Pause"));
            $(this).attr("data-following", true);

            const cursor = document.querySelector(".cockpit-logline");
            if (cursor)
                the_journal.follow(cursor.getAttribute("data-cursor"));
            else
                the_journal.follow();
        }
    });

    $(".filters-toggle button").on("click", () => {
        if ($("#journal .content-header-extra").hasClass("toggle-filters-closed"))
            $(".filters-toggle button").text(_("Hide filters"));
        else
            $(".filters-toggle button").text(_("Show filters"));
        $("#journal .content-header-extra").toggleClass("toggle-filters-closed");
    });

    $('#journal-grep').on("keyup", function(e) {
        if (e.keyCode == 13) { // Submitted by enter
            update_services_list = true;
            cockpit.location.go([], parse_search($(this).val()));
        }
    });

    // Check if the last filter is still on the same line, or it was wrapped.
    window.addEventListener("resize", fit_filters);

    check_grep();
    fit_filters();
    update();
});
