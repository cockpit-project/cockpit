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

(function() {
    "use strict";

    var $ = require("jquery");
    var cockpit = require("cockpit");

    var Mustache = require("mustache");
    require("patterns");

    var docker = require("./docker");
    var bar = require("./bar");

    var _ = cockpit.gettext;

    var util = { };

    util.resource_debug = function resource_debug() {
        if (window.debugging == "all" || window.debugging == "resource")
            console.debug.apply(console, arguments);
    };

    util.docker_debug = function docker_debug() {
        if (window.debugging == "all" || window.debugging == "docker")
            console.debug.apply(console, arguments);
    };

    util.quote_cmdline = function quote_cmdline(cmds) {
        return docker.quote_cmdline(cmds || []);
    };

    util.unquote_cmdline = function unquote_cmdline(string) {
        return docker.unquote_cmdline(string);
    };

    util.render_container_cmdline = function render_container_cmdline (container) {
        // We do our own quoting in preference to using container.Command.
        // We do this for consistency, and also to avoid bugs in how
        // Docker creates container.Command.  Docker doesn't escape quote
        // characters, for example.

        if (container.Config)
            return util.quote_cmdline ((container.Config.Entrypoint || []).concat(container.Config.Cmd || []));
        else
            return container.Command;
    };

    /*
     * Recent versions of docker have a 'Status' field in the state,
     * but earlier versions have distinct fields which we need to combine.
     */
    util.render_container_status = function render_container_status(state) {
        if (state.Status)
            return state.Status;
        if (state.Running)
            return "running";
        if (state.Paused)
            return "paused";
        if (state.Restarting)
            return "restarting";
        if (state.FinishedAt && state.FinishedAt.indexOf("0001") === 0)
            return "created";
        return "exited";
    };

    util.render_container_name = function render_container_name (name) {
        if (name.length > 0 && name[0] == "/")
            return name.slice(1);
        else
            return name;
    };

    util.render_container_state = function render_container_state (state) {
        if (state.Running)
            return cockpit.format(_("Up since $StartedAt"), state);
        else
            return cockpit.format(_("Exited $ExitCode"), state);
    };

    util.render_container_restart_policy = function render_restart_policy(policy) {
        switch (policy.Name) {
            case "no":
                return _("No");
            case "on-failure":
                var text = cockpit.ngettext("On failure, retry $0 time", "On failure, retry $0 times", policy.MaximumRetryCount);
                return cockpit.format(text, policy.MaximumRetryCount);
            case "always":
                return _("Always");
            case "unless-stopped":
                return _("Unless Stopped");
            default: /* Keeping this here just in case. http://stackoverflow.com/a/4878800 */
                return policy.Name.replace('-', ' ').replace(/\w\S*/g, function(txt) {
                    return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
                });
        }
    };

    util.multi_line = function multi_line(strings) {
        return strings.map(function (str) { return Mustache.render("{{.}}", str); }).join('<br/>');
    };

    util.format_cpu_shares = function format_cpu_shares(priority) {
        if (!priority)
            return _("default");
        return cockpit.format(_("$0 shares"), Math.round(priority));
    };

    util.format_cpu_usage = function format_cpu_usage(usage) {
        if (usage === undefined || isNaN(usage))
            return "";
        return Math.round(usage) + "%";
    };

    util.update_memory_bar = function update_memory_bar(bar, usage, limit) {
        var parts = [ usage ];
        if (limit)
            parts.push(limit);
        $(bar).
            attr("value", parts.join("/")).
            toggleClass("bar-row-danger", !!(limit && usage > 0.9 * limit));
    };

    util.format_memory_and_limit = function format_memory_and_limit(usage, limit) {
        if (usage === undefined || isNaN(usage))
            return "";

        var mtext = "";
        var units = 1024;
        var parts;
        if (limit) {
            parts = cockpit.format_bytes(limit, units, true);
            mtext = " / " + parts.join(" ");
            units = parts[1];
        }

        if (usage) {
            parts = cockpit.format_bytes(usage, units, true);
            if (mtext)
                return parts[0] + mtext;
            else
                return parts.join(" ");
        } else {
            return "?" + mtext;
        }
    };

    util.insert_table_sorted = function insert_table_sorted(table, row) {
        util.insert_table_sorted_generic(table, row, function(row1, row2) {
            return row1.text().localeCompare(row2.text());
        });
    };

    util.insert_table_sorted_generic = function insert_table_sorted_generic(table, row, cmp) {
        var rows = $(table).find("tbody tr");
        for (var j = 0; j < rows.length; j++) {
            if (cmp($(rows[j]), row) > 0) {
                $(row).insertBefore(rows[j]);
                row = null;
                break;
            }
        }
        if (row !== null)
            $(table).find("tbody").append(row);
    };

    util.setup_danger_button = function setup_danger_button(id, parent_id, callback) {
        var danger_button = $('<button class="btn btn-default btn-control-ct fa fa-check enable-danger">')
            .toggle(false)
            .on("click", callback);
        $(id + ' th.container-column-actions').append(danger_button);
        $(parent_id)[0].addEventListener("click", function(ev) {
            if ($(ev.target).parents(id).length === 0 &&
                $(id + ' button.enable-danger').hasClass('active'))
                callback();
        }, true);
    };

    util.render_container = function render_container(client, $panel,
                                                      prefix, id, container, danger_mode) {

        // Docker ID can contain funny characters such as ":" so
        // we take care not to embed them into jQuery query
        // strings or HTML.

        var tr = $(document.getElementById(prefix + id));

        if (!container) {
            tr.remove();
            if (!$panel.find('table > tbody > tr').length) {
                $panel.find('button.enable-danger').toggle(false);
            }
            return;
        }

        var cputext;
        var memuse, memlimit;
        var membar, memtext, memtextstyle;

        if (container.State && container.State.Running) {
            cputext = util.format_cpu_usage(container.CpuUsage);

            memuse = container.MemoryUsage;
            memlimit = container.MemoryLimit;
            memtext = util.format_memory_and_limit(memuse, memlimit);

            membar = true;
            memtextstyle = { 'color': 'inherit' };
        } else {
            cputext = "";
            membar = false;
            memtext = _("Stopped");
            memtextstyle = { 'color': 'grey', 'text-align': 'right' };
        }

        var added = false;
        if (!tr.length) {
            $panel.find('button.enable-danger').toggle(true);
            var img_waiting = $('<div class="spinner">');
            var btn_delete = $('<button class="btn btn-danger pficon pficon-delete btn-delete">').
                on("click", function() {
                    var self = this;
                    $(self).hide().
                        siblings("div.spinner").show();
                    util.docker_container_delete(client, id, function() { }, function () { $(self).show().siblings("div.spinner").hide(); });
                    return false;
                });
            var btn_play = $('<button class="btn btn-default btn-control-ct fa fa-play">').
                on("click", function() {
                    $(this).hide().
                        siblings("div.spinner").show();
                    client.start(id).
                        fail(function(ex) {
                            util.handle_scope_start_container(client, id, ex.message);
                        });
                    return false;
                });
            var btn_stop = $('<button class="btn btn-default btn-control-ct fa fa-stop">').
                on("click", function() {
                    $(this).hide().
                        siblings("div.spinner").show();
                    client.stop(id).
                        fail(function(ex) {
                            util.show_unexpected_error(ex);
                        });
                    return false;
                });
            tr = $('<tr>', { 'id': prefix + id }).append(
                $('<td class="container-column-name">'),
                $('<td class="container-column-image">'),
                $('<td class="container-column-command">'),
                $('<td class="container-column-cpu">'),
                $('<td class="container-column-memory-graph">').append(bar.create("containers-containers")),
                $('<td class="container-column-memory-text">'),
                $('<td class="container-column-danger cell-buttons">').append(btn_delete, img_waiting),
                $('<td class="container-column-actions cell-buttons">').append(btn_play, btn_stop, img_waiting.clone()));

            tr.on('click', function(event) {
                cockpit.location.go([ id ]);
            });

            added = true;
        }

        var row = tr.children("td");
        $(row[0]).text(util.render_container_name(container.Name));
        $(row[1]).text(container.Image);
        $(row[2]).text(util.render_container_cmdline(container));
        $(row[3]).text(cputext);
        util.update_memory_bar($(row[4]).children("div").toggle(membar), memuse, memlimit);
        $(row[5]).
            css(memtextstyle).
            text(memtext);

        var waiting = id in client.waiting;
        $(row[6]).children("div.spinner").toggle(waiting);
        $(row[6]).children("button.btn-delete")
            .toggle(!waiting)
            .toggleClass('disabled', container.State.Running);

        var title = (waiting || container.State.Running) ? "You can only delete<br/> stopped containers" : "Delete immediately";

        $(row[6]).children("button.btn-delete")
            .tooltip('destroy')
            .attr("title", title)
            .tooltip({html: true});


        $(row[7]).children("div.spinner").toggle(waiting);
        $(row[7]).children("button.fa-play").toggle(!waiting && !container.State.Running);
        $(row[7]).children("button.fa-stop").toggle(!waiting && container.State.Running);

        $(row[6]).toggle(danger_mode);
        $(row[7]).toggle(!danger_mode);

        tr.toggleClass("unimportant", !container.State.Running);

        if (added)
            util.insert_table_sorted($panel.find('table'), tr);

        bar.update();
    };

    /* Slider/text/checkbox interaction happens here */
    function Slider(sel, min, max, parse, format) {
        var self = this;
        var slider, input, check;
        var updating = false;
        var data;

        /* Logarithmic scale */
        if (min < 0)
            min = 0;
        if (max < 0)
            max = 0;
        var minv = Math.log(min);
        var maxv = Math.log(max);
        var scale = (maxv - minv);

        function limit(val) {
            if (val < min)
                val = min;
            else if (val > max)
                val = max;
            return val;
        }

        function slider_load() {
            if (check.checked)
                data = limit(Math.round(Math.exp(minv + scale * slider.value)));
            else
                data = undefined;
        }

        function slider_update() {
            updating = true;
            if (data !== undefined)
                $(slider).prop("value", (Math.log(data) - minv) / scale);
            $(slider)
                .attr("disabled", data === undefined)
                .trigger("change");
            updating = false;
        }

        function text_load() {
            var val;
            if (check.checked)
                val = limit(parse($(input).val()));
            else
                val = undefined;
            if (isNaN(val))
                val = undefined;
            data = val;
        }

        function text_update() {
            updating = true;
            if (data !== undefined)
                $(input).val(format(data));
            $(input).attr("disabled", data === undefined);
            updating = false;
        }

        function check_load() {
            if (!check.checked)
                data = undefined;
        }

        function check_update() {
            updating = true;
            $(check).prop("checked", data !== undefined);
            updating = false;
        }

        /* Slider to change CPU priority */
        slider = sel.find("div.slider").
            on('change', function() {
                if (updating)
                    return;
                slider_load();
                text_update();
            })[0];

        /* Number value of CPU priority */
        input = sel.find("input.size-text-ct").
            on('change', function() {
                if (updating)
                    return;
                text_load();
                slider_update();
            })[0];

        /* Default checkbox */
        check = sel.find("input[type='checkbox']").
            on('change', function() {
                if (updating)
                    return;
                check_load();
                if (this.checked)
                    text_load();
                slider_update();
                text_update();
            })[0];

        Object.defineProperty(self, "value", {
            get: function() {
                return data;
            },
            set: function(v) {
                data = v;
                check_update();
                slider_update();
                text_update();
            }
        });

        Object.defineProperty(self, "max", {
            get: function() {
                return max;
            },
            set: function(v) {
                if (v < 0)
                    v = 0;
                max = v;
                maxv = Math.log(max);
                scale = (maxv - minv);
                if (slider)
                    slider_update();
            }
        });

        return self;
    }

    /* Memory limit slider/checkbox interaction happens here */
    util.MemorySlider = function MemorySlider(sel, min, max) {
        function parse(val) {
            return parseInt(val, 10) * 1024 * 1024;
        }

        function format(val) {
            return cockpit.format_bytes(val, "MiB", true)[0];
        }

        return new Slider(sel, min, max, parse, format);
    };

    /* CPU priority slider/checkbox interaction happens here */
    util.CpuSlider = function CpuSlider(sel, min, max) {
        function parse(val) {
            return parseInt(val, 10);
        }

        function format(val) {
            return String(val);
        }

        return new Slider(sel, min, max, parse, format);
    };

    util.docker_container_delete = function docker_container_delete(docker_client, container_id, on_success, on_failure) {
        docker_client.rm(container_id).
            fail(function(ex) {
                /* if container is still running, ask user to force delete */
                if (ex.message.indexOf('remove a running container') > -1) {
                    var container_info = docker_client.containers[container_id];
                    var msg;
                    if (container_info.State.Running) {
                        msg = _("Container is currently running.");
                    } else {
                        msg = _("Container is currently marked as not running, but regular stopping failed.") +
                            " " + _("Error message from Docker:") +
                            " '" + ex.message + "'";
                    }
                    var name;
                    if (container_info.Name)
                        name = container_info.Name;
                    else
                        name = container_id;
                    if (name.charAt(0) === '/')
                        name = name.substring(1);
                    util.confirm(cockpit.format(_("Please confirm forced deletion of $0"), name),
                                 msg,
                                 _("Force Delete")).
                        done(function () {
                            docker_client.rm(container_id, true).
                                fail(function(ex) {
                                    util.show_unexpected_error(ex);
                                    on_failure();
                                }).
                                done(on_success);
                        }).
                        fail(on_failure);
                    return;
                }
                util.show_unexpected_error(ex);
                on_failure();
            }).
            done(on_success);
    };

    /* if error message points to leftover scope, try to resolve the issue */
    util.handle_scope_start_container = function handle_scope_start_container(docker_client, container_id, error_message, on_success, on_failure) {
        var end_phrase = '.scope already exists';
        var idx_end = error_message.indexOf(end_phrase);
        /* HACK: workaround for https://github.com/docker/docker/issues/7015 */
        if (idx_end > -1) {
            var start_phrase = 'Unit docker-';
            var idx_start = error_message.indexOf(start_phrase) + start_phrase.length;
            var docker_container = error_message.substring(idx_start, idx_end);
            cockpit.spawn([ "systemctl", "stop", "docker-" + docker_container + ".scope" ], { "superuser": "try" }).
                done(function () {
                    docker_client.start(container_id).
                        fail(function(ex) {
                            if (on_failure)
                                on_failure();
                        }).
                        done(function() {
                            if (on_success)
                                on_success();
                        });
                    return;
                }).
                fail(function (error) {
                    util.show_unexpected_error(cockpit.format(_("Failed to stop Docker scope: $0"), error));
                    if (on_failure)
                        on_failure();
                });
            return;
        }
        util.show_unexpected_error(error_message);
        if (on_failure)
            on_failure();
    };

    util.show_unexpected_error = function show_unexpected_error(error) {
        $("#error-popup-message").text(error.message || error || "???");
        $('.modal[role="dialog"]').modal('hide');
        $('#error-popup').modal('show');
    };

    util.confirm = function confirm(title, body, action_text) {
        var deferred = $.Deferred();

        $('#confirmation-dialog-title').text(title);
        if (typeof body == "string")
            $('#confirmation-dialog-body').text(body);
        else
            $('#confirmation-dialog-body').html(body);
        $('#confirmation-dialog-confirm').text(action_text);

        function close() {
            $('#confirmation-dialog button').off('click');
            $('#confirmation-dialog').modal('hide');
        }

        $('#confirmation-dialog-confirm').click(function () {
            close();
            deferred.resolve();
        });

        $('#confirmation-dialog-cancel').click(function () {
            close();
            deferred.reject();
        });

        $('#confirmation-dialog').modal('show');
        return deferred.promise();
    };

    module.exports = util;
}());
