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

function make_set(array) {
    var s = { };
    for (var i = 0; i < array.length; i++)
        s[array[i]] = true;
    return s;
}

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

function find_account(user_name, client)
{
    var account_objs = client.getObjectsFrom("/com/redhat/Cockpit/Accounts/");
    var i, acc;

    for (i = 0; i < account_objs.length; i++) {
        acc = account_objs[i].lookup("com.redhat.Cockpit.Account");
        if (acc && acc.UserName == user_name)
            return acc;
    }
    return null;
}

function fill_canvas(canvas, overlay, data, width, callback)
{
    var img = new window.Image();
    img.onerror = function () {
        shell.show_error_dialog(_("Can't use this file"), _("Can't read it."));
    };
    img.onload = function () {
        canvas.width = width;
        canvas.height = canvas.width * (img.height/img.width);
        overlay.width = canvas.width;
        overlay.height = canvas.height;
        var ctxt = canvas.getContext("2d");
        ctxt.clearRect(0, 0, canvas.width, canvas.height);
        ctxt.drawImage(img, 0, 0, canvas.width, canvas.height);
        callback ();
    };
    img.src = data;
}

function canvas_data(canvas, x1, y1, x2, y2, width, height, format)
{
    var dest = $('<canvas/>')[0];
    dest.width = width;
    dest.height = height;
    var dest_w, dest_h;
    var img_w = x2 - x1, img_h = y2 - y1;
    if (img_w > img_h) {
        dest_w = width;
        dest_h = dest_w * (img_h/img_w);
    } else {
        dest_h = height;
        dest_w = dest_h * (img_w/img_h);
    }
    var ctxt = dest.getContext("2d");
    ctxt.drawImage (canvas,
                    x1, y1, img_w, img_h,
                    (width - dest_w)/2, (height - dest_h)/2, dest_w, dest_h);
    return dest.toDataURL(format);
}

// XXX - make private

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
        update_accounts_privileged();
    },

    enter: function() {
        /* TODO: This code needs to be migrated away from old dbus */
        this.client = shell.dbus(null);

        on_account_changes(this.client, "accounts", $.proxy(this, "update"));
        this.update();
    },

    leave: function() {
        off_account_changes(this.client, "accounts");
        this.client.release();
        this.client = null;
    },

    update: function() {
        var list = $("#accounts-list");
        var account_objs = this.client.getObjectsFrom("/com/redhat/Cockpit/Accounts/");
        var i, acc;

        this.accounts = [ ];
        for (i = 0; i < account_objs.length; i++) {
            acc = account_objs[i].lookup("com.redhat.Cockpit.Account");
            if (acc)
                this.accounts.push(acc);
        }

        this.accounts.sort (function (a, b) { return a.RealName.localeCompare(b.RealName); } );


        list.empty();
        for (i = 0; i < this.accounts.length; i++) {
            acc = this.accounts[i];
            var img =
                $('<img/>', { 'class': "cockpit-account-pic",
                              'width': "48",
                              'height': "48",
                              'src': "images/avatar-default-48.png" });
            var div =
                $('<div/>', { 'class': "cockpit-account" }).append(
                    img,
                    $('<div/>', { 'class': "cockpit-account-real-name" }).text(acc.RealName),
                    $('<div/>', { 'class': "cockpit-account-user-name" }).text(acc.UserName));
            div.on('click', $.proxy(this, "go", acc.UserName));
            list.append(div);
        }
    },

    create: function () {
        PageAccountsCreate.client = this.client;
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
        $('#accounts-create-dialog').modal('hide');
        var manager = PageAccountsCreate.client.get ("/com/redhat/Cockpit/Accounts",
                                                     "com.redhat.Cockpit.Accounts");
        manager.call("CreateAccount",
                     $('#accounts-create-user-name').val(),
                     $('#accounts-create-real-name').val(),
                     $('#accounts-create-pw1').val(),
                     $('#accounts-create-locked').prop('checked'),
                     function (error) {
                         if (error)
                             shell.show_unexpected_error(error);
                     });
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

    enter: function() {
        /* TODO: This code needs to be migrated away from old dbus */
        this.client = shell.dbus(null);

        on_account_changes(this.client, "account", $.proxy(this, "update"));
        this.real_name_dirty = false;
        this.update ();
    },

    leave: function() {
        off_account_changes(this.client, "account");
        this.client.release();
        this.client = null;
    },

    update: function() {
        this.account = find_account(shell.get_page_param('id'), this.client);

        if (this.account) {
            var can_change = this.check_role_for_self_mod();

            var manager = this.client.get ("/com/redhat/Cockpit/Accounts",
                                           "com.redhat.Cockpit.Accounts");
            this.sys_roles = manager.Roles || [ ];
            $('#account-real-name').attr('disabled', !can_change);

            if (!this.real_name_dirty)
                $('#account-real-name').val(this.account.RealName);
            $('#account-user-name').text(this.account.UserName);
            if (this.account.LoggedIn)
                $('#account-last-login').text(_("Logged In"));
            else if (this.account.LastLogin === 0)
                $('#account-last-login').text(_("Never"));
            else
                $('#account-last-login').text((new Date(this.account.LastLogin*1000)).toLocaleString());
            $('#account-locked').prop('checked', this.account.Locked);
            var groups = make_set(this.account.Groups);
            var roles = "";
            for (var i = 0; i < this.sys_roles.length; i++) {
                if (this.sys_roles[i][0] in groups) {
                    if (roles !== "")
                        roles += "<br/>";
                    roles += shell.esc(this.sys_roles[i][1]);
                }
            }
            $('#account-roles').html(roles);
            $('#account .breadcrumb .active').text(this.account.RealName);
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
        return (this.account.UserName == cockpit.user["user"] ||
                shell.default_permission.allowed !== false);
    },

    change_real_name: function() {
        var me = this;

        this.real_name_dirty = false;

        if (!me.check_role_for_self_mod ()) {
            me.update ();
            return;
        }

        this.account.call ('SetRealName', $('#account-real-name').val(),
                           function (error) {
                               if (error) {
                                   shell.show_unexpected_error(error);
                                   me.update ();
                               }
                           });
    },

    change_locked: function() {
        var me = this;

        this.account.call ('SetLocked',
                           $('#account-locked').prop('checked'),
                           function (error) {
                               if (error) {
                                   shell.show_unexpected_error(error);
                                   me.update ();
                               }
                           });
    },

    set_password: function() {
        if (!this.check_role_for_self_mod ())
            return;

        PageAccountSetPassword.user_name = this.account.UserName;
        $('#account-set-password-dialog').modal('show');
    },

    delete_account: function() {
        PageAccountConfirmDelete.account = this.account;
        $('#account-confirm-delete-dialog').modal('show');
    },

    logout_account: function() {
        var me = this;
        this.account.call('KillSessions',
                          function (error) {
                              if (error) {
                                  shell.show_unexpected_error(error);
                                  me.update ();
                              }
                          });
    },

    change_roles: function() {
        PageAccountChangeRoles.account = this.account;
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
        var groups, r, g, i;

        this.client = PageAccountChangeRoles.account._client;
        var manager = this.client.get ("/com/redhat/Cockpit/Accounts",
                                       "com.redhat.Cockpit.Accounts");
        this.sys_roles = manager.Roles || [ ];

        var list = $('<ul/>', { 'class': 'list-group' });
        for (i = 0; i < this.sys_roles.length; i++) {
            r = this.sys_roles[i][0];
            list.append(
                $('<li>', { 'class': 'list-group-item' }).append(
                    $('<div>', { 'class': 'checkbox',
                                 'style': 'margin:0px'
                               }).append(
                        $('<input/>', { type: "checkbox",
                                        name: "account-role-checkbox-" + r,
                                        id: "account-role-checkbox-" + r
                                      }),
                        $('<label/>', { "for": "account-role-checkbox-" + r }).text(
                            this.sys_roles[i][1]))));
        }

        var roles = $('#account-change-roles-roles');
        roles.empty();
        roles.append (list);

        groups = make_set(PageAccountChangeRoles.account.Groups);
        this.roles = { };
        for (i = 0; i < this.sys_roles.length; i++) {
            r = this.sys_roles[i][0];
            if (r in groups)
                this.roles[r] = true;
            $('#account-role-checkbox-' + r).prop('checked', this.roles[r]? true: false);
        }
    },

    leave: function() {
    },

    apply: function() {
        var i, r, checked;
        var add = [ ];
        var remove = [ ];
        for (i = 0; i < this.sys_roles.length; i++) {
            r = this.sys_roles[i][0];
            checked = $('#account-role-checkbox-' + r).prop('checked');
            if (checked && !this.roles[r])
                add.push(r);
            else if (!checked && this.roles[r])
                remove.push(r);
        }

        PageAccountChangeRoles.account.call ('ChangeGroups', add, remove,
                                             function (error) {
                                                 if (error)
                                                     shell.show_unexpected_error(error);
                                             });
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
        $('#account-confirm-delete-title').text(cockpit.format(_("Delete $0"), PageAccountConfirmDelete.account.UserName));
    },

    leave: function() {
    },

    apply: function() {
        var prog = ["/usr/sbin/userdel"];

        if ($('#account-confirm-delete-files').prop('checked'))
            prog.push("-r");

        prog.push(PageAccountConfirmDelete.account.UserName);

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
