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

import { mustache } from "mustache";

import { machines, get_init_superuser_for_options } from "./machines";
import * as credentials from "credentials";
import "patterns";

import add_tmpl from "raw-loader!./machine-add.html";
import auth_failed_tmpl from "raw-loader!./machine-auth-failed.html";
import change_auth_tmpl from "raw-loader!./machine-change-auth.html";
import change_port_tmpl from "raw-loader!./machine-change-port.html";
import color_picker_tmpl from "raw-loader!./machine-color-picker.html";
import invalid_hostkey_tmpl from "raw-loader!./machine-invalid-hostkey.html";
import not_supported_tmpl from "raw-loader!./machine-not-supported.html";
import unknown_hosts_tmpl from "raw-loader!./machine-unknown-hostkey.html";

import ssh_show_default_key_sh from "raw-loader!./ssh-show-default-key.sh";
import ssh_add_key_sh from "raw-loader!./ssh-add-key.sh";

import "./machine-dialogs.scss";
import "form-layout.scss";

const _ = cockpit.gettext;

const default_codes = {
    "no-cockpit": "not-supported",
    "not-supported": "not-supported",
    "protocol-error": "not-supported",
    "authentication-not-supported": "change-auth",
    "authentication-failed": "change-auth",
    "no-forwarding": "change-auth",
    "unknown-hostkey": "unknown-hostkey",
    "invalid-hostkey": "invalid-hostkey",
    "not-found": "add-machine",
    "unknown-host": "unknown-host"
};

function translate_and_init(tmpl) {
    const tmp = $("<div>").append(tmpl);
    tmp.find("[translate=\"yes\"]").each(function(i, e) {
        const old = e.outerHTML;
        const translated = cockpit.gettext(e.getAttribute("context"), $(e).text());
        $(e).removeAttr("translate")
                .text(translated);
        tmpl = tmpl.replace(old, e.outerHTML);
    });
    mustache.parse(tmpl);
    return tmpl;
}

function is_object(x) {
    return x !== null && typeof x === 'object';
}

function fmt_to_array(fmt, args) {
    const fmt_re = /(\$\{[^}]+\}|\$[a-zA-Z0-9_]+)/g;

    if (arguments.length != 2 || !is_object(args) || args === null)
        args = Array.prototype.slice.call(arguments, 1);

    function replace(part) {
        if (part.startsWith("${"))
            return args[part.slice(2, -1)].clone();
        else if (part.startsWith("$"))
            return args[parseInt(part.slice(1))].clone();
        else
            return part;
    }

    return fmt.split(fmt_re).map(replace);
}

const templates = {
    "add-machine" : translate_and_init(add_tmpl),
    "auth-failed" : translate_and_init(auth_failed_tmpl),
    "change-auth" : translate_and_init(change_auth_tmpl),
    "change-port" : translate_and_init(change_port_tmpl),
    "color-picker" : translate_and_init(color_picker_tmpl),
    "invalid-hostkey" : translate_and_init(invalid_hostkey_tmpl),
    "not-supported" : translate_and_init(not_supported_tmpl),
    "unknown-hostkey" : translate_and_init(unknown_hosts_tmpl),
    "unknown-host" : translate_and_init(unknown_hosts_tmpl)
};

function full_address(machines_ins, address) {
    const machine = machines_ins.lookup(address);
    if (machine && machine.address != "localhost")
        return machine.connection_string;

    return address;
}

function Dialog(selector, address, machines_ins, codes, caller_callback) {
    const self = this;

    self.machines_ins = machines_ins;
    self.codes = codes;
    self.address = full_address(self.machines_ins, address);

    let promise_callback = null;

    let success_callback = null;

    let current_template = null;
    let current_instance = null;

    function address_or_label() {
        const machine = self.machines_ins.lookup(self.address);
        let host = self.machines_ins.split_connection_string(self.address).address;
        if (machine && machine.label)
            host = machine.label;
        return host;
    }

    function change_content(template, error_options) {
        let old_instance = current_instance;

        if (current_template === template)
            return;

        if (template == "add-machine")
            current_instance = new AddMachine(self);
        else if (template == "unknown-hostkey" || template == "unknown-host")
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
        const dfd = $.Deferred();
        const conn_options = $.extend({ payload: "echo", host: address }, options);

        conn_options["init-superuser"] = get_init_superuser_for_options(conn_options);

        const machine = self.machines_ins.lookup(address);
        if (machine && machine.host_key && !machine.on_disk) {
            conn_options['temp-session'] = false; /* Compatibility option */
            conn_options.session = 'shared';
            conn_options['host-key'] = machine.host_key;
        }
        const client = cockpit.channel(conn_options);
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
        let ret_txt = selector;
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
        else {
            if (current_instance && current_instance.close)
                current_instance.close();
            $(selector).modal('hide');
        }
    };

    self.cancel = function() {
        if (current_instance && current_instance.close)
            current_instance.close();
        $(selector).modal('hide');
    };

    self.render = function render(data, template) {
        if (!template)
            template = current_template;

        const address_data = self.machines_ins.split_connection_string(self.address);
        const context = $.extend({
            host : address_or_label(),
            full_address : self.address,
            context_title : self.context_title,
            strong : function() {
                return function(text, render) {
                    return "<strong>" + render(text) + "</strong>";
                };
            }
        }, data, address_data);

        const output = $(mustache.render(templates[template], context));
        cockpit.translate(output);
        self.get_sel(".modal-content").html(output);
    };

    self.render_error = function render_error(error) {
        let template;
        if (error.problem && error.command == "close")
            template = self.codes[error.problem];

        if (template && current_template !== template)
            change_content(template, error);
        else
            $(selector).dialog("failure", cockpit.message(error));
    };

    self.clear_error = function clear_error() {
        $(selector).dialog("clear_errors");
    };

    self.render_template = function render_template(template) {
        change_content(template);
    };

    self.show = function () {
        const sel = self.get_sel();
        sel.on('hide.bs.modal', function () {
            self.get_sel(".model-content").empty();
        });
        sel.modal('show');
    };

    self.run = function (promise, failure_callback) {
        const dialog_dfd = $.Deferred();
        const promise_funcs = [];

        function next(i) {
            promise_funcs[i]()
                    .then(function(val) {
                        i = i + 1;
                        if (i < promise_funcs.length) {
                            next(i);
                        } else {
                            dialog_dfd.resolve();
                            self.complete(val);
                        }
                    })
                    .catch(function(ex) {
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
        if (caller_callback)
            promise_funcs.push(() => caller_callback(self.address));

        next(0);
    };
}

function is_method_supported(methods, method) {
    const result = methods[method];
    return result ? result != "no-server-support" : false;
}

function MachineColorPicker(machines_ins) {
    const self = this;

    self.render = function(selector, address, selected_color) {
        let machine;

        if (address && !selected_color) {
            machine = machines_ins.lookup(address);
            if (machine)
                selected_color = machine.color;
        }

        if (!selected_color)
            selected_color = machines_ins.unused_color();

        let part;
        const colors = [];
        for (let i = 0; i < machines.colors.length; i += 6) {
            part = machines.colors.slice(i, i + 6);
            colors.push({ list : part });
        }

        const text = mustache.render(templates["color-picker"], { colors : colors, });
        $(selector).html(text);

        $("#host-edit-color", selector).css("background-color", selected_color);
        $(".color-cell", selector).each(function(index) {
            $(this).css("background-color", machines.colors[index]);
        });

        $('#host-edit-color-popover .popover-content .color-cell', selector)
                .click(function() {
                    const color = $(this).css('background-color');
                    $('#host-edit-color', selector).css('background-color', color);
                });

        $("#host-edit-color", selector).parent()
                .on('show.bs.dropdown', function () {
                    $('#host-edit-color-popover', selector).show();
                })
                .on('hide.bs.dropdown', function () {
                    $('#host-edit-color-popover', selector).hide();
                });
    };
}

function Simple(dialog) {
    const self = this;

    self.load = function() {
        dialog.render();
    };
}

function AddMachine(dialog) {
    const self = this;
    const selector = dialog.get_sel();
    let run_error = null;

    let user_name_dirty = false;
    const unused_color = dialog.machines_ins.unused_color();

    const invisible = dialog.machines_ins.addresses.filter(function(addr) {
        const m = dialog.machines_ins.lookup(addr);
        return !m || !m.visible;
    });

    function existing_error(address) {
        let ex = null;
        const machine = dialog.machines_ins.lookup(address);
        if (machine && machine.visible && machine.on_disk && machine != self.old_machine) {
            ex = new Error(_("This machine has already been added."));
            ex.target = "#add-machine-address";
        }
        return ex;
    }

    function check_address(evt) {
        let disabled = true;
        let ex = null;

        const addr = $('#add-machine-address').val();
        const button = dialog.get_sel(".modal-footer>.pf-m-primary");

        if (addr === "") {
            disabled = true;
        } else if (addr.search(/\s+/) === -1) {
            ex = existing_error(addr);
            if (!ex)
                disabled = false;
        } else {
            ex = new Error(_("The IP address or hostname cannot contain whitespace."));
        }

        if (ex)
            ex.target = "#add-machine-address";

        if (run_error)
            selector.dialog("failure", run_error, ex);
        else
            selector.dialog("failure", ex);

        if (!user_name_dirty) {
            const m = addr ? dialog.machines_ins.lookup(addr) : null;
            if (m && m.user)
                $('#add-machine-user').val(m.user);
            if (m && m.color)
                $('#add-machine-color-picker #host-edit-color').css('background-color', m.color);
            else
                $('#add-machine-color-picker #host-edit-color').css('background-color', unused_color);
        }

        button.prop("disabled", disabled);
    }

    function add_machine() {
        run_error = null;
        dialog.address = $('#add-machine-address').val();
        const user = $('#add-machine-user').val();
        if (user) {
            const parts = dialog.machines_ins.split_connection_string(dialog.address);
            parts.user = user;
            dialog.address = dialog.machines_ins.generate_connection_string(user, parts.port, parts.address);
        }

        const color = machines.colors.parse($('#add-machine-color-picker #host-edit-color').css('background-color'));

        if (self.old_machine && dialog.address == self.old_machine.connection_string) {
            dialog.run(dialog.machines_ins.change(self.old_machine.key, { color: color }));
            return;
        }

        if (existing_error(dialog.address))
            return;

        dialog.set_goal(function() {
            const dfp = $.Deferred();
            dialog.machines_ins.add(dialog.address, color)
                    .then(function () {
                        if (self.old_machine && self.old_machine != dialog.machines_ins.lookup(dialog.address)) {
                            dialog.machines_ins.change(self.old_machine.key, { visible: false })
                                    .then(dfp.resolve);
                        } else
                            dfp.resolve();
                    })
                    .catch(function (ex) {
                        const msg = cockpit.format(_("Failed to add machine: $0"),
                                                   cockpit.message(ex));
                        dfp.reject(msg);
                    });

            return dfp.promise();
        });

        dialog.run(dialog.try_to_connect(dialog.address), function (ex) {
            if (ex.problem == "no-host") {
                let host_id_port = dialog.address;
                const port_index = host_id_port.lastIndexOf(":");
                let port = "22";
                if (port_index === -1)
                    host_id_port = dialog.address + ":22";
                else
                    port = host_id_port.substr(port_index + 1);
                ex.message = cockpit.format(_("Unable to contact the given host $0. Make sure it has ssh running on port $1, or specify another port in the address."), host_id_port, port);
                ex = cockpit.message(ex);
                run_error = ex;
            }
            dialog.render_error(ex);
        });
    }

    self.load = function() {
        const manifest = cockpit.manifests.shell || {};
        let limit = parseInt(manifest["machine-limit"], 10);
        const color_picker = new MachineColorPicker(dialog.machines_ins);
        if (!limit || isNaN(limit))
            limit = 20;

        self.old_machine = null;
        let address_parts = null;
        if (dialog.address) {
            self.old_machine = dialog.machines_ins.lookup(dialog.address);
            if (self.old_machine && !self.old_machine.visible)
                self.old_machine = null;
            address_parts = dialog.machines_ins.split_connection_string(dialog.address);
        }

        let host_address = ""; let host_user = "";
        if (address_parts) {
            host_address = address_parts.address;
            if (address_parts.port)
                host_address += ":" + address_parts.port;
            host_user = address_parts.user;
        }

        dialog.render({
            editing: self.old_machine != null,
            nearlimit : limit * 0.75 <= dialog.machines_ins.list.length,
            host_address: host_address,
            host_user: host_user,
            connection_change_disabled: dialog.address == "localhost" ? "disabled" : "",
            limit : limit,
            options : invisible,
        });

        const button = dialog.get_sel(".modal-footer>.pf-m-primary");
        button.on("click", add_machine);

        $("#add-machine-address").on("input focus change", check_address);
        $("#add-machine-user").on("input", function () { user_name_dirty = true });
        color_picker.render("#add-machine-color-picker", null, self.old_machine ? self.old_machine.color : unused_color);
        check_address();
    };
}

function MachinePort(dialog) {
    const self = this;

    function change_port() {
        const dfp = $.Deferred();
        const parts = dialog.machines_ins.split_connection_string(dialog.address);
        parts.port = $("#edit-machine-port").val();
        const address = dialog.machines_ins.generate_connection_string(parts.user,
                                                                       parts.port,
                                                                       parts.address);
        function update_host(ex) {
            dialog.address = address;
            dialog.machines_ins.change(parts.address, { port: parts.port })
                    .then(function () {
                    // We failed before so try to connect again
                    // now that the machine is saved.
                        if (ex) {
                            dialog.try_to_connect(address)
                                    .then(dialog.complete)
                                    .catch(function (e) {
                                        dfp.reject(e);
                                    });
                        } else {
                            dfp.resolve();
                        }
                    })
                    .catch(function (ex) {
                        const msg = cockpit.format(_("Failed to edit machine: $0"),
                                                   cockpit.message(ex));
                        dfp.reject(msg);
                    });
        }

        dialog.try_to_connect(address)
                .then(function () {
                    update_host();
                })
                .catch(function (ex) {
                /* any other error means progress, so save */
                    if (ex.problem != 'no-host')
                        update_host(ex);
                    else
                        dfp.reject(ex);
                });

        dialog.run(dfp.promise());
    }

    self.load = function() {
        const machine = dialog.machines_ins.lookup(dialog.address);
        if (!machine) {
            dialog.get_sel().modal('hide');
            return;
        }

        dialog.render({
            port : machine.port,
        });
        dialog.get_sel(".modal-footer>.pf-m-primary").on("click", change_port);
    };
}

function HostKey(dialog, problem) {
    const self = this;
    let error_options = null;
    let key = null;

    function add_key() {
        let q;
        const machine = dialog.machines_ins.lookup(dialog.address);
        if (!machine || machine.on_disk) {
            q = dialog.machines_ins.add_key(key);
        } else {
            /* When machine isn't saved to disk
               don't save the key either */
            q = dialog.machines_ins.change(dialog.address, {
                host_key: key
            });
        }

        const promise = q.then(function () {
            const inner = dialog.try_to_connect(dialog.address);

            inner.catch(function(ex) {
                if ((ex.problem == "invalid-hostkey" ||
                    ex.problem == "unknown-hostkey") &&
                    machine && !machine.on_disk) {
                    dialog.machines_ins.change(dialog.address, {
                        host_key: null
                    });
                }
            });

            return inner;
        });

        dialog.run(promise);
    }

    function render() {
        let promise = null;
        const options = {};
        let match_problem = problem;
        let fp;
        let key_type;

        if (error_options) {
            key = error_options["host-key"];
            fp = error_options["host-fingerprint"];
            if (key)
                key_type = key.split(" ")[1];
        }

        dialog.render({
            context_title : dialog.context_title,
            key : key ? { type: key_type, fingerprint: fp } : null,
        });

        if (!key) {
            if (problem == "unknown-host") {
                options.session = "private";
                match_problem = "unknown-hostkey";
            }

            promise = dialog.try_to_connect(dialog.address, options)
                    .catch(function(ex) {
                        if (ex.problem != match_problem) {
                            dialog.render_error(ex);
                        } else {
                            error_options = ex;
                            render();
                        }
                        return Promise.reject(ex);
                    })

            // Fixed already, just close
                    .then(function (v) {
                        dialog.complete(v);
                    });

            dialog.get_sel().dialog("wait", promise);
        } else {
            dialog.get_sel(".modal-footer>.apply").on("click", add_key);
        }
    }

    self.load = function(ex) {
        error_options = ex;
        render();
    };
}

function ChangeAuth(dialog) {
    const self = this;
    let error_options = null;
    let identity_path = null;
    let keys = null;
    const machine = dialog.machines_ins.lookup(dialog.address);
    let default_ssh_key = null;

    let offer_login_password;
    let offer_key_password;
    let use_login_password;
    let use_key_password;

    let offer_key_setup;

    self.user = { };

    function set_error_options(ex) {
        error_options = ex;
        identity_path = null;
        if (error_options && error_options.error && error_options.error.startsWith("locked identity"))
            identity_path = error_options.error.split(": ")[1];
    }

    let old_extra_state = null;

    function update_key_setup() {
        if (!default_ssh_key)
            return;

        if ($("#login-setup-text").length == 0)
            return;

        function bold(str) { return $('<b>').text(str) }

        const lmach = dialog.machines_ins.lookup(null);

        const params = {
            key: bold(default_ssh_key.name),
            luser: bold(self.user.name),
            lhost: bold(lmach ? lmach.label || lmach.address : "localhost"),
            afile: bold("~/.ssh/authorized_keys"),
            ruser: bold(dialog.machines_ins.split_connection_string(dialog.address).user || self.user.name),
            rhost: bold(dialog.machines_ins.split_connection_string(dialog.address).address),
        };

        default_ssh_key.unaligned_passphrase =
            (default_ssh_key.encrypted && identity_path && identity_path == default_ssh_key.name);

        let text, extra, state;
        if (!default_ssh_key.exists) {
            state = "create";
            text = _("Create a new SSH key and authorize it.");
            extra = [$('<p class="ct-form-full">').append(
                fmt_to_array(_("A new SSH key at ${key} will be created for ${luser} on ${lhost} and it will be added to the ${afile} file of ${ruser} on ${rhost}."), params)),
            $('<label class="control-label">').text(_("Key password")),
            $('<input type="password" class="form-control login-setup-new-key-password">'),
            $('<label class="control-label">').text(_("Confirm key password")),
            $('<input type="password" class="form-control login-setup-new-key-password2">'),
            $('<p class="ct-form-full">').append(
                fmt_to_array(_("In order to allow log in to ${rhost} as ${ruser} without password in the future, use the login password of ${luser} on ${lhost} as the key password, or leave the key password blank."), params))
            ];
        } else if (default_ssh_key.unaligned_passphrase) {
            text = cockpit.format(_("Change the password of ${key}."), { key: default_ssh_key.name });
            extra = [$('<p class="ct-form-full">').append(
                fmt_to_array(_("By changing the password of the SSH key ${key} to the login password of ${luser} on ${lhost}, the key will be automatically made available and you can log in to ${rhost} without password in the future."), params)),
            $('<label class="control-label">').text(_("New key password")),
            $('<input type="password" class="form-control login-setup-login-password">'),
            $('<label class="control-label">').text(_("Confirm new key password")),
            $('<input type="password" class="form-control login-setup-login-password2">')
            ];
            state = "passchange";
        } else {
            text = _("Authorize SSH key.");
            extra = [
                $('<p class="ct-form-full">').append(
                    fmt_to_array(_("The SSH key ${key} of ${luser} on ${lhost} will be added to the ${afile} file of ${ruser} on ${rhost}."), params)),
                $('<p class="ct-form-full">').append(
                    fmt_to_array(_("This will allow you to log in without password in the future."), params))
            ];
            state = "auth";
        }

        if (old_extra_state == state)
            return;

        old_extra_state = state;
        $("#login-setup-text").text(text);
        $("#login-setup-extra").empty()
                .append(extra);
    }

    function update_auth() {
        if (offer_login_password && offer_key_password) {
            dialog.get_sel("#login-authentication, #login-authentication + *").show();
            use_login_password = dialog.get_sel("#login-authentication + div input[value=pass]").prop('checked');
        } else {
            dialog.get_sel("#login-authentication, #login-authentication + *").hide();
            use_login_password = offer_login_password;
        }
        use_key_password = offer_key_password && !use_login_password;

        dialog.get_sel("#login-diff-password, #login-diff-password + *")
                .toggle(use_login_password);

        dialog.get_sel(".login-locked, .login-locked + *, .login-locked + * + *")
                .toggle(use_key_password);

        if (!default_ssh_key)
            offer_key_setup = false;
        else if (default_ssh_key.unaligned_passphrase)
            offer_key_setup = use_key_password;
        else if (identity_path) {
            // This is a locked, non-default identity that will never
            // be loaded into the agent, so there is no point in
            // offering to change the passphrase.
            dialog.get_sel(".password-change-advice").hide();
            offer_key_setup = false;
        } else
            offer_key_setup = true;

        dialog.get_sel(".login-setup-auto, .login-setup-auto + *").toggle(offer_key_setup);
    }

    function toggle_setup_extra() {
        $("#login-setup-extra").toggle(offer_key_setup && $('#login-setup-keys').prop('checked'));
    }

    function update() {
        update_key_setup();
        update_auth();
        toggle_setup_extra();
    }

    function show_error(message, target) {
        const ex = new Error(message);
        ex.target = target;
        dialog.get_sel().dialog("failure", ex);
    }

    function change_passphrase(cur_passphrase, login_password) {
        return keys.change(default_ssh_key.name, cur_passphrase, login_password, login_password);
    }

    function maybe_create_key(passphrase) {
        if (!default_ssh_key.exists)
            return keys.create(default_ssh_key.name, default_ssh_key.type, passphrase, passphrase);
        else
            return Promise.resolve();
    }

    function authorize_key(host) {
        return keys.get_pubkey(default_ssh_key.name)
                .then(data => cockpit.script(ssh_add_key_sh, [data.trim()], { host: host, err: "message" }));
    }

    function maybe_unlock_key() {
        if (use_key_password) {
            const cur_passphrase = dialog.get_sel(".locked-identity-password").val();
            return keys.load(identity_path, cur_passphrase);
        } else
            return Promise.resolve();
    }

    function login() {
        const options = {};
        const user = dialog.machines_ins.split_connection_string(dialog.address).user || "";
        const do_setup_keys = offer_key_setup && $("#login-setup-keys").prop('checked');
        const do_key_password_change = do_setup_keys && default_ssh_key.unaligned_passphrase;

        if (use_login_password) {
            options.password = $("#login-custom-password").val();
            options.session = 'shared';
            if (!user) {
                /* we don't want to save the default user for everyone
                 * so we pass current user as an option, but make sure the
                 * session isn't private
                 */
                if (self.user && self.user.name)
                    options.user = self.user.name;
                options["temp-session"] = false; /* Compatibility option */
            }
        }

        const key_password = dialog.get_sel(".locked-identity-password").val();

        if (use_key_password && !key_password) {
            show_error(_("The key password can not be empty"), ".locked-identity-password");
            return;
        }

        const setup_new_key_password = dialog.get_sel(".login-setup-new-key-password").val();
        const setup_new_key_password2 = dialog.get_sel(".login-setup-new-key-password2").val();

        if (do_setup_keys && !do_key_password_change && setup_new_key_password != setup_new_key_password2) {
            show_error(_("The key passwords do not match"), ".login-setup-new-key-password2");
            return;
        }

        const setup_login_password = dialog.get_sel(".login-setup-login-password").val();
        const setup_login_password2 = dialog.get_sel(".login-setup-login-password2").val();

        if (do_key_password_change && !setup_login_password) {
            show_error(_("The new key password can not be empty"), ".login-setup-login-password");
            return;
        }

        if (do_key_password_change && setup_login_password != setup_login_password2) {
            show_error(_("The new key passwords do not match"), ".login-setup-login-password2");
            return;
        }

        dialog.run(maybe_unlock_key()
                .then(function () {
                    return dialog.try_to_connect(dialog.address, options)
                            .then(function () {
                                if (machine) {
                                    return dialog.machines_ins.change(machine.address, { user : user });
                                } else {
                                    return Promise.resolve();
                                }
                            })
                            .then(function () {
                                if (do_key_password_change) {
                                    return change_passphrase(key_password, setup_login_password);
                                } else if (do_setup_keys) {
                                    return maybe_create_key(setup_new_key_password)
                                            .then(() => authorize_key(dialog.address));
                                } else
                                    return Promise.resolve();
                            });
                })
                .catch(function (ex) {
                    set_error_options(ex);
                    update();
                    return Promise.reject(ex);
                }));
    }

    function cancel() {
        dialog.cancel();
    }

    function render() {
        let promise = null;
        let template = "change-auth";
        let methods = null;
        let available = null;
        let locked_identity = false;

        if (error_options) {
            available = {};

            methods = error_options["auth-method-results"];
            if (methods) {
                for (const method in methods) {
                    if (is_method_supported(methods, method)) {
                        available[method] = true;
                    }
                }
            }

            if ($.isEmptyObject(available))
                template = "auth-failed";

            locked_identity = error_options.error && error_options.error.startsWith("locked identity");

            offer_login_password = !!available.password;
            offer_key_password = locked_identity;
        } else {
            offer_login_password = true;
            offer_key_password = false;
        }

        if (methods === null) {
            promise = dialog.try_to_connect(dialog.address)
                    .catch(function(ex) {
                        if (ex.problem && dialog.codes[ex.problem] != "change-auth") {
                            dialog.render_error(ex);
                        } else {
                            set_error_options(ex);
                            render();
                        }
                        return Promise.reject(ex);
                    })

            // Fixed already, just close
                    .then(function (v) {
                        dialog.complete(v);
                    });

            dialog.get_sel().dialog("wait", promise);
        } else if (!$.isEmptyObject(available)) {
            dialog.render({
                available : offer_login_password || offer_key_password,
                only_password: offer_login_password && !offer_key_password,
                only_key: !offer_login_password && offer_key_password,
                password_and_key: offer_login_password && offer_key_password,
                key: identity_path
            }, template);

            dialog.get_sel(".modal-footer>.pf-m-primary").on("click", login);
            dialog.get_sel(".modal-header .close, .modal-footer>.pf-m-link").on("click", cancel);
            dialog.get_sel("a[data-content]").popover();

            $("#login-setup-keys").on('change', toggle_setup_extra);
            dialog.get_sel("#login-authentication + div input").on('change', update);
            update();

            dialog.get_sel(".modal-content input").on('change input', function () {
                dialog.clear_error();
            });
        }
    }

    self.load = function(ex) {
        set_error_options(ex);
        if (credentials) {
            keys = credentials.keys_instance();
            $(keys).on("changed", update);
        }

        // When we get here, the dialog is already open and showing
        // whatever was in itlast time. Make sure it shows something sensible
        // while we asynchronously initialize our state.

        dialog.render({
            loading: true
        }, "change-auth");

        cockpit.user()
                .then(function (user) {
                    self.user = user;
                })
                .always(function (user) {
                    cockpit.script(ssh_show_default_key_sh, [], { })
                            .then(function (data) {
                                const info = data.split("\n");
                                if (info[0])
                                    default_ssh_key = { name: info[0], exists: true, encrypted: info[1] == "encrypted" };
                                else
                                    default_ssh_key = { name: self.user.home + "/.ssh/id_rsa", type: "rsa", exists: false };
                            })
                            .always(function () {
                                render();
                            });
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

function MachineDialogManager(machines_ins, codes) {
    const self = this;

    if (!codes)
        codes = default_codes;

    const color_picker = new MachineColorPicker(machines_ins);

    self.troubleshoot = function(target_id, machine) {
        const selector = "#" + target_id;
        if (!machine || !machine.problem)
            return;

        let template = codes[machine.problem];
        if (machine.problem == "no-host")
            template = "change-port";

        const dialog = new Dialog(selector, machine.address, machines_ins, codes);
        dialog.render_template(template);
        dialog.show();
    };

    self.needs_troubleshoot = function (machine) {
        if (!machine || !machine.problem)
            return false;

        if (machine.problem == "no-host")
            return true;

        return !!codes[machine.problem];
    };

    self.render_dialog = function (template, target_id, address, callback) {
        const selector = "#" + target_id;
        const dialog = new Dialog(selector, address, machines_ins, codes, callback);
        dialog.render_template(template);
        dialog.show();
    };

    self.render_color_picker = function (selector, address) {
        color_picker.render(selector, address);
    };
}

export function new_machine_dialog_manager(machines_ins, codes) {
    return new MachineDialogManager(machines_ins, codes);
}
