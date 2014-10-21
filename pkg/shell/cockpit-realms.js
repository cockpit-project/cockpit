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

(function(cockpit, $) {

cockpit.realms_op_set_parameters = function realms_op_set_parameters(manager, op, realm, details) {
    PageRealmsOp.manager = manager;
    PageRealmsOp.op = op;
    PageRealmsOp.realm = realm;
    PageRealmsOp.details = details;
};

PageRealmsOp.prototype = {
    _init: function() {
        this.id = "realms-op";
    },

    show: function() {
    },

    setup: function() {
        var self = this;

        $("#realms-op-apply").on("click", function (e) {
            self.apply();
        });
        $("#realms-op-cancel").on("click", function (e) {
            self.cancel();
        });
        $("#realms-op-address").on("keyup", function (e) {
            self.maybe_check_realm();
        });
        $("#realms-op-address").on("change", function (e) {
            self.maybe_check_realm();
        });
        $(".realms-op-field").on("keydown", function (e) {
            if (e.which == 13)
                self.apply();
        });

        $("#realms-op-auth").on('change', function (e) {
            self.update_cred_fields();
        });

        $("#realms-op-software").on('change', function (e) {
            self.update_auth_methods();
        });
    },

    enter: function() {
        var me = this;

        $("#realms-op-diagnostics").hide();
        me.realm_manager = PageRealmsOp.manager;
        me.op = PageRealmsOp.op;
        me.realm = PageRealmsOp.realm;
        me.given_details = PageRealmsOp.details;

        $(me.realm_manager).on("notify:Busy.realms-op", function () {
            me.update_busy();
        });

        if (me.op == 'join') {
            me.never_show_software_choice = 1;
            me.title = C_("page-title", "Join a Domain");
            $("#realms-op-apply").text(_("Join"));
            $(".realms-op-join-only-row").show();
        } else if (me.op == 'leave') {
            me.never_show_software_choice = 1;
            me.title = C_("page-title", "Leave Domain");
            $("#realms-op-apply").text(_("Leave"));
            $(".realms-op-join-only-row").hide();
        } else {
            $("#realms-op").modal('hide');
            return;
        }

        $("#realms-op-title").empty().append(me.title);

        $("#realms-op-spinner").hide();
        $("#realms-op-wait-message").hide();
        $("#realms-op-address-spinner").hide();
        $("#realms-op-address-error").hide();
        $("#realms-op-error").empty();
        $("#realms-op-diagnostics").empty();
        $(".realms-op-field").val("");

        me.checking = 0;
        me.checked = "";
        me.discovered_details = [ ];

        if (me.op == 'join') {
            me.check_default_realm();
            me.maybe_check_realm();
            me.update_discovered_details();
        } else {
            me.update_auth_methods();
        }

        me.update_busy();
    },

    leave: function() {
    },

    update_discovered_details: function () {
        var me = this;

        var sel = $("#realms-op-software");
        sel.empty();
        for (var i = 0; i < me.discovered_details.length; i++) {
            var d = me.discovered_details[i];
            var txt = d['client-software'] + " / " + d['server-software'];
            sel.append('<option value="' + i + '">' + cockpit.esc(txt) + '</option>');
        }
        me.update_auth_methods();

        if (me.never_show_software_choice || me.discovered_details.length < 2) {
            $("#realms-op-software-row").hide();
        } else {
            $("#realms-op-software-row").show();
        }
    },

    update_auth_methods: function () {
        var me = this;

        var m = { };

        function add_from_details (d) {
            if (d) {
                var c = d['supported-join-credentials'];
                if (c) {
                    for (var i = 0; i < c.length; i++)
                        m[c[i]] = 1;
                }
            }
        }

        if (me.op == 'leave') {
            add_from_details (me.given_details);
        } else if (me.never_show_software_choice) {
            // Just merge them all and trust that realmd will do the
            // right thing.
            for (var i = 0; i < me.discovered_details.length; i++)
                add_from_details (me.discovered_details[i]);
        } else {
            var s = $("#realms-op-software").val();
            add_from_details (me.discovered_details[s]);
        }

        var have_one = 0;
        var sel = $("#realms-op-auth");

        function add_choice (tag, text) {
            if (tag in m) {
                sel.append('<option value="' + tag + '">' + cockpit.esc(text) + '</option>');
                have_one = 1;
            }
        }

        sel.empty();
        add_choice ('admin', _('Administrator Password'));
        add_choice ('user', _('User Password'));
        add_choice ('otp', _('One Time Password'));
        add_choice ('none', _('Automatic'));
        if (!have_one)
            sel.append('<option value="admin">' + _("Administrator Password") + '</option>');
        if($('[data-id="realms-op-auth"]').length <= 1)
            $("#realms-authentification-row").hide();
        else
            $("#realms-authentification-row").show();

        $('#realms-op-auth').selectpicker();
        me.update_cred_fields();
    },

    update_cred_fields: function () {
        var me = this;

        var a = $("#realms-op-auth").val();

        $("#realms-op-admin-row").hide();
        $("#realms-op-admin-password-row").hide();
        $("#realms-op-user-row").hide();
        $("#realms-op-user-password-row").hide();
        $("#realms-op-otp-row").hide();

        if (a == "admin") {
            $("#realms-op-admin-row").show();
            $("#realms-op-admin-password-row").show();
            var admin;
            if (me.op == 'join') {
                var s = $("#realms-op-software").val();
                var d = s && me.discovered_details[s];
                admin = d && d['suggested-administrator'];
            } else {
                admin = me.given_details['suggested-administrator'];
            }
            if (admin && !$("#realms-op-admin").val())
                $("#realms-op-admin")[0].placeholder = _("e.g. \""+admin+"\"");
        } else if (a == "user") {
            $("#realms-op-user-row").show();
            $("#realms-op-user-password-row").show();
        } else if (a == "otp") {
            $("#realms-op-otp-row").show();
        }
    },

    update_busy: function () {
        var me = this;

        var busy = me.realm_manager.Busy;

        if (busy && busy[0]) {
            $("#realms-op-spinner").show();
            $("#realms-op-wait-message").show();
            $(".realms-op-field").prop('disabled', true);
            $("#realms-op-apply").prop('disabled', true);
            $("#realms-op-software").prop('disabled', true);
            $('[data-id="realms-op-auth"]').prop('disabled', true);
        } else {
            $("#realms-op-spinner").hide();
            $("#realms-op-wait-message").hide();
            $(".realms-op-field").prop('disabled', false);
            $('[data-id="realms-op-auth"]').prop('disabled', false);
            $("#realms-op-apply").prop('disabled', false);
            $("#realms-op-software").prop('disabled', false);

        }
    },

    check_default_realm: function () {
        var me = this;

        me.realm_manager.call("Discover", "", { },
                              function (error, result, details) {
                                  if (result) {
                                      $("#realms-op-address")[0].placeholder =
                                          F(_("e.g. %{address}"), { address: result });
                                  }
                              });
    },

    maybe_check_realm: function() {
        var me = this;
        if ($("#realms-op-address").val() != me.checked) {
            $("#realms-op-address-error").hide();
            if (me.timeout)
                clearTimeout(me.timeout);
            me.timeout = setTimeout(function () { me.check_realm(); }, 1000);
        }
    },

    check_realm: function() {
        var me = this;

        var name = $("#realms-op-address").val();

        if (me.checking || !name || me.checked == name) {
            return;
        }

        $("#realms-op-address-spinner").show();
        me.checking = 1;
        me.checked = name;

        me.realm_manager.call("Discover", name, { },
                              function (error, result, details) {
                                  if ($("#realms-op-address").val() != me.checked) {
                                      me.checking = 0;
                                      me.check_realm();
                                  } else {
                                      $("#realms-op-address-spinner").hide();
                                      me.checking = 0;
                                      me.discovered_details = [ ];
                                      if (error)
                                          $("#realms-op-error").empty().append(error.message);
                                      else if (!result) {
                                          $("#realms-op-address-error").show();
                                          $("#realms-op-address-error").attr('title',
                                                                             F(_("Domain %{domain} could not be contacted"), { 'domain': cockpit.esc(name) }));
                                      } else {
                                          me.discovered_details = details;
                                      }
                                      me.update_discovered_details();
                                  }
                              });
    },

    apply: function() {
        var me = this;

        function handle_op_result (error, result)
        {
            me.working = false;
            if (error && error.name != "com.redhat.Cockpit.Error.Cancelled") {
                $("#realms-op-error").empty().append(error.message);
                $("#realms-op-error").append((' <button id="realms-op-more-diagnostics" data-inline="true">' +
                                              _("More") + '</button>'));
                $("#realms-op-more-diagnostics").click(function (e) {
                    me.realm_manager.call("GetDiagnostics",
                                          function (error, result) {
                                              $("#realms-op-more-diagnostics").hide();
                                              $("#realms-op-diagnostics").show();
                                              $("#realms-op-diagnostics").empty().append(result);
                                          });
                });
            } else {
                $("#realms-op").modal('hide');
            }
        }

        $("#realms-op-error").empty();
        $("#realms-op-diagnostics").empty();

        var a = $("#realms-op-auth").val();
        var creds;
        if (a == "user")
            creds = [ "user", $("#realms-op-user").val(), $("#realms-op-user-password").val() ];
        else if (a == "admin")
            creds = [ "admin", $("#realms-op-admin").val(), $("#realms-op-admin-password").val() ];
        else if (a == "otp")
            creds = [ "otp", "", $("#realms-op-ot-password").val() ];
        else
            creds = [ "none", "", "" ];

        var options;

        if (me.op == 'join') {
            var details;
            if (me.never_show_software_choice)
                details = { };
            else {
                var s = $("#realms-join-software").val();
                details = me.discovered_details[s];
            }

            options = { 'computer-ou': $("#realms-join-computer-ou").val() };

            if (details['client-software'])
                options['client-software'] = details['client-software'];
            if (details['server-software'])
                options['server-software'] = details['server-software'];

            me.working = true;
            me.realm_manager.call("Join", $("#realms-op-address").val(), creds, options, handle_op_result);
        } else if (me.op == 'leave') {
            options = { 'server-software': me.given_details['server-software'],
                        'client-software': me.given_details['client-software']
                      };
            me.working = true;
            me.realm_manager.call("Leave", me.realm, creds, options, handle_op_result);
        }
    },

    cancel: function() {
        var me = this;

        if (me.working) {
            me.realm_manager.call("Cancel", function (error, result) { });
        } else {
            $("#realms-op").modal('hide');
        }
        $("#realms-op-spinner").hide();
        $("#realms-op-wait-message").hide();
    }
};

function PageRealmsOp() {
    this._init();
}

cockpit.dialogs.push(new PageRealmsOp());

})(cockpit, $);
