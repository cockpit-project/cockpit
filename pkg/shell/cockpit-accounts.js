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

/* global jQuery   */
/* global cockpit  */
/* global _        */
/* global C_       */

var shell = shell || { };
(function($, cockpit, shell) {

function update_accounts_privileged() {
    shell.update_privileged_ui(
        shell.default_permission, ".accounts-privileged",
        cockpit.format(
            _("The user <b>$0</b> is not permitted to modify accounts"),
            cockpit.user.name)
    );
    $(".accounts-privileged").children("input")
        .attr('disabled', shell.default_permission.allowed === false);
}

$(shell.default_permission).on("changed", update_accounts_privileged);

function on_account_changes(client, id, func) {
    function object_added(event, obj) {
        if (obj.objectPath.indexOf("/com/redhat/Cockpit/Accounts/") === 0)
            func();
    }

    function object_removed(event, obj) {
        if (obj.objectPath.indexOf("/com/redhat/Cockpit/Accounts/") === 0)
            func();
    }

    function properties_changed(event, obj) {
        if (obj.objectPath.indexOf("/com/redhat/Cockpit/Accounts/") === 0)
            func();
    }

    function signal_emitted(event, iface, signal, args) {
        if (iface.getObject().objectPath.indexOf("/com/redhat/Cockpit/Accounts/") === 0 &&
            signal == "Changed")
            func();
    }

    $(client).on("objectAdded." + id, object_added);
    $(client).on("objectRemoved." + id, object_removed);
    $(client).on("propertiesChanged." + id, properties_changed);
    $(client).on("signalEmitted." + id, signal_emitted);
}

function off_account_changes(client, id) {
    $(client).off("." + id);
}

function parse_passwd_content(content) {
    var ret = [ ];
    var lines = content.split('\n');
    var column;

    for (var i = 0; i < lines.length; i++) {
        if (! lines[i])
            continue;
        column = lines[i].split(':');
        ret[i] = [];
        ret[i]["name"] = column[0];
        ret[i]["password"] = column[1];
        ret[i]["uid"] = column[2];
        ret[i]["gid"] = column[3];
        ret[i]["gecos"] = column[4];
        ret[i]["home"] = column[5];
        ret[i]["shell"] = column[6];
    }

    return ret;
}

function parse_group_content(content) {
    var ret = [ ];
    var lines = content.split('\n');
    var column;

    for (var i = 0; i < lines.length; i++) {
        if (! lines[i])
            continue;
        column = lines[i].split(':');
        ret[i] = [];
        ret[i]["name"] = column[0];
        ret[i]["password"] = column[1];
        ret[i]["gid"] = column[2];
        ret[i]["userlist"] = column[3].split(',');
    }

    return ret;
}

function change_password(user_name, old_pass, new_pass, success_call, failure_call) {
    var expect_in;
    var call;

    if (cockpit.user["user"] == user_name) {
        expect_in  = 'spawn passwd;' +
            'expect "Changing password for user ' + user_name + '";' +
            'expect "Changing password for ' + user_name + '";' +
            'expect "(current) UNIX password: ";' +
            'send "' + old_pass + '\\r";' +
            'expect "New password: ";' +
            'send "' + new_pass + '\\r";' +
            'expect "Retype new password: ";' +
            'send "' + new_pass + '\\r";' +
            'expect "passwd: all authentication tokens updated successfully.";';
        call = cockpit.spawn([ "/usr/bin/expect"], { "environ": ["LC_ALL=C"]});
    } else {
        expect_in = 'spawn passwd ' + user_name + ';' +
            'expect "Changing password for user ' + user_name + '";' +
            'expect "New password: ";' +
            'send "' + new_pass + '\\r";' +
            'expect "Retype new password: ";' +
            'send "' + new_pass + '\\r";' +
            'expect "passwd: all authentication tokens updated successfully.";';
        call = cockpit.spawn([ "/usr/bin/expect"], {"superuser" : true, "environ": ["LC_ALL=C"]});
    }

    call.input(expect_in)
        .fail(failure_call)
        .done(success_call);
}

function is_user_in_group(user, group) {
    for (var i = 0; group["userlist"] && i < group["userlist"].length; i++) {
        if (group["userlist"][i] === user)
            return true;
    }

    return false;
}

PageAccounts.prototype = {
    _init: function() {
        this.id = "accounts";
    },

    getTitle: function() {
        return C_("page-title", "Accounts");
    },

    show: function() {
    },

    setup: function() {
        $('#accounts-create').on('click', $.proxy (this, "create"));
    },

    enter: function() {
        var self = this;

        function parse_accounts(content) {
            self.accounts = parse_passwd_content(content);
            self.update();
        }

        this.handle_passwd =  cockpit.file('/etc/passwd');

        this.handle_passwd.read()
           .done(parse_accounts)
           .fail(shell.show_unexpected_error);

        this.handle_passwd.watch(parse_accounts);
    },

    leave: function() {
        if (this.handle_passwd) {
            this.handle_passwd.close();
            this.handle_passwd = null;
        }
    },

    update: function() {
        var list = $("#accounts-list");

        this.accounts.sort (function (a, b) {
                                if (! a["gecos"]) return -1;
                                else if (! b["gecos"]) return 1;
                                else return a["gecos"].localeCompare(b["gecos"]);
                            });

        list.empty();
        for (var i = 0; i < this.accounts.length; i++) {
            if (this.accounts[i]["uid"] < 1000 || this.accounts[i]["shell"] == "/sbin/nologin")
                continue;
            var img =
                $('<img/>', { 'class': "cockpit-account-pic",
                              'width': "48",
                              'height': "48",
                              'src': "images/avatar-default-48.png" });
            var div =
                $('<div/>', { 'class': "cockpit-account" }).append(
                    img,
                    $('<div/>', { 'class': "cockpit-account-real-name" }).text(this.accounts[i]["gecos"]),
                    $('<div/>', { 'class': "cockpit-account-user-name" }).text(this.accounts[i]["name"]));
            div.on('click', $.proxy(this, "go", this.accounts[i]["name"]));
            list.append(div);
        }
    },

    create: function () {
        $('#accounts-create-dialog').modal('show');
    },

    go: function (user) {
        cockpit.location.go('account', { id: user });
    }
};

function PageAccounts() {
    this._init();
}

shell.pages.push(new PageAccounts());

PageAccountsCreate.prototype = {
    _init: function() {
        this.error_timeout = null;
        this.id = "accounts-create-dialog";
    },

    show: function() {
    },

    setup: function() {
        $('#accounts-create-cancel').on('click', $.proxy(this, "cancel"));
        $('#accounts-create-create').on('click', $.proxy(this, "create"));
        $('#accounts-create-dialog .check-passwords').on('keydown', $.proxy(this, "update", "keydown"));
        $('#accounts-create-dialog .check-passwords').on('input', $.proxy(this, "update", "input"));
        $('#accounts-create-dialog input').on('focusout change', $.proxy(this, "update", "changeFocus"));
    },

    enter: function() {
        $('#accounts-create-user-name').val("");
        $('#accounts-create-real-name').val("");
        $('#accounts-create-pw1').val("");
        $('#accounts-create-pw2').val("");
        $('#accounts-create-locked').prop('checked', false);
        $('#accounts-create-message-password-mismatch').css("visibility", "hidden");
        $("#account-set-password-dialog .check-passwords").removeClass("has-error");
        this.update ();
    },

    leave: function() {
    },

    update: function(behavior) {
        function check_params ()
        {
            return ($('#accounts-create-user-name').val() !== "" &&
                    $('#accounts-create-real-name').val() !== "" &&
                    $('#accounts-create-pw1').val() !== "" &&
                    $('#accounts-create-pw2').val() == $('#accounts-create-pw1').val());
        }

        function highlight_error() {
            $("#accounts-create-dialog .check-passwords").addClass("has-error");
            $('#accounts-create-message-password-mismatch').css("visibility", "visible");
        }

        function hide_error() {
            $("#accounts-create-dialog .check-passwords").removeClass("has-error");
            $('#accounts-create-message-password-mismatch').css("visibility", "hidden");
        }

        function check_password_match() {
            if ($('#accounts-create-pw2').val() !== "" &&
                $('#accounts-create-pw1').val() !== $('#accounts-create-pw2').val())
                highlight_error();
            else
                hide_error();
        }

        window.clearTimeout(this.error_timeout);
        this.error_timeout = null;

        if (behavior == "changeFocus") {
            if ($('#accounts-create-pw2').val() !== "" &&
                $('#accounts-create-pw1').val() !== $('#accounts-create-pw2').val())
                highlight_error();
            else
                hide_error();
        } else if (behavior == "input") {
            if ($('#accounts-create-pw2').val() !== "" &&
                !$('#accounts-create-pw1').val().startsWith($('#accounts-create-pw2').val()))
                highlight_error();
            else
                hide_error();

            this.error_timeout = window.setTimeout(check_password_match, 2000);
            this.setTimeout = null;
        }

        $('#accounts-create-create').prop('disabled', !check_params());
    },

    cancel: function() {
        $('#accounts-create-dialog').modal('hide');
    },

    create: function() {
        var prog = ["/usr/sbin/useradd"];

        function adjust_locked() {
            if ($('#accounts-create-locked').prop('checked')) {
                cockpit.spawn(["/usr/sbin/usermod",
                              $('#accounts-create-user-name').val(),
                              "--lock"], { "superuser": true})
                       .done(function() {$('#accounts-create-dialog').modal('hide');})
                       .fail(shell.show_unexpected_error);
            } else {
                $('#accounts-create-dialog').modal('hide');
            }
        }

        if ($('#accounts-create-real-name').val()) {
            prog.push('-c');
            prog.push($('#accounts-create-real-name').val());
        }

        prog.push($('#accounts-create-user-name').val());

        cockpit.spawn(prog, { "superuser": true })
           .done(function () {
                if ($('#accounts-create-pw1').val()) {
                    change_password($('#accounts-create-user-name').val(),
                                    "",
                                    $('#accounts-create-pw1').val(),
                                    adjust_locked,
                                    function() { shell.show_unexpected_error(_("Failed to change password")); });
               } else {
                   adjust_locked();
               }
           })
           .fail(shell.show_unexpected_error);
    }
};

function PageAccountsCreate() {
    this._init();
}

shell.dialogs.push(new PageAccountsCreate());

PageAccount.prototype = {
    _init: function() {
        this.id = "account";
        this.section_id = "accounts";
        this.roles = [];
    },

    getTitle: function() {
        return C_("page-title", "Accounts");
    },

    show: function() {
    },

    setup: function() {
        $('#account-real-name').on('change', $.proxy (this, "change_real_name"));
        $('#account-real-name').on('keydown', $.proxy (this, "real_name_edited"));
        $('#account-set-password').on('click', $.proxy (this, "set_password"));
        $('#account-delete').on('click', $.proxy (this, "delete_account"));
        $('#account-logout').on('click', $.proxy (this, "logout_account"));
        $('#account-change-roles').on('click', $.proxy (this, "change_roles"));
        $('#account-locked').on('change', $.proxy (this, "change_locked"));
    },

    get_user: function() {
       var self = this;
       function parse_user(content) {
            var accounts = parse_passwd_content(content);

            for (var i = 0; i < accounts.length; i++) {
               if (accounts[i]["name"] !== shell.get_page_param('id'))
                  continue;

               self.account = accounts[i];
               self.update();
            }
        }

        this.handle_passwd = cockpit.file('/etc/passwd');

        this.handle_passwd.read()
           .done(parse_user)
           .fail(shell.show_unexpected_error);

        this.handle_passwd.watch(parse_user);
    },

    get_roles: function() {
        var self = this;

        function parse_groups(content) {
            var i, j;
            self.groups = parse_group_content(content);
            while (self.roles.length > 0)
                self.roles.pop();
            for (i = 0, j = 0; i < self.groups.length; i++) {
                if (self.groups[i]["name"] == "wheel" || self.groups[i]["name"] == "docker") {
                   self.roles[j] = { };
                   self.roles[j]["name"] = self.groups[i]["name"];
                   self.roles[j]["desc"] = self.groups[i]["name"] == "wheel" ?
                                           _("Server Administrator") :
                                           _("Container Administrator");
                   self.roles[j]["id"] = self.groups[i]["gid"];
                   self.roles[j]["member"] = is_user_in_group(shell.get_page_param('id'), self.groups[i]);
                   j++;
                }
            }
            $(self).triggerHandler("roles");
            self.update();
        }

        this.handle_groups = cockpit.file('/etc/group');

        this.handle_groups.read()
           .done(parse_groups)
           .fail(shell.show_unexpected_error);

        this.handle_groups.watch(parse_groups);
    },

    get_last_login: function() {
        var self = this;

        function parse_last_login(data) {
           data = data.split('\n')[1]; // throw away header
           if (data.length === 0) return null;
           data =  data.split('   '); // get last column - separated by spaces

           if (data[data.length - 1].indexOf('**Never logged in**') > -1)
               return null;
           else
               return new Date(data[data.length - 1]);
        }

        cockpit.spawn(["/usr/bin/lastlog", "-u", shell.get_page_param('id')],
                      { "environ": ["LC_ALL=C"] })
           .done(function (data) { self.lastLogin = parse_last_login(data); self.update(); })
           .fail(shell.show_unexpected_error);
    },

    get_locked: function() {
        var self = this;

        function parse_locked(content) {
            self.locked = content.indexOf("Password locked.") > -1;
            self.update();
        }

        cockpit.spawn(["/usr/bin/passwd", "-S", shell.get_page_param('id')],
                      { "environ": [ "LC_ALL=C" ], "superuser": true })
           .done(parse_locked);
    },

    get_logged: function() {
        var self = this;

        function parse_logged(content) {
            self.logged = content.length > 0;
            if (! self.logged)
               self.get_last_login();
            else
               self.update();
        }

        cockpit.spawn(["/usr/bin/w", "-sh", shell.get_page_param('id')])
           .done(parse_logged)
           .fail(shell.show_unexpected_error);
    },

    enter: function() {
        this.real_name_dirty = false;

        this.get_user();
        this.get_roles();
        this.get_locked();
        this.get_logged();
    },

    leave: function() {
        if (this.handle_passwd) {
           this.handle_passwd.close();
           this.handle_passwd = null;
        }

        if (this.handle_groups) {
           this.handle_groups.close();
           this.handle_groups = null;
        }
    },

    update: function() {
        if (this.account) {
            var can_change = this.check_role_for_self_mod();

            $('#account-real-name').attr('disabled', !can_change);
            $('#account-logout').attr('disabled', !this.logged);

            if (!this.real_name_dirty)
                $('#account-real-name').val(this.account["gecos"]);

            $('#account-user-name').text(this.account["name"]);

            if (this.logged)
                $('#account-last-login').text(_("Logged In"));
            else if (! this.lastLogin)
                $('#account-last-login').text(_("Never"));
            else
                $('#account-last-login').text(this.lastLogin.toLocaleString());

            if (typeof this.locked != 'undefined') {
                $('#account-locked').prop('checked', this.locked);
                $('#account-locked').parents('tr').show();
            } else {
                $('#account-locked').parents('tr').hide();
            }

            var roles = "";
            for (var i = 0; this.roles && i < this.roles.length; i++) {
                if (! this.roles[i]["member"])
                    continue;
                if (roles !== "")
                    roles += "<br/>";

                roles += shell.esc(this.roles[i]["desc"]);
            }
            $('#account-roles').html(roles);
            $('#account .breadcrumb .active').text(this.account["gecos"]);
        } else {
            $('#account-real-name').val("");
            $('#account-user-name').text("");
            $('#account-last-login').text("");
            $('#account-locked').prop('checked', false);
            $('#account-roles').text("");
            $('#account .breadcrumb .active').text("?");
        }
        update_accounts_privileged();
    },

    real_name_edited: function() {
        this.real_name_dirty = true;
    },

    check_role_for_self_mod: function () {
        return (this.account["name"] == cockpit.user["user"] ||
                shell.default_permission.allowed !== false);
    },

    change_real_name: function() {
        var me = this;

        this.real_name_dirty = false;

        if (!me.check_role_for_self_mod ()) {
            me.update ();
            return;
        }

        // TODO: unwanted chars check
        cockpit.spawn(["/usr/sbin/usermod",
                      me.account["name"], "--comment",
                      $('#account-real-name').val()],
                      { "superuser": true})
           .done(function(data) { me.account["gecos"] = $('#account-real-name').val(); me.update(); })
           .fail(shell.show_unexpected_error);
    },

    change_locked: function() {
        cockpit.spawn(["/usr/sbin/usermod",
                       this.account["name"],
                       $('#account-locked').prop('checked') ? "--lock" : "--unlock"], { "superuser": true})
           .done($.proxy (this, "get_locked"))
           .fail(shell.show_unexpected_error);
    },

    set_password: function() {
        if (!this.check_role_for_self_mod ())
            return;

        PageAccountSetPassword.user_name = this.account["name"];
        $('#account-set-password-dialog').modal('show');
    },

    delete_account: function() {
        PageAccountConfirmDelete.user_name = this.account["name"];
        $('#account-confirm-delete-dialog').modal('show');
    },

    logout_account: function() {
        cockpit.spawn(["/usr/bin/loginctl", "kill-user", this.account["name"]], { "superuser": true})
           .done($.proxy (this, "get_logged"))
           .fail(shell.show_unexpected_error);

    },

    change_roles: function() {
        PageAccountChangeRoles.page = this;
        $('#account-change-roles-dialog').modal('show');
    }

};

function PageAccount() {
    this._init();
}

shell.pages.push(new PageAccount());

var crop_handle_width = 20;

PageAccountChangeRoles.prototype = {
    _init: function() {
        this.id = "account-change-roles-dialog";
    },

    show: function() {
    },

    setup: function() {
        $('#account-change-roles-apply').on('click', $.proxy(this, "apply"));
    },

    enter: function() {
        function update() {
            var r, u;
            var roles = $('#account-change-roles-roles');

            roles.empty();

            u = PageAccountChangeRoles.page.account;

            for (var i = 0; i < PageAccountChangeRoles.page.roles.length; i++) {
                r = PageAccountChangeRoles.page.roles[i];
                roles.append(
                      $('<li>', { 'class': 'list-group-item' }).append(
                          $('<div>', { 'class': 'checkbox',
                                       'style': 'margin:0px'
                                     }).append(
                              $('<input/>', { type: "checkbox",
                                              name: "account-role-checkbox-" + r["id"],
                                              id: "account-role-checkbox-" + r["id"],
                                              checked: r["member"]
                                            }),
                              $('<label/>', { "for": "account-role-checkbox-" + r["id"] }).text(
                                  r["desc"]))));
            }
        }

        $(PageAccountChangeRoles.page).on("roles", update);
        update();
    },

    leave: function() {
        $(PageAccountChangeRoles.page).off("roles");
    },

    apply: function() {
        var checked, r;
        var new_roles = [ ];
        var del_roles = [ ];

        for (var i = 0; i < PageAccountChangeRoles.page.roles.length; i++) {
            r = PageAccountChangeRoles.page.roles[i];
            if ($('#account-role-checkbox-' + r["id"]).prop('checked') && ! r["member"])
                new_roles.push(r["id"]);

            if (! $('#account-role-checkbox-' + r["id"]).prop('checked') && r["member"])
               del_roles.push(r["name"]);
        }

        if (new_roles.length > 0) {
            cockpit.spawn(["/usr/sbin/usermod", PageAccountChangeRoles.page.account["name"],
                           "-G", new_roles.toString(), "-a"], { "superuser": true })
               .fail(shell.show_unexpected_error);
        }

        for (var j = 0; j < del_roles.length; j++) {
            cockpit.spawn(["/usr/bin/gpasswd", "-d", PageAccountChangeRoles.page.account["name"],
                           del_roles[j]], { "superuser": true })
                   .fail(shell.show_unexpected_error);
        }

        $('#account-change-roles-dialog').modal('hide');
    }
};

function PageAccountChangeRoles() {
    this._init();
}

shell.dialogs.push(new PageAccountChangeRoles());

PageAccountConfirmDelete.prototype = {
    _init: function() {
        this.id = "account-confirm-delete-dialog";
    },

    show: function() {
    },

    setup: function() {
        $('#account-confirm-delete-apply').on('click', $.proxy(this, "apply"));
    },

    enter: function() {
        $('#account-confirm-delete-files').prop('checked', false);
        $('#account-confirm-delete-title').text(cockpit.format(_("Delete $0"), PageAccountConfirmDelete.user_name));
    },

    leave: function() {
    },

    apply: function() {
        var prog = ["/usr/sbin/userdel"];

        if ($('#account-confirm-delete-files').prop('checked'))
            prog.push("-r");

        prog.push(PageAccountConfirmDelete.user_name);

        cockpit.spawn(prog, { "superuser": true })
           .done(function () {
              $('#account-confirm-delete-dialog').modal('hide');
              cockpit.location = "accounts";
           })
           .fail(shell.show_unexpected_error);
    }
};

function PageAccountConfirmDelete() {
    this._init();
}

shell.dialogs.push(new PageAccountConfirmDelete());

PageAccountSetPassword.prototype = {
    _init: function() {
        this.error_timeout = null;
        this.id = "account-set-password-dialog";
    },

    show: function() {
        if (cockpit.user["user"] !== PageAccountSetPassword.user_name) {
            $('#account-set-password-old').parents('tr').toggle(false);
            $('#account-set-password-pw1').focus();
        } else {
            $('#account-set-password-old').parents('tr').toggle(true);
            $('#account-set-password-old').focus();
        }
    },

    setup: function() {
        $('#account-set-password-apply').on('click', $.proxy(this, "apply"));
        $('#account-set-password-dialog .check-passwords').on('keydown', $.proxy(this, "update", "keydown"));
        $('#account-set-password-dialog .check-passwords').on('input', $.proxy(this, "update", "input"));
        $('#account-set-password-dialog input').on('focusout change', $.proxy(this, "update", "changeFocus"));
    },

    enter: function() {
        $('#account-set-password-old').val("");
        $('#account-set-password-pw1').val("");
        $('#account-set-password-pw2').val("");
        $('#account-set-password-message-password-mismatch').css("visibility", "hidden");
        $("#account-set-password-dialog .check-passwords").removeClass("has-error");
        this.update ();
    },

    leave: function() {
    },

    update: function(behavior) {
        function check_params ()
        {
            return ($('#account-set-password-pw1').val() !== "" &&
                    $('#account-set-password-pw2').val() == $('#account-set-password-pw1').val());
        }

        function highlight_error() {
            $("#account-set-password-dialog .check-passwords").addClass("has-error");
            $('#account-set-password-message-password-mismatch').css("visibility", "visible");
        }

        function hide_error() {
            $("#account-set-password-dialog .check-passwords").removeClass("has-error");
            $('#account-set-password-message-password-mismatch').css("visibility", "hidden");
        }

        function check_password_match() {
            if ($('#account-set-password-pw2').val() !== "" &&
                $('#account-set-password-pw1').val() !== $('#account-set-password-pw2').val())
                highlight_error();
            else
                hide_error();
        }

        window.clearTimeout(this.error_timeout);
        this.error_timeout = null;

        if (behavior == "changeFocus") {
            if ($('#account-set-password-pw2').val() !== "" &&
                $('#account-set-password-pw1').val() !== $('#account-set-password-pw2').val())
                highlight_error();
            else
                hide_error();
        } else if (behavior == "input") {
            if ($('#account-set-password-pw2').val() !== "" &&
                !$('#account-set-password-pw1').val().startsWith($('#account-set-password-pw2').val()))
                highlight_error();
            else
                hide_error();

            this.error_timeout = window.setTimeout(check_password_match, 2000);
            this.setTimeout = null;
        }

        $('#account-set-password-apply').prop('disabled', !check_params());
    },

    apply: function() {
        change_password(PageAccountSetPassword.user_name,
                        $('#account-set-password-old').val(),
                        $('#account-set-password-pw1').val(),
                        function() { $('#account-set-password-dialog').modal('hide'); },
                        function() { shell.show_unexpected_error(_("Failed to change password")); });
    }
};

function PageAccountSetPassword() {
    this._init();
}

shell.dialogs.push(new PageAccountSetPassword());

shell.change_password = function change_password() {
    PageAccountSetPassword.user_name = cockpit.user["user"];
    $('#account-set-password-dialog').modal('show');
};

})(jQuery, cockpit, shell);
