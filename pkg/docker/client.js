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
    "docker/util",
    "shell/shell",
    "shell/cockpit-plot",
    "shell/cockpit-util",
], function($, cockpit, util, shell) {

    /* DOCKER CLIENT
     */

    function DockerClient() {
        var self = this;
        var events;
        var watch;
        var http;
        var connected;
        var got_failure;
        var alive = true;

        var later;
        function trigger_event() {
            if (!later) {
                later = window.setTimeout(function() {
                    later = null;
                    $(self).trigger("event");
                }, 300);
            }
        }

        /* This is a named function because we call it recursively */
        function connect_events() {

            /* Trigger the event signal when JSON from /events */
            events = http.get("/v1.12/events");
            events.stream(function(resp) {
                util.docker_debug("event:", resp);
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

        /* Resource usage sampling */
        var usage_metrics_channel;
        var usage_grid;
        var usage_samples = { };

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

            // Add in the fields of the short form of the container
            // info, but never overwrite fields that are already in
            // the long form.
            //
            // TODO: Figure out and document why we do this at all.

            for (var m in containers_meta[id]) {
                if (container[m] === undefined)
                    container[m] = containers_meta[id][m];
            }

            var name = container_to_name(container);
            if (name)
                containers_by_name[name] = id;
            if (!container.CGroup)
                container.CGroup = cgroup_from_container(id);
        }

        function remove_container(id) {
            var container = self.containers[id];
            if (container) {
                var name = container_to_name(container);
                if (name && containers_by_name[name] == id)
                    delete containers_by_name[name];
                delete self.containers[id];
                $(self).trigger("container", [id, undefined]);
            }
        }

        function fetch_containers() {
            /*
             * Gets a list of the containers and details for each one.  We use
             * /events for notification when something changes as well as some
             * file monitoring.
             */
            http.get("/v1.12/containers/json", { all: 1 }).
                done(function(data) {
                    var containers = JSON.parse(data);
                    if (connected.state() == "pending")
                        connected.resolve();
                    alive = true;

                    var seen = {};
                    $(containers).each(function(i, item) {
                        var id = item.Id;
                        if (!id)
                            return;

                        seen[id] = id;
                        containers_meta[id] = item;
                        http.get("/v1.12/containers/" + encodeURIComponent(id) + "/json").
                            done(function(data) {
                                var container = JSON.parse(data);
                                populate_container(id, container);
                                self.containers[id] = container;
                                usage_samples[id] = [ usage_grid.add(usage_metrics_channel,
                                                                     [ "cgroup.memory.usage", container.CGroup ]),
                                                      usage_grid.add(usage_metrics_channel,
                                                                     [ "cgroup.cpu.usage", container.CGroup ]),
                                                      usage_grid.add(usage_metrics_channel,
                                                                     [ "cgroup.memory.limit", container.CGroup ]),
                                                      usage_grid.add(usage_metrics_channel,
                                                                     [ "cgroup.cpu.shares", container.CGroup ])
                                                    ];
                                $(self).trigger("container", [id, container]);
                            });
                    });

                    var removed = [];
                    $.each(self.containers, function(id) {
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
                    $(self).trigger("failure", [ex]);
                });
        }

        function handle_usage_samples() {
            for (var id in usage_samples) {
                var container = self.containers[id];
                if (!container)
                    continue;
                var samples = usage_samples[id];
                var mem = samples[0][0];
                var limit = samples[2][0];
                /* if the limit is extremely high, consider the value to mean unlimited
                 * 1.115e18 is roughly 2^60
                 */
                if (limit > 1.115e18)
                    limit = undefined;
                var cpu = samples[1][0]/10;
                var priority = samples[3][0];
                if (mem != container.MemoryUsage ||
                    limit != container.MemoryLimit ||
                    cpu != container.CpuUsage ||
                    priority != container.CpuPriority) {
                    container.MemoryUsage = mem;
                    container.MemoryLimit = limit;
                    container.CpuUsage = cpu;
                    container.CpuPriority = priority;
                    $(self).trigger("container", [id, container]);
                }
            }
        }

        function populate_image(id, image) {
            if (image.Config === undefined) {
                if (image.ContainerConfig)
                    image.Config = image.ContainerConfig;
                else
                    image.Config = { };
            }
            $.extend(image, images_meta[id]);

            /* HACK: TODO upstream bug */
            if (image.RepoTags)
                image.RepoTags.sort();
        }

        function remove_image(id) {
            if (self.images[id]) {
                delete self.images[id];
                $(self).trigger("image", [id, undefined]);
            }
        }

        function fetch_images() {
            /*
             * Gets a list of images and keeps it up to date.
             */
            http.get("/v1.12/images/json").
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
                        http.get("/v1.12/images/" + encodeURIComponent(id) + "/json").
                            done(function(data) {
                                var image = JSON.parse(data);
                                populate_image(id, image);
                                self.images[id] = image;
                                $(self).trigger("image", [id, image]);
                            });
                    });

                    var removed = [];
                    $.each(self.images, function(id) {
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
                    $(self).trigger("failure", [ex]);
                });
        }

        $(self).on("event", function() {
            fetch_containers();
            fetch_images();
        });

        function perform_connect() {
            got_failure = false;
            connected = $.Deferred();
            http = cockpit.http("/var/run/docker.sock", { superuser: "try" });

            connect_events();

            if (watch && watch.valid)
                watch.close();

            http.get("/v1.12/info").done(function(data) {
                var info = data && JSON.parse(data);
                watch = cockpit.channel({ payload: "fslist1", path: info["DockerRootDir"], superuser: "try" });
                $(watch).on("message", function(event, data) {
                    trigger_event();
                });
                $(watch).on("close", function(event, options) {
                    if (options.problem && options.problem != "not-found")
                        console.warn("monitor for docker directory failed: " + options.problem);
                });

                $(self).triggerHandler("event");
            }).fail(function(err) {
                if (err != "not-found")
                    console.warn("monitor for docker directory failed: " + err);
                $(self).triggerHandler("event");
            });

            usage_metrics_channel = cockpit.metrics(1000,
                                                    { source: "internal",
                                                      metrics: [ { name: "cgroup.memory.usage",
                                                                   units: "bytes"
                                                                 },
                                                                 { name: "cgroup.cpu.usage",
                                                                   units: "millisec",
                                                                   derive: "rate"
                                                                 },
                                                                 { name: "cgroup.memory.limit",
                                                                   units: "bytes"
                                                                 },
                                                                 { name: "cgroup.cpu.shares",
                                                                   units: "count"
                                                                 }
                                                               ]
                                                    });
            usage_grid = cockpit.grid(1000, -1, -0);
            usage_grid.walk();

            $(usage_grid).on('notify', function (event, index, count) {
                handle_usage_samples();
            });
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

        this.cgroup_from_container = cgroup_from_container;
        function cgroup_from_container(id) {
            return "system.slice/docker-" + id + ".scope";
        }

        function trigger_id(id) {
            if (id in self.containers)
                $(self).trigger("container", [id, self.containers[id]]);
            else if (id in self.images)
                $(self).trigger("image", [id, self.images[id]]);
        }

        function waiting(id, yes) {
            if (id in self.waiting) {
                self.waiting[id]++;
            } else {
                self.waiting[id] = 1;
                trigger_id(id);
            }
        }

        function not_waiting(id) {
            self.waiting[id]--;
            if (self.waiting[id] === 0) {
                delete self.waiting[id];
                trigger_id(id);
            }
        }

        /* Actually connect initially */
        perform_connect();

        this.start = function start(id, options) {
            waiting(id);
            util.docker_debug("starting:", id);
            return http.request({
                method: "POST",
                path: "/v1.12/containers/" + encodeURIComponent(id) + "/start",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(options || { })
            })
                .fail(function(ex) {
                    util.docker_debug("start failed:", id, ex);
                })
                .done(function(resp) {
                    util.docker_debug("started:", id, resp);
                })
                .always(function() {
                    not_waiting(id);
                });
        };

        this.stop = function stop(id, timeout) {
            waiting(id);
            if (timeout === undefined)
                timeout = 10;
            util.docker_debug("stopping:", id, timeout);
            return http.request({
                method: "POST",
                path: "/v1.12/containers/" + encodeURIComponent(id) + "/stop",
                params: { 't': timeout },
                body: ""
            })
                .fail(function(ex) {
                    util.docker_debug("stop failed:", id, ex);
                })
                .done(function(resp) {
                    util.docker_debug("stopped:", id, resp);
                })
                .always(function() {
                    not_waiting(id);
                });
        };

        this.restart = function restart(id, timeout) {
            waiting(id);
            if (timeout === undefined)
                timeout = 10;
            util.docker_debug("restarting:", id);
            return http.request({
                method: "POST",
                path: "/v1.12/containers/" + encodeURIComponent(id) + "/restart",
                params: { 't': timeout },
                body: ""
            })
                .fail(function(ex) {
                    util.docker_debug("restart failed:", id, ex);
                })
                .done(function(resp) {
                    util.docker_debug("restarted:", id, resp);
                })
                .always(function() {
                    not_waiting(id);
                });
        };

        this.create = function create(name, options) {
            var body = JSON.stringify(options || { });
            util.docker_debug("creating:", name, body);
            return http.request({
                method: "POST",
                path: "/v1.12/containers/create",
                params: { "name": name },
                headers: { "Content-Type": "application/json" },
                body: body,
            })
                .fail(function(ex) {
                    util.docker_debug("create failed:", name, ex);
                })
                .done(function(resp) {
                    util.docker_debug("created:", name, resp);
                })
                .then(JSON.parse);
        };

        this.search = function search(term) {
            util.docker_debug("searching:", term);
            return http.get("/v1.12/images/search", { "term": term })
                .fail(function(ex) {
                    util.docker_debug("search failed:", term, ex);
                })
                .done(function(resp) {
                    util.docker_debug("searched:", term, resp);
                });
        };

        this.commit = function create(id, repotag, options, run_config) {
            var args = {
                "container": id,
                "repo": repotag
            };
            $.extend(args, options);

            waiting(id);
            util.docker_debug("committing:", id, repotag, options, run_config);
            return http.request({
                method: "POST",
                path: "/v1.12/commit",
                params: args,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(run_config || { })
            })
                .fail(function(ex) {
                    util.docker_debug("commit failed:", repotag, ex);
                })
                .done(function(resp) {
                    util.docker_debug("committed:", repotag);
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
            util.docker_debug("deleting:", id);
            return http.request({
                method: "DELETE",
                path: "/v1.12/containers/" + encodeURIComponent(id),
                params: { "force": forced },
                body: ""
            })
                .fail(function(ex) {
                    util.docker_debug("delete failed:", id, ex);
                })
                .done(function(resp) {
                    util.docker_debug("deleted:", id, resp);
                    remove_container(id);
                })
                .always(function() {
                    not_waiting(id);
                });
        };

        this.rmi = function rmi(id) {
            waiting(id);
            util.docker_debug("deleting:", id);
            return http.request({
                method: "DELETE",
                path: "/v1.12/images/" + encodeURIComponent(id),
                body: ""
            })
                .fail(function(ex) {
                    util.docker_debug("delete failed:", id, ex);
                })
                .done(function(resp) {
                    util.docker_debug("deleted:", id, resp);
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
            util.docker_debug("changing cgroup:", command);

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

        this.machine_info = function machine_info() {
            return shell.util.machine_info();
        };

        this.info = function info() {
            return http.get("/v1.12/info")
                .fail(function(ex) {
                    util.docker_debug("info failed:", ex);
                })
                .done(function(resp) {
                    util.docker_debug("info:", resp);
                });
        };

        this.close = function close() {
            if (usage_metrics_channel) {
                usage_metrics_channel.close();
                usage_grid.close();
            }
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

    return {
        init: function () {
            return new DockerClient();
        }
    };

});
