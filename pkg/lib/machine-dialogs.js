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

    var mustache = require("mustache");

    var machines = require("machines");
    var credentials = require("credentials");

    var add_tmpl = require("raw!machine-add.html");
    var auth_failed_tmpl = require("raw!machine-auth-failed.html");
    var change_auth_tmpl = require("raw!machine-change-auth.html");
    var change_port_tmpl = require("raw!machine-change-port.html");
    var color_picker_tmpl = require("raw!machine-color-picker.html");
    var invalid_hostkey_tmpl = require("raw!machine-invalid-hostkey.html");
    var not_supported_tmpl = require("raw!machine-not-supported.html");
    var sync_users_tmpl = require("raw!machine-sync-users.html");
    var unknown_hosts_tmpl = require("raw!machine-unknown-hostkey.html");

    var _ = cockpit.gettext;

    var default_codes = {
        "no-cockpit": "not-supported",
        "not-supported": "not-supported",
        "protocol-error": "not-supported",
        "authentication-not-supported": "change-auth",
        "authentication-failed": "change-auth",
        "no-forwarding": "change-auth",
        "unknown-hostkey": "unknown-hostkey",
        "invalid-hostkey": "invalid-hostkey",
        "not-found": "add-machine",
        "sync-users": "sync-users"
    };

    function translate_and_init(tmpl) {
        var tmp = $("<div>").append(tmpl);
        tmp.find("[translatable=\"yes\"]").each(function(i, e) {
            var old = e.outerHTML;
            var translated = cockpit.gettext(e.getAttribute("context"), $(e).text());
            $(e).removeAttr("translatable").text(translated);
            tmpl = tmpl.replace(old, e.outerHTML);
        });
        mustache.parse(tmpl);
        return tmpl;
    }

    var templates = {
        "add-machine" : translate_and_init(add_tmpl),
        "auth-failed" : translate_and_init(auth_failed_tmpl),
        "change-auth" : translate_and_init(change_auth_tmpl),
        "change-port" : translate_and_init(change_port_tmpl),
        "color-picker" : translate_and_init(color_picker_tmpl),
        "invalid-hostkey" : translate_and_init(invalid_hostkey_tmpl),
        "not-supported" : translate_and_init(not_supported_tmpl),
        "sync-users" : translate_and_init(sync_users_tmpl),
        "unknown-hostkey" : translate_and_init(unknown_hosts_tmpl)
    };

    function full_address(machines_ins, address) {
        var machine = machines_ins.lookup(address);
        if (machine && machine.address != "localhost")
            return machine.connection_string;

        return address;
    }

    function Dialog(selector, address, machines_ins, codes) {
        var self = this;

        self.machines_ins = machines_ins;
        self.codes = codes;
        self.address = full_address(self.machines_ins, address);

        var promise_callback = null;

        var success_callback = null;

        var current_template = null;
        var current_instance = null;

        function address_or_label() {
            var machine = self.machines_ins.lookup(self.address);
            var host = self.machines_ins.split_connection_string(self.address).address;
            if (machine && machine.label)
                host = machine.label;
            return host;
        }

        function change_content(template, error_options) {
            var old_instance = current_instance;

            if (current_template === template)
                return;

            if (template == "add-machine")
                current_instance = new AddMachine(self);
            else if (template == "sync-users")
                current_instance = new SyncUsers(self);
            else if (template == "unknown-hostkey")
                current_instance = new HostKey(self, template);
            else if (template == "invalid-hostkey")
                current_instance = new HostKey(self, template);
            else if (template == "change-auth")
                current_instance = new ChangeAuth(self);
            else if (template == "change-port")
                current_instance = new MachinePort(self);
            else
                current_instance = new Simple(self);

            current_template = template;
            current_instance.load(error_options);

            if (old_instance && old_instance.close)
                old_instance.close();
            old_instance = null;
        }

        self.try_to_connect = function(address, options) {
            var dfd = $.Deferred();
            var conn_options = $.extend({ "payload": "echo",
                                          "host": address },
                                        options);

            var machine = self.machines_ins.lookup(address);
            if (machine && machine.host_key && !machine.on_disk) {
                conn_options['temp-session'] = false;
                conn_options['host-key'] = machine.host_key;
            }
            var client = cockpit.channel(conn_options);
            client.send("x");
            $(client)
               .on("message", function() {
                    $(client).off();
                    client.close();
                    dfd.resolve();
                })
                .on("close", function(event, options) {
                    dfd.reject(options);
                });

            return dfd.promise();
        };

        self.get_sel = function(child_selector) {
            var ret_txt = selector;
            if (child_selector)
                ret_txt = ret_txt + " " + child_selector;
            return $(ret_txt);
        };

        self.set_on_success = function (callback) {
            success_callback = callback;
        };

        self.set_goal = function (callback) {
            promise_callback = callback;
        };

        self.complete = function(val) {
            if (success_callback)
                success_callback(val);
            else
                $(selector).modal('hide');
        };

        self.render = function render(data, template) {
            if (!template)
                template = current_template;

            var address_data = self.machines_ins.split_connection_string(self.address);
            var context = $.extend({
                'host' : address_or_label(),
                'full_address' : self.address,
                'context_title' : self.context_title,
                'strong' : function() {
                    return function(text, render) {
                        return "<strong>" + render(text) + "</strong>";
                    };
                }
            }, data, address_data);

            var output = $(mustache.render(templates[template], context));
            cockpit.translate(output);
            self.get_sel(".modal-content").html(output);
        };

        self.render_error = function render_error(error) {
            var template;
            if (error.problem && error.command == "close")
                template = self.codes[error.problem];

            if (template && current_template !== template)
                change_content(template, error);
            else
                $(selector).dialog("failure", cockpit.message(error));
        };

        self.render_template = function render_template(template) {
            change_content(template);
        };

        self.show = function () {
            var sel = self.get_sel();
            sel.on('hide.bs.modal', function () {
                self.get_sel(".model-content").empty();
            });
            sel.modal('show');
        };

        self.run = function (promise, failure_callback) {
            var dialog_dfd = $.Deferred();
            var promise_funcs = [];

            function next(i) {
                promise_funcs[i]()
                    .done(function(val) {
                        i = i + 1;
                        if (i < promise_funcs.length) {
                            next(i);
                        } else {
                            dialog_dfd.resolve();
                            self.complete(val);
                        }
                    })
                    .fail(function(ex) {
                        if (failure_callback)
                            failure_callback(ex);
                        else
                            self.render_error(ex);
                        dialog_dfd.reject(ex);
                    });
            }

            promise_funcs.push(function() {
                return promise;
            });

            self.get_sel().dialog("wait", dialog_dfd.promise());
            if (promise_callback)
                promise_funcs.push(promise_callback);

            next(0);
        };
    }

    function is_method_supported(methods, method) {
        var result = methods[method];
        return result ? result != "no-server-support" : false;
    }

    function can_try_method(methods, method) {
        if (is_method_supported(methods, method))
            return method == 'password' || methods[method] != "not-provided";
        return false;
    }

    function MachineColorPicker(machines_ins) {
        var self = this;

        self.render = function(selector, address, selected_color) {
            var machine;

            if (address && !selected_color) {
                machine = machines_ins.lookup(address);
                if (machine)
                    selected_color = machine.color;
            }

            if (!selected_color)
                selected_color = machines_ins.unused_color();

            var part, colors = [];
            for (var i = 0; i < machines.colors.length; i += 6) {
                part = machines.colors.slice(i, i+6);
                colors.push({"list" : part});
            }

            var text = mustache.render(templates["color-picker"], { 'colors' : colors, });
            $(selector).html(text);

            $("#host-edit-color", selector).css("background-color", selected_color);
            $(".color-cell", selector).each(function(index) {
                $(this).css("background-color", machines.colors[index]);
            });

            $('#host-edit-color-popover .popover-content .color-cell', selector)
                .click(function() {
                    var color = $(this).css('background-color');
                    $('#host-edit-color', selector).css('background-color', color);
                });

            $("#host-edit-color", selector).parent().
                on('show.bs.dropdown', function () {
                    var $div = $('#host-edit-color', selector);
                    var $pop = $('#host-edit-color-popover', selector);
                    var div_pos = $div.position();
                    var div_width = $div.width();
                    var div_height = $div.height();
                    var pop_width = $pop.width();
                    var pop_height = $pop.height();

                    var top = div_pos.top - pop_height + 10;
                    if (top < 0) {
                        top = div_pos.top + div_height + 10;
                        $pop.addClass("bottom");
                        $pop.removeClass("top");
                    } else {
                        $pop.addClass("top");
                        $pop.removeClass("bottom");
                    }
                    $pop.css('left', div_pos.left + (div_width - pop_width) / 2);
                    $pop.css('top', top);
                    $pop.show();
                }).
                on('hide.bs.dropdown', function () {
                    $('#host-edit-color-popover', selector).hide();
                });
        };
    }

    function Simple(dialog) {
        var self = this;

        self.load = function() {
            dialog.render();
        };
    }

    function AddMachine(dialog) {
        var self = this;
        var color = null;
        var selector = dialog.get_sel();
        var run_error = null;

        var invisible = dialog.machines_ins.addresses.filter(function(addr) {
            var m = dialog.machines_ins.lookup(addr);
            return !m || !m.visible;
        });

        function existing_error(address) {
            var ex = null;
            var machine = dialog.machines_ins.lookup(address);
            if (machine && machine.visible && machine.on_disk) {
                ex = new Error(_("This machine has already been added."));
                ex.target = "#add-machine-address";
            }
            return ex;
        }

        function check_address(evt) {
            var disabled = true;
            var ex = null;

            var addr = $('#add-machine-address').val();
            var button = dialog.get_sel(".btn-primary");
            if (addr === "") {
                disabled = true;
            } else if (!machines.allow_connection_string &&
                       (addr.indexOf('@') > -1 || addr.indexOf(':') > -1)) {
                ex = new Error(_("This version of cockpit-ws does not support connecting to a host with an alternate user or port"));
            } else if (addr.search(/\s+/) === -1) {
                ex = existing_error(addr);
                if (!ex)
                    disabled = false;
            } else {
                ex = new Error(_("The IP address or host name cannot contain whitespace."));
            }

            if (ex)
                ex.target = "#add-machine-address";

            if (run_error)
                selector.dialog("failure", run_error, ex);
            else
                selector.dialog("failure", ex);

            button.prop("disabled", disabled);
        }

        function add_machine() {
            run_error = null;
            dialog.address = $('#add-machine-address').val();
            color = machines.colors.parse($('#add-machine-color-picker #host-edit-color').css('background-color'));
            if (existing_error(dialog.address))
                return;

            dialog.set_goal(function() {
                var dfp = $.Deferred();
                dialog.machines_ins.add(dialog.address, color)
                    .done(dfp.resolve)
                    .fail(function (ex) {
                        var msg = cockpit.format(_("Failed to add machine: $0"),
                                                 cockpit.message(ex));
                        dfp.reject(msg);
                    });

                return dfp.promise();
            });

            dialog.run(dialog.try_to_connect(dialog.address), function (ex) {
                if (ex.problem == "no-host") {
                    var host_id_port = dialog.address;
                    var port_index = host_id_port.lastIndexOf(":");
                    var port = "22";
                    if (port_index === -1)
                        host_id_port = dialog.address + ":22";
                    else
                        port = host_id_port.substr(port_index + 1);
                    ex.message = cockpit.format(_("Cockpit could not contact the given host $0. Make sure it has ssh running on port $1, or specify another port in the address."), host_id_port, port);
                    ex = cockpit.message(ex);
                    run_error = ex;
                }
                dialog.render_error(ex);
            });
        }

        self.load = function() {
            var manifest = cockpit.manifests["shell"] || {};
            var limit = parseInt(manifest["machine-limit"], 10);
            var color_picker = new MachineColorPicker(dialog.machines_ins);
            if (!limit || isNaN(limit))
                limit = 20;

            dialog.render({
                'nearlimit' : limit * 0.75 <= dialog.machines_ins.list.length,
                'limit' : limit,
                'placeholder' : _("Enter IP address or host name"),
                'options' : invisible,
            });

            var button = dialog.get_sel(".btn-primary");
            button.on("click", add_machine);

            $("#add-machine-address").on("keyup", function (ev) {
                if (ev.which === 13) {
                    var disabled = button.prop('disabled');
                    if (!disabled)
                        add_machine();
                }
            });
            $("#add-machine-address").on("input focus", check_address);
            color_picker.render("#add-machine-color-picker", dialog.address, color);
            $("#add-machine-address").focus();
        };
    }

    function MachinePort(dialog) {
        var self = this;

        function change_port() {
            var dfp = $.Deferred();
            var parts = dialog.machines_ins.split_connection_string(dialog.address);
            parts.port = $("#edit-machine-port").val();
            var address = dialog.machines_ins.generate_connection_string(parts.user,
                                                                  parts.port,
                                                                  parts.address);
            function update_host(ex) {
                dialog.address = address;
                dialog.machines_ins.change(parts.address, { "port": parts.port })
                    .done(function () {
                        // We failed before so try to connect again
                        // now that the machine is saved.
                        if (ex) {
                            dialog.try_to_connect(address)
                                .done(dialog.complete)
                                .fail(function (e) {
                                    dfp.reject(e);
                                });
                        } else {
                            dfp.resolve();
                        }
                    })
                    .fail(function (ex) {
                        var msg = cockpit.format(_("Failed to edit machine: $0"),
                                                 cockpit.message(ex));
                        dfp.reject(msg);
                    });
            }

            dialog.try_to_connect(address)
                .done(function () {
                    update_host();
                })
                .fail(function (ex) {
                    /* any other error means progress, so save */
                    if (ex.problem != 'no-host')
                        update_host(ex);
                    else
                        dfp.reject(ex);
                });

            dialog.run(dfp.promise());
        }

        self.load = function() {
            var machine = dialog.machines_ins.lookup(dialog.address);
            if (!machine) {
                dialog.get_sel().modal('hide');
                return;
            }

            dialog.render({ 'port' : machine.port,
                            'allow_connection_string' : machines.allow_connection_string });
            if (machines.allow_connection_string)
                dialog.get_sel(".btn-primary").on("click", change_port);
        };
    }

    function HostKey(dialog, problem) {
        var self = this;
        var error_options = null;
        var key = null;
        var allow_change = problem == "unknown-hostkey";

        function add_key() {
            var q;
            var machine = dialog.machines_ins.lookup(dialog.address);
            if (!machine || machine.on_disk) {
                q = dialog.machines_ins.add_key(key);
            } else {
                /* When machine isn't saved to disk
                   don't save the key either */
                q = dialog.machines_ins.change(dialog.address, {
                    'host_key': key
                });
            }

            var promise = q.then(function () {
                var inner = dialog.try_to_connect(dialog.address);

                inner.fail(function(ex) {
                    if ((ex.problem == "invalid-hostkey" ||
                        ex.problem == "unknown-hostkey") &&
                        machine && !machine.on_disk) {
                            dialog.machines_ins.change(dialog.address, {
                                'host_key': null
                            });
                        }
                    });

                return inner;
            });

            dialog.run(promise);
        }

        function render() {
            var promise = null;
            var fp;

            if (error_options) {
                key = error_options["host-key"];
                fp = error_options["host-fingerprint"];
            }

            dialog.render({
                'context_title' : dialog.context_title,
                'path' : machines.known_hosts_path,
                'key' : fp,
                'key_host' : key ? key.split(' ')[0] : null,
            });

            if (!key) {
                promise = dialog.try_to_connect(dialog.address)
                    .fail(function(ex) {
                        if (ex.problem != problem) {
                            dialog.render_error(ex);
                        } else {
                            error_options = ex;
                            render();
                        }
                    })

                    // Fixed already, just close
                    .done(function (v) {
                        dialog.complete(v);
                    });

                dialog.get_sel().dialog("wait", promise);
            } else if (allow_change) {
                dialog.get_sel(".btn-primary").on("click", add_key);
            }
        }

        self.load = function(ex) {
            error_options = ex;
            render();
        };
    }

    function ChangeAuth(dialog) {
        var self = this;
        var error_options = null;
        var allows_password = false;
        var available = null;
        var supported = null;
        var keys = null;
        var machine = dialog.machines_ins.lookup(dialog.address);

        self.user = { };

        function update_keys() {
            var loaded_keys = [];
            var txt;
            var key_div = dialog.get_sel('.keys');

            if (key_div) {
                key_div.empty();
                for (var id in keys.items) {
                    var key = keys.items[id];
                    if (key.loaded)
                        key_div.append($("<div>").text(key.name));
                }
            }
        }

        function login() {
            var address;
            var options = {};
            var dfp = $.Deferred();
            var user = $("#login-custom-user").val();

            var parts = dialog.machines_ins.split_connection_string(dialog.address);
            parts.user = user;

            address = dialog.machines_ins.generate_connection_string(parts.user,
                                                              parts.port,
                                                              parts.address);

            if ($("#login-type").val() != 'stored') {
                options['password'] = $("#login-custom-password").val();
                if (!user) {
                    /* we don't want to save the default user for everyone
                     * so we pass current user as an option, but make sure the
                     * session isn't private
                     */
                    if (self.user && self.user.name)
                        options["user"] = self.user.name;
                    options["temp-session"] = false;
                }
            }

            dialog.try_to_connect(address, options)
                .done(function () {
                    dialog.address = address;
                    if (machine) {
                        dialog.machines_ins.change(machine.address, { "user" : user })
                            .done(dfp.resolve)
                            .fail(dfp.reject);
                    } else {
                        dfp.resolve();
                    }
                })
                .fail(dfp.reject);

            dialog.run(dfp.promise());
        }

        function change_login_type(value) {
            var stored = value != 'password';
            var text = $("#login-type li[value=" + value + "]").text();
            $("#login-type button span").text(text);
            $("#login-available").toggle(stored);
            $("#login-diff-password").toggle(!stored);
        }

        function render() {
            var promise = null;
            var template = "change-auth";
            if (!machines.allow_connection_string || !machines.has_auth_results)
                template = "auth-failed";

            var methods = null;
            var available = null;
            var supported = null;

            var machine_user = dialog.machines_ins.split_connection_string(dialog.address).user;
            if (!machine_user && machine)
                machine_user = machine.user;

            if (error_options && machines.has_auth_results) {
                supported = {};
                available = {};

                methods = error_options["auth-method-results"];
                if (methods) {
                    allows_password = is_method_supported(methods, 'password');
                    for (var method in methods) {
                        if (can_try_method(methods, method)) {
                            available[method] = true;
                        }
                    }
                }

                if ($.isEmptyObject(available))
                    template = "auth-failed";
            }

            dialog.render({
                'supported' : methods,
                'available' : available,
                'machine_user' : machine_user,
                'user' : self.user ? self.user.name : "",
                'allows_password' : allows_password,
                'can_sync': !!dialog.codes['sync-users'],
                'machines.allow_connection_string' : machines.allow_connection_string,
                'sync_link' : function() {
                    return function(text, render) {
                        return '<a id="do-sync-users">' + render(text) + "</a>";
                    };
                }
            }, template);

            if (methods === null && machines.has_auth_results) {
                promise = dialog.try_to_connect(dialog.address)
                    .fail(function(ex) {
                        error_options = ex;
                        render();
                    })

                    // Fixed already, just close
                    .done(function (v) {
                        dialog.complete(v);
                    });

                dialog.get_sel().dialog("wait", promise);
            } else if (!$.isEmptyObject(available)) {
                $("#login-type li").on('click', function() {
                    change_login_type($(this).attr("value"));
                });
                change_login_type($("#login-type li:first-child").attr("value"));
                dialog.get_sel(".btn-primary").on("click", login);
                dialog.get_sel("a[data-content]").popover();

                update_keys();
            }

            dialog.get_sel("#do-sync-users").on("click", function () {
                dialog.render_template("sync-users");
            });
        }

        self.load = function(ex) {
            error_options = ex;
            if (credentials) {
                keys = credentials.keys_instance();
                $(keys).on("changed", update_keys);
            }
            cockpit.user()
                .done(function (user) {
                    self.user = user;
                })
                .always(function (user) {
                    render();
                });
        };

        self.close = function(ex) {
            if (keys) {
                $(keys).off();
                keys.close();
            }
            keys = null;
        };
    }

    function SyncUsers(dialog) {
        var self = this;
        var users = {};

        var needs_auth = false;
        var needs_root = false;
        var methods = null;
        var remote_options = { "superuser": true };

        var perm_failed = null;

        function load_users() {
            var local = cockpit.dbus(null, { bus: "internal",
                                             host: "localhost",
                                             superuser: true });
            $(local).on("close", function(event, options) {
                perm_failed = options;
                render();
            });

            var proxy = local.proxy("cockpit.Setup", "/setup");
            proxy.wait(function () {
                if (proxy.valid) {
                    var blank = {
                        "t" : "(asas)",
                        "v" : [[], []]
                    };

                    proxy.Transfer("passwd1", blank)
                        .done(function(prepared) {
                            var i, parts, name;
                            var groups = prepared.v[1];

                            for (i = 0; i < prepared.v[0].length; i++) {
                                var raw = prepared.v[0][i];

                                parts = raw.split(":");
                                name = parts[0];

                                users[name] = {
                                    "username" : name,
                                    "name" : parts[4] || name,
                                    "raw" : raw,
                                    "groups" : [],
                                };
                            }

                            for (i = 0; i < groups.length; i++) {
                                parts = groups[i].split(":");
                                name = parts[0];
                                var members = parts[parts.length - 1].split(",");
                                for (var j = 0; j < members.length; j++) {
                                    var u = members[j];
                                    if (users[u])
                                        users[u].groups.push(name);
                                }
                            }
                        })
                        .fail(function(ex) {
                            ex.message = cockpit.gettext(ex.message);
                            perm_failed = ex;
                        })
                        .always(function(ex) {
                            $(local).off();
                            local.close();
                            render();
                        });
                }
            });
        }

        function sync_users() {
            var client = null;

            var dfd = $.Deferred();
            var promise = dfd.promise();

            dialog.run(promise);

            /* A successfull sync should close the dialog */
            dialog.set_on_success(null);

            promise.always(function () {
                if (client) {
                    $(client).off();
                    client.close();
                }
            });

            var options = { bus: "internal" };
            if (needs_auth) {
                options.user = $("#sync-username").val();
                options.password = $("#sync-password").val();
            }
            $.extend(options, remote_options, { host: dialog.address });
            client = cockpit.dbus(null, options);
            $(client).on("close", function(event, ex) {
                dfd.reject(cockpit.message(ex));
            });

            var variant = {
                "t" : "(asas)",
                "v" : [[]],
            };

            var groups = {};
            dialog.get_sel("input:checked").each( function() {
                var u = users[$(this).attr("name")];
                if (u) {
                    variant.v[0].push(u.raw);
                    for (var i = 0; i < u.groups.length; i++) {
                        var group = u.groups[i];
                        if (!groups[group])
                            groups[group] = [];

                        groups[group].push(u.username);
                    }
                }
            });
            variant.v.push(Object.keys(groups).map(function(k) {
                return k + ":::" + groups[k].join();
            }));

            /* We assume all cockpits support the 'passwd1' mechanism */
            var proxy = client.proxy("cockpit.Setup", "/setup");
            proxy.wait(function() {
                if (proxy.valid) {
                    proxy.Commit("passwd1", variant)
                        .fail(function(ex) {
                            ex.message = cockpit.gettext(ex.message);
                            dfd.reject(ex);
                        })
                        .done(dfd.resolve);
                }
            });
        }

        function toggle_button() {
            var any = dialog.get_sel("input:checked").length > 0;
            dialog.get_sel(".btn-primary").toggleClass("disabled", !any);
        }

        function render() {
            function formated_groups() {
                /*jshint validthis:true */
                if (this.groups)
                    return this.groups.join(", ");
            }

            /* assume password is allowed for backwards compatibility */
            var allows_password = true;
            var user_list = Object.keys(users).sort().map(function(v) {
                return users[v];
            });

            if (machines.has_auth_results && methods)
                allows_password = is_method_supported(methods, 'password');

            var text = dialog.render({
                'needs_auth' : needs_auth,
                'needs_root' : needs_root,
                'users' : user_list,
                'perm_failed' : perm_failed ? cockpit.message(perm_failed) : null,
                'allows_password' : allows_password,
                'formated_groups': formated_groups,
            });

            dialog.get_sel(".modal-content").html(text);
            dialog.get_sel(".btn-primary").on("click", sync_users);
            dialog.get_sel("input:checkbox").on("change", function() {
                var name = $(this).attr("name");
                users[name].checked = $(this).is(':checked');
                toggle_button();
            });
            toggle_button();
        }

        self.load = function(error_options) {
            if (error_options)
                methods = error_options['auth-method-results'];

            render();
            dialog.try_to_connect(dialog.address, remote_options).fail(function(ex) {
                needs_auth = true;
                if (ex.problem == "access-denied") {
                    needs_root = true;
                    if (!methods && machines.has_auth_results)
                        /* TODO: We need to know if password auth is
                         * supported but we only get that when the transport
                         * closes. Passing an invalid username should
                         * open new transport that fails.
                         */
                        dialog.try_to_connect(dialog.address, { "user" : "1" })
                            .fail(function(ex) {
                                methods = ex['auth-method-results'];
                            })
                            .always(render);
                } else {
                    methods = ex['auth-method-results'];
                    render();
                }
            });
            load_users();
        };
    }

    function MachineDialogManager(machines_ins, codes) {
        var self = this;

        if (!codes)
            codes = default_codes;

        var color_picker = new MachineColorPicker(machines_ins);

        self.troubleshoot = function(target_id, machine) {
            var selector = "#" + target_id;
            if (!machine || !machine.problem)
                return;

            var template = codes[machine.problem];
            if (machine.problem == "no-host")
                template = "change-port";

            var dialog = new Dialog(selector, machine.address, machines_ins, codes);
            dialog.render_template(template);
            dialog.show();
        };

        self.needs_troubleshoot = function (machine) {
            if (!machine || !machine.problem)
                return false;

            if (machine.problem == "no-host")
                return true;

            return codes[machine.problem] ? true : false;
        };

        self.render_dialog = function (template, target_id, address) {
            var selector = "#" + target_id;
            var dialog = new Dialog(selector, address, machines_ins, codes);
            dialog.render_template(template);
            dialog.show();
        };

        self.render_color_picker = function (selector, address) {
            color_picker.render(selector, address);
        };
    }

    module.exports = {
        new_manager: function (machines_ins, codes) {
            return new MachineDialogManager(machines_ins, codes);
        }
    };
}());
