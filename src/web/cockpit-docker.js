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

var $cockpit = $cockpit || { };

(function($, $cockpit, cockpit_pages) {

var docker_clients = { };

function resource_debug() {
    if ($cockpit.debugging == "all" || $cockpit.debugging == "resource")
        console.debug.apply(console, arguments);
}

function docker_debug() {
    if ($cockpit.debugging == "all" || $cockpit.debugging == "docker")
        console.debug.apply(console, arguments);
}

function get_docker_client(machine) {
    if (!machine)
        machine = cockpit_get_page_param ("machine", "server");
    if (!docker_clients[machine])
        docker_clients[machine] = new DockerClient (machine);
    return docker_clients[machine];
}

function cockpit_quote_cmdline (cmds) {
    function quote(arg) {
        return arg.replace(/\\/g, '\\\\').replace(/ /g, '\\ ');
    }
    return cmds? cmds.map(quote).join(' ') : "";
}

function cockpit_unquote_cmdline (string) {
    function shift(str) {
        return string.replace(/\\ /g, '\u0001').replace(/\\\\/g, '\u0002');
    }
    function unshift(str) {
        return str.replace(/\u0001/g, ' ').replace(/\u0002/g, '\\');
    }

    return shift(string).split(' ').map(unshift);
}

function cockpit_render_container_name (name) {
    if (name.length > 0 && name[0] == "/")
        return name.slice(1);
    else
        return name;
}

function cockpit_render_container_state (state) {
    if (state.Running)
        return F(_("Up since %{StartedAt}"), state);
    else
        return F(_("Exited %{ExitCode}"), state);
}

function multi_line(strings) {
    return strings.map(cockpit_esc).join('<br/>');
}

function insert_table_sorted(table, row) {
    var key = $(row).text();
    var rows = $(table).find("tbody tr");
    for (var j = 0; j < rows.length; j++) {
        if ($(rows[j]).text().localeCompare(key) > 0) {
            $(row).insertBefore(rows[j]);
            row = null;
            break;
        }
    }
    if (row !== null)
        $(table).find("tbody").append(row);
}

PageContainers.prototype = {
    _init: function() {
        this.id = "containers";
    },

    getTitle: function() {
        return C_("page-title", "Containers");
    },

    enter: function(first_visit) {
        var self = this;

        if (first_visit) {
            this.container_filter_btn =
                cockpit_select_btn($.proxy(this, "filter"),
                                   [ { title: _("All"),                 choice: 'all',  is_default: true },
                                     { title: _("Running"),             choice: 'running' }
                                   ]);
            $('#containers-containers .panel-heading span').append(this.container_filter_btn);
        }

        var client = get_docker_client();
        if (client != this.client) {
            if (this.client)
                this.client.off('.containers');
            if (this.cpu_plot)
                this.cpu_plot.stop();
            if (this.mem_plot)
                this.mem_plot.stop();

            var reds = [ "#250304",
                         "#5c080c",
                         "#970911",
                         "#ce0e15",
                         "#ef2930",
                         "#f36166",
                         "#f7999c",
                         "#fbd1d2"
                       ];

            var blues = [ "#00243c",
                          "#004778",
                          "#006bb4",
                          "#008ff0",
                          "#2daaff",
                          "#69c2ff",
                          "#a5daff",
                          "#e1f3ff"
                        ];

            this.client = client;

            function highlight_container_row(event, id) {
                $('#containers-containers tr').removeClass('highlight');
                $('#' + id).addClass('highlight');
            }

            this.cpu_plot = client.setup_cgroups_plot ('#containers-cpu-graph', 4, blues.concat(blues));
            $(this.cpu_plot).on('update-total', function (event, total) {
                $('#containers-cpu-text').text(total+"%");
            });
            $(this.cpu_plot).on('highlight', highlight_container_row);

            this.mem_plot = client.setup_cgroups_plot ('#containers-mem-graph', 0, blues.concat(blues));
            $(this.mem_plot).on('update-total', function (event, total) {
                $('#containers-mem-text').text(cockpit_format_bytes_pow2 (total));
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

            /* High level failures about the overall functionality of docker */
            $(this.client).on('failure.containers', function(event, ex) {
                var msg;
                console.warn(ex);
                if (ex.problem == "not-found")
                    msg = _("Docker is not installed or activated on the system");
                else if (ex.problem == "not-authorized")
                    msg = _("Not authorized to access Docker on this system");
                else
                    msg = ex.toString();
                $("#containers-failure").show();
                $("#containers-failure span").text(msg);
            });
        }

        var id;
        for (id in this.client.containers) {
            this.render_container(id, this.client.containers[id]);
        }

        for (id in this.client.images) {
            this.render_image(id, this.client.images[id]);
        }
    },

    show: function() {
        if (this.cpu_plot)
            this.cpu_plot.start();
        if (this.mem_plot)
            this.mem_plot.start();
    },

    leave: function() {
        if (this.cpu_plot)
            this.cpu_plot.stop();
        if (this.mem_plot)
            this.mem_plot.stop();
    },

    render_container: function(id, container) {
        var self = this;
        var tr = $("#" + id);

        if (!container) {
            tr.remove();
            return;
        }

        var cputext;
        var memuse, memlimit;
        var membar, memtext, memtextstyle, memdanger;

        if (container.State && container.State.Running) {
            cputext = (container.CpuUsage || 0).toString() + "%";

            memuse = container.MemoryUsage || 0;
            memlimit = container.Config && container.Config.Memory;

            var barvalue = memuse.toString();

            if (memlimit)
                barvalue += "/" + memlimit.toString();

            if (memlimit) {
                var parts = $cockpit.format_bytes(memlimit, 1024);
                memtext = (memuse? $cockpit.format_bytes(memuse, parts[1])[0] : "?") + " / " + parts.join(" ");
            } else {
                memtext = (memuse? $cockpit.format_bytes(memuse, 1024).join(" ") : "?");
            }

            memdanger = (memlimit && memuse > 0.9 * memlimit) ? true : false;
            membar = true;
            memtextstyle = { 'color': 'inherit' };
        } else {
            cputext = "";
            membar = false;
            memdanger = false;
            memtext = _("Stopped");
            memtextstyle = { 'color': 'grey', 'text-align': 'right' };
            barvalue = 0;
        }

        var added = false;
        if (!tr.length) {
            var img_waiting = $('<div class="waiting">');
            var btn_play = $('<button class="btn btn-default btn-control btn-play">').
                on("click", function() {
                    $(this).hide().
                        siblings("div.waiting").show();
                    self.client.start(id).
                        fail(function(ex) {
                            cockpit_show_unexpected_error(ex);
                        });
                    return false;
                });
            var btn_stop = $('<button class="btn btn-default btn-control btn-stop">').
                on("click", function() {
                    $(this).hide().
                        siblings("div.waiting").show();
                    self.client.stop(id).
                        fail(function(ex) {
                            cockpit_show_unexpected_error(ex);
                        });
                    return false;
                });
            tr = $('<tr id="' + id + '">').append(
                $('<td class="container-col-name">'),
                $('<td class="container-col-image">'),
                $('<td class="container-col-command">'),
                $('<td class="container-col-cpu">'),
                $('<td class="container-col-memory-graph">').append($cockpit.BarRow("containers-containers")),
                $('<td class="container-col-memory-text">'),
                $('<td class="cell-buttons">').append(btn_play, btn_stop, img_waiting));
            tr.on('click', function(event) {
                cockpit_go_down ({ page: 'container-details',
                    id: id
                });
            });

            added = true;
        }

        var row = tr.children("td");
        $(row[0]).text(cockpit_render_container_name(container.Name));
        $(row[1]).text(container.Image);
        $(row[2]).text(container.Command);
        $(row[3]).text(cputext);
        $(row[4]).children("div").
            attr("value", barvalue).
            toggleClass("bar-row-danger", memdanger).
            toggle(membar);
        $(row[5]).
            css(memtextstyle).
            text(memtext);

        var waiting = id in self.client.waiting;
        $(row[6]).children("div.waiting").toggle(waiting);
        $(row[6]).children("button.btn-play").toggle(!waiting && !container.State.Running);
        $(row[6]).children("button.btn-stop").toggle(!waiting && container.State.Running);

        var filter = cockpit_select_btn_selected(this.container_filter_btn);
        tr.toggleClass("unimportant", !container.State.Running);

        if (added)
            insert_table_sorted($('#containers-containers table'), tr);
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
            var button = $('<button class="btn btn-default btn-control btn-play">').
                on("click", function() {
                    PageRunImage.display(self.client, id);
                    return false;
                });
            tr = $('<tr id="' + id + '">').append(
                    $('<td class="image-col-tags">'),
                    $('<td class="image-col-created">'),
                    $('<td class="image-col-size-graph">').append($cockpit.BarRow("container-images")),
                    $('<td class="image-col-size-text">'),
                    $('<td class="cell-buttons">').append(button));
            tr.on('click', function(event) {
                cockpit_go_down ({ page: 'image-details',
                    id: id
                });
            });

            added = true;
        }

        var row = tr.children("td");
        $(row[0]).html(multi_line(image.RepoTags));
        $(row[1]).text(new Date(image.Created * 1000).toLocaleString());
        $(row[2]).children("div").attr("value", image.VirtualSize);
        $(row[3]).text($cockpit.format_bytes(image.VirtualSize, 1024).join(" "));

        if (added)
            insert_table_sorted($('#containers-images table'), tr);
    },

    filter: function() {
        var filter = cockpit_select_btn_selected(this.container_filter_btn);
        $("#containers-containers table").toggleClass("filter-unimportant", filter === "running");
    }

};

function PageContainers() {
    this._init();
}

cockpit_pages.push(new PageContainers());

PageRunImage.prototype = {
    _init: function() {
        this.id = "containers_run_image_dialog";
    },

    getTitle: function() {
        return C_("page-title", "Run Image");
    },

    show: function() {
    },

    leave: function() {
    },

    enter: function(first_visit) {
        var page = this;
        page.memory_limit = undefined;
        page.cpu_priority = undefined;

        /* Memory limit slider/checkbox interaction happens here */
        function init_interact_memory(min, max, defawlt) {
            var slider, desc;

            function update_limit() {
                if (slider.disabled) {
                    page.memory_limit = undefined;
                    return _("unlimited");
                }
                var limit = Math.round(slider.value * max);
                if (limit < min)
                    limit = min;
                page.memory_limit = limit;
                return $cockpit.format_bytes(limit).join(" ");
            }

            /* Slider to limit amount of memory */
            slider = $("#containers-run-image-memory-slider").
                on('change', function() {
                    $(desc).text(update_limit());
                })[0];

            /* Description of how much memory is selected */
            desc = $("#containers-run-image-memory-desc")[0];

            /* Unlimited checkbox */
            $("#containers-run-image-memory-limit").
                on('change', function() {
                    $(slider).attr("disabled", !this.checked);
                    $(desc).toggleClass("disabled", !this.checked);
                    $(desc).text(update_limit());
                });

            /* Set the default value */
            slider.value = defawlt / max;
        }

        /* CPU priority slider/checkbox interaction happens here */
        function init_interact_cpu(min, max, defawlt) {
            var slider, desc;

            /* Logarithmic position between these */
            var minv = Math.log(min);
            var maxv = Math.log(max);
            var scale = (maxv - minv);

            function update_priority() {
                if (slider.disabled) {
                    page.cpu_priority = undefined;
                    return _("default");
                }
                page.cpu_priority = Math.round(Math.exp(minv + scale * slider.value));
                return String(page.cpu_priority) + _(" shares");
            }

            /* Slider to change CPU priority */
            slider = $("#containers-run-image-cpu-slider").
                on('change', function() {
                    $(desc).text(update_priority());
                })[0];

            /* Description of CPU priority */
            desc = $("#containers-run-image-cpu-desc")[0];
            console.log(desc);

            /* Default checkbox */
            $("#containers-run-image-cpu-prioritize").
                on('change', function() {
                    $(slider).attr("disabled", !this.checked);
                    $(desc).toggleClass("disabled", !this.checked);
                    $(desc).text(update_priority());
                });

            /* Setup the default value */
            slider.value = (Math.log(defawlt) - minv) / scale;
        }

        if (first_visit) {
            $("#containers-run-image-run").on('click', $.proxy(this, "run"));
            /* TODO: Get max memory from elsewhere */
            init_interact_memory(10000000, 8000000000, 400000000);
            init_interact_cpu(2, 1000000, 1024);
        }

        $("#containers-run-image-memory-limit").
            prop("checked", false).
            trigger("change");
        $("#containers-run-image-cpu-prioritize").
            prop("checked", false).
            trigger("change");
        $("#containers-run-image-with-terminal").
            prop("checked", true).
            trigger("change");

        docker_debug("run-image", PageRunImage.image_info);

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
        $("#containers-run-image-command").val(cockpit_quote_cmdline(PageRunImage.image_info.config.Cmd));

        function render_port(p) {
            var port_input = $('<input class="form-control" style="display:inline;width:auto" >');
            var tr =
                $('<tr class="port-map">').append(
                    $('<td>').text(
                        F(_("Bind port %{port} to "),
                          { port: p })),
                    $('<td colspan="2">').append(
                        port_input));

            port_input.attr('placeholder', _("none"));
            return tr;
        }

        var table = $('#containers_run_image_dialog .modal-body table');
        table.find('.port-map').remove();
        this.port_items = { };
        for (var p in PageRunImage.image_info.config.ExposedPorts) {
            var tr = render_port(p);
            this.port_items[p] = tr;
            table.append(tr);
        }
    },

    run: function() {
        var name = $("#containers-run-image-name").val();
        var cmd = $("#containers-run-image-command").val();
        var port_bindings = { };
        var p, map;
        for (p in this.port_items) {
            map = this.port_items[p].find('input').val();
            if (map)
                port_bindings[p] = [ { "HostIp": "",
                                       "HostPort": map
                                     }
                                   ];
        }

        $("#containers_run_image_dialog").modal('hide');

        var tty = $("#containers-run-image-with-terminal").prop('checked');
        var options = {
            "Cmd": cockpit_unquote_cmdline(cmd),
            "Image": PageRunImage.image_info.id,
            "Memory": this.memory_limit || 0,
            "MemorySwap": (this.memory_limit * 2) || 0,
            "CpuShares": this.cpu_priority || 0,
            "Tty": tty
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
                cockpit_show_unexpected_error(ex);
            }).
            done(function(result) {
                PageRunImage.client.start(result.Id, { "PortBindings": port_bindings }).
                    fail(function(ex) {
                        cockpit_show_unexpected_error(ex);
                    });
                if (cockpit_get_page_param('page') == "image-details") {
                    cockpit_go_up();
                }
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


cockpit_pages.push(new PageRunImage());

PageContainerDetails.prototype = {
    _init: function() {
        this.id = "container-details";
        this.terminal = null;
    },

    getTitle: function() {
        return this.name;
    },

    show: function() {
    },

    leave: function() {
        $(this.client).off('.container-details');
        if (this.terminal) {
            this.terminal.close();
            this.terminal = null;
            $("#container-terminal").hide();
        }
    },

    enter: function(first_visit) {
        var self = this;

        if (first_visit) {
            $('#container-details-start').on('click', $.proxy(this, "start_container"));
            $('#container-details-stop').on('click', $.proxy(this, "stop_container"));
            $('#container-details-restart').on('click', $.proxy(this, "restart_container"));
            $('#container-details-delete').on('click', $.proxy(this, "delete_container"));
        }

        this.client = get_docker_client();
        this.container_id = cockpit_get_page_param('id');
        this.name = this.container_id.slice(0,12);

        $(this.client).on('container.container-details', function (event, id, container) {
            if (id == self.container_id)
                self.update();
        });

        this.update();
    },

    maybe_show_terminal: function(info) {
        if (!info.Config.Tty)
            return;

        if (!this.terminal) {
            this.terminal = new DockerTerminal($("#container-terminal")[0],
                                               this.client.machine,
                                               this.container_id);
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

    update: function() {
        $('#container-details-names').text("");
        $('#container-details-id').text("");
        $('#container-details-created').text("");
        $('#container-details-image').text("");
        $('#container-details-command').text("");
        $('#container-details-state').text("");
        $('#container-details-ports').text("");

        var info = this.client.containers[this.container_id];
        docker_debug("container-details", this.container_id, info);

        if (!info) {
            $('#container-details-names').text(_("Not found"));
            return;
        }

        var waiting = !!(this.client.waiting[this.container_id]);
        $('#container-details div.waiting').toggle(waiting);
        $('#container-details button').toggle(!waiting);
        $('#container-details-start').prop('disabled', info.State.Running);
        $('#container-details-stop').prop('disabled', !info.State.Running);
        $('#container-details-restart').prop('disabled', !info.State.Running);
        $('#container-details-delete').prop('disabled', info.State.Running);

        var name = cockpit_render_container_name(info.Name);
        if (name != this.name) {
            this.name = name;
            cockpit_content_update_loc_trail();
        }

        var port_bindings = [ ];
        if (info.NetworkSettings) {
            for (var p in info.NetworkSettings.Ports) {
                var h = info.NetworkSettings.Ports[p];
                if (!h)
                    continue;
                for (var i = 0; i < h.length; i++) {
                    port_bindings.push(F(_("%{hip}:%{hport} -> %{cport}"),
                                         { hip: h[i].HostIp,
                                           hport: h[i].HostPort,
                                           cport: p
                                         }));
                }
            }
        }

        $('#container-details-id').text(info.ID);
        $('#container-details-names').text(cockpit_render_container_name(info.Name));
        $('#container-details-created').text(info.Created);
        $('#container-details-image').text(info.Image);
        $('#container-details-command').text(info.Command);
        $('#container-details-state').text(cockpit_render_container_state(info.State));
        $('#container-details-ports').html(port_bindings.map(cockpit_esc).join('<br/>'));

        this.maybe_show_terminal(info);
    },

    start_container: function () {
        var self = this;
        this.client.start(this.container_id).
                fail(function(ex) {
                    cockpit_show_unexpected_error (ex);
                }).
                done(function() {
                    self.maybe_reconnect_terminal();
                });
    },

    stop_container: function () {
        this.client.stop(this.container_id).
                fail(function(ex) {
                    cockpit_show_unexpected_error (ex);
                });
    },

    restart_container: function () {
        var self = this;
        this.client.restart(this.container_id).
                fail(function(ex) {
                    cockpit_show_unexpected_error (ex);
                }).
                done(function() {
                    self.maybe_reconnect_terminal();
                });
    },

    delete_container: function () {
        this.client.rm(this.container_id).
            fail(function(ex) {
                cockpit_show_unexpected_error(ex);
            }).
            done(function() {
                cockpit_go_up();
            });
    }

};

function PageContainerDetails() {
    this._init();
}

cockpit_pages.push(new PageContainerDetails());

PageImageDetails.prototype = {
    _init: function() {
        this.id = "image-details";
    },

    getTitle: function() {
        return this.name;
    },

    show: function() {
    },

    leave: function() {
        $(this.client).off('.container-details');
    },

    enter: function(first_visit) {
        var self = this;

        if (first_visit) {

            $('#image-details-run').on('click', $.proxy(this, "run_image"));
            $('#image-details-delete').on('click', $.proxy(this, "delete_image"));
        }

        this.client = get_docker_client();
        this.image_id = cockpit_get_page_param('id');
        this.name = F(_("Image %{id}"), { id: this.image_id.slice(0,12) });

        $(this.client).on('image.image-details', function (event, id, imaege) {
            if (id == self.image_id)
                self.update();
        });

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
        $('#container-details div.waiting').toggle(waiting);
        $('#container-details button').toggle(!waiting);

        if (info.RepoTags && info.RepoTags.length > 0) {
            var name = info.RepoTags[0];
            if (name != this.name) {
                this.name = name;
                cockpit_content_update_loc_trail();
            }
        }

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

            $('#image-details-entrypoint').text(cockpit_quote_cmdline(config.Entrypoint));
            $('#image-details-command').text(cockpit_quote_cmdline(config.Cmd));
            $('#image-details-ports').text(ports.join(', '));
        }
    },

    run_image: function () {
        PageRunImage.display(this.client, this.image_id);
    },

    delete_image: function () {
        this.client.rmi(this.image_id).
            fail(function(ex) {
                cockpit_show_unexpected_error(ex);
            }).
            done(function() {
                cockpit_go_up();
            });
    }

};

function PageImageDetails() {
    this._init();
}

cockpit_pages.push(new PageImageDetails());

function DockerClient(machine) {
    var me = this;
    var rest = $cockpit.rest("unix:///var/run/docker.sock", machine);

    var events = rest.get("/events");
    var alive = true;

    /* This is a named function because we call it recursively */
    function connect_events() {

        /* Trigger the event signal when JSON from /events */
        events.stream(function(resp) {
            docker_debug("event:", resp);
            $(me).trigger("event");
        }).

        /* Reconnect to /events when it disconnects/fails */
        always(function() {
            window.setTimeout(function() {
                if (alive && events) {
                    events = events.restart();
                    connect_events();
                    alive = false;
                }
            }, 1000);
        });
    }
    connect_events();

    /* All active poll requests for containers/images indexed by Id */
    var polls = { };

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
    function populate_container(id, container) {
        if (container.State === undefined)
            container.State = { };
        if (container.Config === undefined)
            container.Config = { };
        $.extend(container, containers_meta[id]);
    }

    /*
     * Gets a list of the containers and details for each one.  We use
     * /events for notification when something changes.  However, for
     * extra robustness and to account for the fact that there are no
     * events when new images appear, we also poll for changes.
     */
    rest.poll("/containers/json", 4000, events, { "all": 1 }).
        stream(function(containers) {
            alive = true;

            /*
             * The output we get from /containers/json is mostly useless
             * conflicting with the information that we get about specific
             * containers. So just use it to get a list of containers.
             */
            $(containers).each(function(i, item) {
                var id = item.Id;
                if (id && !polls[id]) {
                    containers_meta[id] = item;
                    polls[id] = rest.poll("/containers/" + id + "/json", 5000, events).
                        stream(function(container) {
                            populate_container(id, container);
                            me.containers[id] = container;
                            $(me).trigger("container", [id, container]);
                        }).
                        fail(function(ex) {
                            /*
                             * A 404 is the way we determine when a container
                             * actually goes away
                             */
                            if (ex.status == 404) {
                                delete me.containers[id];
                                $(me).trigger("container", [id, undefined]);
                            }
                        }).
                        always(function() {
                            /*
                             * This lets us start a new poll for this, if it failed
                             * for a reason other than a 404
                             */
                            polls[id].cancel();
                            delete polls[id];
                        });
                }
            });
        }).
        fail(function(ex) {
            $(me).trigger("failure", [ex]);
        });

    var images_meta = { };
    function populate_image(id, image) {
        if (image.config === undefined) {
            if (image.container_config)
                image.config = image.container_config;
            else
                image.config = { };
        }
        $.extend(image, images_meta[id]);
    }

    /*
     * Gets a list of images and keeps it up to date. Again, the /images/json and
     * /images/xxxx/json have completely inconsistent keys. So using the former
     * is pretty useless here :S
     */
    var images_req = rest.poll("/images/json", 1000).
        stream(function(images) {
            alive = true;

            $(images).each(function(i, item) {
                var id = item.Id;
                if (id && !polls[id]) {
                    images_meta[id] = item;
                    polls[id] = rest.poll("/images/" + id + "/json", 0, images_req).
                        stream(function(image) {
                            populate_image(id, image);
                            me.images[id] = image;
                            $(me).trigger("image", [id, image]);
                        }).
                        fail(function(ex) {
                            /*
                             * A 404 is the way we determine when a container
                             * actually goes away
                             */
                            if (ex.status == 404) {
                                delete me.images[id];
                                $(me).trigger("image", [id, undefined]);
                            }
                        }).
                        always(function() {
                            /*
                             * This lets us start a new poll for image, if it failed
                             * for a reason other than a 404.
                             */
                            polls[id].cancel();
                            delete polls[id];
                        });
                }
            });
        }).
        fail(function(ex) {
            $(me).trigger("failure", [ex]);
        });

    /* We listen to the resource monitor and include the measurements
     * in the container objects.
     *
     * TODO: Don't assume that the D-Bus client is ready.  Call
     * GetSamples for quicker initialization.
     */

    var dbus_client = cockpit_get_dbus_client (machine);
    var monitor = dbus_client.lookup ("/com/redhat/Cockpit/LxcMonitor",
                                      "com.redhat.Cockpit.MultiResourceMonitor");

    /* TODO: dig out the maximum memory */
    this.max_memory = 8000000000;

    if (monitor) {
        $(monitor).on('NewSample', function (event, timestampUsec, samples) {
            resource_debug("samples", timestampUsec, samples);
            for (var id in me.containers) {
                var container = me.containers[id];
                var sample = samples["lxc/" + id] || samples["docker-" + id + ".slice"];

                var mem = sample? sample[0] : 0;
                var cpu = sample? sample[4] : 0;
                if (mem != container.MemoryUsage || cpu != container.CpuUsage) {
                    container.MemoryUsage = mem;
                    container.CpuUsage = cpu;
                    $(me).trigger("container", [id, container]);
                }
            }
        });
    } else {
        console.warn("No resource monitor");
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

    this.start = function start(id, options) {
        waiting(id);
        docker_debug("starting:", id, options);
        return rest.post("/containers/" + id + "/start", null, options).
            fail(function(ex) {
                docker_debug("start failed:", id, ex);
            }).
            done(function(resp) {
                docker_debug("started:", id, resp);
            }).
            always(function() {
                not_waiting(id);
            });
    };

    this.stop = function stop(id, timeout) {
        waiting(id);
        if (timeout === undefined)
            timeout = 10;
        docker_debug("stopping:", id, timeout);
        return rest.post("/containers/" + id + "/stop", { 't': timeout }).
            fail(function(ex) {
                docker_debug("stop failed:", id, ex);
            }).
            done(function(resp) {
                docker_debug("stopped:", id, resp);
            }).
            always(function() {
                not_waiting(id);
            });
    };

    this.restart = function restart(id) {
        waiting(id);
        docker_debug("restarting:", id);
        return rest.post("/containers/" + id + "/restart").
            fail(function(ex) {
                docker_debug("restart failed:", id, ex);
            }).
            done(function(resp) {
                docker_debug("restarted:", id, resp);
            }).
            always(function() {
                not_waiting(id);
            });
    };

    this.create = function create(name, options) {
        docker_debug("creating:", name, options);
        return rest.post("/containers/create", { "name": name }, options).
            fail(function(ex) {
                docker_debug("create failed:", name, ex);
            }).
            done(function(resp) {
                docker_debug("created:", name, resp);
            });
    };

    this.rm = function rm(id) {
        waiting(id);
        docker_debug("deleting:", id);
        return rest.del("/containers/" + id).
            fail(function(ex) {
                docker_debug("delete failed:", id, ex);
            }).
            done(function(resp) {
                docker_debug("deleted:", id, resp);
            }).
            always(function() {
                not_waiting(id);
            });
    };

    this.rmi = function rmi(id) {
        waiting(id);
        docker_debug("deleting:", id);
        return rest.del("/images/" + id).
            fail(function(ex) {
                docker_debug("delete failed:", id, ex);
            }).
            done(function(resp) {
                docker_debug("deleted:", id, resp);
            }).
            always(function() {
                not_waiting(id);
            });
    };

    this.setup_cgroups_plot = function setup_cgroups_plot(element, sample_index, colors) {
        var self = this;
        var max_consumers = colors.length-1;
        var data = new Array(max_consumers+1);       // max_consumers entries plus one for the total
        var consumers = new Array(max_consumers);
        var plot;
        var i;

        if (!monitor)
            return null;

        for (i = 0; i < data.length; i++)
            data[i] = { };

        function is_container(cgroup) {
            return cgroup.startsWith("lxc/");
        }

        function update_consumers() {
            var mcons = monitor.Consumers;
            consumers.forEach(function (c, i) {
                if (c && mcons.indexOf(c) < 0) {
                    resource_debug("Consumer disappeared", c);
                    consumers[i] = null;
                }
            });
            mcons.forEach(function (mc) {
                if (!is_container(mc))
                    return;
                if (consumers.indexOf(mc) < 0) {
                    resource_debug("New consumer", mc);
                    for (i = 0; i < max_consumers; i++) {
                        if (!consumers[i]) {
                            consumers[i] = mc;
                            return;
                        }
                    }
                    console.warn("Too many consumers");
                }
            });
        }

        function store_samples (samples, index) {
            var total = 0;
            for (var c in samples) {
                if (is_container(c))
                    total += samples[c][sample_index];
            }
            function store(i, value) {
                var series = data[i].data;
                var floor = (i > 0? data[i-1].data[index][2] : 0);
                series[index][1] = floor;
                series[index][2] = floor + value;
            }
            consumers.forEach(function (c, i) {
                store(i, (c && samples[c]? samples[c][sample_index] : 0));
            });
            store(max_consumers, total);
            if (index == monitor.NumSamples-1)
                $(plot).trigger('update-total', [ total ]);
        }

        plot = cockpit_setup_plot (element, monitor, data,
                                   { colors: colors,
                                     legend: { show: false },
                                     series: { shadowSize: 0,
                                               lines: { lineWidth: 0.0,
                                                        fill: 1.0
                                                      }
                                             },
                                     xaxis: { tickFormatter: function() { return ""; } },
                                     yaxis: { tickFormatter: function() { return ""; } },
                                     // The point radius influences
                                     // the margin around the grid
                                     // even if no points are plotted.
                                     // We don't want any margin, so
                                     // we set the radius to zero.
                                     points: { radius: 0 },
                                     grid: { borderWidth: 1,
                                             hoverable: true,
                                             autoHighlight: false,
                                             aboveData: true,
                                             color: "black",
                                             labelMargin: 0
                                           }
                                   },
                                   store_samples);
        $(monitor).on("notify:Consumers", function (event) {
            update_consumers();
        });

        var cur_highlight = null;

        function highlight(consumer) {
            if (consumer != cur_highlight) {
                cur_highlight = consumer;
                if (consumer && consumer.startsWith("lxc/"))
                    consumer = consumer.substring(4);
                $(plot).trigger('highlight', [ consumer ]);
            }
        }

        $(plot.element).on("plothover", function(event, pos, item) {
            var i, index;

            index = Math.round(pos.x);
            if (index < 0)
                index = 0;
            if (index > monitor.NumSamples-1)
                index = monitor.NumSamples-1;

            for (i = 0; i < max_consumers; i++) {
                if (i < max_consumers && data[i].data[index][1] <= pos.y && pos.y <= data[i].data[index][2])
                    break;
            }
            if (i < max_consumers)
                highlight(consumers[i]);
            else
                highlight(null);
        });
        $(plot.element).on("mouseleave", function(event, pos, item) {
            highlight(null);
        });

        update_consumers();
        return plot;
    };
}

function DockerTerminal(parent, machine, id) {
    var self = this;

    var term = new Terminal({
        cols: 80,
        rows: 24,
        screenKeys: true
    });

    /* term.js wants the parent element to build its terminal inside of */
    term.open(parent);

    var enable_input = true;
    var channel = null;

    /*
     * A raw channel over which we speak Docker's strange /attach
     * protocol. It starts with a HTTP POST, and then quickly
     * degenerates into a simple stream.
     *
     * We only support the tty stream. The other framed stream
     * contains embedded nulls in the framing and doesn't work
     * with our text-stream channels.
     *
     * See: http://docs.docker.io/en/latest/reference/api/docker_remote_api_v1.8/#attach-to-a-container
     */
    function attach() {
        channel = new Channel({
            "host": machine,
            "payload": "text-stream",
            "unix": "/var/run/docker.sock"
        });

        var buffer = "";
        var headers = false;
        self.connected = true;

        $(channel).
            on("close.terminal", function(ev, problem) {
                self.connected = false;
                if (!problem)
                    problem = "disconnected";
                term.write('\x1b[31m' + problem + '\x1b[m\r\n');
                self.typeable(false);
                $(channel).off("close.terminal");
                $(channel).off("message.terminal");
                channel = null;
            }).
            on("message.terminal", function(ev, payload) {
                /* Look for end of headers first */
                if (!headers) {
                    buffer += payload;
                    var pos = buffer.indexOf("\r\n\r\n");
                    if (pos == -1)
                        return;
                    headers = true;
                    payload = buffer.substring(pos + 2);
                }
                /* Once headers are done it's just raw data */
                term.write(payload);
            });

        var req =
            "POST /containers/" + id + "/attach?logs=1&stream=1&stdin=1&stdout=1&stderr=1 HTTP/1.0\r\n" +
            "Content-Length: 0\r\n" +
            "\r\n";
        channel.send(req);
    }

    term.on('data', function(data) {
        /* Send typed input back through channel */
        if (enable_input)
            channel.send(data);
    });

    attach();

    /* Allows caller to cleanup nicely */
    this.close = function close() {
        if (self.connected)
            channel.close(null);
        term.destroy();
    };

    /* Allows the curser to restart the attach request */
    this.connect = function connect() {
        if (channel) {
            channel.close();
            channel = null;
        }
        term.softReset();
        term.refresh(term.y, term.y);
        attach();
    };

    /* Shows and hides the cursor */
    this.typeable = function typeable(yes) {
        if (yes === undefined)
            yes = !enable_input;
        if (yes) {
            term.cursorHidden = false;
            term.showCursor();
        } else {
            /* There's no term.hideCursor() function */
            term.cursorHidden = true;
            term.refresh(term.y, term.y);
        }
        enable_input = yes;
    };

    return this;
}

})(jQuery, $cockpit, cockpit_pages);
