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

var cockpit = cockpit || { };

(function($, cockpit) {

function resource_debug() {
    if (cockpit.debugging == "all" || cockpit.debugging == "resource")
        console.debug.apply(console, arguments);
}

function docker_debug() {
    if (cockpit.debugging == "all" || cockpit.debugging == "docker")
        console.debug.apply(console, arguments);
}

var docker_clients = cockpit.util.make_resource_cache();

cockpit.docker = docker;
function docker(machine) {
    return docker_clients.get(machine, function () { return new DockerClient(machine); });
}

function quote_cmdline (cmds) {
    return cockpit.util.quote_words(cmds || []);
}

function unquote_cmdline (string) {
    return cockpit.util.parse_words(string);
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
        return F(_("Up since %{StartedAt}"), state);
    else
        return F(_("Exited %{ExitCode}"), state);
}

function multi_line(strings) {
    return strings.map(cockpit.esc).join('<br/>');
}

function format_cpu_shares(priority) {
    if (!priority)
        return _("default");
    return F(_("%{shares} shares"), { shares: Math.round(priority) });
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
        console.warn(ex);

        if (typeof ex == "string")
            msg = ex;
        else if (ex.problem == "not-found") {
            msg = _("Docker is not installed or activated on the system");
            show_start = true;
        } else if (ex.problem == "not-authorized")
            msg = _("Not authorized to access Docker on this system");
        else
            msg = F(_("Can't connect to Docker: %{error}"), { error: ex.toString() });
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
        /* This error is handled via cockpit.set_watched_client
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
        // TODO: Make sure that this uses the polkit policy
        cockpit.spawn([ "systemctl", "start", "docker.socket" ]).
            done(function () {
                client.close();
                client.connect().
                    done(function () {
                        hide_failure();
                        page.show();
                    });
            }).
            fail(function (error) {
                show_failure(F(_("Failed to start Docker: %{error}"), { error: error }));
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

function render_container (client, $panel, filter_button, prefix, id, container) {
    var tr = $("#" + prefix + id);

    if (!container) {
        tr.remove();
        return;
    }

    var cputext;
    var memuse, memlimit;
    var membar, memtext, memtextstyle;
    var barvalue;

    if (container.State && container.State.Running) {
        cputext = format_cpu_usage(container.CpuUsage);

        memuse = container.MemoryUsage || 0;
        memlimit = container.MemoryLimit || 0;
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
        var img_waiting = $('<div class="waiting">');
        var btn_play = $('<button class="btn btn-default btn-control btn-play">').
            on("click", function() {
                $(this).hide().
                    siblings("div.waiting").show();
                client.start(id).
                    fail(function(ex) {
                        cockpit.show_unexpected_error(ex);
                    });
                return false;
            });
        var btn_stop = $('<button class="btn btn-default btn-control btn-stop">').
            on("click", function() {
                $(this).hide().
                    siblings("div.waiting").show();
                client.stop(id).
                    fail(function(ex) {
                        cockpit.show_unexpected_error(ex);
                    });
                return false;
            });
        tr = $('<tr id="' + prefix + id + '">').append(
            $('<td class="container-col-name">'),
            $('<td class="container-col-image">'),
            $('<td class="container-col-command">'),
            $('<td class="container-col-cpu">'),
            $('<td class="container-col-memory-graph">').append(cockpit.BarRow("containers-containers")),
            $('<td class="container-col-memory-text">'),
            $('<td class="cell-buttons">').append(btn_play, btn_stop, img_waiting));
        tr.on('click', function(event) {
            cockpit.go_down({  page: 'container-details',
                               id: id
                             });
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
    $(row[6]).children("div.waiting").toggle(waiting);
    $(row[6]).children("button.btn-play").toggle(!waiting && !container.State.Running);
    $(row[6]).children("button.btn-stop").toggle(!waiting && container.State.Running);

    if (filter_button) {
        var filter = cockpit.select_btn_selected(filter_button);
        tr.toggleClass("unimportant", !container.State.Running);
    }

    if (added)
        insert_table_sorted($panel.find('table'), tr);
}

PageContainers.prototype = {
    _init: function() {
        this.id = "containers";
    },

    getTitle: function() {
        return C_("page-title", "Containers");
    },

    setup: function() {
        this.container_filter_btn =
            cockpit.select_btn($.proxy(this, "filter"),
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

        this.address = cockpit.get_page_param('machine') || "localhost";
        this.client = cockpit.docker(this.address);

        // Just for watching
        this.dbus_client = cockpit.dbus(this.address, { payload: "dbus-json1" });
        cockpit.set_watched_client(this.dbus_client);

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
        for (id in this.client.containers) {
            this.render_container(id, this.client.containers[id]);
        }

        for (id in this.client.images) {
            this.render_image(id, this.client.images[id]);
        }

        setup_for_failure(self, self.client);
    },

    show: function() {
        this.cpu_plot.start();
        this.mem_plot.start();
    },

    leave: function() {
        unsetup_for_failure(this.client);

        cockpit.set_watched_client(null);
        this.dbus_client.release();
        this.dbus_client = null;

        this.cpu_plot.destroy();
        this.mem_plot.destroy();
        $(this.client).off('.containers');
        this.client.release();
        this.client = null;
    },

    render_container: function(id, container) {
        render_container(this.client, $('#containers-containers'), this.container_filter_btn,
                         "", id, container);
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
                    $('<td class="image-col-size-graph">').append(cockpit.BarRow("container-images")),
                    $('<td class="image-col-size-text">'),
                    $('<td class="cell-buttons">').append(button));
            tr.on('click', function(event) {
                cockpit.go_down({ page: 'image-details',
                    id: id
                });
            });

            added = true;
        }

        var row = tr.children("td");
        $(row[0]).html(multi_line(image.RepoTags));
        $(row[1]).text(new Date(image.Created * 1000).toLocaleString());
        $(row[2]).children("div").attr("value", image.VirtualSize);
        $(row[3]).text(cockpit.format_bytes(image.VirtualSize, 1024));

        if (added) {
            insert_table_sorted($('#containers-images table'), tr);
        }
    },

    filter: function() {
        var filter = cockpit.select_btn_selected(this.container_filter_btn);
        $("#containers-containers table").toggleClass("filter-unimportant", filter === "running");
    }

};

function PageContainers() {
    this._init();
}

cockpit.pages.push(new PageContainers());

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

    setup: function() {
        $("#containers-run-image-run").on('click', $.proxy(this, "run"));

        this.memory_slider = new MemorySlider($("#containers-run-image-memory"),
                                              10*1024*1024, 2*1024*1024*1024);
        this.cpu_slider = new CpuSlider($("#containers-run-image-cpu"), 2, 1000000);
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

        console.log(info);

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
        $("#containers-run-image-command").val(quote_cmdline(PageRunImage.image_info.config.Cmd));

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
            "Cmd": unquote_cmdline(cmd),
            "Image": PageRunImage.image_info.id,
            "Memory": this.memory_slider.value || 0,
            "MemorySwap": (this.memory_slider.value * 2) || 0,
            "CpuShares": this.cpu_slider.value || 0,
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
                cockpit.show_unexpected_error(ex);
            }).
            done(function(result) {
                PageRunImage.client.start(result.Id, { "PortBindings": port_bindings }).
                    fail(function(ex) {
                        cockpit.show_unexpected_error(ex);
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

cockpit.pages.push(new PageRunImage());

PageSearchImage.prototype = {
    _init: function() {
        this.id = "containers-search-image-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Get new image");
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
        this.address = cockpit.get_page_param('machine') || "localhost";
        this.client = cockpit.docker(this.address);

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

        var created = tr.children('td').eq(1);
        var size = tr.children('td').eq(2);

        var failed = false;
        var layers = {};

        this.client.pull(repo, tag).
            stream(function(progress) {
                if ("error" in progress) {
                    failed = true;
                    created.text = 'Error downloading';
                    size.text('Error downloading: ' + progress['errorDetail']['message']);
                    tr.on('click', function() {
                        // Make the row be gone when clicking it
                        tr.remove();
                    });
                }
                else if("status" in progress) {
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
                }
            }).
            done(function(progress) {
                // According to Docker, download was finished.
                if(!failed) {
                    tr.remove();
                }
            });

        $("#containers-search-image-dialog").modal('hide');
    },

    perform_search: function(client) {
        var term = $('#containers-search-image-search')[0].value;

        $('#containers-search-image-waiting').addClass('waiting');
        $('#containers-search-image-no-results').hide();
        $('#containers-search-image-results').hide();
        $('#containers-search-image-results tbody tr').remove();
        this.search_request = client.search(term).
          done(function(resp){
              $('#containers-search-image-waiting').removeClass('waiting');

              if(resp.length > 0) {
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
            this.search_request.cancel();
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

cockpit.pages.push(new PageSearchImage());

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
        unsetup_for_failure(this.client);

        cockpit.set_watched_client(null);
        this.dbus_client.release();
        this.dbus_client = null;

        $(this.client).off('.container-details');
        this.client.release();
        this.client = null;

        if (this.terminal) {
            this.terminal.close();
            this.terminal = null;
            $("#container-terminal").hide();
        }
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

                var author = cockpit.connection_config.name || cockpit.connection_config.user;
                $(commit).find(".container-author").attr('value', author);

                var command = "";
                if (info.Config)
                    command = quote_cmdline(info.Config.Cmd);
                if (!command)
                    command = info.Command;
                $(commit).find(".container-command").attr('value', command);
            }).
            find(".btn-primary").on("click", function() {
                var location = cockpit.location();
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
                        cockpit.show_unexpected_error(ex);
                    }).
                    done(function() {
                        location.go_up();
                    });
            });

        this.address = cockpit.get_page_param('machine') || "localhost";
        this.client = cockpit.docker(this.address);
        this.container_id = cockpit.get_page_param('id');
        this.name = this.container_id.slice(0,12);

        this.client.machine_info().
            done(function(info) {
                self.memory_limit.max = info.memory;
            });

        // Just for watching
        this.dbus_client = cockpit.dbus(this.address, { payload: "dbus-json1" });
        cockpit.set_watched_client(this.dbus_client);

        $(this.client).on('container.container-details', function (event, id, container) {
            if (id == self.container_id)
                self.update();
        });

        setup_for_failure(this, this.client);
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
        $('#container-details-ports-row').hide();
        $('#container-details-resource-row').hide();

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
        $('#container-details-commit').prop('disabled', !!info.State.Running);
        $('#container-details-memory-row').toggle(!!info.State.Running);
        $('#container-details-cpu-row').toggle(!!info.State.Running);
        $('#container-details-resource-row').toggle(!!info.State.Running);

        var name = render_container_name(info.Name);
        if (name != this.name) {
            this.name = name;
            cockpit.content_update_loc_trail();
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
        $('#container-details-names').text(render_container_name(info.Name));
        $('#container-details-created').text(info.Created);
        $('#container-details-image').text(info.Image);
        $('#container-details-command').text(render_container_cmdline(info));
        $('#container-details-state').text(render_container_state(info.State));

        $('#container-details-ports-row').toggle(port_bindings.length > 0);
        $('#container-details-ports').html(port_bindings.map(cockpit.esc).join('<br/>'));

        update_memory_bar(this.memory_usage, info.MemoryUsage, info.MemoryLimit);
        $('#container-details-memory-text').text(format_memory_and_limit(info.MemoryUsage, info.MemoryLimit));

        $('#container-details .cpu-usage').text(format_cpu_usage(info.CpuUsage));
        $('#container-details .cpu-shares').text(format_cpu_shares(info.CpuPriority));

        this.maybe_show_terminal(info);
    },

    start_container: function () {
        var self = this;
        this.client.start(this.container_id).
                fail(function(ex) {
                    cockpit.show_unexpected_error(ex);
                }).
                done(function() {
                    self.maybe_reconnect_terminal();
                });
    },

    stop_container: function () {
        this.client.stop(this.container_id).
                fail(function(ex) {
                    cockpit.show_unexpected_error(ex);
                });
    },

    restart_container: function () {
        var self = this;
        this.client.restart(this.container_id).
                fail(function(ex) {
                    cockpit.show_unexpected_error(ex);
                }).
                done(function() {
                    self.maybe_reconnect_terminal();
                });
    },

    delete_container: function () {
        var self = this;
        var location = cockpit.location();
        cockpit.confirm(F(_("Please confirm deletion of %{name}"), { name: self.name }),
                        _("Deleting a container will erase all data in it."),
                        _("Delete")).
            done(function () {
                self.client.rm(self.container_id).
                    fail(function(ex) {
                        cockpit.show_unexpected_error(ex);
                    }).
                    done(function() {
                        location.go_up();
                    });
            });
    }

};

function PageContainerDetails() {
    this._init();
}

cockpit.pages.push(new PageContainerDetails());

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
        unsetup_for_failure(this.client);

        cockpit.set_watched_client(null);
        this.dbus_client.release();
        this.dbus_client = null;

        $(this.client).off('.image-details');
        this.client.release();
        this.client = null;
    },

    setup: function() {
        $('#image-details-run').on('click', $.proxy(this, "run_image"));
        $('#image-details-delete').on('click', $.proxy(this, "delete_image"));
    },

    enter: function() {
        var self = this;

        this.address = cockpit.get_page_param('machine') || "localhost";
        this.client = cockpit.docker(this.address);
        this.image_id = cockpit.get_page_param('id');
        this.name = F(_("Image %{id}"), { id: this.image_id.slice(0,12) });

        // Just for watching
        this.dbus_client = cockpit.dbus(this.address, { payload: "dbus-json1" });
        cockpit.set_watched_client(this.dbus_client);

        $('#image-details-containers table tbody tr').remove();

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

        if (info.RepoTags && info.RepoTags.length > 0) {
            var name = info.RepoTags[0];
            if (name != this.name) {
                this.name = name;
                cockpit.content_update_loc_trail();
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

            $('#image-details-entrypoint').text(quote_cmdline(config.Entrypoint));
            $('#image-details-command').text(quote_cmdline(config.Cmd));
            $('#image-details-ports').text(ports.join(', '));
        }
    },

    render_container: function (id, container) {
        render_container(this.client, $('#image-details-containers'), null, "I",
                         id, container);
    },

    run_image: function () {
        PageRunImage.display(this.client, this.image_id);
    },

    delete_image: function () {
        var self = this;
        var location = cockpit.location();
        cockpit.confirm(F(_("Please confirm deletion of %{name}"), { name: self.name }),
                        _("Deleting an image will delete it, but you can probably download it again if you need it later.  Unless this image has never been pushed to a repository, that is, in which case you probably can't download it again."),
                        _("Delete")).
            done(function () {
                self.client.rmi(self.image_id).
                    fail(function(ex) {
                        cockpit.show_unexpected_error(ex);
                    }).
                    done(function() {
                        location.go_up();
                    });
            });
    }

};

function PageImageDetails() {
    this._init();
}

cockpit.pages.push(new PageImageDetails());

function DockerClient(machine) {
    var me = this;
    var events;
    var rest;
    var connected;
    var got_failure;
    var alive = true;

    /* We use the Docker API v1.10 as documented here:

       https://docs.docker.com/reference/api/docker_remote_api/

       TODO: We should update eventually.  Later versions have
       incompatible changes, but they are also nicer.
     */

    /* This is a named function because we call it recursively */
    function connect_events() {

        /* Trigger the event signal when JSON from /events */
        events.stream(function(resp) {
            docker_debug("event:", resp);
            if (connected.state() == "pending")
                connected.resolve();
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

    function cleanup_container(id, container) {
       if (!container)
           return;
       var name = container_to_name(container);
       if (name && containers_by_name[name] == id)
           delete containers_by_name[name];
    }

    function perform_connect() {
        got_failure = false;
        connected = $.Deferred();
        rest = cockpit.rest("unix:///var/run/docker.sock", machine);
        events = rest.get("/v1.10/events");

        connect_events();

        /*
         * Gets a list of the containers and details for each one.  We use
         * /events for notification when something changes.  However, for
         * extra robustness and to account for the fact that there are no
         * events when new images appear, we also poll for changes.
         */
        rest.poll("/v1.10/containers/json", 4000, events, { "all": 1 }).
            stream(function(containers) {
                if (connected.state() == "pending")
                    connected.resolve();
                alive = true;

                /*
                 * The output we get from /containers/json is mostly useless
                 * conflicting with the information that we get about specific
                 * containers. So just use it to get a list of containers.
                 */
                $(containers).each(function(i, item) {
                    var id = item.Id;
                    containers_meta[id] = item;
                    if (id && !polls[id]) {
                        polls[id] = rest.poll("/v1.10/containers/" + id + "/json", 5000, events).
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
                                    cleanup_container(id, me.containers[id]);
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
                    } else if (id && me.containers[id]) {
                        populate_container(id, me.containers[id]);
                        $(me).trigger("container", [id, me.containers[id]]);
                    }
                });
            }).
            fail(function(ex) {
                if (connected.state() == "pending")
                    connected.reject(ex);
                got_failure = true;
                $(me).trigger("failure", [ex]);
            });

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

        /*
         * Gets a list of images and keeps it up to date. Again, the /images/json and
         * /images/xxxx/json have completely inconsistent keys. So using the former
         * is pretty useless here :S
         */
        var images_req = rest.poll("/v1.10/images/json", 1000).
            stream(function(images) {
                if (connected.state() == "pending")
                    connected.resolve();
                alive = true;

                $(images).each(function(i, item) {
                    var id = item.Id;
                    images_meta[id] = item;
                    if (id && !polls[id]) {
                        polls[id] = rest.poll("/v1.10/images/" + id + "/json", 0, images_req).
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
                    } else if (id && me.images[id]) {
                        populate_image(id, me.images[id]);
                        $(me).trigger("image", [id, me.images[id]]);
                    }
                });
            }).
            fail(function(ex) {
                if (connected.state() == "pending")
                    connected.reject(ex);
                got_failure = true;
                $(me).trigger("failure", [ex]);
            });

        /* TODO: This code needs to be migrated away from dbus-json1 */
        dbus_client = cockpit.dbus(machine, { payload: "dbus-json1" });
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

    /* Pull an image from the central registry
     */
    this.pull = function pull(repo, tag) {
        docker_debug("pulling: " + repo + ", tag: " + tag);

        var url = "/v1.10/images/create?fromImage=" + repo;
        if(tag !== '') {
            url += "&tag=" + tag;
        }

        return rest.post(url);
    };

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
        docker_debug("starting:", id, options);
        return rest.post("/v1.10/containers/" + id + "/start", null, options).
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
        return rest.post("/v1.10/containers/" + id + "/stop", { 't': timeout }).
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
        return rest.post("/v1.10/containers/" + id + "/restart").
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
        return rest.post("/v1.10/containers/create", { "name": name }, options).
            fail(function(ex) {
                docker_debug("create failed:", name, ex);
            }).
            done(function(resp) {
                docker_debug("created:", name, resp);
            });
    };

    this.search = function search(term) {
        docker_debug("searching:", term);
        return rest.get("/v1.10/images/search", { "term": term }).
            fail(function(ex) {
                docker_debug("search failed:", term, ex);
            }).
            done(function(resp) {
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
        return rest.post("/v1.10/commit", args, run_config).
            fail(function(ex) {
                docker_debug("commit failed:", repotag, ex);
            }).
            done(function(resp) {
                docker_debug("committed:", repotag);
            }).
            always(function() {
                not_waiting(id);
            });
    };

    this.rm = function rm(id) {
        waiting(id);
        docker_debug("deleting:", id);
        return rest.del("/v1.10/containers/" + id).
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
        return rest.del("/v1.10/images/" + id).
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

    function change_cgroup(directory, cgroup, filename, value) {
        /* TODO: Yup need a nicer way of doing this ... likely systemd once we're geard'd out */
        var path = "/sys/fs/cgroup/" + directory + "/" + cgroup + "/" + filename;
        var command = "echo '" + value.toFixed(0) + "' > " + path;
        docker_debug("changing cgroup:", command);

        /*
         * TODO: We need a sane UI for showing that the resources can't be changed
         * Showing unexpected error isn't it.
         */
        var options = {
            host: cockpit.get_page_param("machine", "server")
        };
        cockpit.spawn(["sh", "-c", command], options).
            fail(function(ex) {
                console.warn(ex);
            });
    }

    this.change_memory_limit = function change_memory_limit(id, value) {
        if (value == undefined || value <= 0)
            value = -1;
        return change_cgroup("memory", this.containers[id].CGroup, "memory.limit_in_bytes", value);
    };

    this.change_swap_limit = function change_swap_limit(id, value) {
        if (value == undefined || value <= 0)
            value = -1;
        return change_cgroup("memory", this.containers[id].CGroup, "memory.memsw.limit_in_bytes", value);
    };

    this.change_cpu_priority = function change_cpu_priority(id, value) {
        if (value == undefined || value <= 0)
            value = 1024;
        return change_cgroup("cpuacct", this.containers[id].CGroup, "cpu.shares", value);
    };

    this.setup_cgroups_plot = function setup_cgroups_plot(element, sample_index, colors) {
        function is_container(cgroup) {
            return !!container_from_cgroup(cgroup);
        }

        return cockpit.setup_multi_plot(element, monitor, sample_index, colors,
                                        is_container);
    };

    this.machine_info = function machine_info() {
        return cockpit.util.machine_info(machine);
    };


    this.close = function close() {
        $(monitor).off('NewSample', handle_new_samples);
        monitor = null;
        if (rest)
            rest.close();
        rest = null;
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
        channel = cockpit.channel({
            "host": machine,
            "payload": "text-stream",
            "unix": "/var/run/docker.sock"
        });

        var buffer = "";
        var headers = false;
        self.connected = true;

        $(channel).
            on("close.terminal", function(ev, options) {
                self.connected = false;
                var problem = options.reason || "disconnected";
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
            "POST /v1.10/containers/" + id + "/attach?logs=1&stream=1&stdin=1&stdout=1&stderr=1 HTTP/1.0\r\n" +
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

})(jQuery, cockpit);
