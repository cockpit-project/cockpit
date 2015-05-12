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

define([
    "jquery",
    "base1/cockpit",
    "base1/mustache",
    "manifests",
    "shell/controls",
    "shell/shell",
    "shell/cockpit-main",
    "shell/cockpit-util",
], function($, cockpit, Mustache, manifests, controls, shell) {
"use strict";

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

function resource_debug() {
    if (window.debugging == "all" || window.debugging == "resource")
        console.debug.apply(console, arguments);
}

function docker_debug() {
    if (window.debugging == "all" || window.debugging == "docker")
        console.debug.apply(console, arguments);
}

var docker_clients = shell.util.make_resource_cache();

shell.docker = docker_client;
function docker_client() {
    return docker_clients.get("default", function () { return new DockerClient(); });
}

var docker;

if (manifests["docker"]) {
    require([
        'docker/docker'
    ], function(d) {
        docker = d;
    });
}

function quote_cmdline(cmds) {
    return docker.quote_cmdline(cmds || []);
}

function unquote_cmdline(string) {
    return docker.unquote_cmdline(string);
}

function render_container_cmdline (container) {
    // We do our own quoting in preference to using container.Command.
    // We do this for consistency, and also to avoid bugs in how
    // Docker creates container.Command.  Docker doesn't escape quote
    // characters, for example.

    if (container.Config)
        return quote_cmdline ((container.Config.Entrypoint || []).concat(container.Config.Cmd || []));
    else
        return container.Command;
}

function render_container_name (name) {
    if (name.length > 0 && name[0] == "/")
        return name.slice(1);
    else
        return name;
}

function render_container_state (state) {
    if (state.Running)
        return cockpit.format(_("Up since $StartedAt"), state);
    else
        return cockpit.format(_("Exited $ExitCode"), state);
}

function multi_line(strings) {
    return strings.map(shell.esc).join('<br/>');
}

function format_cpu_shares(priority) {
    if (!priority)
        return _("default");
    return cockpit.format(_("$0 shares"), Math.round(priority));
}

function format_cpu_usage(usage) {
    if (usage === undefined || isNaN(usage))
        return "";
    return Math.round(usage) + "%";
}

function update_memory_bar(bar, usage, limit) {
    var parts = [ usage ];
    if (limit)
        parts.push(limit);
    $(bar).
        attr("value", parts.join("/")).
        toggleClass("bar-row-danger", !!(limit && usage > 0.9 * limit));
}

function format_memory_and_limit(usage, limit) {
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
}

function insert_table_sorted(table, row) {
    insert_table_sorted_generic(table, row, function(row1, row2) {
        return row1.text().localeCompare(row2.text());
    });
}

function insert_table_sorted_generic(table, row, cmp) {
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
}

/* Memory limit slider/checkbox interaction happens here */
function MemorySlider(sel, min, max) {
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
}

/* CPU priority slider/checkbox interaction happens here */
function CpuSlider(sel, min, max) {
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
        return format_cpu_shares(priority);
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
}

function setup_for_failure(page, client) {
    var $failure = $("#containers-failure");
    var $page = $('#' + page.id);

    function show_failure(ex) {
        var msg;
        var show_start = false;

        if (typeof ex == "string") {
            msg = ex;
            console.warn(ex);
        } else if (ex.problem == "not-found") {
            msg = _("Docker is not installed or activated on the system");
            show_start = true;
        } else if (ex.problem == "access-denied") {
            msg = _("Not authorized to access Docker on this system");
        } else {
            msg = cockpit.format(_("Can't connect to Docker: $0"), ex.toString());
            console.warn(ex);
        }
        $("#containers-failure-waiting").hide();
        $("#containers-failure-message").text(msg);

        $("#containers-failure-start").toggle(show_start);
        $("#containers-failure-retry").toggle(!show_start);

        $page.children().hide();
        $failure.show();
    }

    function hide_failure() {
        $page.children().show();
        $failure.hide();
    }

    /* High level failures about the overall functionality of docker */
    $(client).on('failure.failure', function(event, ex) {
        /* This error is handled via the watchdog
         * and we don't need to show it here. */
        if (ex.problem != "disconnected")
            show_failure(ex, page);
    });

    $('#containers-failure-retry').on('click.failure', function () {
        client.close();
        client.connect().
            done(function () {
                hide_failure();
                page.show();
            });
    });

    $('#containers-failure-start').on('click.failure', function () {
        $("#containers-failure-start").hide();
        $("#containers-failure-message").text(_("Starting docker"));
        $("#containers-failure-waiting").show();
        cockpit.spawn([ "systemctl", "start", "docker" ], { "superuser": true }).
            done(function () {
                client.close();
                client.connect().
                    done(function () {
                        hide_failure();
                        page.show();
                    });
            }).
            fail(function (error) {
                show_failure(cockpit.format(_("Failed to start Docker: $0"), error));
            });
    });

    $page.prepend($failure);
    hide_failure();
    client.maybe_reconnect();
}

function unsetup_for_failure(client) {
    $(client).off('.failure');
    $('#containers-failure-start').off('.failure');
}

function docker_container_delete(docker_client, container_id, on_success, on_failure) {
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
                shell.confirm(cockpit.format(_("Please confirm forced deletion of $0"), name),
                    msg,
                    _("Force Delete")).
                    done(function () {
                        docker_client.rm(container_id, true).
                            fail(function(ex) {
                                shell.show_unexpected_error(ex);
                                on_failure();
                            }).
                            done(on_success);
                    }).
                    fail(on_failure);
                return;
            }
            shell.show_unexpected_error(ex);
            on_failure();
        }).
        done(on_success);
}

/* if error message points to leftover scope, try to resolve the issue */
function handle_scope_start_container(docker_client, container_id, error_message, on_success, on_failure) {
    var end_phrase = '.scope already exists';
    var idx_end = error_message.indexOf(end_phrase);
    /* HACK: workaround for https://github.com/docker/docker/issues/7015 */
    if (idx_end > -1) {
        var start_phrase = 'Unit docker-';
        var idx_start = error_message.indexOf(start_phrase) + start_phrase.length;
        var docker_container = error_message.substring(idx_start, idx_end);
        cockpit.spawn([ "systemctl", "stop", "docker-" + docker_container + ".scope" ], { "superuser": true }).
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
                shell.show_unexpected_error(cockpit.format(_("Failed to stop Docker scope: $0"), error));
                if (on_failure)
                    on_failure();
            });
        return;
    }
    shell.show_unexpected_error(error_message);
    if (on_failure)
        on_failure();
}

function render_container (client, $panel, filter_button, prefix, id, container, danger_mode) {
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
        cputext = format_cpu_usage(container.CpuUsage);

        memuse = container.MemoryUsage;
        memlimit = container.MemoryLimit;
        memtext = format_memory_and_limit(memuse, memlimit);

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
                docker_container_delete(client, id, function() { }, function () { $(self).show().siblings("div.spinner").hide(); });
                return false;
            });
        var btn_play = $('<button class="btn btn-default btn-control fa fa-play">').
            on("click", function() {
                $(this).hide().
                    siblings("div.spinner").show();
                client.start(id).
                    fail(function(ex) {
                        handle_scope_start_container(client, id, ex.message);
                    });
                return false;
            });
        var btn_stop = $('<button class="btn btn-default btn-control fa fa-stop">').
            on("click", function() {
                $(this).hide().
                    siblings("div.spinner").show();
                client.stop(id).
                    fail(function(ex) {
                        shell.show_unexpected_error(ex);
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
            cockpit.location.go("container-details", { id: id });
        });

        added = true;
    }

    var row = tr.children("td");
    $(row[0]).text(render_container_name(container.Name));
    $(row[1]).text(container.Image);
    $(row[2]).text(render_container_cmdline(container));
    $(row[3]).text(cputext);
    update_memory_bar($(row[4]).children("div").toggle(membar), memuse, memlimit);
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

    if (filter_button) {
        var filter = shell.select_btn_selected(filter_button);
        tr.toggleClass("unimportant", !container.State.Running);
    }

    if (added)
        insert_table_sorted($panel.find('table'), tr);
}

function setup_danger_button(id, parent_id, callback) {
    var danger_button = $('<button class="btn btn-default btn-control fa fa-check enable-danger">')
        .toggle(false)
        .on("click", callback);
    $(id + ' th.container-col-actions').append(danger_button);
    $(parent_id)[0].addEventListener("click", function(ev) {
          if ($(ev.target).parents(id).length === 0 &&
                  $(id + ' button.enable-danger').hasClass('active'))
              callback();
    }, true);
}

PageContainers.prototype = {
    _init: function() {
        this.id = "containers";
        this.danger_enabled = false;
    },

    getTitle: function() {
        return C_("page-title", "Containers");
    },

    toggle_danger: function(val) {
        var self = this;
        self.danger_enabled = val;
        $('#containers-containers button.enable-danger').toggleClass('active', self.danger_enabled);
        $("#containers-containers td.container-col-actions").toggle(!self.danger_enabled);
        $("#containers-containers td.container-col-danger").toggle(self.danger_enabled);
    },

    setup: function() {
        var self = this;
        setup_danger_button('#containers-containers', "#"+this.id,
            function() {
                self.toggle_danger(!self.danger_enabled);
            });

        this.container_filter_btn =
            shell.select_btn($.proxy(this, "filter"),
                               [ { title: _("All"),                 choice: 'all',  is_default: true },
                                 { title: _("Running"),             choice: 'running' }
                               ]);
        $('#containers-containers .panel-heading span').append(this.container_filter_btn);

        $('#containers-images-search').on("click", function() {
              PageSearchImage.display();
              return false;
          });
    },

    enter: function() {
        var self = this;

        this.client = shell.docker();

        /* TODO: This code needs to be migrated away from old dbus */
        this.dbus_client = shell.dbus(null);

        var reds = [ "#250304",
                     "#5c080c",
                     "#970911",
                     "#ce0e15",
                     "#ef2930",
                     "#f36166",
                     "#f7999c",
                     "#fbd1d2"
                   ];

        var blues = [ "#006bb4",
                      "#008ff0",
                      "#2daaff",
                      "#69c2ff",
                      "#a5daff",
                      "#e1f3ff",
                      "#00243c",
                      "#004778"
                    ];

        function highlight_container_row(event, id) {
            id = self.client.container_from_cgroup(id) || id;
            $('#containers-containers tr').removeClass('highlight');
            $('#' + id).addClass('highlight');
        }

        this.cpu_plot = this.client.setup_cgroups_plot ('#containers-cpu-graph', 4, blues.concat(blues));
        $(this.cpu_plot).on('update-total', function (event, total) {
            $('#containers-cpu-text').text(format_cpu_usage(total));
        });
        $(this.cpu_plot).on('highlight', highlight_container_row);

        this.mem_plot = this.client.setup_cgroups_plot ('#containers-mem-graph', 0, blues.concat(blues));
        $(this.mem_plot).on('update-total', function (event, total) {
            $('#containers-mem-text').text(cockpit.format_bytes(total, 1024));
        });
        $(this.mem_plot).on('highlight', highlight_container_row);

        $('#containers-containers table tbody tr').remove();
        $('#containers-images table tbody tr').remove();

        /* Every time a container appears, disappears, changes */
        $(this.client).on('container.containers', function(event, id, container) {
            self.render_container(id, container);
        });

        /* Every time a image appears, disappears, changes */
        $(this.client).on('image.containers', function(event, id, image) {
            self.render_image(id, image);
        });

        var id;
        $("#containers-containers button.enable-danger").toggle(false);
        for (id in this.client.containers) {
            this.render_container(id, this.client.containers[id]);
        }

        for (id in this.client.images) {
            this.render_image(id, this.client.images[id]);
        }

        setup_for_failure(self, self.client, self.address);

        // Render storage, throttle update on events
        self.render_storage();
        $(this.client).on('event.containers', this.throttled_render_storage());
    },

    show: function() {
        this.cpu_plot.start();
        this.mem_plot.start();
    },

    leave: function() {
        unsetup_for_failure(this.client);

        this.dbus_client.release();
        this.dbus_client = null;

        this.cpu_plot.destroy();
        this.mem_plot.destroy();
        $(this.client).off('.containers');
        this.client.release();
        this.client = null;
    },

    throttled_render_storage: function () {
        var self = this;
        var timer = null;
        var missed = false;

        var throttle = function() {
          if (!timer) {
            self.render_storage();
            timer = window.setTimeout(function () {
                var need_call = missed;
                missed = false;
                timer = null;
                if (need_call && self.client)
                    throttle();

            }, 10000);
          } else {
            missed = true;
          }
        };

        return throttle;
     },

    render_storage: function () {
        this.client.info().done(function(data) {
            var resp = data && JSON.parse(data);
            if (resp['Driver'] !== "devicemapper") {
                // TODO: None of the other graphdrivers currently
                // report size information.
                $('#containers-storage .bar').html();
                $('#containers-storage .data').html("Unknown");
            }

            var used;
            var total;
            var avail;
            $.each(resp['DriverStatus'], function (index, value) {
                if (value && value[0] == "Data Space Total")
                    total = value[1];
                else if (value && value[0] == "Data Space Used")
                    used = value[1];
                else if (value && value[0] == "Data Space Available")
                    avail = value[1];
            });

            if (used && total && docker) {

              var b_used = docker.bytes_from_format(used);
              var b_total = docker.bytes_from_format(total);

              // Prefer available if present as that will be accurate for
              // sparse file based devices
              if (avail) {
                  $('#containers-storage').tooltip('destroy');
                  b_total = docker.bytes_from_format(avail);
                  total = cockpit.format_bytes(b_used + b_total);
              } else {
                  var warning = _("WARNING: Docker may be reporting the size it has allocated to it's storage pool using sparse files, not the actual space available to the underlying storage device.");
                  $('#containers-storage').tooltip({ title : warning });
              }

              var formated = used + " / " + total;
              var bar_row = controls.BarRow();
              bar_row.attr("value", b_used + "/" + b_total);
              bar_row.toggleClass("bar-row-danger", used > 0.95 * total);

              $('#containers-storage .bar').html(bar_row);
              $('#containers-storage .data').html(formated);
            } else {
              $('#containers-storage .bar').html();
              $('#containers-storage .data').html("Unknown");
            }
        });
    },

    render_container: function(id, container) {
        render_container(this.client, $('#containers-containers'), this.container_filter_btn,
                         "", id, container, this.danger_enabled);
    },

    render_image: function(id, image) {
        var self = this;
        var tr = $("#" + id);

        if (!image ||
            !image.RepoTags ||
            image.RepoTags[0] == "<none>:<none>") {
            tr.remove();
            return;
        }

        var added = false;
        if (!tr.length) {
            var button = $('<button class="btn btn-default btn-control fa fa-play">').
                on("click", function() {
                    PageRunImage.display(self.client, id);
                    return false;
                });
            tr = $('<tr id="' + id + '">').append(
                    $('<td class="image-col-tags">'),
                    $('<td class="image-col-created">'),
                    $('<td class="image-col-size-graph">'),
                    $('<td class="image-col-size-text">'),
                    $('<td class="cell-buttons">').append(button));
            tr.on('click', function(event) {
                cockpit.location.go('image-details', { id: id });
            });

            added = true;
        }

        var row = tr.children("td");
        $(row[0]).html(multi_line(image.RepoTags));

        /* if an image is older than two days, don't show the time */
        var threshold_date = new Date(image.Created * 1000);
        threshold_date.setDate(threshold_date.getDate() + 2);

        if (threshold_date > (new Date())) {
            $(row[1]).text(new Date(image.Created * 1000).toLocaleString());
        } else {
            var creation_date = new Date(image.Created * 1000);

            /* we hide the time, so put full timestamp in the hover text */
            $(row[1])
                .text(creation_date.toLocaleDateString())
                .attr("title", creation_date.toLocaleString());
        }

        $(row[2]).children("div").attr("value", image.VirtualSize);
        $(row[3]).text(cockpit.format_bytes(image.VirtualSize, 1024));

        if (added) {
            insert_table_sorted($('#containers-images table'), tr);
        }
    },

    filter: function() {
        var filter = shell.select_btn_selected(this.container_filter_btn);
        $("#containers-containers table").toggleClass("filter-unimportant", filter === "running");
    }

};

function PageContainers() {
    this._init();
}

shell.pages.push(new PageContainers());

PageRunImage.prototype = {
    _init: function() {
        this.error_timeout = null;
        this.id = "containers_run_image_dialog";
    },

    show: function() {
    },

    leave: function() {
        this.containers = null;
    },


    setup: function() {
        $("#containers-run-image-run").on('click', $.proxy(this, "run"));
        $('#containers-run-image-command').on('keydown', $.proxy(this, "update", "keydown", "command"));
        $('#containers-run-image-command').on('input', $.proxy(this, "update", "input", "command"));
        $('#containers-run-image-command').on('focusout change', $.proxy(this, "update", "changeFocus", "command"));

        this.memory_slider = new MemorySlider($("#containers-run-image-memory"),
                                              10*1024*1024, 2*1024*1024*1024);
        this.cpu_slider = new CpuSlider($("#containers-run-image-cpu"), 2, 1000000);

        var table = $('#containers_run_image_dialog .modal-body table');

        var port_renderer = this.port_renderer();
        var self = this;
        $('#expose-ports').on('change', function() {
            var items = $('#select-exposed-ports');
            if ($(this).prop('checked')) {
                if (items.children().length === 0) {
                    port_renderer();
                }
                items.show();
            }
            else {
                items.hide();
            }
            self.update('changeFocus', 'ports');
        });

        var renderer = this.link_renderer();
        $("#link-containers").change(function() {
            var items = $('#select-linked-containers');
            if ($(this).prop('checked')) {
                if (items.children().length === 0 ) {
                    renderer();
                }
                items.show();
            } else {
                items.hide();
            }
            self.update('changeFocus', 'links');
        });

        this.validator = this.configuration_validator();
    },

    update: function(behavior, section) {
        if ((this.perform_checks !== true) && (behavior !== 'clear'))
            return;
        this.validator(behavior, section);
    },

    enter: function() {
        var page = this;

        var info = PageRunImage.image_info;
        docker_debug("run-image", info);

        var checked;
        var value;

        PageRunImage.client.machine_info().
            done(function (info) {
                page.memory_slider.max = info.memory;
            });

        page.containers = [];
        var id;
        for (id in PageRunImage.client.containers) {
            page.containers.push(
                render_container_name(
                  PageRunImage.client.containers[id].Name
                )
            );
        }

        this.perform_checks = false;

        /* make sure errors are cleared */
        this.update('clear');

        $('#select-linked-containers').empty();
        $("#link-containers").prop("checked", false);

        /* Memory slider defaults */
        if (info.container_config.Memory) {
            this.memory_slider.value = info.config_container.Memory;
        } else {
            /* First call sets the position of slider */
            this.memory_slider.value = 512*1024*1024;
            this.memory_slider.value = undefined;
        }

        /* CPU slider defaults */
        if (info.container_config.CpuShares) {
            this.cpu_slider.value = info.container_config.CpuShares;
        } else {
            this.cpu_slider.value = 1024;
            this.cpu_slider.value = undefined;
        }

        // from https://github.com/dotcloud/docker/blob/master/pkg/namesgenerator/names-generator.go

        var left = [ "happy", "jolly", "dreamy", "sad", "angry", "pensive", "focused", "sleepy", "grave", "distracted", "determined", "stoic", "stupefied", "sharp", "agitated", "cocky", "tender", "goofy", "furious", "desperate", "hopeful", "compassionate", "silly", "lonely", "condescending", "naughty", "kickass", "drunk", "boring", "nostalgic", "ecstatic", "insane", "cranky", "mad", "jovial", "sick", "hungry", "thirsty", "elegant", "backstabbing", "clever", "trusting", "loving", "suspicious", "berserk", "high", "romantic", "prickly", "evil" ];

        var right = [ "lovelace", "franklin", "tesla", "einstein", "bohr", "davinci", "pasteur", "nobel", "curie", "darwin", "turing", "ritchie", "torvalds", "pike", "thompson", "wozniak", "galileo", "euclid", "newton", "fermat", "archimedes", "poincare", "heisenberg", "feynman", "hawking", "fermi", "pare", "mccarthy", "engelbart", "babbage", "albattani", "ptolemy", "bell", "wright", "lumiere", "morse", "mclean", "brown", "bardeen", "brattain", "shockley" ];

        function make_name() {
            function ranchoice(array) {
                return array[Math.round(Math.random() * (array.length-1))];
            }
            return ranchoice(left) + "_" + ranchoice(right);
        }

        $("#containers-run-image").text(PageRunImage.image_info.RepoTags[0]);
        $("#containers-run-image-name").val(make_name());
        var command_input = $("#containers-run-image-command");
        command_input.val(quote_cmdline(PageRunImage.image_info.config.Cmd));

        /* delete any old port mapping entries */
        var portmapping = $('#select-exposed-ports');
        portmapping.empty();

        /* show ports exposed by container image */
        var port_renderer = this.port_renderer();
        for (var p in PageRunImage.image_info.config.ExposedPorts)
            port_renderer(parseInt(p), p.slice(-3), false);

        if (portmapping.children().length > 0) {
            $('#expose-ports').prop('checked', true);
            /* make sure the ports are visible */
            portmapping.show();
        } else {
            $('#expose-ports').prop('checked', false);
        }
    },

    configuration_validator: function() {
        var self = this;

        function check_entries_valid() {
            /* disable run button if there are any errors on the page */
            $('#containers-run-image-run').prop('disabled',
                $('#containers_run_image_dialog').find('.has-error').length > 0);
        }

        function help_item_for_control(control, help_index) {
            if (help_index === undefined)
                return $(control.closest('.form-inline').find('.help-block'));
            else
                return $(control.closest('.form-inline').find('.help-block')[help_index]);
        }

        function message_prefix(help_index) {
            if (help_index === undefined)
                return "";
            else if (help_index === 0)
                return _("Container") + ": ";
            else
                return _("Host") + ": ";
        }

        function show_port_message(port, message_type, message, help_index) {
            port.parent().addClass(message_type);
            var help_item = help_item_for_control(port, help_index);
            help_item.text(message_prefix(help_index) + message);
            var err_item = help_item.parent();
            err_item.addClass(message_type);
            err_item.show();
        }

        function clear_control_error(control, help_index) {
            control.parent().removeClass('has-error');
            var err_item = help_item_for_control(control, help_index).parent();
            err_item.removeClass('has-error');
            err_item.hide();
        }

        /* check all exposed ports for duplicate port entries, invalid port numbers and empty fields */
        function check_port(ports, protocols, port_index, help_index) {
            var exposed_port = ports[port_index];
            var port_value = exposed_port.val();

            clear_control_error(exposed_port, help_index);

            /* skip if empty */
            if (port_value === "")
                return;

            /* check for invalid port number */
            if (/\D/.test(port_value) || (port_value < 0) || (port_value > 65535)) {
                show_port_message(exposed_port, 'has-error', _("Invalid port"), help_index);
                return;
            }

            /* check for duplicate entries */
            for (var i = 0; i < ports.length; ++i) {
                if (i === port_index)
                    continue;
                var second_port = ports[i];
                if ((port_value === second_port.val()) && (protocols[port_index] === protocols[i])) {
                    show_port_message(exposed_port, 'has-error', _("Duplicate port"), help_index);
                    return;
                }
            }
        }

        function clear_port_errors() {
            $('#select-exposed-ports').children('form').each(function() {
                var element = $(this);
                var input_ports = element.find('input');
                input_ports = [ $(input_ports[0]),  $(input_ports[1]) ];
                clear_control_error(input_ports[0], 0);
                clear_control_error(input_ports[1], 1);
            });
        }


        function check_ports() {
            /* if #expose-ports isn't checked, then don't check for errors - but make sure errors are cleared */
            if (!$('#expose-ports').prop('checked')) {
                clear_port_errors();
                check_entries_valid();
                return;
            }

            var exposed_ports = { 'container': [], 'host': [], 'protocol': [] };
            /* gather all ports */
            $('#select-exposed-ports').children('form').each(function() {
                var element = $(this);
                var input_ports = element.find('input');
                input_ports = [ $(input_ports[0]),  $(input_ports[1]) ];
                if ((input_ports[0].val() !== "") || (input_ports[1].val() !== "")) {
                    exposed_ports.container.push(input_ports[0]);
                    exposed_ports.host.push(input_ports[1]);
                    exposed_ports.protocol.push(element.find('select').val().toLowerCase());
                } else {
                    /* if they are empty, make sure they are both cleared of errors */
                    clear_control_error(input_ports[0], 0);
                    clear_control_error(input_ports[1], 1);
                }
            });

            /* check ports */
            for (var port_index = 0; port_index < exposed_ports.container.length; ++port_index) {
                check_port(exposed_ports.container, exposed_ports.protocol, port_index, 0);
                check_port(exposed_ports.host, exposed_ports.protocol, port_index, 1);
            }

            /* update run status */
            check_entries_valid();
        }

        function clear_command_error() {
            $('#containers-run-image-command-note').hide();
            $('#containers-run-image-command').parent().removeClass('has-error');
        }

        function check_command() {
            /* if command is empty, show error */
            if ($('#containers-run-image-command').val() === "") {
                $('#containers-run-image-command-note').show();
                $('#containers-run-image-command').parent().addClass('has-error');
            } else {
                clear_command_error();
            }

            /* update run status */
            check_entries_valid();
        }

        function show_link_message(control, message_type, message, help_index) {
            control.parent().addClass(message_type);
            var help_item = help_item_for_control(control, help_index);
            help_item.text(message);
            var err_item = help_item.parent();
            err_item.addClass(message_type);
            err_item.show();
        }

        function check_alias(aliases, alias_index ) {
            var alias = aliases[alias_index];
            var alias_value = alias.val();

            clear_control_error(alias, 1);

            /* check for empty field */
            if (alias_value === "") {
                /* still valid if empty */
                show_link_message(alias, 'has-error', _("No alias specified"), 1);
                return;
            }

            /* check for duplicate entries */
            for (var i = 0; i < aliases.length; ++i) {
                if (i === alias_index)
                    continue;
                var second_alias = aliases[i];
                if ((alias_value === second_alias.val())) {
                    show_link_message(alias, 'has-error', _("Duplicate alias"), 1);
                    return;
                }
            }
        }

        function clear_link_errors() {
            $('#select-linked-containers').children('form').each(function() {
                var element = $(this);
                var container = element.find('select');
                var alias = element.find('input[name="alias"]');

                clear_control_error(container, 0);
                clear_control_error(alias, 1);
            });
        }

        function check_links() {
            /* if #link-containers isn't checked, then don't check for errors - but make sure errors are cleared */
            if (!$('#link-containers').prop('checked')) {
                clear_link_errors();
                check_entries_valid();
                return;
            }

            var aliases = [];
            var containers = [];
            /* gather all aliases */
            $('#select-linked-containers').children('form').each(function() {
                var element = $(this);
                var container = element.find('select');
                var alias = element.find('input[name="alias"]');

                if ((alias.val() !== "") || (container.val() !== "")) {
                    if (container.val() === "")
                        show_link_message(container, 'has-error', _("No container specified"), 0);
                    else
                        clear_control_error(container, 0);
                    aliases.push(alias);
                } else {
                    /* if they are empty, make sure all errors are cleared */
                    clear_control_error(container, 0);
                    clear_control_error(alias, 1);
                }
            });

            /* check aliases */
            for (var alias_index = 0; alias_index < aliases.length; ++alias_index)
                check_alias(aliases, alias_index);

            /* update run status */
            check_entries_valid();
        }

        /*
         * validation functionality for the run image dialog
         *
         * error:
         *   - a port is used more than once (same port/protocol exposed on container, same port/protocol used on host)
         *   - a port number is invalid
         *   - an alias for a linked container is used more than once
         *   - a linked container has no alias or an alias is given for no link
         *
         * any errors will result in a disabled 'run' button
         */
        function update(behavior, section) {
            /* while typing, delay check */
            window.clearTimeout(self.error_timeout);
            self.error_timeout = null;

            if (behavior === "clear") {
                clear_command_error();
                clear_port_errors();
                clear_link_errors();

                /* update run status */
                check_entries_valid();
            } else if (behavior === "all") {
                check_command();
                check_ports();
                check_links();
            } else if ((behavior === "changeFocus") || (behavior === "changeOption")) {
                if (section === "command")
                    check_command();
                else if (section === "ports")
                    check_ports();
                else if (section === "links")
                    check_links();
            } else if ((behavior === "input") || (behavior === "keydown")) {
                if (section === "command")
                    self.error_timeout = window.setTimeout(check_command, 2000);
                else if (section === "ports")
                    self.error_timeout = window.setTimeout(check_ports, 2000);
                else if (section === "links")
                    self.error_timeout = window.setTimeout(check_links, 2000);
                self.setTimeout = null;
            }
        }

        return update;
    },

    port_renderer: function() {
        var self = this;
        var template = $("#port-expose-tmpl").html();
        Mustache.parse(template);

        function add_row() {
            render();
        }

        function remove_row(e) {
            var parent = $(e.target).closest("form");
            parent.remove();
            if ($('#select-exposed-ports').children().length === 0 ) {
                $("#expose-ports").attr("checked", false);
            }
            /* update run button, this may have removed an error */
            self.validator("changeFocus", "ports");
        }

        function render(port_internal, port_protocol, port_internal_editable) {
            if (port_internal === undefined)
                port_internal = '';
            if (port_protocol === undefined)
                port_protocol = 'TCP';
            if (port_internal_editable === undefined)
                port_internal_editable = true;

            var row = $(Mustache.render(template, {
                host_port_label: _('to host port'),
                placeholder: _('none')
            }));
            row.children("button.fa-plus").on('click', add_row);
            if (port_internal_editable) {
                row.children("button.pficon-close").on('click', remove_row);
            } else {
                row.children("button.pficon-close").attr('disabled', true);
            }

            var row_container_input = row.find('input[name="container"]');
            row_container_input.val(port_internal);
            if (port_internal_editable) {
                row_container_input.on('keydown', $.proxy(self, "update", "keydown", "ports"));
                row_container_input.on('input', $.proxy(self, "update", "input", "ports"));
                row_container_input.on('focusout change', $.proxy(self, "update", "changeFocus", "ports"));
            } else {
                row_container_input.attr('disabled', true);
            }

            var row_host_input = row.find('input[name="host"]');
            row_host_input.on('keydown', $.proxy(self, "update", "keydown", "ports"));
            row_host_input.on('input', $.proxy(self, "update", "input", "ports"));
            row_host_input.on('focusout change', $.proxy(self, "update", "changeFocus", "ports"));

            var protocol_select = row.find("div select.selectpicker");
            if (port_internal_editable) {
                protocol_select.on('change', $.proxy(self, "update", "changeOption", "ports"));
            } else {
                protocol_select.attr('disabled', true);
            }

            protocol_select.selectpicker('refresh');
            if (port_protocol.toUpperCase() === _("UDP"))
                protocol_select.selectpicker('val', _("UDP"));
            else
                protocol_select.selectpicker('val', _("TCP"));

            $("#select-exposed-ports").append(row);
        }

        return render;
    },

    link_renderer: function() {
        var self = this;
        var template = $("#container-link-tmpl").html();
        Mustache.parse(template);

        function add_row() {
            render();
        }

        function remove_row(e) {
            var parent = $(e.target).closest("form");
            parent.remove();
            if ($('#select-linked-containers').children().length === 0 ) {
                $("#link-containers").attr("checked", false);
            }

            /* update run button, this may have removed an error */
            self.update("changeFocus", "links");
        }

        function render() {
          var row = $(Mustache.render(template, {
              containers: self.containers,
              alias_label: _('alias'),
              placeholder: _('none')
          }));
          row.children("button.fa-plus").on('click', add_row);
          row.children("button.pficon-close").on('click', remove_row);
          var row_input = row.find('input');
          row_input.on('keydown', $.proxy(self, "update", "keydown", "links"));
          row_input.on('input', $.proxy(self, "update", "input", "links"));
          row_input.on('focusout change', $.proxy(self, "update", "changeFocus", "links"));
          var container_select = row.find("div select.selectpicker");
          container_select.on('change', $.proxy(self, "update", "changeOption", "links"));
          container_select.selectpicker('refresh');
          $("#select-linked-containers").append(row);
        }

        return render;
    },

    run: function() {
        this.perform_checks = true;
        /* validate input, abort on error */
        this.update('all');
        if ($('#containers-run-image-run').prop('disabled'))
            return;
        var name = $("#containers-run-image-name").val();
        var cmd = $("#containers-run-image-command").val();
        var port_bindings = { };
        var p, mapping;
        var map_from, map_to, map_protocol;
        var links = [];
        var exposed_ports = { };
        if ($('#expose-ports').prop('checked')) {
            $('#select-exposed-ports').children('form').each(function() {
                var input_ports = $(this).find('input').map(function(idx, elem) {
                        return $(elem).val();
                    }).get();
                map_from = input_ports[0];
                map_to = input_ports[1];
                map_protocol = $(this).find('select').val().toLowerCase();

                if (map_from === '' || map_to === '')
                    return;

                port_bindings[map_from + '/' + map_protocol] = [ { "HostPort": map_to } ];
                exposed_ports[map_from + '/' + map_protocol] = { };
            });
        }

        if ($("#link-containers").prop('checked')) {
          $("#select-linked-containers form").each(function() {
              var element = $(this);
              var container = element.find('select[name="container"]').val();
              var alias = element.find('input[name="alias"]').val();
              if (!container || !alias) {
                  return;
              }
              links.push(container + ':' + alias);
          });
        }

        $("#containers_run_image_dialog").modal('hide');

        var tty = $("#containers-run-image-with-terminal").prop('checked');
        var options = {
            "Cmd": unquote_cmdline(cmd),
            "Image": PageRunImage.image_info.id,
            "Memory": this.memory_slider.value || 0,
            "MemorySwap": (this.memory_slider.value * 2) || 0,
            "CpuShares": this.cpu_slider.value || 0,
            "Tty": tty,
            "ExposedPorts": exposed_ports,
            "HostConfig": {
                "Links": links
            }
        };

        if (tty) {
            $.extend(options, {
                "AttachStderr": true,
                "AttachStdin": true,
                "AttachStdout": true,
                "OpenStdin": true,
                "StdinOnce": true
            });
        }

        PageRunImage.client.create(name, options).
            fail(function(ex) {
                shell.show_unexpected_error(ex);
            }).
            done(function(result) {
                PageRunImage.client.start(result.Id, { "PortBindings": port_bindings }).
                    fail(function(ex) {
                        shell.show_unexpected_error(ex);
                    });
            });
    }
};

PageRunImage.display = function(client, id) {
    PageRunImage.image_info = client.images[id];
    PageRunImage.client = client;
    $("#containers_run_image_dialog").modal('show');
};

function PageRunImage() {
    this._init();
}

shell.dialogs.push(new PageRunImage());

PageSearchImage.prototype = {
    _init: function() {
        this.id = "containers-search-image-dialog";
    },

    show: function() {
        $('#containers-search-image-search').focus();
    },

    leave: function() {
        this.cancel_search();

        $(this.client).off('.containers-search-image-dialog');
        this.client.release();
        this.client = null;
    },

    setup: function() {
        $("#containers-search-image-search").on('keypress', $.proxy(this, "input"));
        $("#containers-search-image-search").attr( "placeholder", "search by name, namespace or description" );
        $("#containers-search-download").on('click', $.proxy(this, 'start_download'));
        $('#containers-search-tag').prop('disabled', true);
        $('#containers-search-download').prop('disabled', true);
        this.search_timeout = null;
        this.search_request = null;
    },

    enter: function() {
        this.client = shell.docker();

        // Clear the previous results and search string from previous time
        $('#containers-search-image-results tbody tr').remove();
        $('#containers-search-image-results').hide();
        $('#containers-search-image-no-results').hide();
        $('#containers-search-image-search')[0].value = '';
    },

    input: function(event) {
        this.cancel_search();

        // Only handle if the new value is at least 3 characters long or return was pressed
        if(event.target.value.length < 3 && event.which != 13)
            return;

        var self = this;

        this.search_timeout = window.setTimeout(function() {
            self.perform_search(self.client);
        }, event.which == 13 ? 0 : 2000);
    },

    start_download: function(event) {
        var repo = $('#containers-search-download').data('repo');
        var registry = $('#containers-search-download').data('registry') || undefined;
        var tag = $('#containers-search-tag').val();

        $('#containers-search-tag').prop('disabled', true);
        $('#containers-search-download').data('repo', '');
        $('#containers-search-download').prop('disabled', true);

        var tr = $('<tr id="imagedl_' + repo.replace("/", "_") + '">').append(
            $('<td class="container-col-tags">').text(repo + ':' + tag),
            $('<td class="container-col-created">').text('Downloading'),
            $('<td class="image-col-size-graph">').append(
                $('<div class="progress progress-striped active">').append(
                $('<div class="progress-bar" role="progressbar" aria-valuenow="1" aria-valuemin="0" aria-valuemax="1" style="width: 100%">'))),
            $('<td class="image-col-size-text">'),
            $('<td class="cell-buttons">'));

        insert_table_sorted($('#containers-images table'), tr);

        var created = tr.children('td.container-col-created');
        var size = tr.children('td.image-col-size-text');

        var failed = false;
        var layers = {};

        docker.pull(repo, tag, registry).
            progress(function(message, progress) {
                if("id" in progress) {
                    var new_string = progress['status'];
                    if(progress['status'] == 'Downloading') {
                        new_string += ': ' + progress['progressDetail']['current'] + '/' + progress['progressDetail']['total'];
                    }
                    layers[progress['id']] = new_string;
                    if(progress['status'] == 'Download complete') {
                        // We probably don't care anymore about completed layers
                        // This also keeps the size of the row to a minimum
                        delete layers[progress['id']];
                    }
                }
                var full_status = '';
                for(var layer in layers) {
                    full_status += layer + ': ' + layers[layer] + '&nbsp;&nbsp;&nbsp;&nbsp;';
                }
                size.html(full_status);
            }).
            fail(function(ex) {
                console.warn("pull failed:", ex);
                failed = true;
                created.text(_('Error downloading'));
                size.text(ex.message).attr('title', ex.message);
                tr.on('click', function() {
                    // Make the row be gone when clicking it
                    tr.remove();
                });
            }).
            always(function() {
                // According to Docker, download was finished.
                if(!failed)
                    tr.remove();
            });

        $("#containers-search-image-dialog").modal('hide');
    },

    perform_search: function(client) {
        var term = $('#containers-search-image-search')[0].value;

        $('#containers-search-image-waiting').addClass('spinner');
        $('#containers-search-image-no-results').hide();
        $('#containers-search-image-results').hide();
        $('#containers-search-image-results tbody tr').remove();
        this.search_request = client.search(term).
          done(function(data) {
              var resp = data && JSON.parse(data);
              $('#containers-search-image-waiting').removeClass('spinner');

              if(resp && resp.length > 0) {
                  $('#containers-search-image-results').show();
                  resp.forEach(function(entry) {
                      var row = $('<tr>').append(
                                    $('<td>').text(entry.name),
                                    $('<td>').text(entry.description));
                      row.on('click', function(event) {
                          // Remove the active class from all other rows
                          $('#containers-search-image-results tr').each(function(){
                              $(this).removeClass('active');
                          });

                          row.addClass('active');
                          $('#containers-search-tag').val('latest');
                          $('#containers-search-tag').prop('disabled', false);
                          $('#containers-search-download').data('repo', entry.name);
                          $('#containers-search-download').data('registry', entry.registry_name);
                          $('#containers-search-download').prop('disabled', false);
                      });
                      row.data('entry', entry);

                      insert_table_sorted_generic($('#containers-search-image-results'), row, function(row1, row2) {
                          //Bigger than 0 means row1 after row2
                          //Smaller than 0 means row1 before row2
                          if (row1.data('entry').is_official && !row2.data('entry').is_official)
                              return -1;
                          if (!row1.data('entry').is_official && row2.data('entry').is_official)
                              return 1;
                          if (row1.data('entry').is_trusted && !row2.data('entry').is_trusted)
                              return -1;
                          if (!row1.data('entry').is_trusted && row2.data('entry').is_trusted)
                              return 1;
                          if (row1.data('entry').star_count != row2.data('entry').star_count)
                              return row2.data('entry').star_count - row1.data('entry').star_count;
                          return row1.data('entry').name.localeCompare(row2.data('entry').name);
                      });
                  });
              } else {
                  // No results
                  $('#containers-search-image-no-results').html('No results for ' + term + "<br />Please try another term");
                  $('#containers-search-image-no-results').show();
              }
          });
    },

    cancel_search: function() {
        window.clearTimeout(this.search_timeout);
        $('#containers-search-image-no-results').hide();
        $('#containers-search-image-results').hide();
        $('#containers-search-image-results tbody tr').remove();
        if (this.search_request !== null) {
            this.search_request.close();
            this.search_request = null;
        }
        $('#containers-search-image-waiting').removeClass('waiting');

        $('#containers-search-tag').prop('disabled', true);
        $('#containers-search-download').prop('disabled', true);
    }
};

PageSearchImage.display = function(client) {
    $("#containers-search-image-dialog").modal('show');
};

function PageSearchImage() {
    this._init();
}

shell.dialogs.push(new PageSearchImage());

PageContainerDetails.prototype = {
    _init: function() {
        this.id = "container-details";
        this.section_id = "containers";
        this.terminal = null;
    },

    getTitle: function() {
        return C_("page-title", "Containers");
    },

    show: function() {
    },

    leave: function() {
        unsetup_for_failure(this.client);

        this.dbus_client.release();
        this.dbus_client = null;

        $(this.client).off('.container-details');
        this.client.release();
        this.client = null;

        if (this.terminal) {
            this.terminal.close();
            this.terminal = null;
        }
        $("#container-terminal").hide();
    },

    setup: function() {
        var self = this;

        $('#container-details-start').on('click', $.proxy(this, "start_container"));
        $('#container-details-stop').on('click', $.proxy(this, "stop_container"));
        $('#container-details-restart').on('click', $.proxy(this, "restart_container"));
        $('#container-details-delete').on('click', $.proxy(this, "delete_container"));

        self.memory_limit = new MemorySlider($("#container-resources-dialog .memory-slider"),
                                             10*1024*1024, 2*1024*1024*1024);
        self.cpu_priority = new CpuSlider($("#container-resources-dialog .cpu-slider"),
                                          2, 1000000);

        self.memory_usage = $('#container-details-memory .bar-row');
        $('#container-resources-dialog').
            on("show.bs.modal", function() {
                var info = self.client.containers[self.container_id];

                /* Fill in the resource dialog */
                $(this).find(".container-name").text(self.name);
                self.memory_limit.value = info.MemoryLimit || undefined;
                self.cpu_priority.value = info.CpuPriority || undefined;
            }).
            find(".btn-primary").on("click", function() {
                self.client.change_memory_limit(self.container_id, self.memory_limit.value);
                var swap = self.memory_limit.value;
                if (!isNaN(swap))
                    swap *= 2;
                self.client.change_swap_limit(self.container_id, swap);
                self.client.change_cpu_priority(self.container_id, self.cpu_priority.value);
            });
    },

    enter: function() {
        var self = this;

        var commit = $('#container-commit-dialog')[0];
        $(commit).
            on("show.bs.modal", function() {
                var info = self.client.containers[self.container_id];

                $(commit).find(".container-name").text(self.name);

                var image = self.client.images[info.Config.Image];
                var repo = "";
                if (image && image.RepoTags)
                    repo = image.RepoTags[0].split(":", 1)[0];
                $(commit).find(".container-repository").attr('value', repo);

                $(commit).find(".container-tag").attr('value', "");

                var author = cockpit.user["name"] || cockpit.user["user"];
                $(commit).find(".container-author").attr('value', author);

                var command = "";
                if (info.Config)
                    command = quote_cmdline(info.Config.Cmd);
                if (!command)
                    command = info.Command;
                $(commit).find(".container-command").attr('value', command);
            }).
            find(".btn-primary").on("click", function() {
                var location = cockpit.location;
                var run = { "Cmd": unquote_cmdline($(commit).find(".container-command").val()) };
                var options = {
                    "author": $(commit).find(".container-author").val()
                };
                var tag = $(commit).find(".container-tag").val();
                if (tag)
                    options["tag"] = tag;
                var repository = $(commit).find(".container-repository").val();
                self.client.commit(self.container_id, repository, options, run).
                    fail(function(ex) {
                        shell.show_unexpected_error(ex);
                    }).
                    done(function() {
                        location.go("containers");
                    });
            });

        this.client = shell.docker();
        this.container_id = shell.get_page_param('id');
        this.name = this.container_id.slice(0,12);

        this.client.machine_info().
            done(function(info) {
                self.memory_limit.max = info.memory;
            });

        /* TODO: This code needs to be migrated away from old dbus */
        this.dbus_client = shell.dbus(null);

        $(this.client).on('container.container-details', function (event, id, container) {
            if (id == self.container_id)
                self.update();
        });

        setup_for_failure(this, this.client, null);
        this.update();
    },

    maybe_show_terminal: function(info) {
        if (!this.terminal) {
            this.terminal = docker.console(this.container_id, info.Config.Tty);
            $("#container-terminal").empty().append(this.terminal);
        }
        if (this.terminal.connected)
            this.terminal.typeable(info.State.Running);
        $("#container-terminal").show();
    },

    maybe_reconnect_terminal: function() {
        if (this.terminal && !this.terminal.connected) {
            this.terminal.connect();
            this.terminal.typeable(true);
        }
    },

    add_bindings: function(bindings, config) {
        for (var p in config) {
            var h = config[p];
            if (!h)
                continue;
            for (var i = 0; i < h.length; i++) {
                var host_ip = h[i].HostIp;
                if (host_ip === '')
                    host_ip = '0.0.0.0';
                var desc = cockpit.format(_("${hip}:${hport} -> $cport"),
                                          { hip: host_ip,
                                           hport: h[i].HostPort,
                                           cport: p
                                          });
                /* make sure we don't push anything we already have */
                if (bindings.indexOf(desc) === -1)
                    bindings.push(desc);
            }
        }
        return bindings;
    },

    update: function() {
        $('#container-details-names').text("");
        $('#container-details-id').text("");
        $('#container-details-created').text("");
        $('#container-details-image').text("");
        $('#container-details-command').text("");
        $('#container-details-state').text("");
        $('#container-details-ports-row').hide();
        $('#container-details-links-row').hide();
        $('#container-details-resource-row').hide();

        var info = this.client.containers[this.container_id];
        docker_debug("container-details", this.container_id, info);

        if (!info) {
            $('#container-details-names').text(_("Not found"));
            return;
        }

        var waiting = !!(this.client.waiting[this.container_id]);
        $('#container-details div.spinner').toggle(waiting);
        $('#container-details button').toggle(!waiting);
        $('#container-details-start').prop('disabled', info.State.Running);
        $('#container-details-stop').prop('disabled', !info.State.Running);
        $('#container-details-restart').prop('disabled', !info.State.Running);
        $('#container-details-commit').prop('disabled', !!info.State.Running);
        $('#container-details-memory-row').toggle(!!info.State.Running);
        $('#container-details-cpu-row').toggle(!!info.State.Running);
        $('#container-details-resource-row').toggle(!!info.State.Running);

        this.name = render_container_name(info.Name);
        $('#container-details .breadcrumb .active').text(this.name);

        var port_bindings = [ ];
        if (info.NetworkSettings)
            this.add_bindings(port_bindings, info.NetworkSettings.Ports);
        if (info.HostConfig)
            this.add_bindings(port_bindings, info.HostConfig.PortBindings);

        $('#container-details-id').text(info.ID);
        $('#container-details-names').text(render_container_name(info.Name));
        $('#container-details-created').text(info.Created);
        $('#container-details-image').text(info.Image);
        $('#container-details-command').text(render_container_cmdline(info));
        $('#container-details-state').text(render_container_state(info.State));

        $('#container-details-ports-row').toggle(port_bindings.length > 0);
        $('#container-details-ports').html(port_bindings.map(shell.esc).join('<br/>'));

        this.update_links(info);

        update_memory_bar(this.memory_usage, info.MemoryUsage, info.MemoryLimit);
        $('#container-details-memory-text').text(format_memory_and_limit(info.MemoryUsage, info.MemoryLimit));

        $('#container-details .cpu-usage').text(format_cpu_usage(info.CpuUsage));
        $('#container-details .cpu-shares').text(format_cpu_shares(info.CpuPriority));

        this.maybe_show_terminal(info);
    },

    update_links: function(info) {
        $('#container-details-links').empty();
        var links = info.HostConfig.Links;
        if (links) {
          $('#container-details-links-row').toggle(true);
          $('#container-details-links').html(
                links.join('<br/>')
          );
        }
    },

    start_container: function () {
        var self = this;
        var id = this.container_id;
        this.client.start(this.container_id).
                fail(function(ex) {
                    handle_scope_start_container(self.client, id, ex.message, function() { self.maybe_reconnect_terminal(); }, null);
                }).
                done(function() {
                    self.maybe_reconnect_terminal();
                });
    },

    stop_container: function () {
        this.client.stop(this.container_id).
                fail(function(ex) {
                    shell.show_unexpected_error(ex);
                });
    },

    restart_container: function () {
        var self = this;
        this.client.restart(this.container_id).
                fail(function(ex) {
                    shell.show_unexpected_error(ex);
                }).
                done(function() {
                    self.maybe_reconnect_terminal();
                });
    },

    delete_container: function () {
        var self = this;
        var location = cockpit.location;
        shell.confirm(cockpit.format(_("Please confirm deletion of $0"), self.name),
                        _("Deleting a container will erase all data in it."),
                        _("Delete")).
            done(function () {
                docker_container_delete(self.client, self.container_id, function() { location.go("containers"); }, function () { });
            });
    }

};

function PageContainerDetails() {
    this._init();
}

shell.pages.push(new PageContainerDetails());

PageImageDetails.prototype = {
    _init: function() {
        this.id = "image-details";
        this.section_id = "containers";
        this.danger_enabled = false;
    },

    getTitle: function() {
        return C_("page-title", "Containers");
    },

    show: function() {
    },

    leave: function() {
        unsetup_for_failure(this.client);

        this.dbus_client.release();
        this.dbus_client = null;

        $(this.client).off('.image-details');
        this.client.release();
        this.client = null;
    },

    toggle_danger: function(val) {
        var self = this;
        self.danger_enabled = val;
        $('#image-details-containers button.enable-danger').toggleClass('active', self.danger_enabled);
        $("#image-details-containers td.container-col-actions").toggle(!self.danger_enabled);
        $("#image-details-containers td.container-col-danger").toggle(self.danger_enabled);

    },

    setup: function() {
        var self = this;
        setup_danger_button('#image-details-containers', "#"+this.id,
            function() {
                self.toggle_danger(!self.danger_enabled);
            });
        $('#image-details-run').on('click', $.proxy(this, "run_image"));
        $('#image-details-delete').on('click', $.proxy(this, "delete_image"));
    },

    enter: function() {
        var self = this;

        this.client = shell.docker();
        this.image_id = shell.get_page_param('id');
        this.name = cockpit.format(_("Image $0"), this.image_id.slice(0,12));

        /* TODO: migrate this code away from old dbus */
        this.dbus_client = shell.dbus(null);

        $('#image-details-containers table tbody tr').remove();
        $('#image-details-containers button.enable-danger').toggle(false);
        $(this.client).on('image.image-details', function (event, id, image) {
            if (id == self.image_id)
                self.update();
        });

        $(this.client).on('container.image-details', function(event, id, container) {
            if (!container || (container.Config && container.Config.Image == self.image_id))
                self.render_container(id, container);
        });

        for (var cid in this.client.containers) {
            var c = this.client.containers[cid];
            if (c.Config && c.Config.Image == self.image_id)
                self.render_container(c.Id, c);
        }

        setup_for_failure(this, this.client);
        this.update();
    },

    update: function() {
        $('#image-details-id').text("");
        $('#image-details-entrypoint').text("");
        $('#image-details-command').text("");
        $('#image-details-created').text("");
        $('#image-details-author').text("");
        $('#image-details-ports').text("");

        var info = this.client.images[this.image_id];
        docker_debug("image-details", this.image_id, info);

        if (!info) {
            $('#image-details-id').text(_("Not found"));
            return;
        }

        var waiting = !!(this.client.waiting[this.image_id]);
        $('#image-details-buttons div.waiting').toggle(waiting);
        $('#image-details-buttons button').toggle(!waiting);

        if (info.RepoTags && info.RepoTags.length > 0)
            this.name = info.RepoTags[0];

        $('#image-details .breadcrumb .active').text(this.name);

        $('#image-details-id').text(info.id);
        $('#image-details-tags').html(multi_line(info.RepoTags));
        $('#image-details-created').text(info.created);
        $('#image-details-author').text(info.author);

        var config = info.config;
        if (config) {
            var ports = [ ];
            for (var p in config.ExposedPorts) {
                ports.push(p);
            }

            $('#image-details-entrypoint').text(quote_cmdline(config.Entrypoint));
            $('#image-details-command').text(quote_cmdline(config.Cmd));
            $('#image-details-ports').text(ports.join(', '));
        }
    },

    render_container: function (id, container) {
        render_container(this.client, $('#image-details-containers'), null, "I",
                         id, container, this.danger_enabled);
    },

    run_image: function () {
        PageRunImage.display(this.client, this.image_id);
    },

    delete_image: function () {
        var self = this;
        var location = cockpit.location;
        shell.confirm(cockpit.format(_("Please confirm deletion of $0"), self.name),
                        _("Deleting an image will delete it, but you can probably download it again if you need it later.  Unless this image has never been pushed to a repository, that is, in which case you probably can't download it again."),
                        _("Delete")).
            done(function () {
                self.client.rmi(self.image_id).
                    fail(function(ex) {
                        shell.show_unexpected_error(ex);
                    }).
                    done(function() {
                        location.go("containers");
                    });
            });
    }

};

function PageImageDetails() {
    this._init();
}

shell.pages.push(new PageImageDetails());

function DockerClient() {
    var me = this;
    var events;
    var watch;
    var http;
    var connected;
    var got_failure;
    var alive = true;

    /* We use the Docker API v1.10 as documented here:

       https://docs.docker.com/reference/api/docker_remote_api/

       TODO: We should update eventually.  Later versions have
       incompatible changes, but they are also nicer.
     */

    var later;
    function trigger_event() {
        if (!later) {
            later = window.setTimeout(function() {
                later = null;
                $(me).trigger("event");
            }, 300);
        }
    }

    /* This is a named function because we call it recursively */
    function connect_events() {

        /* Trigger the event signal when JSON from /events */
        events = http.get("/v1.10/events");
        events.stream(function(resp) {
            docker_debug("event:", resp);
            if (connected.state() == "pending")
                connected.resolve();
            trigger_event();
        }).

        /* Reconnect to /events when it disconnects/fails */
        always(function() {
            window.setTimeout(function() {
                if (alive && events) {
                    connect_events();
                    alive = false;
                }
            }, 1000);
        });
    }

    /*
     * Exposed API, all containers and images
     * Contains the combined /container/json and /container/xxx/json
     * output indexed by Id (err id).
     *
     * Same for images
     */
    this.containers = { };
    this.images = { };

    /* Containers we're waiting for an action to complete on */
    this.waiting = { };

    var containers_meta = { };
    var containers_by_name = { };

    var images_meta = { };

    var dbus_client;
    var monitor;

    function container_to_name(container) {
        if (!container.Name)
            return null;
        var name = container.Name;
        if (name[0] === '/')
            name = name.substring(1);
        return name;
    }

    function populate_container(id, container) {
        if (container.State === undefined)
            container.State = { };
        if (container.Config === undefined)
            container.Config = { };
        $.extend(container, containers_meta[id]);
        var name = container_to_name(container);
        if (name)
           containers_by_name[name] = id;
    }

    function remove_container(id) {
        var container = me.containers[id];
        if (container) {
            var name = container_to_name(container);
            if (name && containers_by_name[name] == id)
                delete containers_by_name[name];
            delete me.containers[id];
            $(me).trigger("container", [id, undefined]);
        }
    }

    function fetch_containers() {
        /*
         * Gets a list of the containers and details for each one.  We use
         * /events for notification when something changes as well as some
         * file monitoring.
         */
        http.get("/v1.10/containers/json", { all: 1 }).
            done(function(data) {
                var containers = JSON.parse(data);
                if (connected.state() == "pending")
                    connected.resolve();
                alive = true;

                /*
                 * The output we get from /containers/json is mostly useless
                 * conflicting with the information that we get about specific
                 * containers. So just use it to get a list of containers.
                 */

                var seen = {};
                $(containers).each(function(i, item) {
                    var id = item.Id;
                    if (!id)
                        return;

                    seen[id] = id;
                    containers_meta[id] = item;
                    http.get("/v1.10/containers/" + encodeURIComponent(id) + "/json").
                        done(function(data) {
                            var container = JSON.parse(data);
                            populate_container(id, container);
                            me.containers[id] = container;
                            $(me).trigger("container", [id, container]);
                        });
                });

                var removed = [];
                $.each(me.containers, function(id) {
                    if (!seen[id])
                        removed.push(id);
                });

                $.each(removed, function(i, id) {
                    remove_container(id);
                });
            }).
            fail(function(ex) {
                if (connected.state() == "pending")
                    connected.reject(ex);
                got_failure = true;
                $(me).trigger("failure", [ex]);
            });
    }

    function populate_image(id, image) {
        if (image.config === undefined) {
            if (image.container_config)
                image.config = image.container_config;
            else
                image.config = { };
        }
        $.extend(image, images_meta[id]);

        /* HACK: TODO upstream bug */
        if (image.RepoTags)
            image.RepoTags.sort();
    }

    function remove_image(id) {
        if (me.images[id]) {
            delete me.images[id];
            $(me).trigger("image", [id, undefined]);
        }
    }

    function fetch_images() {
        /*
         * Gets a list of images and keeps it up to date. Again, the /images/json and
         * /images/xxxx/json have completely inconsistent keys. So using the former
         * is pretty useless here :S
         */
        http.get("/v1.10/images/json").
            done(function(data) {
                var images = JSON.parse(data);
                if (connected.state() == "pending")
                    connected.resolve();
                alive = true;

                var seen = {};
                $.each(images, function(i, item) {
                    var id = item.Id;
                    if (!id)
                        return;

                    seen[id] = id;
                    images_meta[id] = item;
                    http.get("/v1.10/images/" + encodeURIComponent(id) + "/json").
                        done(function(data) {
                            var image = JSON.parse(data);
                            populate_image(id, image);
                            me.images[id] = image;
                            $(me).trigger("image", [id, image]);
                        });
                });

                var removed = [];
                $.each(me.images, function(id) {
                    if (!seen[id])
                        removed.push(id);
                });

                $.each(removed, function(i, id) {
                    remove_image(id);
                });
            }).
            fail(function(ex) {
                if (connected.state() == "pending")
                    connected.reject(ex);
                got_failure = true;
                $(me).trigger("failure", [ex]);
            });
    }

    $(me).on("event", function() {
        fetch_containers();
        fetch_images();
    });

    function perform_connect() {
        got_failure = false;
        connected = $.Deferred();
        http = cockpit.http("/var/run/docker.sock", { superuser: true });

        connect_events();

        if (watch && watch.valid)
            watch.close();

        http.get("/v1.10/info").done(function(data) {
            var info = data && JSON.parse(data);
            watch = cockpit.channel({ payload: "fslist1", path: info["DockerRootDir"]});
            $(watch).on("message", function(event, data) {
                trigger_event();
            });
            $(watch).on("close", function(event, options) {
                if (options.problem && options.problem != "not-found")
                    console.warn("monitor for docker directory failed: " + options.problem);
            });

            $(me).triggerHandler("event");
        }).fail(function(err) {
            if (err != "not-found")
                console.warn("monitor for docker directory failed: " + err);
            $(me).triggerHandler("event");
        });

        /* TODO: This code needs to be migrated away from dbus-json1 */
        dbus_client = shell.dbus(null);
        monitor = dbus_client.get("/com/redhat/Cockpit/LxcMonitor",
                                  "com.redhat.Cockpit.MultiResourceMonitor");
        $(monitor).on('NewSample', handle_new_samples);
    }

    var regex_docker_cgroup = /docker-([A-Fa-f0-9]{64})\.scope/;
    var regex_geard_cgroup = /.*\/ctr-(.+).service/;
    this.container_from_cgroup = container_from_cgroup;
    function container_from_cgroup (cgroup) {
        /*
         * TODO: When we move to showing resources for systemd units
         * instead of containers then we'll get rid of all this
         * nastiness.
         */

        /* Docker created cgroups */
        var match = regex_docker_cgroup.exec(cgroup);
        if (match)
            return match[1];

        /* geard created cgroups */
        match = regex_geard_cgroup.exec(cgroup);
        if (match)
            return containers_by_name[match[1]];
        return null;
    }

    /* We listen to the resource monitor and include the measurements
     * in the container objects.
     *
     * TODO: Call GetSamples for quicker initialization.
     */

    function handle_new_samples (event, timestampUsec, samples) {
        resource_debug("samples", timestampUsec, samples);
        for (var cgroup in samples) {
            var id = container_from_cgroup(cgroup);
            if (!id)
                continue;
            var container = me.containers[id];
            if (!container)
                continue;
            var sample = samples[cgroup];
            container.CGroup = cgroup;
            var mem = sample[0];
            var limit = sample[1];
            /* if the limit is extremely high, consider the value to mean unlimited
             * 1.115e18 is roughly 2^60
             */
            if (limit > 1.115e18)
                limit = undefined;
            var cpu = sample[4];
            var priority = sample[5];
            if (mem != container.MemoryUsage ||
                limit != container.MemoryLimit ||
                cpu != container.CpuUsage ||
                priority != container.CpuPriority) {
                container.MemoryUsage = mem;
                container.MemoryLimit = limit;
                container.CpuUsage = cpu;
                container.CpuPriority = priority;
                $(me).trigger("container", [id, container]);
            }
        }
    }

    function trigger_id(id) {
        if (id in me.containers)
            $(me).trigger("container", [id, me.containers[id]]);
        else if (id in me.images)
            $(me).trigger("image", [id, me.images[id]]);
    }

    function waiting(id, yes) {
        if (id in me.waiting) {
            me.waiting[id]++;
        } else {
            me.waiting[id] = 1;
            trigger_id(id);
        }
    }

    function not_waiting(id) {
        me.waiting[id]--;
        if (me.waiting[id] === 0) {
            delete me.waiting[id];
            trigger_id(id);
        }
    }

    /* Actually connect initially */
    perform_connect();

    this.start = function start(id, options) {
        waiting(id);
        docker_debug("starting:", id);
        return http.request({
                method: "POST",
                path: "/v1.10/containers/" + encodeURIComponent(id) + "/start",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(options || { })
            })
            .fail(function(ex) {
                docker_debug("start failed:", id, ex);
            })
            .done(function(resp) {
                docker_debug("started:", id, resp);
            })
            .always(function() {
                not_waiting(id);
            });
    };

    this.stop = function stop(id, timeout) {
        waiting(id);
        if (timeout === undefined)
            timeout = 10;
        docker_debug("stopping:", id, timeout);
        return http.request({
                method: "POST",
                path: "/v1.10/containers/" + encodeURIComponent(id) + "/stop",
                params: { 't': timeout },
                body: ""
            })
            .fail(function(ex) {
                docker_debug("stop failed:", id, ex);
            })
            .done(function(resp) {
                docker_debug("stopped:", id, resp);
            })
            .always(function() {
                not_waiting(id);
            });
    };

    this.restart = function restart(id) {
        waiting(id);
        docker_debug("restarting:", id);
        return http.post("/v1.10/containers/" + encodeURIComponent(id) + "/restart")
            .fail(function(ex) {
                docker_debug("restart failed:", id, ex);
            })
            .done(function(resp) {
                docker_debug("restarted:", id, resp);
            })
            .always(function() {
                not_waiting(id);
            });
    };

    this.create = function create(name, options) {
        docker_debug("creating:", name);
        return http.request({
                method: "POST",
                path: "/v1.10/containers/create",
                params: { "name": name },
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(options || { })
            })
            .fail(function(ex) {
                docker_debug("create failed:", name, ex);
            })
            .done(function(resp) {
                docker_debug("created:", name, resp);
            })
            .then(JSON.parse);
    };

    this.search = function search(term) {
        docker_debug("searching:", term);
        return http.get("/v1.10/images/search", { "term": term })
            .fail(function(ex) {
                docker_debug("search failed:", term, ex);
            })
            .done(function(resp) {
                docker_debug("searched:", term, resp);
            });
    };

    this.commit = function create(id, repotag, options, run_config) {
        var args = {
            "container": id,
            "repo": repotag
        };
        $.extend(args, options);

        waiting(id);
        docker_debug("committing:", id, repotag, options, run_config);
        return http.request({
                method: "POST",
                path: "/v1.10/commit",
                params: args,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(run_config || { })
            })
            .fail(function(ex) {
                docker_debug("commit failed:", repotag, ex);
            })
            .done(function(resp) {
                docker_debug("committed:", repotag);
            })
            .always(function() {
                not_waiting(id);
            })
            .then(JSON.parse);
    };

    this.rm = function rm(id, forced) {
        if (forced === undefined)
            forced = false;
        waiting(id);
        docker_debug("deleting:", id);
        return http.request({
                method: "DELETE",
                path: "/v1.10/containers/" + encodeURIComponent(id),
                params: { "force": forced },
                body: ""
            })
            .fail(function(ex) {
                docker_debug("delete failed:", id, ex);
            })
            .done(function(resp) {
                docker_debug("deleted:", id, resp);
                remove_container(id);
            })
            .always(function() {
                not_waiting(id);
            });
    };

    this.rmi = function rmi(id) {
        waiting(id);
        docker_debug("deleting:", id);
        return http.request({
                method: "DELETE",
                path: "/v1.10/images/" + encodeURIComponent(id),
                body: ""
            })
            .fail(function(ex) {
                docker_debug("delete failed:", id, ex);
            })
            .done(function(resp) {
                docker_debug("deleted:", id, resp);
                remove_image(id);
            })
            .always(function() {
                not_waiting(id);
            });
    };

    function change_cgroup(directory, cgroup, filename, value) {
        /* TODO: Yup need a nicer way of doing this ... likely systemd once we're geard'd out */
        var path = "/sys/fs/cgroup/" + directory + "/" + cgroup + "/" + filename;
        var command = "echo '" + value.toFixed(0) + "' > " + path;
        docker_debug("changing cgroup:", command);

        /*
         * TODO: We need a sane UI for showing that the resources can't be changed
         * Showing unexpected error isn't it.
         */
        cockpit.spawn(["sh", "-c", command]).
            fail(function(ex) {
                console.warn(ex);
            });
    }

    this.change_memory_limit = function change_memory_limit(id, value) {
        if (value === undefined || value <= 0)
            value = -1;
        return change_cgroup("memory", this.containers[id].CGroup, "memory.limit_in_bytes", value);
    };

    this.change_swap_limit = function change_swap_limit(id, value) {
        if (value === undefined || value <= 0)
            value = -1;
        return change_cgroup("memory", this.containers[id].CGroup, "memory.memsw.limit_in_bytes", value);
    };

    this.change_cpu_priority = function change_cpu_priority(id, value) {
        if (value === undefined || value <= 0)
            value = 1024;
        return change_cgroup("cpuacct", this.containers[id].CGroup, "cpu.shares", value);
    };

    this.setup_cgroups_plot = function setup_cgroups_plot(element, sample_index, colors) {
        function is_container(cgroup) {
            return !!container_from_cgroup(cgroup);
        }

        return shell.setup_multi_plot(element, monitor, sample_index, colors,
                                        is_container);
    };

    this.machine_info = function machine_info() {
        return shell.util.machine_info();
    };

    this.info = function info() {
        return http.get("/v1.10/info")
            .fail(function(ex) {
                docker_debug("info failed:", ex);
            })
            .done(function(resp) {
                docker_debug("info:", resp);
            });
    };

    this.close = function close() {
        $(monitor).off('NewSample', handle_new_samples);
        monitor = null;
        if (dbus_client)
            dbus_client.release();
        dbus_client = null;
        connected = null;
    };

    this.connect = function connect() {
        if(!connected)
            perform_connect();
        return connected.promise();
    };

    this.maybe_reconnect = function maybe_reconnect() {
        if (got_failure) {
            this.close();
            perform_connect();
        }
        return connected.promise();
    };
}

});
