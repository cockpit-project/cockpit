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

PageContainers.prototype = {
    _init: function() {
        this.id = "containers";
    },

    getTitle: function() {
        return C_("page-title", "Containers");
    },

    enter: function(first_visit) {
        if (first_visit) {
            this.client = new DockerClient();
            $(this.client).on('event', $.proxy (this, "update"));

            this.container_filter_btn =
                cockpit_select_btn($.proxy(this, "update"),
                                   [ { title: _("All"),                 choice: 'all',  is_default: true },
                                     { title: _("Running"),             choice: 'running' },
                                     { title: _("10 Recently Created"), choice: 'recent10' }
                                   ]);
            $('#containers-containers .panel-heading span').append(this.container_filter_btn);
        }
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var me = this;

        var filter = cockpit_select_btn_selected(this.container_filter_btn);

        // Updating happens asynchronously, as we receive responses
        // from Docker.  However, a event might come in that triggers
        // a new update before the last one has finished.  To prevent
        // these two concurrent updates from interfering with each
        // other when they manipulate the DOM, we give each
        // asynchronous call a fresh and unique DOM element to
        // populate when the results come in.  If this update as been
        // overtaken by a concurrent update that DOM element will
        // never appear in the document.
        //
        // A better solution would be to maintain a Docker Object
        // Model that can be consulted synchronously and sends
        // asynchronous change notifications.

        function multi_line(strings) {
            return strings.map(cockpit_esc).join('<br/>');
        }

        function render_container(container) {

            var state_td = $('<td>');
            var tr =
                $('<tr>').append(
                    $('<td>').html(multi_line(container.Names.map(cockpit_render_container_name))),
                    $('<td>').text(container.Image),
                    $('<td>').text(container.Command),
                    state_td);

            tr.on('click', function (event) {
                cockpit_go_down ({ page: 'container-details',
                                   id: container.Id
                                 });
            });

            me.client.get("/containers/" + container.Id + "/json",
                          function (error, info) {
                              var state = info.State;
                              state_td.text(cockpit_render_container_state(state));
                          });

            return tr;
        }

        function render_image(image) {

            var tr =
                $('<tr>').append(
                    $('<td>').html(multi_line(image.RepoTags)),
                    $('<td>').text(new Date(image.Created*1000).toLocaleString()),
                    $('<td>').text(cockpit_format_bytes_pow2 (image.VirtualSize)));

            tr.on('click', function (event) {
                cockpit_go_down ({ page: 'image-details',
                                   id: image.Id
                                 });
            });

            return tr;
        }

        var container_table = $('<table class="table">');
        $('#containers-containers table').replaceWith(container_table);

        var containers_resource = '/containers/json';
        if (filter == 'all')
            containers_resource += '?all=1';
        else if (filter == 'recent10')
            containers_resource += '?limit=10';

        this.client.get(containers_resource, function (error, containers) {
            if (error) {
                container_table.append(
                    $('<tr>').append(
                        $('<td>').text(F("Can't get %{resource}: %{error}",
                                         { resource: containers_resource, error: error }))));
                return;
            }

            container_table.append(
                $('<tr>', { 'style': 'font-weight:bold' }).append(
                    $('<td>').text(_("Name")),
                    $('<td>').text(_("Image")),
                    $('<td>').text(_("Command")),
                    $('<td>').text(_("Status"))),
                containers.map(render_container));
        });

        var images_table = $('<table class="table">');
        $('#containers-images table').replaceWith(images_table);

        this.client.get('/images/json', function (error, images) {
            if (error) {
                images_table.append(
                    $('<tr>').append(
                        $('<td>').text(F("Can't get %{resource}: %{error}",
                                         { resource: '/images/json', error: error }))));
                return;
            }

            images_table.append(
                $('<tr>', { 'style': 'font-weight:bold' }).append(
                    $('<td>').text(_("Tags")),
                    $('<td>').text(_("Created")),
                    $('<td>').text(_("Virtual Size"))),
                images.map(render_image));
        });
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
        if (first_visit) {
            $("#containers-run-image-run").on('click', $.proxy(this, "run"));
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

        $("#containers-run-image-name").val(make_name());
        $("#containers-run-image-command").val(cockpit_quote_cmdline(PageRunImage.image_info.config.Cmd));

        function render_port(p) {
            var port_input = $('<input class="form-control" style="display:inline;width:auto" >');
            var tr =
                $('<tr class="port-map">').append(
                    $('<td>').text(
                        F(_("Bind port %{port} to "),
                          { port: p })),
                    $('<td>').append(
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

        PageRunImage.client.post("/containers/create?name=" + encodeURIComponent(name),
                                 { "Cmd": cockpit_unquote_cmdline(cmd),
                                   "Image": PageRunImage.image_info.id
                                 },
                                 function (error, result) {
                                     if (error)
                                         cockpit_show_unexpected_error (error);
                                     else {
                                         PageRunImage.client.post("/containers/" + result.Id + "/start", { "PortBindings": port_bindings },
                                                                  function (error) {
                                                                      if (error)
                                                                          cockpit_show_unexpected_error (error);
                                                                  });
                                     }
                                 });
    }
};

function PageRunImage() {
    this._init();
}

cockpit_pages.push(new PageRunImage());

PageContainerDetails.prototype = {
    _init: function() {
        this.id = "container-details";
    },

    getTitle: function() {
        var id = this.container_id;
        return F(C_("page-title", "Container %{id}"), { id: id? id.slice(0,12) : "<??>" });
    },

    show: function() {
    },

    leave: function() {
        this.destroy_monitor();
    },

    enter: function(first_visit) {
        this.container_id = cockpit_get_page_param('id');

        if (first_visit) {
            this.client = new DockerClient();
            $(this.client).on('event', $.proxy (this, "update"));

            $('#container-details-start').on('click', $.proxy(this, "start_container"));
            $('#container-details-stop').on('click', $.proxy(this, "stop_container"));
            $('#container-details-restart').on('click', $.proxy(this, "restart_container"));
            $('#container-details-delete').on('click', $.proxy(this, "delete_container"));
        }

        $('#container-details-monitor').hide();
        this.reset_monitor();
        this.update();
    },

    update: function() {
        var me = this;
        $('#container-details-names').text("");
        $('#container-details-id').text("");
        $('#container-details-created').text("");
        $('#container-details-image').text("");
        $('#container-details-command').text("");
        $('#container-details-state').text("");
        $('#container-details-ports').text("");
        this.client.get("/containers/" + this.container_id + "/json",
                        function (error, result) {
                            if (error) {
                                $('#container-details-names').text(error);
                                return;
                            }

                            var port_bindings = [ ];
                            if (result.NetworkSettings) {
                                for (var p in result.NetworkSettings.Ports) {
                                    var h = result.NetworkSettings.Ports[p];
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

                            $('#container-details-id').text(result.ID);
                            $('#container-details-names').text(cockpit_render_container_name(result.Name));
                            $('#container-details-created').text(result.Created);
                            $('#container-details-image').text(result.Image);
                            $('#container-details-command').text(cockpit_quote_cmdline([ result.Path ].concat(result.Args)));
                            $('#container-details-state').text(cockpit_render_container_state(result.State));
                            $('#container-details-ports').html(port_bindings.map(cockpit_esc).join('<br/>'));

                            if (result.State && result.State.Running)
                                me.create_monitor ();
                            else
                                me.destroy_monitor ();
                        });
    },

    create_monitor: function () {
        var me = this;
        if (!me.monitor) {
            var manager = cockpit_dbus_client.lookup("/com/redhat/Cockpit/Manager",
                                                     "com.redhat.Cockpit.Manager");
            me.monitor = "...";
            $('#container-details-monitor').show();
            manager.call('CreateCGroupMonitor', "lxc/" + this.container_id,
                         function (error, result) {
                             if (result) {
                                 var m = cockpit_dbus_client.lookup(result,
                                                                    "com.redhat.Cockpit.ResourceMonitor");
                                 if (!me.monitor) {
                                     m.call('Destroy', function (error) {
                                         if (error)
                                             console.log(error);
                                     });
                                 } else {
                                     me.monitor = m;
                                     $(me.monitor).on('NewSample', function (event, time, samples) {
                                         me.update_monitor(samples);
                                     });
                                 }
                             }
                         });
        }
    },

    destroy_monitor: function () {
        if (this.monitor) {
            if (this.monitor != "...") {
                this.monitor.call('Destroy', function (error) {
                    if (error)
                        console.log(error);
                });
            }
            $('#container-details-monitor').hide();
            this.monitor = null;
        }
    },

    reset_monitor: function () {
        $('#container-details-monitor-title').text("");
        var table = $('#container-details-monitor-graph');
        table.find('td:nth-child(1)').attr('width', '0%');
        table.find('td:nth-child(2)').attr('width', '0%');
        table.find('td:nth-child(3)').attr('width', '100%');
        table.find('td:nth-child(4)').attr('width', '0%');
    },

    update_monitor: function (samples) {
        var me = this;

        var mem_used = samples[0];
        var swap_used = samples[2] - mem_used;
        var limit = samples[3];

        function round_top(num) {
            var gran = (num < 1024*1024*1024)? 100*1024*1024 : 10*1024*1024*1024;
            return (Math.ceil(num / gran)*1.5)*gran;
        }

        var total = round_top(mem_used+swap_used);
        var off_limit = (limit < total)? total-limit : 0;
        var empty = total - swap_used - mem_used - off_limit;
        function perc(num) { return Math.round(num/total * 100).toString() + '%'; }

        var title = F(limit < 1e16?_("%{inuse} of %{limit} in use") : _("%{inuse} in use"),
                      { inuse: cockpit_format_bytes_pow2 (mem_used+swap_used),
                        limit: cockpit_format_bytes_pow2 (limit)
                      });

        $('#container-details-monitor-title').text(title);
        var table = $('#container-details-monitor-graph');
        table.find('td:nth-child(1)').attr('width', perc(swap_used));
        table.find('td:nth-child(2)').attr('width', perc(mem_used));
        table.find('td:nth-child(3)').attr('width', perc(empty));
        table.find('td:nth-child(4)').attr('width', perc(off_limit));
    },

    start_container: function () {
        this.client.post("/containers/" + this.container_id + "/start", null, function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    stop_container: function () {
        this.client.post("/containers/" + this.container_id + "/stop?t=10", null, function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    restart_container: function () {
        this.client.post("/containers/" + this.container_id + "/restart", null, function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    delete_container: function () {
        this.client.delete_("/containers/" + this.container_id, function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
            else
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
        var id = this.image_id;
        return F(C_("page-title", "Image %{id}"), { id: id? id.slice(0,12) : "<??>" });
    },

    show: function() {
    },

    leave: function() {
    },

    enter: function(first_visit) {
        this.image_id = cockpit_get_page_param('id');

        if (first_visit) {
            this.client = new DockerClient();
            $(this.client).on('event', $.proxy (this, "update"));

            $('#image-details-run').on('click', $.proxy(this, "run_image"));
            $('#image-details-delete').on('click', $.proxy(this, "delete_image"));
        }

        this.update();
    },

    update: function() {
        $('#image-details-id').text("");
        $('#image-details-entrypoint').text("");
        $('#image-details-command').text("");
        $('#image-details-created').text("");
        $('#image-details-author').text("");
        $('#image-details-ports').text("");

        this.client.get("/images/" + this.image_id + "/json",
                        function (error, result) {
                            if (error) {
                                $('#image-details-id').text(error);
                                return;
                            }

                            $('#image-details-id').text(result.id);
                            $('#image-details-created').text(result.created);
                            $('#image-details-author').text(result.author);

                            var config = result.config;
                            if (config) {
                                var ports = [ ];
                                for (var p in config.ExposedPorts) {
                                    ports.push(p);
                                }

                                $('#image-details-entrypoint').text(cockpit_quote_cmdline(config.Entrypoint));
                                $('#image-details-command').text(cockpit_quote_cmdline(config.Cmd));
                                $('#image-details-ports').text(ports.join(', '));
                            }
                        });
    },

    run_image: function () {
        var me = this;
        this.client.get("/images/" + this.image_id + "/json", function (error, info) {
            if (error) {
                cockpit_show_unexpected_error (error);
            } else {
                PageRunImage.image_info = info;
                PageRunImage.client = me.client;
                $("#containers_run_image_dialog").modal('show');
            }
        });
    },

    delete_image: function () {
        this.client.delete_("/images/" + this.image_id, function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
            else
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

    /* Subscribe to docker events

       XXX - streaming JSON doesn't work yet since message don't
             always contain exactly one JSON object.
    */
    rest.getraw("/events").stream(function(resp) {
        console.log("DockerClient event:", resp);
        $(me).trigger("event");
    }).fail(function(reason) {
        console.warn("DockerClient events failed:", reason);
    });

    /*
     * TODO: it would probably make sense for this API to use
     * Deferreds as well. But for now we just map it to the
     * continuation style API DockerClient has.
     */

    function get(resource, cont) {
        rest.get(resource).done(function(resp) {
                cont(null, resp);
            }).fail(function(reason) {
                cont(reason);
            });
    }

    function post(resource, data, cont) {
        rest.post(resource, data).done(function(resp) {
                cont(null, resp);
            }).fail(function(reason) {
                cont(reason);
            });
    }

    function delete_ (resource, cont) {
        rest.del(resource).done(function(resp) {
                cont(null, resp);
            }).fail(function(reason) {
                cont(reason);
            });
    }

    this.get = get;
    this.post = post;
    this.delete_ = delete_;
}
