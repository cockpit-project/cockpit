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
    "shell/shell",
    "shell/cockpit-main"
], function($, cockpit, shell) {
"use strict";

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

PageSetupServer.prototype = {
    _init: function() {
        this.id = "dashboard_setup_server_dialog";
    },

    show: function() {
        $("#dashboard_setup_address").focus();
    },

    leave: function() {
        var self = this;
        $(self.local).off();
        self.local.close();
        self.local = null;
        self.cancel();
    },

    setup: function() {
        $('#dashboard_setup_cancel').on('click', $.proxy(this, 'cancel'));
        $('#dashboard_setup_prev').on('click', $.proxy(this, 'prev'));
        $('#dashboard_setup_next').on('click', $.proxy(this, 'next'));
    },

    highlight_error: function(container) {
        $(container).addClass("has-error");
    },

    hide_error: function(container) {
        $(container).removeClass("has-error");
    },

    highlight_error_message: function(id, message) {
        $(id).text(message);
        $(id).css("visibility", "visible");
    },

    hide_error_message: function(id) {
        $(id).css("visibility", "hidden");
    },

    check_empty_address: function() {
        var addr = $('#dashboard_setup_address').val();

        if (addr === "") {
            $('#dashboard_setup_next').prop('disabled', true);
            this.hide_error('#dashboard_setup_address_tab');
            this.hide_error_message('#dashboard_setup_address_error');
        } else if (addr.search(/\s+/) === -1) {
            $('#dashboard_setup_next').prop('disabled', false);
            this.hide_error('#dashboard_setup_address_tab');
            this.hide_error_message('#dashboard_setup_address_error');
        } else {
            $('#dashboard_setup_next').prop('disabled', true);
            this.highlight_error('#dashboard_setup_address_tab');
            this.highlight_error_message('#dashboard_setup_address_error',
                                         _("IP address or host name cannot contain whitespace."));
        }

        $('#dashboard_setup_next').text(_("Next"));
        $("#dashboard_setup_spinner").hide();
    },

    check_empty_name: function() {
        var name = $('#dashboard_setup_login_user').val();

        if (name === "") {
            this.name_is_done = false;
            $('#dashboard_setup_next').prop('disabled', true);
            this.hide_error('#login_user_cell');
            this.hide_error_message('#dashboard_setup_login_error');
        } else if (name.search(/\s+/) === -1) {
            this.name_is_done = true;
            $('#dashboard_setup_next').prop('disabled', false);
            this.hide_error('#login_user_cell');
            this.hide_error_message('#dashboard_setup_login_error');
        } else {
            this.name_is_done = false;
            $('#dashboard_setup_next').prop('disabled', true);
            this.highlight_error('#login_user_cell');
            this.highlight_error_message('#dashboard_setup_login_error',
                                         _("User name cannot contain whitespace."));
        }

        $('#dashboard_setup_next').text(_("Next"));
        $("#dashboard_setup_spinner").hide();
    },

    enter: function() {
        var self = this;

        self.local = cockpit.dbus(null, { bus: "internal", host: "localhost", superuser: true });

        self.machines = PageSetupServer.machines;
        self.address = null;
        self.options = { "host-key": "" };
        self.name_is_done = false;

        $("#dashboard_setup_address")[0].placeholder = _("Enter IP address or host name");
        $('#dashboard_setup_address').on('keyup change', $.proxy(this, 'update_discovered'));
        $('#dashboard_setup_address').on('input change focus', $.proxy(this, 'check_empty_address'));
        $('#dashboard_setup_login_user').on('input change focus', $.proxy(this, 'check_empty_name'));
        $('#dashboard_setup_login_password').on('input focus', function() {
            if (self.name_is_done)
                self.hide_error_message('#dashboard_setup_login_error');
        });
        $('#dashboard_setup_address').on('keyup', function(event) {
            if (event.which === 13) {
                var disable = $('#dashboard_setup_next').prop('disabled');

                if (!disable)
                    self.next();
            }
        });
        $('#dashboard_setup_login_user').on('keyup', function(event) {
            if (event.which === 13)
                $("#dashboard_setup_login_password").focus();
        });
        $('#dashboard_setup_login_password').on('keyup', function(event) {
            if (event.which === 13) {
                var disable = $('#dashboard_setup_next').prop('disabled');

                if (!disable)
                    self.next();
            }
        });

        $('#dashboard_setup_address').val("");
        $('#dashboard_setup_login_user').val("");
        $('#dashboard_setup_login_password').val("");

        $('#dashboard_setup_address_reuse_creds').prop('checked', true);

        self.show_tab('address');
        self.update_discovered();
        $('#dashboard_setup_next').prop('disabled', true);
        $("#dashboard_setup_spinner").hide();
    },

    update_discovered: function() {
        var self = this;

        var filter = $('#dashboard_setup_address').val();
        var discovered = $('#dashboard_setup_address_discovered');

        function render_address(address) {
            if (!address.trim())
                return null;
            if (!filter)
                return $('<span/>').text(address);
            var index = address.indexOf(filter);
            if (index == -1)
                return null;
            return $('<span/>').append(
                $('<span/>').text(address.substring(0,index)),
                $('<b/>').text(address.substring(index,index+filter.length)),
                $('<span/>').text(address.substring(index+filter.length)));
        }

        discovered.empty();

        var rendered_address, item;
        var address, machine, addresses = self.machines.addresses;
        for (var i = 0; i < addresses.length; i++) {
            address = addresses[i];
            machine = self.machines.lookup(address);
            if (!machine.visible) {
                rendered_address = render_address(address);
                if (rendered_address) {
                    item =
                        $('<li>', {
                            'class': 'list-group-item',
                            'on': {
                                'click': $.proxy(this, 'discovered_clicked', address)
                                              }
                        }).html(rendered_address);
                    discovered.append(item);
                }
            }
        }
    },

    discovered_clicked: function(address) {
        $("#dashboard_setup_address").val(address);
        this.update_discovered();
        $("#dashboard_setup_address").focus();
    },

    show_tab: function(tab) {
        $('.cockpit-setup-tab').hide();
        $('#dashboard_setup_next').text(_("Next"));
        $("#dashboard_setup_spinner").hide();
        if (tab == 'address') {
            $('#dashboard_setup_address_tab').show();
            $("#dashboard_setup_address").focus();
            this.hide_error_message('#dashboard_setup_address_error');
            this.next_action = this.next_select;
            this.prev_tab = null;
        } else if (tab == 'login') {
            $('#dashboard_setup_login_tab').show();
            $('#dashboard_setup_login_user').focus();
            this.hide_error_message('#dashboard_setup_login_error');
            this.next_action = this.next_login;
            this.prev_tab = 'address';
        } else if (tab == 'action') {
            $('#dashboard_setup_action_tab').show();
            $('#dashboard_setup_next').text(_("Add host"));
            this.next_action = this.next_setup;
            var reuse = $('#dashboard_setup_address_reuse_creds').prop('checked');
            if (reuse)
                this.prev_tab = 'address';
            else
                this.prev_tab = 'login';
        } else if (tab == 'close') {
            $('#dashboard_setup_action_tab').show();
            $('#dashboard_setup_next').text(_("Close"));
            this.next_action = this.next_close;
            this.prev_tab = null;
        }

        if (this.next_action === this.next_login)
            this.check_empty_name();
        else
            $('#dashboard_setup_next').prop('disabled', false);
        $('#dashboard_setup_prev').prop('disabled', !this.prev_tab);
    },

    close: function() {
        var self = this;
        if (self.remote)
            self.remote.close();
        $("#dashboard_setup_server_dialog").modal('hide');
    },

    cancel: function() {
        this.close();
    },

    prev: function() {
        if (this.prev_tab)
            this.show_tab(this.prev_tab);
    },

    next: function() {
        $("#dashboard_setup_spinner").show();
        $('#dashboard_setup_next').prop('disabled', true);
        this.next_action();
    },

    connect_server: function() {
        /* This function tries to connect to the server in
         * 'this.address' with 'this.options' and does the right thing
         * depending on the result.
         */

        var self = this;

        var options = $.extend({ bus: "internal", host: self.address, superuser: true }, self.options);
        var client = cockpit.dbus(null, options);

        $(client)
            .on("close", function(event, options) {
                if (!self.options["host-key"] && options.problem == "unknown-hostkey") {
                    /* The host key is unknown.  Remember it and try
                     * again while allowing that one host key.  When
                     * the user confirms the host key eventually, we
                     * store it permanently.
                     */
                    self.options["host-key"] = options["host-key"];
                    $('#dashboard_setup_action_fingerprint').text(options["host-fingerprint"]);
                    self.connect_server();
                    return;
                } else if (options.problem == "authentication-failed") {
                    /* The given credentials didn't work.  Ask the
                     * user to try again.
                     */
                    self.show_tab('login');
                    self.highlight_error_message('#dashboard_setup_login_error',
                                                 cockpit.message(options.problem));
                    return;
                }

                /* The connection has failed.  Show the error on every
                 * tab but stay on the current tab.
                 */
                var problem = options.problem || "disconnected";
                self.highlight_error_message('#dashboard_setup_address_error', cockpit.message(problem));
                self.highlight_error_message('#dashboard_setup_login_error', cockpit.message(problem));

                $('#dashboard_setup_next').prop('disabled', false);
                $('#dashboard_setup_next').text(_("Next"));
                $("#dashboard_setup_spinner").hide();
            });

        var remote = client.proxy("cockpit.Setup", "/setup");
        var local = self.local.proxy("cockpit.Setup", "/setup");
        remote.wait(function() {
            if (remote.valid) {
                self.remote = client;
                local.wait(function() {
                    self.prepare_setup(remote, local);
                });
            }
        });
    },

    next_select: function() {
        var me = this;
        var reuse_creds;

        me.hide_error_message('#dashboard_setup_address_error');

        me.address = $('#dashboard_setup_address').val();

        if (me.address.trim() !== "") {
            $('#dashboard_setup_login_address').text(me.address);

            reuse_creds = $('#dashboard_setup_address_reuse_creds').prop('checked');

            if (!reuse_creds)
                me.show_tab('login');
            else {
                me.options.user = null;
                me.options.password = null;
                me.options["host-key"] = null;
                me.connect_server();
            }
        } else {
            $('#dashboard_setup_next').text(_("Next"));
            $("#dashboard_setup_spinner").hide();
            me.highlight_error_message('#dashboard_setup_address_error',
                                       _("IP address or host name cannot be empty."));
        }
    },

    next_login: function() {
        var me = this;

        var user = $('#dashboard_setup_login_user').val();
        var pass = $('#dashboard_setup_login_password').val();

        me.hide_error_message('#dashboard_setup_login_error');

        me.options.user = user;
        me.options.password = pass;

        if (user.trim() !== "") {
            me.connect_server();
        } else {
            $('#dashboard_setup_next').text(_("Next"));
            $("#dashboard_setup_spinner").hide();
            me.highlight_error_message('#dashboard_setup_login_error',
                                       _("User name cannot be empty."));
        }
    },

    reset_tasks: function() {
        var $tasks = $('#dashboard_setup_action_tasks');

        this.tasks = [];
        $tasks.empty();
    },

    add_task: function(desc, func) {
        var $tasks = $('#dashboard_setup_action_tasks');

        var $entry = $('<li/>', { 'class': 'list-group-item' }).append(
            $('<table/>', { 'class': "cockpit-setup-task-table",
                            'style': "width:100%" }).append(
                $('<tr/>').append(
                    $('<td/>').text(
                        desc),
                    $('<td style="width:16px"/>').append(
                        $('<div>',  { 'class': "cockpit-setup-task-spinner spinner",
                                      'style': "display:none"
                                    }),
                        $('<div>', { 'class': "cockpit-setup-task-error fa fa-exclamation-triangle",
                                      'style': "display:none"
                                    }),
                        $('<div>', { 'class': "cockpit-setup-task-done pficon pficon-ok",
                                      'style': "display:none"
                                    })))));

        var task = { entry: $entry,
                     func: func,
                     error: function(msg) {
                         this.had_error = true;
                         this.entry.find(".cockpit-setup-task-table").append(
                             $('<tr/>').append(
                                 $('<td/>', { 'style': "color:red" }).text(msg)));
                     }
                   };

        this.tasks.push(task);
        $tasks.append($entry);
    },

    run_tasks: function(done) {
        var me = this;

        function run(i) {
            var t;

            if (i < me.tasks.length) {
                t = me.tasks[i];
                t.entry.find(".cockpit-setup-task-spinner").show();
                t.func(t, function() {
                    t.entry.find(".cockpit-setup-task-spinner").hide();
                    if (t.had_error)
                        t.entry.find(".cockpit-setup-task-error").show();
                    else
                        t.entry.find(".cockpit-setup-task-done").show();
                    run(i+1);
                });
            } else
                done();
        }

        run(0);
    },

    prepare_setup: function(remote, local) {
        var self = this;

        /* We assume all cockpits support the 'passwd1' mechanism */
        remote.Prepare("passwd1")
            .done(function(prepared) {
                self.reset_tasks();
                self.add_task(_("Synchronize admin logins"), function(task, done) {
                    passwd1_mechanism(task, done, prepared);
                });
                $('#dashboard_setup_action_address').text(self.address);
                self.show_tab('action');
            })
            .fail(function(ex) {
                self.highlight_error_message('#dashboard_setup_address_error', ex);
                self.highlight_error_message('#dashboard_setup_login_error', ex);
            });

        function passwd1_mechanism(task, done, prepared) {
            local.Transfer("passwd1", prepared)
                .fail(function(ex) {
                    task.error(ex);
                    done();
                })
                .done(function(result) {
                    remote.Commit("passwd1", result)
                        .fail(function(ex) {
                            task.error(ex);
                        })
                        .always(function() {
                            done();
                        });
                });
        }
    },

    next_setup: function() {
        var self = this;

        /* We can only add the machine to the list of known machines
         * here since doing so also stores its key as 'known good',
         * and we need the users permission for this.
         */

        self.machines.add(self.address, self.options["host-key"])
            .fail(function(ex) {
                self.highlight_error_message('#dashboard_setup_address_error', ex.toString());
                self.show_tab('address');
            })
            .done(function() {
                self.run_tasks(function() {
                    self.show_tab('close');
                });
            });
    },

    next_close: function() {
        this.close();
    }

};

function PageSetupServer() {
    this._init();
}

shell.dialogs.push(new PageSetupServer());

shell.host_setup = function host_setup(machines) {
    PageSetupServer.machines = machines;
    $('#dashboard_setup_server_dialog').modal('show');
};

});
