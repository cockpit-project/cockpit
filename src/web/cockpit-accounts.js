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

function cockpit_check_role (role, client)
{
    var acc, i;

    acc = cockpit_find_account (cockpit.connection_config.user, client);
    if (acc) {
        for (i = 0; i < acc.Groups.length; i++) {
            if (acc.Groups[i] == 'wheel' || acc.Groups[i] == role)
                return true;
        }
        cockpit_show_error_dialog (_("Not authorized"), _("You are not authorized for this operation."));
        return false;
    }
    // When in doubt, just go ahead and let it fail later.
    return true;
}

function cockpit_find_account(user_name, client)
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

function cockpit_fill_canvas (canvas, overlay, data, width, callback)
{
    var img = new window.Image();
    img.onerror = function () {
        cockpit_show_error_dialog (_("Can't use this file"), _("Can't read it."));
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

function cockpit_canvas_data (canvas, x1, y1, x2, y2, width, height, format)
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

function cockpit_show_change_avatar_dialog (file_input, callback)
{
    var files, file, reader;
    files = $(file_input)[0].files;
    if (files.length != 1)
        return;
    file = files[0];
    if (!file.type.match("image.*")) {
        cockpit_show_error_dialog (_("Can't upload this file"), _("It's not an image."));
        return;
    }
    reader = new window.FileReader();
    reader.onerror = function () {
        cockpit_show_error_dialog (_("Can't upload this file"), _("Can't read it."));
    };
    reader.onload = function () {
        var canvas = $('#account-change-avatar-canvas')[0];
        var overlay = $('#account-change-avatar-overlay')[0];
        cockpit_fill_canvas (canvas, overlay, reader.result, 256,
                          function () {
                              PageAccountChangeAvatar.callback = callback;
                              $('#account-change-avatar-dialog').modal('show');
                          });
    };
    reader.readAsDataURL(file);
}

// XXX - make private

function cockpit_on_account_changes(client, id, func) {
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

function cockpit_off_account_changes(client, id) {
    $(client).off("." + id);
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
        this.address = cockpit_get_page_param('machine', 'server') || "localhost";
        /* TODO: This code needs to be migrated away from dbus-json1 */
        this.client = cockpit.dbus(this.address, { "protocol": "dbus-json1" });

        cockpit_on_account_changes(this.client, "accounts", $.proxy(this, "update"));
        this.update();
    },

    leave: function() {
        cockpit_off_account_changes(this.client, "accounts");
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

        function set_avatar(acc, img) {
            acc.call('GetIconDataURL',
                     function (error, result) {
                         if (result)
                             img.attr('src', result);
                     });
        }

        list.empty();
        for (i = 0; i < this.accounts.length; i++) {
            acc = this.accounts[i];
            var img =
                $('<img/>', { 'class': "cockpit-account-pic",
                              'width': "48",
                              'height': "48",
                              'src': "/images/avatar-default-48.png" });
            var div =
                $('<div/>', { 'class': "cockpit-account" }).append(
                    img,
                    $('<div/>', { 'class': "cockpit-account-real-name" }).text(acc.RealName),
                    $('<div/>', { 'class': "cockpit-account-user-name" }).text(acc.UserName));
            div.on('click', $.proxy(this, "go", acc.UserName));
            set_avatar (acc, img);
            list.append(div);
        }
    },

    create: function () {
        if (cockpit_check_role ('cockpit-user-admin', this.client)) {
            PageAccountsCreate.client = this.client;
            $('#accounts-create-dialog').modal('show');
        }
    },

    go: function (user) {
        cockpit_go_down ({ page: 'account', id: user });
    }
};

function PageAccounts() {
    this._init();
}

cockpit_pages.push(new PageAccounts());

PageAccountsCreate.prototype = {
    _init: function() {
        this.id = "accounts-create-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Create Account");
    },

    show: function() {
    },

    setup: function() {
        $('#accounts-create-cancel').on('click', $.proxy(this, "cancel"));
        $('#accounts-create-create').on('click', $.proxy(this, "create"));
        $('#accounts-create-dialog input').on('keyup change', $.proxy(this, "update"));
    },

    enter: function() {
        $('#accounts-create-user-name').val("");
        $('#accounts-create-real-name').val("");
        $('#accounts-create-pw1').val("");
        $('#accounts-create-pw2').val("");
        $('#accounts-create-locked').prop('checked', false);
        this.update ();
    },

    leave: function() {
    },

    update: function() {
        function check_params ()
        {
            return ($('#accounts-create-user-name').val() !== "" &&
                    $('#accounts-create-real-name').val() !== "" &&
                    $('#accounts-create-pw1').val() !== "" &&
                    $('#accounts-create-pw2').val() == $('#accounts-create-pw1').val());
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
                             cockpit_show_unexpected_error (error);
                     });
    }
};

function PageAccountsCreate() {
    this._init();
}

cockpit_pages.push(new PageAccountsCreate());

PageAccount.prototype = {
    _init: function() {
        this.id = "account";
    },

    getTitle: function() {
        return C_("page-title", this.account? this.account.RealName : "??");
    },

    show: function() {
    },

    setup: function() {
        $('#account-pic').on('click', $.proxy (this, "trigger_change_avatar"));
        $('#account-avatar-uploader').on('change', $.proxy (this, "change_avatar"));
        $('#account-real-name').on('change', $.proxy (this, "change_real_name"));
        $('#account-real-name').on('keydown', $.proxy (this, "real_name_edited"));
        $('#account-set-password').on('click', $.proxy (this, "set_password"));
        $('#account-delete').on('click', $.proxy (this, "delete_account"));
        $('#account-logout').on('click', $.proxy (this, "logout_account"));
        $('#account-change-roles').on('click', $.proxy (this, "change_roles"));
        $('#account-locked').on('change', $.proxy (this, "change_locked"));
    },

    enter: function() {
        this.address = cockpit_get_page_param('machine', 'server') || "localhost";
        /* TODO: This code needs to be migrated away from dbus-json1 */
        this.client = cockpit.dbus(this.address, { protocol: "dbus-json1" });

        cockpit_on_account_changes(this.client, "account", $.proxy(this, "update"));
        this.real_name_dirty = false;
        this.update ();
    },

    leave: function() {
        cockpit_off_account_changes(this.client, "account");
        this.client.release();
        this.client = null;
    },

    update: function() {
        this.account = cockpit_find_account(cockpit_get_page_param('id'), this.client);

        if (this.account) {
            var manager = this.client.get ("/com/redhat/Cockpit/Accounts",
                                           "com.redhat.Cockpit.Accounts");
            this.sys_roles = manager.Roles || [ ];

            this.account.call('GetIconDataURL',
                              function (error, result) {
                                  if (result)
                                      $('#account-pic').attr('src', result);
                              });
            $('#account-pic').attr('src', "/images/avatar-default-128.png");
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
            var groups = cockpit_make_set (this.account.Groups);
            var roles = "";
            for (var i = 0; i < this.sys_roles.length; i++) {
                if (this.sys_roles[i][0] in groups) {
                    if (roles !== "")
                        roles += "<br/>";
                    roles += cockpit_esc(this.sys_roles[i][1]);
                }
            }
            $('#account-roles').html(roles);
        } else {
            $('#account-pic').attr('src', null);
            $('#account-real-name').val("");
            $('#account-user-name').text("");
            $('#account-last-login').text("");
            $('#account-locked').prop('checked', false);
            $('#account-roles').text("");
        }
        cockpit_content_update_loc_trail ();
    },

    trigger_change_avatar: function() {
        if (!this.check_role_for_self_mod ())
            return;

        if (window.File && window.FileReader)
            $('#account-avatar-uploader').trigger('click');
    },

    change_avatar: function() {
        var me = this;
        cockpit_show_change_avatar_dialog ('#account-avatar-uploader',
                                        function (data) {
                                            me.account.call('SetIconDataURL', data,
                                                            function (error) {
                                                                if (error)
                                                                    cockpit_show_unexpected_error (error);
                                                            });
                                        });
    },

    real_name_edited: function() {
        this.real_name_dirty = true;
    },

    check_role_for_self_mod: function () {
        return (this.account.UserName == cockpit.connection_config.user ||
                cockpit_check_role ('cockpit-user-admin', this.client));
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
                                   cockpit_show_unexpected_error (error);
                                   me.update ();
                               }
                           });
    },

    change_locked: function() {
        var me = this;

        if (!cockpit_check_role ('cockpit-user-admin', this.client)) {
            me.update ();
            return;
        }

        this.account.call ('SetLocked',
                           $('#account-locked').prop('checked'),
                           function (error) {
                               if (error) {
                                   cockpit_show_unexpected_error (error);
                                   me.update ();
                               }
                           });
    },

    set_password: function() {
        if (!this.check_role_for_self_mod ())
            return;

        PageAccountSetPassword.account = this.account;
        $('#account-set-password-dialog').modal('show');
    },

    delete_account: function() {
        if (!cockpit_check_role ('cockpit-user-admin', this.client))
            return;

        PageAccountConfirmDelete.account = this.account;
        $('#account-confirm-delete-dialog').modal('show');
    },

    logout_account: function() {
        var me = this;

        if (!cockpit_check_role ('cockpit-user-admin', this.client))
            return;

        this.account.call('KillSessions',
                          function (error) {
                              if (error) {
                                  cockpit_show_unexpected_error (error);
                                  me.update ();
                              }
                          });
    },

    change_roles: function() {
        if (!cockpit_check_role ('cockpit-user-admin', this.client))
            return;

        PageAccountChangeRoles.account = this.account;
        $('#account-change-roles-dialog').modal('show');
    }

};

function PageAccount() {
    this._init();
}

cockpit_pages.push(new PageAccount());

var cockpit_crop_handle_width = 20;

PageAccountChangeAvatar.prototype = {
    _init: function() {
        this.id = "account-change-avatar-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Change Picture");
    },

    show: function() {
    },

    setup: function() {
        var self = this;

        $('#account-change-avatar-cancel').on('click', $.proxy(this, "cancel"));
        $('#account-change-avatar-apply').on('click', $.proxy(this, "apply"));

        var $canvas = $('#account-change-avatar-overlay');
        this.canvas = $canvas[0];
        this.canvas2d = this.canvas.getContext("2d");

        $canvas.on('mousedown', function (ev) {
            var offset = $canvas.offset();
            var xoff = ev.pageX - offset.left - self.crop_x;
            var yoff = ev.pageY - offset.top - self.crop_y;

            var orig_x = self.crop_x;
            var orig_y = self.crop_y;
            var orig_s = self.crop_s;

            var proj_sign, dx_sign, dy_sign, ds_sign;

            var h_w = cockpit_crop_handle_width;

            if (xoff > 0 && yoff > 0 && xoff < self.crop_s && yoff < self.crop_s) {
                if (xoff < h_w && yoff < h_w) {
                    // top left
                    proj_sign = 1;
                    dx_sign = 1;
                    dy_sign = 1;
                    ds_sign = -1;
                } else if (xoff > self.crop_s - h_w && yoff < h_w) {
                    // top right
                    proj_sign = -1;
                    dx_sign = 0;
                    dy_sign = -1;
                    ds_sign = 1;
                } else if (xoff < h_w && yoff > self.crop_s - h_w) {
                    // bottom left
                    proj_sign = -1;
                    dx_sign = 1;
                    dy_sign = 0;
                    ds_sign = -1;
                } else if (xoff > self.crop_s - h_w && yoff > self.crop_s - h_w) {
                    // bottom right
                    proj_sign = 1;
                    dx_sign = 0;
                    dy_sign = 0;
                    ds_sign = 1;
                } else {
                    // center
                    proj_sign = 0;
                }

                $('body').on('mousemove', function (ev) {
                    var x = ev.pageX - offset.left - xoff;
                    var y = ev.pageY - offset.top - yoff;
                    if (proj_sign === 0)
                        self.set_crop (x, y, orig_s, true);
                    else {
                        var d = Math.floor((x - orig_x + proj_sign * (y - orig_y)) / 2);
                        self.set_crop (orig_x + dx_sign*d, orig_y + dy_sign*d, orig_s + ds_sign*d, false);
                    }
                });
                $('body').on('mouseup', function (ev) {
                    $('body').off('mouseup');
                    $('body').off('mousemove');
                });
            }
        });
    },

    enter: function() {
        var me = this;
        var size = Math.min (this.canvas.width, this.canvas.height);
        this.set_crop ((this.canvas.width - size) / 2, (this.canvas.height - size) / 2, size, true);
    },

    leave: function() {
    },

    set_crop: function (x, y, s, fix) {
        function clamp (low, val, high)
        {
            if (val < low)
                return low;
            if (val > high)
                return high;
            return val;
        }

        x = Math.floor(x);
        y = Math.floor(y);
        s = Math.floor(s);

        var min_s = 2*cockpit_crop_handle_width;

        if (fix) {
            // move it until it fits
            s = clamp (min_s, s, Math.min (this.canvas.width, this.canvas.height));
            x = clamp (0, x, this.canvas.width - s);
            y = clamp (0, y, this.canvas.height - s);
        } else if (x < 0 || y < 0 || x + s > this.canvas.width || y + s > this.canvas.height || s < min_s)
            return;

        this.crop_x = x;
        this.crop_y = y;
        this.crop_s = s;

        this.draw_crop (x, y, x+s, y+s);
    },

    draw_crop: function(x1,y1,x2,y2) {
        var ctxt;

        function draw_box (x1, y1, x2, y2)
        {
            ctxt.strokeStyle = 'black';
            ctxt.strokeRect(x1+0.5, y1+0.5, x2-x1-1, y2-y1-1);
            ctxt.strokeStyle = 'white';
            ctxt.strokeRect(x1+1.5, y1+1.5, x2-x1-3, y2-y1-3);
        }

        ctxt = this.canvas2d;
        ctxt.clearRect(0, 0, this.canvas.width, this.canvas.height);
        ctxt.fillStyle = 'rgba(0,0,0,0.8)';
        ctxt.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctxt.clearRect(x1, y1, x2 - x1, y2 - y1);

        var h_w = cockpit_crop_handle_width;
        draw_box (x1, y1, x1+h_w, y1+h_w);
        draw_box (x2-h_w, y1, x2, y1+h_w);
        draw_box (x1, y2-h_w, x1+h_w, y2);
        draw_box (x2-h_w, y2-h_w, x2, y2);
        draw_box (x1, y1, x2, y2);
    },

    cancel: function() {
        $('#account-change-avatar-dialog').modal('hide');
    },

    apply: function() {
        var data = cockpit_canvas_data ($('#account-change-avatar-canvas')[0],
                                     this.crop_x, this.crop_y,
                                     this.crop_x+this.crop_s, this.crop_y+this.crop_s,
                                     128, 128, "image/png");
        $('#account-change-avatar-dialog').modal('hide');
        PageAccountChangeAvatar.callback (data);
    }
};

function PageAccountChangeAvatar() {
    this._init();
}

cockpit_pages.push(new PageAccountChangeAvatar());

PageAccountChangeRoles.prototype = {
    _init: function() {
        this.id = "account-change-roles-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Change Roles");
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

        groups = cockpit_make_set (PageAccountChangeRoles.account.Groups);
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
                                                     cockpit_show_unexpected_error (error);
                                             });
        $('#account-change-roles-dialog').modal('hide');
    }
};

function PageAccountChangeRoles() {
    this._init();
}

cockpit_pages.push(new PageAccountChangeRoles());

PageAccountConfirmDelete.prototype = {
    _init: function() {
        this.id = "account-confirm-delete-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Delete Account?");
    },

    show: function() {
    },

    setup: function() {
        $('#account-confirm-delete-apply').on('click', $.proxy(this, "apply"));
    },

    enter: function() {
        $('#account-confirm-delete-files').prop('checked', false);
    },

    leave: function() {
    },

    apply: function() {
        PageAccountConfirmDelete.account.call ('Delete',
                                               $('#account-confirm-delete-files').prop('checked'),
                                               function (error) {
                                                   if (error)
                                                       cockpit_show_unexpected_error (error);
                                               });
        $('#account-confirm-delete-dialog').modal('hide');
        cockpit_go_up ();
    }
};

function PageAccountConfirmDelete() {
    this._init();
}

cockpit_pages.push(new PageAccountConfirmDelete());

PageAccountSetPassword.prototype = {
    _init: function() {
        this.id = "account-set-password-dialog";
    },

    getTitle: function() {
        return C_("page-title", "Set Password");
    },

    show: function() {
    },

    setup: function() {
        $('#account-set-password-apply').on('click', $.proxy(this, "apply"));
        $('#account-set-password-dialog input').on('keyup change', $.proxy(this, "update"));
    },

    enter: function() {
        this.update ();
    },

    leave: function() {
    },

    update: function() {
        function check_params ()
        {
            return ($('#account-set-password-pw1').val() !== "" &&
                    $('#account-set-password-pw2').val() == $('#account-set-password-pw1').val());
        }

        $('#account-set-password-apply').prop('disabled', !check_params());
    },

    apply: function() {
        $('#account-set-password-dialog').modal('hide');
        PageAccountSetPassword.account.call ('SetPassword', $('#account-set-password-pw1').val(),
                                             function (error) {
                                                 if (error)
                                                     cockpit_show_unexpected_error (error);
                                             });
    }
};

function PageAccountSetPassword() {
    this._init();
}

cockpit_pages.push(new PageAccountSetPassword());
