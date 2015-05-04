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
    "base1/patterns",
    "shell/controls",
    "shell/shell",
    "shell/cockpit-main"
], function(jQuery, cockpit, patterns, controls, shell) {
"use strict";

var _ = cockpit.gettext;
var C_ = cockpit.gettext;
var $ = jQuery.scoped("body", patterns);

function update_accounts_privileged() {
    if ($('#account-user-name').text() === 'root' && shell.default_permission.allowed) {
        controls.update_privileged_ui({allowed: false},
                                      "#account-delete",
                                      _("Unable to delete root account"));
        controls.update_privileged_ui({allowed: false},
                                      "#account-change-roles",
                                      _("Unable to change roles for root account"));
    } else {
        controls.update_privileged_ui(
            shell.default_permission, ".accounts-privileged",
            cockpit.format(
                _("The user <b>$0</b> is not permitted to modify accounts"),
                cockpit.user.name)
        );
        $(".accounts-privileged").children("input")
            .attr('disabled', shell.default_permission.allowed === false ||
                              $('#account-user-name').text() === 'root');
    }
}

function passwd_self(old_pass, new_pass) {
    var old_exps = [
        /.*\(current\) UNIX password: $/,
    ];
    var new_exps = [
        /.*New password: $/,
        /.*Retype new password: $/
    ];
    var bad_exps = [
        /.*BAD PASSWORD:.*/
    ];

    var dfd = $.Deferred();
    var buffer = "";
    var sent_new = false;
    var failure = _("Old password not accepted");
    var i;

    var timeout = window.setTimeout(function() {
        failure = _("Prompting via passwd timed out");
        proc.close("terminated");
    }, 10 * 1000);

    var proc = cockpit.spawn(["/usr/bin/passwd"], { pty: true, environ: [ "LC_ALL=C" ], err: "out" })
        .always(function() {
            window.clearInterval(timeout);
        })
        .done(function() {
            dfd.resolve();
        })
        .fail(function(ex) {
            if (ex.constructor.name == "ProcessError")
                ex = new Error(failure);
            dfd.reject(ex);
        })
        .stream(function(data) {
            buffer += data;
            for (i = 0; i < old_exps.length; i++) {
                if (old_exps[i].test(buffer)) {
                    buffer = "";
                    proc.input(old_pass + "\n", true);
                    return;
                }
            }

            for (i = 0; i < new_exps.length; i++) {
                if (new_exps[i].test(buffer)) {
                    buffer = "";
                    proc.input(new_pass + "\n", true);
                    failure = _("Failed to change password");
                    sent_new = true;
                    return;
                }
            }

            for (i = 0; sent_new && i < bad_exps.length; i++) {
                if (bad_exps[i].test(buffer)) {
                    failure = _("New password was not accepted");
                    return;
                }
            }
        });

    return dfd.promise();
}

function passwd_change(user, new_pass) {
    var dfd = $.Deferred();

    var buffer = "";
    cockpit.spawn(["/usr/bin/passwd", "--stdin", user ], {superuser: true, err: "out" })
        .input(new_pass)
        .done(function() {
            dfd.resolve();
        })
        .fail(function(ex, response) {
            if (ex.constructor.name == "ProcessError") {
                console.log(ex);
                if (response)
                    ex = new Error(response);
                else
                    ex = new Error(_("Failed to change password"));
            }
            dfd.reject(ex);
        });

    return dfd.promise();
}

/*
 * Similar to $.when() but serializes, and accepts functions
 * that return promises
 */
function chain(functions) {
    var dfd = $.Deferred();
    var i = 0;

    /* Either an array or functions passed */
    if (typeof functions == "function")
        functions = arguments;

    function step() {
        if (i == functions.length) {
            dfd.resolve();
            return;
        }

        (functions[i])()
            .done(function() {
                step();
            })
            .fail(function(ex) {
                dfd.reject(ex);
            });

        i += 1;
    }

    step();
    return dfd.promise();
}

$(shell.default_permission).on("changed", update_accounts_privileged);

function parse_passwd_content(content, tag, error) {
    if (content === null) {
        console.warn("Couldn't read /etc/passwd", error);
        return [ ];
    }

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
        ret[i]["uid"] = parseInt(column[2], 10);
        ret[i]["gid"] = parseInt(column[3], 10);
        ret[i]["gecos"] = column[4];
        ret[i]["home"] = column[5];
        ret[i]["shell"] = column[6];
    }

    return ret;
}

function parse_group_content(content, tag, error) {
    if (content === null) {
        console.warn("Couldn't read /etc/group", error);
        return [ ];
    }

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
        ret[i]["gid"] = parseInt(column[2], 10);
        ret[i]["userlist"] = column[3].split(',');
    }

    return ret;
}

function password_quality(password) {
    var dfd = $.Deferred();

    cockpit.spawn('/usr/bin/pwscore', { "environ": ["LC_ALL=C"] })
       .input(password)
       .done(function(content) {
           var quality = parseInt(content, 10);
           if (quality === 0) {
               dfd.reject(new Error(_("Password is too weak")));
           } else if (quality <= 33) {
               dfd.resolve("weak");
           } else if (quality <= 66) {
               dfd.resolve("okay");
           } else if (quality <= 99) {
               dfd.resolve("good");
           } else {
               dfd.resolve("excellent");
           }
       })
       .fail(function() {
           dfd.reject(new Error(_("Password is not acceptable")));
       });

    return dfd.promise();
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
            if ((this.accounts[i]["uid"] < 1000 && this.accounts[i]["uid"] !== 0) ||
                  this.accounts[i]["shell"] == "/sbin/nologin")
                continue;
            var img =
                $('<div/>', { 'class': "cockpit-account-pic pficon pficon-user" });
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
        this.id = "accounts-create-dialog";
    },

    show: function() {
    },

    setup: function() {
        $('#accounts-create-cancel').on('click', $.proxy(this, "cancel"));
        $('#accounts-create-create').on('click', $.proxy(this, "create"));
        $('#accounts-create-dialog .check-passwords').on('keydown', $.proxy(this, "validate"));
    },

    enter: function() {
        $('#accounts-create-user-name').val("");
        $('#accounts-create-real-name').val("");
        $('#accounts-create-pw1').val("");
        $('#accounts-create-pw2').val("");
        $('#accounts-create-locked').prop('checked', false);
        $('#accounts-create-password-meter').removeClass("weak okay good excellent");
        $("#accounts-create-dialog").dialog("failure", null);
    },

    leave: function() {
    },

    validate: function() {
        var ex, fails = [];
        var pw = $('#accounts-create-pw1').val();
        if ($('#accounts-create-pw2').val() != pw) {
            ex = new Error(_("The passwords do not match"));
            ex.target = "#accounts-create-pw2";
            fails.push(ex);
        }
        if (!$('#accounts-create-user-name').val()) {
            ex = new Error(_("No user name specified"));
            ex.target = '#accounts-create-user-name';
            fails.push(ex);
        }
        if (!$('#accounts-create-real-name').val()) {
            ex = new Error(_("No real name specified"));
            ex.target = '#accounts-create-real-name';
            fails.push(ex);
        }

        /* The first check is immediately complete */
        var dfd = $.Deferred();
        if (fails.length)
            dfd.reject(fails);
        else
            dfd.resolve();

        var promise = password_quality(pw)
            .fail(function(ex) {
                ex.target = "#accounts-create-pw2";
            })
            .always(function(arg) {
                var strength = this.state() == "resolved" ? arg : "weak";
                var meter = $("#accounts-create-password-meter")
                    .removeClass("weak okay good excellent");
                if (pw)
                    meter.addClass(strength);
                var message = $("#accounts-create-password-meter-message");
                if (strength == "excellent") {
                    message.text(_("Excellent password"));
                } else {
                    message.text("");
                }
            });

        return $.when(dfd, promise);
    },

    cancel: function() {
        $('#accounts-create-dialog').modal('hide');
    },

    create: function() {
        var tasks = [
            function create_user() {
                var prog = ["/usr/sbin/useradd"];
                if ($('#accounts-create-real-name').val()) {
                    prog.push('-c');
                    prog.push($('#accounts-create-real-name').val());
                }
                prog.push($('#accounts-create-user-name').val());
                return cockpit.spawn(prog, { "superuser": true });
            }
        ];

        if ($('#accounts-create-locked').prop('checked')) {
            tasks.push(function adjust_locked() {
                return cockpit.spawn([
                    "/usr/sbin/usermod",
                    $('#accounts-create-user-name').val(),
                    "--lock"
                ], { superuser: true });
            });
        }

        tasks.push(function change_passwd() {
            return passwd_change($('#accounts-create-user-name').val(), $('#accounts-create-pw1').val());
        });

        var promise = this.validate()
            .fail(function(ex) {
                $("#accounts-create-password-meter-message").hide();
                $("#accounts-create-dialog").dialog("failure", ex);
            })
            .done(function() {
                promise = chain(tasks)
                    .done(function() {
                        $('#accounts-create-dialog').modal('hide');
                    })
                    .fail(function(ex) {
                        $("#accounts-create-dialog").dialog("failure", ex);
                    });
                $("#accounts-create-dialog").dialog("wait", promise);
            });

        $("#accounts-create-dialog").dialog("wait", promise);
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
        $("#account-real-name").removeAttr("data-dirty");

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

            var name = $("#account-real-name");

            name.attr('disabled', !can_change || this.account["uid"] === 0);
            $('#account-logout').attr('disabled', !this.logged);

            if (!name.attr("data-dirty"))
                $('#account-real-name').val(this.account["gecos"]);

            $('#account-user-name').text(this.account["name"]);

            if (this.logged)
                $('#account-last-login').text(_("Logged In"));
            else if (! this.lastLogin)
                $('#account-last-login').text(_("Never"));
            else
                $('#account-last-login').text(this.lastLogin.toLocaleString());

            if (typeof this.locked != 'undefined' && this.account["uid"] !== 0) {
                $('#account-locked').prop('checked', this.locked);
                $('#account-locked').parents('tr').show();
            } else {
                $('#account-locked').parents('tr').hide();
            }

            if (this.account["uid"] !== 0) {
                var roles = "";
                for (var i = 0; this.roles && i < this.roles.length; i++) {
                    if (! this.roles[i]["member"])
                        continue;
                    if (roles !== "")
                        roles += "<br/>";

                    roles += shell.esc(this.roles[i]["desc"]);
                }
                $('#account-roles').html(roles);
                $('#account-roles').parents('tr').show();
            } else {
                $('#account-roles').parents('tr').hide();
            }
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
        $("#account-real-name").attr("data-dirty", "true");
    },

    check_role_for_self_mod: function () {
        return (this.account["name"] == cockpit.user["user"] ||
                shell.default_permission.allowed !== false);
    },

    change_real_name: function() {
        var self = this;

        var name = $("#account-real-name");
        name.attr("data-dirty", "true");

        if (!self.check_role_for_self_mod ()) {
            self.update ();
            return;
        }

        // TODO: unwanted chars check
        var value = name.val();

        cockpit.spawn(["/usr/sbin/usermod", self.account["name"], "--comment", value],
                      { "superuser": true})
           .done(function(data) {
               self.account["gecos"] = value;
               self.update();
               name.removeAttr("data-dirty");
           })
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
        $('#account-set-password-dialog .check-passwords').on('keydown', $.proxy(this, "validate"));
    },

    enter: function() {
        $('#account-set-password-old').val("");
        $('#account-set-password-pw1').val("");
        $('#account-set-password-pw2').val("");
        $('#account-set-password-meter').removeClass("weak okay good excellent");
        $("#account-set-password-dialog").dialog("failure", null);
    },

    leave: function() {
    },

    validate: function() {
        var ex;
        var pw = $('#account-set-password-pw1').val();
        if ($('#account-set-password-pw2').val() != pw) {
            ex = new Error(_("The passwords do not match"));
            ex.target = "#account-set-password-pw2";
        }

        var dfd = $.Deferred();
        if (ex)
            dfd.reject(ex);
        else
            dfd.resolve();

        var promise = password_quality(pw)
            .fail(function(ex) {
                ex.target = "#account-set-password-pw2";
            })
            .always(function(arg) {
                var strength = (this.state() == "resolved") ? arg : "weak";
                var meter = $("#account-set-password-meter")
                    .removeClass("weak okay good excellent");
                if (pw)
                    meter.addClass(strength);
                var message = $("#account-set-password-meter-message");
                if (strength == "excellent") {
                    message.text(_("Excellent password"));
                } else {
                    message.text("");
                }
            });

        return $.when(dfd, promise);
    },

    apply: function() {
        var promise = this.validate()
            .done(function() {
                var user = PageAccountSetPassword.user_name;
                var password = $('#account-set-password-pw1').val();

                if (cockpit.user["user"] === user)
                    promise = passwd_self($('#account-set-password-old').val(), password);
                else
                    promise = passwd_change(user, password);

                promise
                    .done(function() {
                        $('#account-set-password-dialog').modal('hide');
                    })
                    .fail(function(ex) {
                        $("#account-set-password-dialog").dialog("failure", ex);
                    });
                $("#account-set-password-dialog").dialog("wait", promise);
            })
            .fail(function(ex) {
                $("#account-set-password-meter-message").hide();
                $("#account-set-password-dialog").dialog("failure", ex);
            });
        $("#account-set-password-dialog").dialog("wait", promise);
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

});
