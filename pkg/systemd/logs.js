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

import $ from "jquery";
import cockpit from "cockpit";
import { journal } from "journal";
import moment from "moment";
import { init_reporting } from "./reporting.jsx";
import { superuser } from "superuser.jsx";

import ReactDOM from 'react-dom';
import React from 'react';
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { ExclamationCircleIcon } from '@patternfly/react-icons';

// We open a couple of long-running channels with { superuser: "try" },
// so we need to reload the page if the access level changes.
//
superuser.reload_page_on_change();

$(function() {
    cockpit.translate();
    const _ = cockpit.gettext;

    var update_services_list = true;
    var current_services = new Set();
    let the_journal = null;

    var problems_client = cockpit.dbus('org.freedesktop.problems', { superuser: "try" });
    var service = problems_client.proxy('org.freedesktop.Problems2', '/org/freedesktop/Problems2');
    var problems = problems_client.proxies('org.freedesktop.Problems2.Entry', '/org/freedesktop/Problems2/Entry');

    // A map of ABRT's problems items and it's callback for rendering
    var problem_render_callbacks = {
        core_backtrace: render_backtrace,
        os_info: render_table_eq,
        environ: render_table_eq,
        limits: render_limits,
        cgroup: render_cgroup,
        namespaces: render_table_co,
        maps: render_maps,
        dso_list: render_dso_list,
        mountinfo: render_mountinfo,
        proc_pid_status: render_table_co,
        open_fds: render_open_fds,
        var_log_messages: render_multiline,
        'not-reportable': render_multiline,
        exploitable: render_multiline,
        suspend_stats: render_table_co,
        dmesg: render_multiline,
        container_rootfs: render_multiline,
        docker_inspect: render_multiline
    };

    var problem_info_1 = ['reason', 'cmdline', 'executable', 'package', 'component',
        'crash_function', 'pid', 'pwd', 'hostname', 'count',
        'type', 'analyzer', 'rootdir', 'duphash', 'exception_type',
        'container', 'container_uuid', 'container_cmdline',
        'container_id', 'container_image'];

    var problem_info_2 = ['Directory', 'username', 'abrt_version', 'architecture', 'global_pid', 'kernel',
        'last_occurrence', 'os_release', 'pkg_fingerprint', 'pkg_vendor',
        'runlevel', 'tid', 'time', 'uid', 'uuid'];

    var displayable_problems = {};

    // Get list of all problems that can be displayed
    var find_problems = function () {
        var r = $.Deferred();
        problems.wait(function() {
            try {
                service.GetProblems(0, {})
                        .done(function(problem_paths, options) {
                            update_problems(problem_paths);
                            r.resolve();
                        });
            } catch (err) {
                // ABRT is not installed. Suggest installing?
                r.resolve();
            }
        });
        return r;
    };

    function update_problems(problem_paths) {
        for (var i in problem_paths) {
            var p = problems[problem_paths[i]];
            displayable_problems[p.ID] = { count: p.Count, problem_path: p.path };
            displayable_problems[p.UUID] = { count: p.Count, problem_path: p.path };
            displayable_problems[p.Duphash] = { count: p.Count, problem_path: p.path };
        }
    }

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

    /* Not public API */
    function journalbox(outer, start, match, priority, tag, keep_following, grep) {
        var box = $('<div class="panel panel-default cockpit-log-panel" role="table">');
        var start_box = $('<div class="journal-start" id="start-box" role="rowgroup">');

        outer.empty().append(box, start_box);

        var query_count = 5000;
        var query_more = 1000;

        var renderer = journal.renderer(box);
        var procs = [];
        var following_procs = [];

        var loading_services = false;

        let no_logs = true;

        function query_error(error) {
            /* TODO: blank slate */
            console.error(cockpit.message(error));
        }

        function prepend_entries(entries) {
            if (entries.length > 0)
                no_logs = false;
            for (var i = 0; i < entries.length; i++) {
                renderer.prepend(entries[i]);
                current_services.add(entries[i].SYSLOG_IDENTIFIER);
            }
            renderer.prepend_flush();
            show_service_filters();
        }

        function append_entries(entries) {
            if (entries.length > 0)
                no_logs = false;
            for (var i = 0; i < entries.length; i++)
                renderer.append(entries[i]);
            renderer.append_flush();
        }

        function didnt_reach_start(first) {
            manage_start_box(false, no_logs,
                             no_logs ? _("No Logs Found") : "",
                             no_logs ? _("You may try to load older entries.") : "",
                             _("Load earlier entries"),
                             () => {
                                 var count = 0;
                                 var stopped = null;
                                 manage_start_box(true, false, no_logs ? ("Loading...") : null, "", "");
                                 procs.push(journal.journalctl(match, { follow: false, reverse: true, cursor: first, priority: priority, grep: grep })
                                         .fail(query_error)
                                         .stream(function(entries) {
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
                                             if (no_logs)
                                                 manage_start_box(false, true, _("No Logs Found"), _("Can not find any logs using the current combination of filters."));
                                             else if (count < query_more)
                                                 ReactDOM.unmountComponentAtNode(document.getElementById("start-box"));
                                         }));
                             });
        }

        function follow(cursor) {
            following_procs.push(journal.journalctl(match, { follow: true, count: 0, cursor: cursor || null, priority: priority, grep: grep })
                    .fail(query_error)
                    .stream(function(entries) {
                        if (entries[0].__CURSOR == cursor)
                            entries.shift();
                        if (entries.length > 0 && no_logs)
                            ReactDOM.unmountComponentAtNode(document.getElementById("start-box"));
                        prepend_entries(entries);
                    }));
        }
        outer.follow = follow;

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
            var service_options = Object.assign({ output: "verbose" }, options);
            var cmd = journal.build_cmd(match, service_options)[0].join(" ");
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

        manage_start_box(true, false, _("Loading..."), "", "");

        var options = {
            follow: false,
            reverse: true,
            priority: priority,
            grep: grep,
        };

        let last = keep_following ? null : 1;
        var count = 0;
        var oldest = null;
        var stopped = false;

        var all = false;
        if (start == 'boot') {
            options.boot = null;
        } else if (start == 'previous-boot') {
            options.boot = "-1";
        } else if (start == 'last-24h') {
            options.since = "-1days";
        } else if (start == 'last-week') {
            options.since = "-7days";
        } else {
            all = true;
        }

        var tags_match = [];
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
                    if (no_logs)
                        manage_start_box(false, true, _("No Logs Found"), _("Can not find any logs using the current combination of filters."));
                    else if (count < query_count)
                        ReactDOM.unmountComponentAtNode(document.getElementById("start-box"));
                    if (!last) {
                        following_procs.push(journal.journalctl(match, {
                            follow: true, count: 0,
                            boot: options.boot,
                            since: options.since,
                            priority: priority,
                            grep: grep,
                        })
                                .fail(query_error)
                                .stream(function(entries) {
                                    if (entries.length > 0 && no_logs)
                                        ReactDOM.unmountComponentAtNode(document.getElementById("start-box"));
                                    prepend_entries(entries);
                                }));
                    }
                    if (!all || stopped)
                        didnt_reach_start(oldest);
                }));

        outer.stop = function stop() {
            $.each(procs, function(i, proc) {
                proc.stop();
            });
            $.each(following_procs, function(i, proc) {
                proc.stop();
            });
        };

        outer.stop_following = function stop_following() {
            $.each(following_procs, function(i, proc) {
                proc.stop();
            });
        };

        return outer;
    }

    var filler;

    function stop_query() {
        if (filler)
            filler.stop();
    }

    function update_query() {
        stop_query();

        var match = [];
        const options = cockpit.location.options;

        const grep = options.grep || "";
        let full_grep = "";

        // Set selected item into start time select menu
        var query_start = options.start || "recent";
        if (query_start == 'recent')
            $(window).scrollTop($(document).height());
        else
            full_grep += "start:" + query_start + " ";

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

        const time_options = [...document.getElementById('journal-current-day-menu').children];
        time_options.forEach(p => {
            if (p.getAttribute('value') === query_start)
                p.selected = true;
            else
                p.selected = false;
        });

        let follow = !(options.follow && options.follow === "false");

        if (query_start == "previous-boot") // Don't follow if we want to see only previous boot
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
            match.push(...['_SYSTEMD_UNIT=' + options.service, "+", "COREDUMP_UNIT=" + options.service, "+", "UNIT=" + options.service]);
            full_grep += "service:" + options.service + " ";
        }

        if (options.tag && options.tag !== "*") {
            match.push('SYSLOG_IDENTIFIER=' + options.tag);
            full_grep += "identifier:" + options.tag + " ";
        }

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

        the_journal = journalbox($("#journal-box"), query_start, match, prio_level, options.tag, follow, grep);
    }

    function update_entry() {
        var cursor = cockpit.location.path[0];
        var out = $('#journal-entry-fields');

        const reportingTable = document.getElementById("journal-entry-reporting-table");
        if (reportingTable != null) {
            reportingTable.remove();
        }

        out.empty();

        function show_entry(entry) {
            var id;
            if (entry.SYSLOG_IDENTIFIER)
                id = entry.SYSLOG_IDENTIFIER;
            else if (entry._SYSTEMD_UNIT)
                id = entry._SYSTEMD_UNIT;
            else
                id = _("Journal entry");

            var is_problem = false;
            if (id === 'abrt-notification') {
                is_problem = true;
                id = entry.PROBLEM_BINARY;
            }

            $('#journal-entry-heading').text(id);

            const crumb = $("#journal-entry-crumb");
            const date = moment(new Date(entry.__REALTIME_TIMESTAMP / 1000));

            if (is_problem) {
                crumb.text(cockpit.format(_("$0: crash at $1"), id, date.format("YYYY-MM-DD HH:mm:ss")));

                find_problems().done(function() {
                    create_problem(out, entry);
                });
            } else {
                crumb.text(cockpit.format(_("Entry at $0"), date.format("YYYY-MM-DD HH:mm:ss")));

                create_entry(out, entry);
            }
        }

        function show_error(error) {
            out.append(
                $('<tr>').append(
                    $('<td>')
                            .text(error)));
        }

        journal.journalctl({ cursor: cursor, count: 1, follow: false })
                .done(function (entries) {
                    if (entries.length >= 1 && entries[0].__CURSOR == cursor)
                        show_entry(entries[0]);
                    else
                        show_error(_("Journal entry not found"));
                })
                .fail(function (error) {
                    show_error(error);
                });
    }

    function create_message_row(entry) {
        const reasonColumn = document.createElement("th");
        reasonColumn.setAttribute("colspan", 2);
        reasonColumn.setAttribute("id", "journal-entry-message");
        reasonColumn.appendChild(document.createTextNode(journal.printable(entry.MESSAGE)));

        const reason = document.createElement("tr");
        reason.appendChild(reasonColumn);

        return reason;
    }

    function create_entry(out, entry) {
        out.append(create_message_row(entry));

        var keys = Object.keys(entry).sort();
        $.each(keys, function (i, key) {
            if (key !== 'MESSAGE') {
                out.append(
                    $('<tr>').append(
                        $('<td>', {
                            class: "journal-entry-key",
                            text: key
                        }),
                        $('<td>', {
                            class: "journal-entry-value",
                            text: journal.printable(entry[key])
                        })
                    )
                );
            }
        });
    }

    function create_problem(out, entry) {
        var problem = null;
        var all_p = [entry.PROBLEM_DIR, entry.PROBLEM_DUPHASH, entry.PROBLEM_UUID];
        for (var i = 0; i < all_p.length; i++) {
            if (all_p[i] in displayable_problems) {
                problem = problems[displayable_problems[all_p[i]].problem_path];
                break;
            }
        }

        // Display unknown problems as standard logs
        // unknown problem = deleted problem | problem of different user
        if (problem === null) {
            create_entry(out, entry);
            return;
        }

        function switch_tab(new_tab, new_content) {
            out.find('li').removeClass('active');
            new_tab.addClass('active');
            out.find('tbody.tab').first()
                    .replaceWith(new_content);
        }

        const heading = document.createElement("h3");
        heading.appendChild(document.createTextNode(_("Extended Information")));

        const caption = document.createElement("caption");
        caption.appendChild(heading);

        var ge_t = $('<li class="active">').append($('<a tabindex="0">').append($('<span translate="yes">').text(_("General"))));
        var pi_t = $('<li>').append($('<a tabindex="0">').append($('<span translate="yes">').text(_("Problem info"))));
        var pd_t = $('<li>').append($('<a tabindex="0">').append($('<span translate="yes">').text(_("Problem details"))));

        var ge = $('<tbody>').addClass('tab');
        var pi = $('<tbody>').addClass('tab');
        var pd = $('<tbody>').addClass('tab')
                .append(
                    $('<tr>').append($('<div class="panel-group" id="accordion-markup">')));

        var tab = $('<ul class="nav nav-tabs nav-tabs-pf">')
                .attr("id", "problem-navigation");

        var d_btn = $('<button class="pf-c-button pf-m-danger problem-btn btn-delete">').append('<span class="pficon pficon-delete">');

        const reportingTable = document.createElement("div");
        reportingTable.setAttribute("id", "journal-entry-reporting-table");

        const journalTable = document.getElementById("journal-entry-fields");
        journalTable.insertAdjacentElement("beforebegin", reportingTable);

        init_reporting(problem, reportingTable);

        ge_t.click(function() {
            switch_tab(ge_t, ge);
        });

        pi_t.click(function() {
            switch_tab(pi_t, pi);
        });

        pd_t.click(function() {
            switch_tab(pd_t, pd);
        });

        d_btn.click(function() {
            service.DeleteProblems([problem.path]);
            displayable_problems = { };
            find_problems().done(function() {
                cockpit.location.go('/');
            });
        });

        // write into general tab non-ABRT related items
        var keys = Object.keys(entry).sort();
        $.each(keys, function(i, key) {
            if (key !== 'MESSAGE' && key.indexOf('PROBLEM_') !== 0) {
                ge.append(
                    $('<tr>').append(
                        $('<td>').css('text-align', 'right')
                                .text(key),
                        $('<td>').css('text-align', 'left')
                                .text(journal.printable(entry[key]))));
            }
        });

        tab.html(ge_t);
        tab.append(pi_t);
        tab.append(pd_t);
        tab.append(d_btn);

        var header = $('<tr>').append(
            $('<th colspan=2>').append(tab));

        out.html(header).append(create_message_row(entry));
        out.append(ge);
        out.prepend(caption);
        out.css("margin-bottom", "0px");

        create_problem_details(problem, pi, pd);
    }

    function create_problem_details(problem, pi, pd) {
        service.GetProblemData(problem.path).done(function(args, options) {
            var i, elem, val;
            // Render first column of problem info
            var c1 = $('<table>').css('display', 'inline-block')
                    .css('padding-right', '200px')
                    .css('vertical-align', 'top')
                    .addClass('info-table-ct');
            pi.append(c1);
            for (i = 0; i < problem_info_1.length; i++) {
                elem = problem_info_1[i];
                if (elem in args) {
                    val = args[elem][2];
                    c1.append(
                        $('<tr>').append(
                            $('<td>').css('text-align', 'right')
                                    .text(elem),
                            $('<td>').css('text-align', 'left')
                                    .text(String(val))));
                }
            }

            // Render second column of problem info
            var c2 = $('<table>').css('display', 'inline-block')
                    .css('vertical-align', 'top')
                    .addClass('info-table-ct');
            pi.append(c2);
            for (i = 0; i < problem_info_2.length; i++) {
                elem = problem_info_2[i];
                if (elem in args) {
                    val = args[elem][2];
                    // Display date properly
                    if (['last_occurrence', 'time'].indexOf(elem) !== -1) {
                        var d = new Date(val / 1000);
                        val = d.toString();
                    }
                    c2.append(
                        $('<tr>').append(
                            $('<td>').css('text-align', 'right')
                                    .text(elem),
                            $('<td>').css('text-align', 'left')
                                    .text(String(val))));
                }
            }

            // Render problem details
            var problem_details_elems = Object.keys(problem_render_callbacks);
            $.each(problem_details_elems, function(i, key) {
                if (key in args) {
                    val = problem_render_callbacks[key](args[key]);
                    $('.panel-group', pd).append(
                        $('<div class="panel panel-default">')
                                .css("border-width", "0px 0px 2px 0px")
                                .css("margin-bottom", "0px")
                                .append(
                                    $('<div class="panel-heading problem-panel">')
                                            .attr('data-toggle', 'collapse')
                                            .attr('data-target', '#' + key)
                                            .attr('data-parent', '#accordion-markup')
                                            .append($('<h4 class="panel-title">')
                                                    .append($('<a tabindex="0" class="accordion-toggle">')
                                                            .text(key))),
                                    $('<div class="panel-collapse collapse">')
                                            .attr('id', key)
                                            .append(
                                                $('<div class="panel-body">')
                                                        .html(val))));
                }
            });
        });
    }

    function render_table_eq(orig) {
        return render_table(orig, '=');
    }

    function render_table_co(orig) {
        return render_table(orig, ':');
    }

    function render_table(orig, delimiter) {
        var lines = orig[2].split('\n');
        var result = '<table class="detail_table">';

        for (var i = 0; i < lines.length - 1; i++) {
            var line = lines[i].split(delimiter);
            result += '<tr> <td class="text-right">' + line[0];
            result += '<td class="text-left">' + line[1];
            result += '</tr>';
        }

        result += '</table>';
        return result;
    }

    function render_multiline(orig) {
        var rendered = orig[2].replace(/\n/g, '<br>');
        return rendered;
    }

    function render_multitable(orig, delimiter) {
        var rendered = orig.replace(RegExp(delimiter, 'g'), '</td><td>');
        rendered = rendered.replace(/\n/g, '</td></tr><tr><td>');
        return '<table class="detail_table"><tr><td>' + rendered + '</td></tr></table>';
    }

    function render_dso_list(orig) {
        var rendered = orig[2].replace(/^(\S+\s+)(\S+)(.*)$/gm, '$1<b>$2</b>$3');
        return render_multitable(rendered, ' ');
    }

    function render_open_fds(orig) {
        var lines = orig[2].split('\n');
        for (var i = 0; i < lines.length - 1; i++) {
            if (i % 5 !== 0) {
                lines[i] = ':' + lines[i];
            }
        }
        return render_multitable(lines.join('\n'), ':');
    }

    function render_cgroup(orig) {
        return render_multitable(orig[2], ':');
    }

    function render_mountinfo(orig) {
        return render_multitable(orig[2].replace(/  +/g, ':'), ' ');
    }

    function render_maps(orig) {
        return render_multitable(orig[2].replace(/  +/g, ':'), ' ');
    }

    function render_limits(orig) {
        var lines = orig[2].split('\n');
        lines[0] = '":' + lines[0].replace(/(\S+) (\S+) /g, '$1:$2 ');
        for (var i = 1; i < lines.length - 1; i++) {
            lines[i] = lines[i].replace(/  +/g, ':');
        }

        return render_multitable(lines.join('\n'), ':');
    }

    function render_backtrace(content) {
        var content_json = JSON.parse(content[2]);

        var crash_thread = null;
        var other_threads = [];
        var other_items = {};

        for (var item in content_json) {
            if (item === 'stacktrace') {
                var threads = content_json[item];
                for (var thread_key in threads) {
                    var thread = threads[thread_key];

                    if (thread.crash_thread) {
                        if (thread.frames) {
                            crash_thread = thread.frames;
                        }
                    } else {
                        if (thread.frames) {
                            other_threads.push(thread.frames);
                        }
                    }
                }
            } else {
                other_items[item] = content_json[item];
            }
        }
        return create_detail_from_parsed_core_backtrace(crash_thread, other_threads, other_items);
    }

    function create_detail_from_parsed_core_backtrace(crash_thread, other_threads, other_items) {
        var detail_content = '';
        for (var item in other_items) {
            detail_content += item;
            detail_content += ': ' + other_items[item] + "  ";
        }

        detail_content += create_table_from_thread(crash_thread);

        if (other_threads.length !== 0) {
            detail_content += '<div id="other_threads_btn_div"><button class="pf-c-button pf-m-secondary other-threads-btn" title="">Show all threads</button></div>';
            detail_content += '<div class="hidden other_threads">';

            var thread_num = 1;
            for (var thread_key in other_threads) {
                detail_content += '\n';
                detail_content += 'thread: ' + thread_num++ + '\n';
                detail_content += create_table_from_thread(other_threads[thread_key]);
            }
            detail_content += '</div>';
        }

        return detail_content;
    }

    function create_table_from_thread(thread) {
        var all_keys = get_all_keys_from_frames(thread);

        /* create table legend */
        var table = '<table class="detail_table"><thead><tr><th>Fr #</th>';
        for (var key in all_keys) {
            table += '<th>';
            table += all_keys[key].replace(/_/g, ' ');
            table += '</th>';
        }
        table += '</tr></thead><tbody>';

        var frame_num = 1;
        for (var frame_key in thread) {
            table += '<tr>';
            table += '<td>';
            table += frame_num++;
            table += '</td>';

            var frame = thread[frame_key];
            for (var key_key in all_keys) {
                key = all_keys[key_key];

                var title = '';
                var row_content = '';
                if (key in frame) {
                    row_content = frame[key].toString();
                    if (row_content.length > 8)
                        title = row_content;
                } else
                    row_content = '';

                table += '<td title="' + title + '">';
                table += row_content;
                table += '</td>';
            }
            table += '</tr>';
        }

        table += '</tbody></table>';
        return table;
    }

    function get_all_keys_from_frames(thread) {
        var all_keys = [];

        for (var frame_key in thread) {
            var frame = thread[frame_key];
            var keys = Object.keys(frame);

            for (var key in keys) {
                if (all_keys.indexOf(keys[key]) === -1)
                    all_keys.push(keys[key]);
            }
        }

        /* order keys */
        var desired_ordered_of_keys = ['function_name', 'file_name', 'address', 'build_id', 'build_id_offset'];

        var all_ordered_keys = [];

        for (var key_key in desired_ordered_of_keys) {
            var in_key = desired_ordered_of_keys[key_key];
            var key_index = all_keys.indexOf(in_key);
            if (key_index !== -1) {
                all_ordered_keys.push(in_key);
                delete all_keys[key_index];
            }
        }

        for (key_key in all_keys) {
            all_ordered_keys.push(all_keys[key_key]);
        }

        return all_ordered_keys;
    }

    function update() {
        var path = cockpit.location.path;
        if (path.length === 0) {
            $("#journal-entry").prop("hidden", true);
            update_query();
            $("#journal").show();
        } else if (path.length == 1) {
            stop_query();
            $("#journal").hide();
            update_entry();
            $("#journal-entry").prop("hidden", false);
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

    function parse_search(value) {
        const new_items = {};
        const values = value.split(" ")
                .filter(item => {
                    let s = item.split("=");
                    if (s.length === 2 && s[0] === s[0].toUpperCase()) {
                        new_items[s[0]] = s[1];
                        return false;
                    }

                    const well_know_keys = ["start", "priority", "follow", "service", "identifier"];
                    const map_keys = (key) => {
                        if (key === "priority")
                            return "prio";
                        if (key === "identifier")
                            return "tag";
                        return key;
                    };
                    s = item.split(":");
                    if (s.length === 2 && well_know_keys.includes(s[0])) {
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

    $('#journal-box').on('click', '.cockpit-logline', function() {
        var cursor = $(this).attr('data-cursor');
        if (cursor)
            cockpit.location.go([cursor], { parent_options: JSON.stringify(cockpit.location.options) });
    });

    $('#journal-box').on('keypress', '.cockpit-logline', function(ev) {
        if (ev.key !== "Enter")
            return;

        var cursor = $(this).attr('data-cursor');
        if (cursor)
            cockpit.location.go([cursor], { parent_options: JSON.stringify(cockpit.location.options) });
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

    $('#journal-current-day-menu').on('change', function() {
        const options = parse_search(document.getElementById("journal-grep").value);
        update_services_list = true;
        cockpit.location.go([], $.extend(options, { start: $(this).val() }));
    });

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

    $('#journal-navigate-home').on("click", function() {
        if (current_services.size > 0)
            update_services_list = false;
        else
            update_services_list = true;

        var parent_options;
        if (cockpit.location.options.parent_options) {
            parent_options = JSON.parse(cockpit.location.options.parent_options);
        }
        cockpit.location.go('/', parent_options);
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
