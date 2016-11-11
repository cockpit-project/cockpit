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

var $ = require("jquery");
var cockpit = require("cockpit");

var Mustache = require("mustache");
var authorized_keys = require("./authorized-keys");

require("patterns");

cockpit.translate();
var _ = cockpit.gettext;
var C_ = cockpit.gettext;

var permission = cockpit.permission({ admin: true });
$(permission).on("changed", update_accounts_privileged);

function update_accounts_privileged() {
    $(".accounts-self-privileged").addClass("accounts-privileged");

    $(".accounts-privileged:not('.accounts-current-account')").update_privileged(
        permission, cockpit.format(
            _("The user <b>$0</b> is not permitted to modify accounts"),
            permission.user ? permission.user.name : ''),
        "right"
    );
    $(".accounts-privileged").find("input")
        .attr('disabled', permission.allowed === false ||
                          $('#account-user-name').text() === 'root');

    // enable fields for current account.
    $(".accounts-current-account").update_privileged(
        {allowed: true}, ""
    );
    $(".accounts-current-account").find("input")
        .attr('disabled', false);

    if ($('#account-user-name').text() === 'root' && permission.allowed) {
        $("#account-delete").update_privileged({allowed: false},
                                      _("Unable to delete root account"));
        $("#account-real-name-wrapper").update_privileged({allowed: false},
                                      _("Unable to rename root account"));
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
    cockpit.spawn([ "chpasswd" ], {superuser: "require", err: "out" })
        .input(user + ":" + new_pass)
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

function parse_passwd_content(content) {
    if (!content) {
        console.warn("Couldn't read /etc/passwd");
        return [ ];
    }

    var ret = [ ];
    var lines = content.split('\n');
    var column;

    for (var i = 0; i < lines.length; i++) {
        if (! lines[i])
            continue;
        column = lines[i].split(':');
        ret.push({
            name: column[0],
            password: column[1],
            uid: parseInt(column[2], 10),
            gid: parseInt(column[3], 10),
            gecos: column[4].replace(/,*$/, ''),
            home: column[5],
            shell: column[6],
        });
    }

    return ret;
}

function parse_group_content(content) {
    content = (content || "").trim();
    if (!content) {
        console.warn("Couldn't read /etc/group");
        return [ ];
    }

    var ret = [ ];
    var lines = content.split('\n');
    var column;

    for (var i = 0; i < lines.length; i++) {
        if (! lines[i])
            continue;
        column = lines[i].split(':');
        ret.push({
            name: column[0],
            password: column[1],
            gid: parseInt(column[2], 10),
            userlist: column[3].split(','),
        });
    }

    return ret;
}

function password_quality(password) {
    var dfd = $.Deferred();

    cockpit.spawn('/usr/bin/pwscore', { "err": "message" })
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
       .fail(function(ex) {
           dfd.reject(new Error(ex.message || _("Password is not acceptable")));
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

function log_unexpected_error(error) {
    console.warn("Unexpected error", error);
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
           .fail(log_unexpected_error);

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
                  this.accounts[i]["shell"].match(/^(\/usr)?\/sbin\/nologin/) ||
                  this.accounts[i]["shell"] === '/bin/false')
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
        PageAccountsCreate.accounts = this.accounts;
        $('#accounts-create-dialog').modal('show');
    },

    go: function (user) {
        cockpit.location.go([ user ]);
    }
};

function PageAccounts() {
    this._init();
}

PageAccountsCreate.prototype = {
    _init: function() {
        this.id = "accounts-create-dialog";
        this.username_dirty = false;
    },

    show: function() {
    },

    setup: function() {
        var self = this;
        $('#accounts-create-cancel').on('click', $.proxy(this, "cancel"));
        $('#accounts-create-create').on('click', $.proxy(this, "create"));
        $('#accounts-create-dialog .check-passwords').on('keydown change', $.proxy(this, "validate"));
        $('#accounts-create-real-name').on('input', $.proxy(this, "suggest_username"));
        $('#accounts-create-user-name').on('input', function() { self.username_dirty = true; });
    },

    enter: function() {
        $('#accounts-create-user-name').val("");
        $('#accounts-create-real-name').val("");
        $('#accounts-create-pw1').val("");
        $('#accounts-create-pw2').val("");
        $('#accounts-create-locked').prop('checked', false);
        $('#accounts-create-password-meter').removeClass("weak okay good excellent");
        $("#accounts-create-dialog").dialog("failure", null);
        this.username_dirty = false;
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

        var promise_password = password_quality(pw)
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

        var promise_username = this.check_username()
            .fail(function(ex) {
                ex.target = "#accounts-create-user-name";
            });

        return cockpit.all(dfd, promise_password, promise_username);
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
                return cockpit.spawn(prog, { "superuser": "require", err: "message" });
            }
        ];

        if ($('#accounts-create-locked').prop('checked')) {
            tasks.push(function adjust_locked() {
                return cockpit.spawn([
                    "/usr/sbin/usermod",
                    $('#accounts-create-user-name').val(),
                    "--lock"
                ], { superuser: "require", err: "message" });
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
                promise = chain(tasks);
                $("#accounts-create-dialog").dialog("promise", promise);
            });

        $("#accounts-create-dialog").dialog("wait", promise);
    },

    is_valid_char_username: function(c) {
        return (c >= 'a' && c <= 'z') ||
               (c >= 'A' && c <= 'Z') ||
               (c >= '0' && c <= '9') ||
               c == '.' || c == '_' || c == '-';
    },

    check_username: function() {
        var dfd = $.Deferred();
        var username = $('#accounts-create-user-name').val();

        for (var i = 0; i < username.length; i++) {
            if (! this.is_valid_char_username(username[i])) {
                dfd.reject(new Error(
                  _("The user name can only consist of letters from a-z, digits, dots, dashes and underscores.")
                ));
                return dfd.promise();
            }
        }

        for (var k = 0; k < PageAccountsCreate.accounts.length; k++) {
            if (PageAccountsCreate.accounts[k]['name'] == username) {
                dfd.reject(new Error(_("This user name already exists")));
                return dfd.promise();
            }
        }

        dfd.resolve();
        return dfd.promise();
    },

    suggest_username: function() {
        var self = this;

        function remove_diacritics(str) {
            var translate_table = {
               'a' :  '[àáâãäå]',
               'ae':  'æ',
               'c' :  'čç',
               'd' :  'ď',
               'e' :  '[èéêë]',
               'i' :  '[íìïî]',
               'l' :  '[ĺľ]',
               'n' :  '[ňñ]',
               'o' :  '[òóôõö]',
               'oe':  'œ',
               'r' :  '[ŕř]',
               's' :  'š',
               't' :  'ť',
               'u' :  '[ùúůûűü]',
               'y' :  '[ýÿ]',
               'z' :  'ž',
            };
            for (var i in translate_table)
                str = str.replace(new RegExp(translate_table[i], 'g'), i);

            for (var k = 0; k < str.length; ) {
                if (! self.is_valid_char_username(str[k]))
                    str = str.substr(0, k) + str.substr(k + 1);
                else
                   k++;
            }

            return str;
        }

        function make_username(realname) {
            var result = "";
            var name = realname.split(' ');

            if (name.length === 1)
                result = name[0].toLowerCase();
            else if (name.length > 1)
                result = name[0][0].toLowerCase() + name[name.length - 1].toLowerCase();

            return remove_diacritics(result);
        }

        if (this.username_dirty)
           return;

        var username = make_username($('#accounts-create-real-name').val());
        $('#accounts-create-user-name').val(username);
    }

};

function PageAccountsCreate() {
    this._init();
}

PageAccount.prototype = {
    _init: function(user) {
        this.id = "account";
        this.section_id = "accounts";
        this.roles = [];
        this.role_template = $("#role-entry-tmpl").html();
        Mustache.parse(this.role_template);

        this.keys_template = $("#authorized-keys-tmpl").html();
        Mustache.parse(this.keys_template);
        this.authorized_keys = null;

        this.user = user;
    },

    getTitle: function() {
        return C_("page-title", "Accounts");
    },

    show: function() {
        var self = this;
        $("#account").toggle(!!self.account_id);
        $("#account-failure").toggle(!self.account_id);
    },

    setup: function() {
        $('#account .breadcrumb a').on("click", function() {
            cockpit.location.go('/');
        });

        $('#account-real-name').on('change', $.proxy (this, "change_real_name"));
        $('#account-real-name').on('keydown', $.proxy (this, "real_name_edited"));
        $('#account-set-password').on('click', $.proxy (this, "set_password"));
        $('#account-delete').on('click', $.proxy (this, "delete_account"));
        $('#account-logout').on('click', $.proxy (this, "logout_account"));
        $('#account-locked').on('change', $.proxy (this, "change_locked", true, null));
        $('#add-authorized-key').on('click', $.proxy (this, "add_key"));
        $('#add-authorized-key-dialog').on('hidden.bs.modal', function () {
            $("#authorized-keys-text").val("");
        });
    },

    setup_keys: function (user_name, home_dir) {
        var self = this;
        if (!self.authorized_keys) {
            self.authorized_keys = authorized_keys.instance(user_name, home_dir);
            $(self.authorized_keys).on("changed", function () {
                self.update();
            });
        }
    },

    remove_key: function (ev) {
        if (!this.authorized_keys)
            return;

        var key = $(ev.target).data("raw");
        $(".account-remove-key").prop('disabled', true);
        this.authorized_keys.remove_key(key)
            .fail(show_unexpected_error)
            .always(function () {
                $(".account-remove-key").prop('disabled', false);
            });
    },

    add_key: function () {
        if (!this.authorized_keys) {
            $("#add-authorized-key-dialog").modal('hide');
            return;
        }

        var key = $("#authorized-keys-text").val();
        var promise = this.authorized_keys.add_key(key);
        $("#add-authorized-key-dialog").dialog("promise", promise);
    },

    get_user: function() {
       var self = this;
       function parse_user(content) {
            var accounts = parse_passwd_content(content);

            for (var i = 0; i < accounts.length; i++) {
               if (accounts[i]["name"] !== self.account_id)
                  continue;

               self.account = accounts[i];
               self.setup_keys(self.account.name, self.account.home);
               self.update();
            }
        }

        this.handle_passwd = cockpit.file('/etc/passwd');

        this.handle_passwd.read()
           .done(parse_user)
           .fail(log_unexpected_error);

        this.handle_passwd.watch(parse_user);
    },

    get_roles: function() {
        var self = this;

        var role_groups = {
            "wheel":   _("Server Administrator"),
            "sudo":    _("Server Administrator"),
            "docker":  _("Container Administrator")
        };

        function parse_groups(content) {
            var groups = parse_group_content(content);
            while (self.roles.length > 0)
                self.roles.pop();
            for (var i = 0; i < groups.length; i++) {
                var name = groups[i]["name"];
                if (role_groups[name]) {
                    self.roles.push({
                        name: name,
                        desc: role_groups[name],
                        id: groups[i]["gid"],
                        member: is_user_in_group(self.account_id, groups[i]),
                    });
                }
            }
            $(self).triggerHandler("roles");
            self.update();
        }

        this.handle_groups = cockpit.file('/etc/group');

        this.handle_groups.read()
           .done(parse_groups)
           .fail(log_unexpected_error);

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

        cockpit.spawn(["/usr/bin/lastlog", "-u", self.account_id],
                      { "environ": ["LC_ALL=C"] })
           .done(function (data) {
               self.lastLogin = parse_last_login(data);
               self.update();
           })
           .fail(function() {
               self.lastLogin = null;
               self.update();
           });
    },

    get_locked: function(update_display) {
        update_display = typeof update_display !== 'undefined' ? update_display : true;
        var dfd = $.Deferred();
        var self = this;

        function parse_locked(content) {
            var status = content.split(" ")[1];
            // libuser uses "LK", shadow-utils use "L".
            return status && (status == "LK" || status == "L");
        }

        cockpit.spawn(["/usr/bin/passwd", "-S", self.account_id],
                      { "environ": [ "LC_ALL=C" ], "superuser": "require" })
            .done(function(content) {
                    self.locked = parse_locked(content);
                    if (update_display)
                        self.update();
                    dfd.resolve(self.locked);
                })
            .fail(function(error) {
                    dfd.reject(error);
                });

        return dfd.promise();
    },

    get_logged: function() {
        var self = this;
        if (!self.account_id) {
            self.logged = false;
            self.update();
            return;
        }

        function parse_logged(content) {
            self.logged = content.length > 0;
            if (! self.logged)
               self.get_last_login();
            else
               self.update();
        }

        cockpit.spawn(["/usr/bin/w", "-sh", self.account_id])
           .done(parse_logged)
           .fail(log_unexpected_error);
    },

    enter: function(account_id) {
        this.account_id = account_id;

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

        if (this.authorized_keys) {
           $(this.authorized_keys).off();
           this.authorized_keys.close();
           this.authorized_keys = null;
        }

        $('#account-failure').hide();
    },

    update: function() {

        if (this.account) {
            $('#account').show();
            $('#account-failure').hide();
            var name = $("#account-real-name");

            var title_name = this.account["gecos"];
            if (!title_name)
                title_name = this.account["name"];

            $('#account-logout').attr('disabled', !this.logged);

            $("#account-title").text(title_name);
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

            if (this.authorized_keys) {
                var keys = this.authorized_keys.keys;
                var state = this.authorized_keys.state;
                var keys_html = Mustache.render(this.keys_template, {
                    "keys": keys,
                    "empty": keys.length === 0 && state == "ready",
                    "denied": state == "access-denied",
                    "failed": state == "failed",
                });
                $('#account-authorized-keys-list').html(keys_html);
                $(".account-remove-key")
                    .on("click", $.proxy (this, "remove_key"));
                $('#account-authorized-keys').show();
            } else {
                $('#account-authorized-keys').hide();
            }

            if (this.account["uid"] !== 0) {
                var html = Mustache.render(this.role_template,
                                           { "roles": this.roles});
                $('#account-change-roles-roles').html(html);
                $('#account-roles').parents('tr').show();
                $("#account-change-roles-roles :input")
                    .on("change", $.proxy (this, "change_role"));
            } else {
                $('#account-roles').parents('tr').hide();
            }
            $('#account .breadcrumb .active').text(title_name);

            // check accounts-self-privileged whether account is the same as currently logged in user
            $(".accounts-self-privileged").
                toggleClass("accounts-current-account",
                            this.user.id == this.account["uid"]);

        } else {
            $('#account').hide();
            $('#account-failure').show();
            $('#account-real-name').val("");
            $('#account-user-name').text("");
            $('#account-last-login').text("");
            $('#account-locked').prop('checked', false);
            $('#account-roles').text("");
            $('#account .breadcrumb .active').text("?");
        }
        update_accounts_privileged();
    },

    change_role: function(ev) {
        var name = $(ev.target).data("name");
        var id = $(ev.target).data("gid");
        if (!name || !id || !this.account["name"])
            return;

        if ($(ev.target).prop('checked')) {
            cockpit.spawn(["/usr/sbin/usermod", this.account["name"],
                           "-G", id, "-a"], { "superuser": "require", err: "message" })
               .fail(show_unexpected_error);
        } else {
            cockpit.spawn(["/usr/bin/gpasswd", "-d", this.account["name"],
                           name], { "superuser": "require", err: "message" })
                   .fail(show_unexpected_error);
        }
    },

    real_name_edited: function() {
        $("#account-real-name").attr("data-dirty", "true");
    },

    check_role_for_self_mod: function () {
        return (this.account["name"] == this.user.name ||
                permission.allowed !== false);
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
                      { "superuser": "try", err: "message"})
           .done(function(data) {
               self.account["gecos"] = value;
               self.update();
               name.removeAttr("data-dirty");
           })
           .fail(show_unexpected_error);
    },

    change_locked: function(verify_status, desired_lock_state) {
        desired_lock_state = desired_lock_state !== null ?
            desired_lock_state : $('#account-locked').prop('checked');
        var self = this;
        cockpit.spawn(["/usr/sbin/usermod",
                       this.account["name"],
                       desired_lock_state ? "--lock" : "--unlock"], { "superuser": "require", err: "message"})
            .done(function() {
                self.get_locked(false)
                    .done(function(locked) {
                        /* if we care about what the lock state should be and it doesn't match, try to change again
                           this is a workaround for different ways of handling a locked account
                           https://github.com/cockpit-project/cockpit/issues/1216
                           https://bugzilla.redhat.com/show_bug.cgi?id=853153
                           This seems to be fixed in fedora 23 (usermod catches the different locking behavior)
                        */
                        if (verify_status && desired_lock_state !== locked) {
                            console.log("Account locked state doesn't match desired value, trying again.");
                            // only retry once to avoid uncontrolled recursion
                            self.change_locked(false, desired_lock_state);
                        } else {
                            self.update();
                        }
                    });
                })
           .fail(show_unexpected_error);
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
        cockpit.spawn(["/usr/bin/loginctl", "terminate-user", this.account["name"]],
                      { "superuser": "try", err: "message"})
           .done($.proxy (this, "get_logged"))
           .fail(show_unexpected_error);

    },
};

function PageAccount(user) {
    this._init(user);
}

var crop_handle_width = 20;

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

        cockpit.spawn(prog, { "superuser": "require", err: "message" })
           .done(function () {
              $('#account-confirm-delete-dialog').modal('hide');
               cockpit.location.go("/");
           })
           .fail(show_unexpected_error);
    }
};

function PageAccountConfirmDelete() {
    this._init();
}

PageAccountSetPassword.prototype = {
    _init: function(user) {
        this.id = "account-set-password-dialog";
        this.user = user;
    },

    show: function() {
        if (this.user.name !== PageAccountSetPassword.user_name) {
            $('#account-set-password-old').parents('tr').toggle(false);
            $('#account-set-password-pw1').focus();
        } else {
            $('#account-set-password-old').parents('tr').toggle(true);
            $('#account-set-password-old').focus();
        }
    },

    setup: function() {
        $('#account-set-password-apply').on('click', $.proxy(this, "apply"));
        $('#account-set-password-dialog .check-passwords').on('keydown change', $.proxy(this, "validate"));
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

        return cockpit.all(dfd, promise);
    },

    apply: function() {
        var self = this;

        var promise = this.validate()
            .done(function() {
                var user = PageAccountSetPassword.user_name;
                var password = $('#account-set-password-pw1').val();

                if (self.user.name === user)
                    promise = passwd_self($('#account-set-password-old').val(), password);
                else
                    promise = passwd_change(user, password);

                $("#account-set-password-dialog").dialog("promise", promise);
            })
            .fail(function(ex) {
                $("#account-set-password-meter-message").hide();
                $("#account-set-password-dialog").dialog("failure", ex);
            });
        $("#account-set-password-dialog").dialog("wait", promise);
    }
};

function PageAccountSetPassword(user) {
    this._init(user);
}

/* INITIALIZATION AND NAVIGATION
 *
 * The code above still uses the legacy 'Page' abstraction for both
 * pages and dialogs, and expects page.setup, page.enter, page.show,
 * and page.leave to be called at the right times.
 *
 * We cater to this with a little compatability shim consisting of
 * 'dialog_setup', 'page_show', and 'page_hide'.
 */

function show_error_dialog(title, message) {
    if (message) {
        $("#error-popup-title").text(title);
        $("#error-popup-message").text(message);
    } else {
        $("#error-popup-title").text(_("Error"));
        $("#error-popup-message").text(title);
    }

    $('.modal[role="dialog"]').modal('hide');
    $('#error-popup').modal('show');
}

function show_unexpected_error(error) {
    show_error_dialog(_("Unexpected error"), error.message || error);
}

function dialog_setup(d) {
    d.setup();
    $('#' + d.id).
        on('show.bs.modal', function () { d.enter(); }).
        on('shown.bs.modal', function () { d.show(); }).
        on('hidden.bs.modal', function () { d.leave(); });
}

function page_show(p, arg) {
    if (p._entered_)
        p.leave();
    p.enter(arg);
    p._entered_ = true;
    $('#' + p.id).show();
    p.show();
}

function page_hide(p) {
    $('#' + p.id).hide();
    if (p._entered_) {
        p.leave();
        p._entered_ = false;
    }
}

function init() {
    var overview_page;
    var account_page;

    cockpit.user().done(function (user) {
        function navigate() {
            var path = cockpit.location.path;

            if (path.length === 0) {
                page_hide(account_page);
                page_show(overview_page);
            } else if (path.length === 1) {
                page_hide(overview_page);
                page_show(account_page, path[0]);
            } else { /* redirect */
                console.warn("not a users location: " + path);
                cockpit.location = '';
            }

            $("body").show();
        }

        cockpit.translate();

        overview_page = new PageAccounts();
        overview_page.setup();

        account_page = new PageAccount(user);
        account_page.setup();

        dialog_setup(new PageAccountsCreate());
        dialog_setup(new PageAccountConfirmDelete());
        dialog_setup(new PageAccountSetPassword(user));

        $(cockpit).on("locationchanged", navigate);
        navigate();
    });
}

$(init);
