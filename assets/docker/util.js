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

define([
    "jquery",
    "base1/cockpit",
    "base1/mustache",
    "docker/docker",
    "shell/controls",
], function($, cockpit, Mustache, docker, controls) {
    var _ = cockpit.gettext;
    var C_ = cockpit.gettext;

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
        var danger_button = $('<button class="btn btn-default btn-control fa fa-check enable-danger">')
            .toggle(false)
            .on("click", callback);
        $(id + ' th.container-col-actions').append(danger_button);
        $(parent_id)[0].addEventListener("click", function(ev) {
            if ($(ev.target).parents(id).length === 0 &&
                $(id + ' button.enable-danger').hasClass('active'))
                callback();
        }, true);
    };

    util.render_container = function render_container(client, $panel,
                                                      prefix, id, container, danger_mode) {
        var tr = $("#" + prefix + id);

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
        var barvalue;

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
            var btn_play = $('<button class="btn btn-default btn-control fa fa-play">').
                on("click", function() {
                    $(this).hide().
                        siblings("div.spinner").show();
                    client.start(id).
                        fail(function(ex) {
                            util.handle_scope_start_container(client, id, ex.message);
                        });
                    return false;
                });
            var btn_stop = $('<button class="btn btn-default btn-control fa fa-stop">').
                on("click", function() {
                    $(this).hide().
                        siblings("div.spinner").show();
                    client.stop(id).
                        fail(function(ex) {
                            util.show_unexpected_error(ex);
                        });
                    return false;
                });
            tr = $('<tr id="' + prefix + id + '">').append(
                $('<td class="container-col-name">'),
                $('<td class="container-col-image">'),
                $('<td class="container-col-command">'),
                $('<td class="container-col-cpu">'),
                $('<td class="container-col-memory-graph">').append(controls.BarRow("containers-containers")),
                $('<td class="container-col-memory-text">'),
                $('<td class="container-col-danger cell-buttons">').append(btn_delete, img_waiting),
                $('<td class="container-col-actions cell-buttons">').append(btn_play, btn_stop, img_waiting.clone()));

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
    };

    /* Memory limit slider/checkbox interaction happens here */
    util.MemorySlider = function MemorySlider(sel, min, max) {
        var self = this;
        var slider, desc;
        var limit;

        function update_limit() {
            if (slider.disabled) {
                limit = undefined;
                return _("unlimited");
            }
            limit = Math.round(slider.value * max);
            if (limit < min)
                limit = min;
            return cockpit.format_bytes(limit, 1024);
        }

        /* Slider to limit amount of memory */
        slider = sel.find("div.slider").
            on('change', function() {
                $(desc).text(update_limit());
            })[0];

        /* Description of how much memory is selected */
        desc = sel.find("span")[0];

        /* Unlimited checkbox */
        var check = sel.find("input[type='checkbox']").
            on('change', function() {
                $(slider).attr("disabled", !this.checked);
                $(desc).toggleClass("disabled", !this.checked);
                $(desc).text(update_limit());
            })[0];

        Object.defineProperty(this, "value", {
            get: function() {
                return limit;
            },
            set: function(v) {
                if (v !== undefined) {
                    $(slider).
                        prop("value", v / max).
                        trigger("change");
                }
                $(check).
                    prop("checked", v !== undefined).
                    trigger("change");
            }
        });

        Object.defineProperty(this, "max", {
            get: function() {
                return max;
            },
            set: function(v) {
                var old_max = max;
                max = v;
                $(slider).
                    prop("value", (slider.value*old_max) / max).
                    trigger("change");
            }
        });

        return this;
    };

    /* CPU priority slider/checkbox interaction happens here */
    util.CpuSlider = function CpuSlider(sel, min, max) {
        var self = this;
        var slider, desc;
        var priority;

        /* Logarithmic CPU scale */
        var minv = Math.log(min);
        var maxv = Math.log(max);
        var scale = (maxv - minv);

        function update_priority() {
            if (slider.disabled)
                priority = undefined;
            else
                priority = Math.round(Math.exp(minv + scale * slider.value));
            return util.format_cpu_shares(priority);
        }

        /* Slider to change CPU priority */
        slider = sel.find("div.slider").
            on('change', function() {
                $(desc).text(update_priority());
            })[0];

        /* Description of CPU priority */
        desc = sel.find("span")[0];

        /* Default checkbox */
        var check = sel.find("input[type='checkbox']").
            on('change', function() {
                $(slider).attr("disabled", !this.checked);
                $(desc).toggleClass("disabled", !this.checked);
                $(desc).text(update_priority());
            });

        Object.defineProperty(this, "value", {
            get: function() {
                return priority;
            },
            set: function(v) {
                if (v !== undefined) {
                    $(slider).
                        prop("value", (Math.log(v) - minv) / scale).
                        trigger("change");
                }
                $(check).
                    prop("checked", v !== undefined).
                    trigger("change");
            }
        });

        return this;
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

    return util;

});
