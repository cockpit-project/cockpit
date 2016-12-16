(function() {
    "use strict";

    var jQuery = require("jquery");
    var cockpit = require("cockpit");
    require("patterns");

    var _ = cockpit.gettext;

    var MANAGER = "/org/freedesktop/realmd";

    var SERVICE = "org.freedesktop.realmd.Service";
    var PROVIDER = "org.freedesktop.realmd.Provider";
    var KERBEROS = "org.freedesktop.realmd.KerberosMembership";
    var REALM = "org.freedesktop.realmd.Realm";

    function instance(realmd, mode, realm, button) {
        var dialog = jQuery.parseHTML(require("raw!./operation.html"))[0];

        /* Scope the jQuery selector to our dialog */
        var $ = function(selector, context) {
            return new jQuery.fn.init(selector, context || dialog);
        };
        $.fn = $.prototype = jQuery.fn;
        jQuery.extend($, jQuery);

        var operation = null;
        var checking = null;
        var checked = null;
        var kerberos = null;

        /* If in an operation first time cancel is clicked, cancel operation */
        $(".realms-op-cancel").on("click", function() {
            if (!cancel())
                $(dialog).modal('hide');
        });

        /* When we're hidden some other way, cancel any operations */
        $(dialog).on("hide.bs.modal", function() {
            cancel();
        });

        $(".realms-op-apply").on("click", perform);
        $(".realms-op-field")
            .on("keydown", function(ev) {
                if (ev.which == 13)
                    perform();
            });

        $(dialog).on("click", ".realms-op-more-diagnostics", function() {
            $(".realms-op-error").hide();
            $(".realms-op-diagnostics").show();
        });

        var timeout = null;
        $(".realms-op-address").on("keyup change", function() {
            if ($(".realms-op-address").val() != checked) {
                $(".realms-op-address-error").hide();
                window.clearTimeout(timeout);
                timeout = window.setTimeout(check, 1000);
            }
        });

        var auth = null;
        function auth_changed(item) {
            auth = item.attr('data-value');
            $(".realms-op-auth span").text(item.text());
            var parts = (auth || "").split("/");
            var type = parts[0];
            var owner = parts[1];

            $(".realms-op-admin-row").hide();
            $(".realms-op-admin-password-row").hide();
            $(".realms-op-user-row").hide();
            $(".realms-op-user-password-row").hide();
            $(".realms-op-otp-row").hide();

            if (type == "password" && owner == "administrator") {
                $(".realms-op-admin-row").show();
                $(".realms-op-admin-password-row").show();
            } else if (type == "password" && owner == "user") {
                $(".realms-op-user-row").show();
                $(".realms-op-user-password-row").show();
            } else if (type == "secret") {
                $(".realms-op-otp-row").show();
            }
        }

        $(".realms-op-auth").on('click', 'li', function() {
            auth_changed($(this));
        });

        var title, label;
        if (mode == 'join') {
            title = _("page-title", _("Join a Domain"));
            label = _("Join");
            $(".realms-op-join-only-row").show();
            check("");
        } else {
            title = _("page-title", _("Leave Domain"));
            label = _("Leave");
            $(".realms-op-join-only-row").hide();
        }

        $(".realms-op-title").text(title);
        $(".realms-op-apply").text(label);
        $(".realms-op-field").val("");

        function check(name) {
            var dfd = $.Deferred();

            if (name === undefined)
                name = $(".realms-op-address").val();

            if (name)
                $(".realms-op-address-spinner").show();

            dfd.always(function() {
                if (name)
                    $(".realms-op-address-spinner").hide();
            });

            realmd.call(MANAGER, PROVIDER, "Discover", [ name, { } ])
                .always(function() {

                    if ($(".realms-op-address").val() != name) {
                        dfd.reject();
                        check();
                        return;
                    }

                    var error, result = [], path;
                    if (this.state() == "rejected") {
                        error = arguments[0];
                        $(".realms-op-error")
                            .empty()
                            .text(error.message);
                        dfd.reject(error);
                    }

                    var message;
                    if (arguments[0][1])
                        result = arguments[0][1];
                    path = result[0]; /* the first realm */

                    if (!path) {
                        if (name) {
                            message = cockpit.format(_("Domain $0 could not be contacted"), name);
                            $(".realms-op-address-error").show().attr('title', message);
                        }

                        realm = null;
                        kerberos = null;

                        dfd.reject(new Error(message));
                    } else {
                        kerberos = realmd.proxy(KERBEROS, path);
                        $(kerberos).on("changed", update);

                        realm = realmd.proxy(REALM, path);
                        $(realm).on("changed", update);
                        realm.wait(function() {
                            dfd.resolve(realm);
                        });
                    }

                    update();
                });

            checking = dfd.promise();
            checked = name;
            return checking;
        }

        function ensure() {
            if (mode != 'join') {
                var dfd = $.Deferred();
                dfd.resolve(realm);
                return dfd.promise();
            }

            if ($(".realms-op-address").val() === checked) {
                if (checking)
                    return checking;
            }

            return check();
        }

        /*
         * The realmd dbus interface has an a(ss) Details
         * property. Lookup the right value for the given
         * field key.
         */
        function find_detail(realm, field) {
            var result = null;
            if (realm && realm.Details) {
                realm.Details.forEach(function(value) {
                    if (value[0] === field)
                        result = value[1];
                });
            }
            return result;
        }


        function update() {
            var message;

            $(".realms-op-spinner").toggle(!!operation);
            $(".realms-op-wait-message").toggle(!!operation);
            $(".realms-op-field").prop('disabled', !!operation);
            $(".realms-op-apply").prop('disabled', !!operation);
            $(".realm-active-directory-only").hide();

            var server = find_detail(realm, "server-software");

            if (realm && kerberos && !kerberos.valid) {
                message = cockpit.format(_("Domain $0 is not supported"), realm.Name);
                $(".realms-op-address-spinner").hide();
                $(".realms-op-address-error").show().attr('title', message);
            } else {
                $(".realms-op-address-error").hide();
            }

            if (operation)
                button.attr('disabled', 'disabled');
            else
                button.removeAttr('disabled');

            if (mode != 'join')
                return;

            $(".realm-active-directory-only").toggle(!server || server == "active-directory");

            if (realm && realm.Name && !$(".realms-op-address")[0].placeholder) {
                $(".realms-op-address")[0].placeholder = cockpit.format(_("e.g. \"$0\""), realm.Name);
            }

            var placeholder = "";
            if (kerberos) {
                if (kerberos.SuggestedAdministrator)
                    placeholder = cockpit.format(_("e.g. \"$0\""), kerberos.SuggestedAdministrator);
            }
            $(".realms-op-admin")[0].placeholder = placeholder;

            var list = $(".realms-op-auth .dropdown-menu");
            var supported = (kerberos && kerberos.SupportedJoinCredentials) || [ ];
            supported.push(["password", "administrator"]);

            var first = true;
            var count = 0;

            function add_choice(owner, type, text) {
                var item, choice, i, length = supported.length;
                for (i = 0; i < length; i++) {
                    if ((!owner || owner == supported[i][1]) && type == supported[i][0]) {
                        choice = type + "/" + supported[i][1];
                        item = $("<li>").attr("data-value", choice).append($("<a>").text(text));
                        list.append(item);
                        if (first) {
                            auth_changed(item);
                            first = false;
                        }
                        count += 1;
                        break;
                    }
                }
            }

            list.empty();
            add_choice('administrator', "password", _("Administrator Password"));
            add_choice('user', "password", _("User Password"));
            add_choice(null, "secret", _("One Time Password"));
            add_choice(null, "automatic", _("Automatic"));
            $(".realms-authentification-row").toggle(count > 1);
            list.prop('disabled', !!operation).val(!first);
        }

        function credentials() {
            var creds, secret;

            var parts = (auth || "").split("/");
            var type = parts[0];
            var owner = parts[1];

            if (owner == "user" && type == "password") {
                creds = [
                    type, owner,
                    cockpit.variant('(ss)', [ $(".realms-op-user").val(), $(".realms-op-user-password").val() ])
                ];
            } else if (owner == "administrator" && type == "password") {
                creds = [
                    type, owner,
                    cockpit.variant('(ss)', [ $(".realms-op-admin").val(), $(".realms-op-admin-password").val() ])
                ];
            } else if (type == "secret") {
                secret = $(".realms-op-ot-password").val();
                creds = [
                    type, owner,
                    cockpit.variant('ay', cockpit.utf8_encoder().encode(secret))
                ];
            } else {
                creds = [
                    "automatic", owner,
                    cockpit.variant('s', "")
                ];
            }

            return creds;
        }

        var unique = 1;

        function perform() {
            var id = "cockpit-" + unique;
            unique += 1;
            busy(id);

            ensure()
                .fail(function() {
                    busy(null);
                })
                .done(function(realm) {
                    var options = { operation: cockpit.variant('s', id) };

                    $(".realms-op-error").empty().show();
                    $(".realms-op-diagnostics").empty().hide();

                    var diagnostics = "";
                    var sub = realmd.subscribe({ member: "Diagnostics" }, function(path, iface, signal, args) {
                        if (args[1] === id) {
                            diagnostics += args[0];
                        }
                    });

                    var call, computer_ou;
                    if (mode == 'join') {
                        computer_ou = $(".realms-join-computer-ou").val();
                        if (computer_ou)
                            options["computer-ou"] = cockpit.variant('s', computer_ou);
                        if (kerberos.valid) {
                            call = kerberos.call("Join", [ credentials(), options ]);
                        } else {
                            busy(null);
                            $(".realms-op-error").empty().text(_("Joining this domain is not supported")).show();
                        }
                    } else if (mode == 'leave') {
                        call = realm.Deconfigure(options);
                    }

                    if (!call) {
                        sub.remove();
                        return;
                    }

                    call
                        .fail(function(ex) {
                            busy(null);
                            if (ex.name == "org.freedesktop.realmd.Error.Cancelled") {
                                $(dialog).modal("hide");
                            } else {
                                console.log("Failed to join domain: " + realm.Name + ": " + ex);
                                $(".realms-op-error").empty().text(ex + " ").show();
                                if (diagnostics) {
                                    $(".realms-op-error")
                                        .append('<a class="realms-op-more-diagnostics">' + _("More") + '</a>');
                                    $(".realms-op-diagnostics").text(diagnostics);
                                }
                            }
                        })
                        .done(function() {
                            busy(null);
                            $(dialog).modal("hide");
                        })
                        .always(function() {
                            sub.remove();
                        });
                });
        }

        function busy(id) {
            operation = id;
            update();
        }

        function cancel() {
            if (operation) {
                realmd.call(MANAGER, SERVICE, "Cancel", [ operation ]);
                busy(null);
                return true;
            }
            return false;
        }

        update();
        return dialog;
    }

    function setup() {
        var $ = jQuery;

        var element = $("<a>");

        var realmd = cockpit.dbus("org.freedesktop.realmd");
        realmd.watch(MANAGER);

        var realms = realmd.proxies("org.freedesktop.realmd.Realm");

        /* The realm we are joined to */
        var joined = null;

        var permission = null;

        $(realmd).on("close", function(ev, options) {
            var message;
            if (options.problem == "not-found")
                message = _("Cannot join a domain because realmd is not available on this system");
            else
                message = cockpit.message(options);
            element
                .addClass("disabled")
                .attr('title', message)
                .tooltip({ container: 'body'})
                .tooltip('fixTitle');
            realmd = null;
        });

        realms.wait(function() {
            if (!realmd)
                return;

            permission = cockpit.permission({ admin: true });

            function update_realm_privileged() {
                $(element).update_privileged(permission,
                        cockpit.format(_("The user <b>$0</b> is not permitted to modify realms"),
                            permission.user ? permission.user.name : ''));
            }

            $(permission).on("changed", update_realm_privileged);
        });

        function update_realms() {
            var text, path, realm;
            joined = [];
            for (path in realms) {
                realm = realms[path];
                if (realm.Configured)
                    joined.push(realm);
            }

            if (!joined || !joined.length)
                text = _("Join Domain");
            else
                text = joined.map(function(x) { return x.Name; }).join(", ");
            element.text(text);
        }

        $(realms).on("changed", update_realms);
        update_realms();

        var dialog = null;
        element.on("click", function() {
            if (dialog)
                $(dialog).remove();

            if (joined && joined.length)
                dialog = instance(realmd, 'leave', joined[0], element);
            else
                dialog = instance(realmd, 'join', null, element);

            $(dialog)
                .attr("id", "realms-op")
                .appendTo("body")
                .modal('show');
            cockpit.translate();
        });

        element.close = function close() {
            if (dialog)
                dialog.cancel();
            element.remove();
            if (realmd)
                realmd.close();
            if (permission)
                permission.close();
        };

        return element;
    }

    /* Hook this in when loaded */
    jQuery(function() {
        var placeholder = jQuery("#system-info-domain");
        if (placeholder.length) {
            placeholder.find(".button-location").append(setup());
            placeholder.removeAttr('hidden');
        }
    });

    return module;
}());
