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

function cockpit_login_init ()
{
    // Note: we don't yet have a D-Bus connection so use the cockpitdyn.js mechanism
    // to obtain the hostname to display
    var display_hostname;
    display_hostname = cockpitdyn_pretty_hostname;
    if (!display_hostname)
        display_hostname = cockpitdyn_hostname;
    $("#login-display-name").text(display_hostname);
    if (cockpitdyn_avatar_data_url)
        $("#login-avatar").attr('src', cockpitdyn_avatar_data_url);

    function beforeshow ()
    {
        $("#login-password-input").val("");
        update ();
    }

    function show ()
    {
        $("#login-user-input").focus();
    }

    function update ()
    {
        var ok = ($('#login-user-input').val() &&
                  $('#login-password-input').val());
        $('#login-button').button(ok? 'enable' : 'disable');
    }

    function login ()
    {
        $("#login-error-message").text("");

        var req = new XMLHttpRequest();
        var loc = window.location.protocol + "//" + window.location.host + "/login";
        var timeout_id;
        req.open("POST", loc, true);
        req.onreadystatechange = function (event) {
	    if (req.readyState == 4) {
                clearTimeout(timeout_id);
                if (req.status == 200) {
                    cockpit_connection_config = JSON.parse(req.responseText);
                    cockpit_init_connect_local();
                } else {
                    $("#login-error-message").text(_("Sorry, that didn't work.") + " (" + req.status + ")");
                    $("#login-password-input").focus();
                }
	    }
            phantom_checkpoint();
        };
        req.send($("#login-user-input").val() + "\n" + $("#login-password-input").val());
        timeout_id = setTimeout(function () {
            req.abort();
        }, 10000);
    }

    $('#login').on('pagebeforeshow', beforeshow);
    $('#login').on('pageshow', show);
    $("#login-user-input").on("keyup change", update);
    $("#login-user-input").on("keydown", function (e) {
            if (e.which == 13)
                $("#login-password-input").focus();
    });
    $("#login-password-input").on("keyup change", update);
    $("#login-password-input").on("keydown", function (e) {
            if (e.which == 13)
                login ();
    });
    $('#login-button').on('click', login);

    cockpit_login_refresh ();
}

function cockpit_login_show ()
{
    if (!$.mobile.activePage || $.mobile.activePage.attr('id') != "login")
        $.mobile.changePage($('#login'), { changeHash: false });
}

function cockpit_login_refresh ()
{
    $("#login-user-input")[0].placeholder = C_("login-screen", "Enter user name");
    $("#login-password-input")[0].placeholder = C_("login-screen", "Enter password");
}

function cockpit_logout (reason)
{
    if (reason)
        $("#login-error-message").text(reason);

    var req = new XMLHttpRequest();
    var loc = window.location.protocol + "//" + window.location.host + "/logout";
    req.open("POST", loc, true);
    req.onreadystatechange = function (event) {
	if (req.readyState == 4) {
            cockpit_hide_disconnected();
            cockpit_disconnect();
            cockpit_login_show();
        }
    };
    req.send();
}

function cockpit_go_login_account ()
{
    cockpit_go ([ { page: "dashboard" },
               { page: "server" },
               { page: "accounts" },
               { page: "account", id: cockpit_connection_config.user }
             ]);
}

PageChpasswd.prototype = {
    _init: function() {
        this.id = "chpasswd";
    },

    getTitle: function() {
        return C_("page-title", "Change Login Password");
    },

    enter: function(first_visit) {
        var me = this;

        if (first_visit) {
            $("#chpasswd-old, #chpasswd-new-1, #chpasswd-new-2").on("keyup", $.proxy(this.update, this));

            $("#chpasswd-apply").on('click', function () {
                me.apply();
            });
            $("#chpasswd-cancel").on('click', function () {
                me.cancel();
            });
        }

        $("#chpasswd-user").val(cockpit_connection_config.user || "");
        $("#chpasswd-old").val("");
        $("#chpasswd-new-1").val("");
        $("#chpasswd-new-2").val("");
        $("#chpasswd-error").hide();
        this.update();
    },

    show: function() {
    },

    leave: function() {
    },

    update: function() {
        var enable =
            ( $("#chpasswd-user").val() &&
              $("#chpasswd-old").val() &&
              $("#chpasswd-new-1").val() &&
              $("#chpasswd-new-2").val() );

        if (enable)
            $("#chpasswd-apply").button('enable');
        else
            $("#chpasswd-apply").button('disable');
    },

    apply: function() {
        if ($("#chpasswd-new-1").val() != $("#chpasswd-new-2").val()) {
            $("#chpasswd-error").text("The two new passwords are not the same");
            $("#chpasswd-error").show();

        } else {
            $("#chpasswd-error").hide();

            var user = $("#chpasswd-user").val();
            var old_password = $("#chpasswd-old").val();
            var new_password = $("#chpasswd-new-1").val();

            var req = new XMLHttpRequest();
            var loc = window.location.protocol + "//" + window.location.host + "/chpasswd";
            req.open("POST", loc, true);
            req.onreadystatechange = function (event) {
	        if (req.readyState == 4) {
                    if (req.status == 200) {
                        $("#chpasswd").popup('close');
                    } else {
                        $("#chpasswd-error").text(req.statusText);
                        $("#chpasswd-error").show();
                    }
	        }
            };
            req.send(user + "\n" + old_password + "\n" + new_password);
        }
    },

    cancel: function() {
        $("#chpasswd").popup('close');
    }
};

function PageChpasswd() {
    this._init();
}

cockpit_pages.push(new PageChpasswd());
