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

var cockpit = cockpit || { };

(function(cockpit, $) {

$(function() {
    $(".cockpit-deauthorize-item a").on("click", function(ev) {
        var req = new XMLHttpRequest();
        var loc = window.location.protocol + "//" + window.location.host + "/deauthorize";
        req.open("POST", loc, true);
        req.onreadystatechange = function (event) {
            if (req.readyState == 4) {
                $(".cockpit-deauthorize-item").addClass("disabled");
                $(".cockpit-deauthorize-item a").off("click");

                /* TODO: We need a better indicator for deauthorized state */
                $(".cockpit-deauthorize-status").text("deauthorized");
            }
        };
        req.send();
        ev.preventDefault();
    });
});

}(cockpit, jQuery));

function cockpit_login_update ()
{
    $("#login-error-message").text("");
}

function cockpit_login_init ()
{
    function login ()
    {
        $('#login-error-message').text("");

        var req = new XMLHttpRequest();
        var loc = window.location.protocol + "//" + window.location.host + "/login";
        var timeout_id;
        req.open("POST", loc, true);
        req.onreadystatechange = function (event) {
	    if (req.readyState == 4) {
                clearTimeout(timeout_id);
                if (req.status == 200) {
                    cockpit.connection_config = JSON.parse(req.responseText);
                    cockpit_content_show();
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

    $("#login-user-input").on("keyup change", cockpit_login_update);
    $("#login-user-input").on("keydown", function (e) {
            if (e.which == 13)
                $("#login-password-input").focus();
    });
    $("#login-password-input").on("keyup change", cockpit_login_update);
    $("#login-password-input").on("keydown", function (e) {
            if (e.which == 13)
                login ();
    });
    $('#login-button').on('click', login);

    cockpit_login_refresh ();
}

function cockpit_login_show ()
{
    $('body').css('padding-top', 0);

    $("#login-password-input").val("");
    cockpit_login_update ();

    cockpit_content_leave ();
    $('.page').hide();
    $('#login').show();

    $("#login-user-input").focus();

    phantom_checkpoint();
}

function cockpit_login_refresh ()
{
}

function cockpit_login_try() {
    var req = new XMLHttpRequest();
    var loc = window.location.protocol + "//" + window.location.host + "/login";
    req.open("GET", loc, true);
    req.onreadystatechange = function (event) {
	if (req.readyState == 4) {
            if (req.status == 200) {
                cockpit.connection_config = JSON.parse(req.responseText);
                cockpit_content_show();
            } else {
                cockpit_login_show();
	    }
        }
    };
    req.send();
}

function cockpit_logout (reason)
{
    if (reason) {
        $("#login-error-message").text(reason);
    }

    var req = new XMLHttpRequest();
    var loc = window.location.protocol + "//" + window.location.host + "/logout";
    req.open("POST", loc, true);
    req.onreadystatechange = function (event) {
	if (req.readyState == 4) {
            cockpit._logged_out();
            cockpit_login_show();
        }
    };
    req.send();
}

function cockpit_go_login_account ()
{
    cockpit_go_server ("localhost",
                       [ { page: "accounts" },
                         { page: "account", id: cockpit.connection_config.user }
                       ]);
}
