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
            var self = this;
            this.client = new DockerClient();

            /* Every time a container appears, disappears, changes */
            $(this.client).on('container', function(event, id, container) {
                self.render_container(id, container);
            });

            /* Every time a container appears, disappears, changes */
            $(this.client).on('image', function(event, id, image) {
                self.render_image(id, image);
            });

            /* High level failures about the overall functionality of docker */
            $(this.client).on('failure', function(event, ex) {
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

            this.container_filter_btn =
                cockpit_select_btn($.proxy(this, "update"),
                                   [ { title: _("All"),                 choice: 'all',  is_default: true },
                                     { title: _("Running"),             choice: 'running' }
                                   ]);
            $('#containers-containers .panel-heading span').append(this.container_filter_btn);
        }

        /* HACK: This is our pretend angularjs */
        this.tags = { };

        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    render_container: function(id, container) {
        if (!container) {
            if (this.tags[id]) {
                this.tags[id].remove();
                delete this.tags[id];
            }
            return;
        }

        var tr =
            $('<tr>').append(
                    $('<td>').text(cockpit_render_container_name(container.Name)),
                    $('<td>').text(container.Image),
                    $('<td>').text(container.Command),
                    $('<td>').text(cockpit_render_container_state(container.State)));

        tr.on('click', function(event) {
            cockpit_go_down ({ page: 'container-details',
                id: id
            });
        });

        var filter = cockpit_select_btn_selected(this.container_filter_btn);
        if (filter == "running" && !container.State.Running)
            tr.css("display", "none");
        else
            tr.css("display", "table-row");

        if (this.tags[id])
            this.tags[id].replaceWith(tr);
        else
            $('#containers-containers table').append(tr);
        this.tags[id] = tr;
    },

    render_image: function(id, image) {
        if (!image) {
            if (this.tags[id]) {
                this.tags[id].remove();
                delete this.tags[id];
            }
            return;
        }

        function multi_line(strings) {
            return strings.map(cockpit_esc).join('<br/>');
        }

        var tr =
            $('<tr>').append(
                    $('<td>').html(multi_line(image.RepoTags)),
                    $('<td>').text(new Date(image.Created * 1000).toLocaleString()),
                    $('<td>').text(cockpit_format_bytes_pow2(image.VirtualSize)));

        tr.on('click', function (event) {
            cockpit_go_down ({ page: 'image-details',
                               id: image.Id
                             });
        });

        if (this.tags[id])
            this.tags[id].replaceWith(tr);
        else
            $('#containers-images table').append(tr);
        this.tags[id] = tr;
    },

    update: function() {
        var id;
        for (id in this.client.containers) {
            this.render_container(id, this.client.containers[id]);
        }

        for (id in this.client.images) {
            this.render_image(id, this.client.images[id]);
        }
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
        $("#containers-run-image-memory").val("");
        $("#containers-run-image-swap").val("");

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
        var mem_limit = cockpit_parse_bytes($("#containers-run-image-memory").val(), 0);
        var swap_limit = cockpit_parse_bytes($("#containers-run-image-swap").val(), 0);
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

        PageRunImage.client.post("/containers/create",
                                 { "name": name
                                 },
                                 { "Cmd": cockpit_unquote_cmdline(cmd),
                                   "Image": PageRunImage.image_info.id,
                                   "Memory": mem_limit,
                                   "MemorySwap": swap_limit
                                 },
                                 function (error, result) {
                                     if (error)
                                         cockpit_show_unexpected_error (error);
                                     else {
                                         PageRunImage.client.post("/containers/" + result.Id + "/start",
                                                                  null,
                                                                  { "PortBindings": port_bindings },
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

        this.update();
    },

    update: function() {
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
                        });
    },

    start_container: function () {
        this.client.post("/containers/" + this.container_id + "/start", null, null, function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    stop_container: function () {
        this.client.post("/containers/" + this.container_id + "/stop", { 't': '10' }, null, function (error, result) {
            if (error)
                cockpit_show_unexpected_error (error);
        });
    },

    restart_container: function () {
        this.client.post("/containers/" + this.container_id + "/restart", null, null, function (error, result) {
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

    var events = rest.get("/events");
    var alive = true;

    /* This is a named function because we call it recursively */
    function connect_events() {

        /* Trigger the event signal when JSON from /events */
        events.stream(function(resp) {
            console.log("DockerClient event:", resp);
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

    /* Both indexed by container.Id */
    this.containers = { };
    var polls = { };

    /* Indexd by image.Id */
    this.images = { };

    /*
     * Gets a list of the containers and then starts to poll each
     * one for changes. We rely on the /events for notification when
     * something changes. However since docker is racy with its /events
     * sometimes firing them before it updates its internal state ...
     * we rely on a interval fallback to see if something changed.
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
                    polls[id] = rest.poll("/containers/" + id + "/json", 5000, events).
                        stream(function(container) {
                            me.containers[id] = container;
                            $(me).trigger("container", [id, container]);
                        }).
                        fail(function(ex) {
                            /*
                             * A 404 is the way we determine when a cotnainer
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

    /*
     * Gets a list of images and keeps it up to date
     */
    rest.poll("/images/json", 1000).
        stream(function(images) {
            alive = true;

            var id;
            var snapshot = { };
            for (id in me.images)
                snapshot[id] = id;

            $(images).each(function(i, image) {
                delete snapshot[image.Id];
                me.images[image.Id] = image;
                $(me).trigger("image", [image.Id, image]);
            });

            /* Images that were deleted */
            for (id in snapshot) {
                delete me.images[id];
                $(me).trigger("image", [id, undefined]);
            }
        }).
        fail(function(ex) {
            $(me).trigger("failure", [ex]);
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

    function post(resource, params, body, cont) {
        rest.post(resource, params, body).done(function(resp) {
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
