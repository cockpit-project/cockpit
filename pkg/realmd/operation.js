import jQuery from "jquery";
import cockpit from "cockpit";
import * as packagekit from "packagekit.js";
import { install_dialog } from "cockpit-components-install-dialog.jsx";
import "patterns";

import operation_html from "raw-loader!./operation.html";

const _ = cockpit.gettext;

var MANAGER = "/org/freedesktop/realmd";

var SERVICE = "org.freedesktop.realmd.Service";
var PROVIDER = "org.freedesktop.realmd.Provider";
var KERBEROS = "org.freedesktop.realmd.Kerberos";
var KERBEROS_MEMBERSHIP = "org.freedesktop.realmd.KerberosMembership";
var REALM = "org.freedesktop.realmd.Realm";

function instance(realmd, mode, realm, button) {
    var dialog = jQuery.parseHTML(operation_html)[0];

    /* Scope the jQuery selector to our dialog */
    var $ = function(selector, context) {
        return new jQuery.fn.init(selector, context || dialog); // eslint-disable-line new-cap
    };
    $.fn = $.prototype = jQuery.fn;
    jQuery.extend($, jQuery);

    var error_message = null;
    var operation = null;
    var checking = null;
    var checked = null;
    var kerberos_membership = null;
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
    $(".realms-op-leave").on("click", perform);
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
    $("#realms-op-address").on("keyup change", function() {
        if ($("#realms-op-address").val() != checked) {
            $(".realms-op-address-error").empty();
            $(".realms-op-address-spinner").hide();
            $("#realms-op-address").parent()
                    .removeClass("has-success has-error");
            window.clearTimeout(timeout);
            timeout = window.setTimeout(check, 1000);
        }
    });

    function hide_control(path) {
        var e = $(path);
        e.hide();
        e.prev().hide(); // hide the associated label
    }

    function show_control(path) {
        var e = $(path);
        e.show();
        e.prev().show(); // hide the associated label
    }

    var auth = null;
    function auth_changed(item) {
        auth = item.attr('data-value');
        $("#realms-op-auth span").text(item.text());
        var parts = (auth || "").split("/");
        var type = parts[0];
        var owner = parts[1];

        hide_control("#realms-op-admin");
        hide_control("#realms-op-admin-password");
        hide_control("#realms-op-user");
        hide_control("#realms-op-user-password");
        hide_control("#realms-op-ot-password");

        if (type == "password" && owner == "administrator") {
            show_control("#realms-op-admin");
            show_control("#realms-op-admin-password");
        } else if (type == "password" && owner == "user") {
            show_control("#realms-op-user");
            show_control("#realms-op-user-password");
        } else if (type == "secret") {
            show_control("#realms-op-ot-password");
        }
    }

    $("#realms-op-auth").on('click', 'li', function() {
        auth_changed($(this));
    });

    var title, label;
    if (mode == 'join') {
        title = _("page-title", _("Join a Domain"));
        label = _("Join");
        $(".realms-op-join-only").show();
        $(".realms-op-leave-only-row").hide();
        $(".realms-op-apply").text(label);
        check("");
    } else {
        title = _("page-title", _("Domain"));
        $("#realms-op-info-domain").text(realm && realm.Name);
        if (realm && realm.LoginFormats && realm && realm.LoginFormats.length > 0)
            $("#realms-op-info-login-format").text(realm.LoginFormats[0].replace("%U", "username"));
        $("#realms-op-info-server-sw").text(find_detail(realm, "server-software"));
        $("#realms-op-info-client-sw").text(find_detail(realm, "client-software"));

        $("#realms-op-leave-toggle").on("click", ev => {
            if ($("#realms-op-alert").is(":visible")) {
                $("#realms-op-alert").hide();
                $("#realms-op-leave-caret")
                        .removeClass("fa-caret-down")
                        .addClass("fa-caret-right");
            } else {
                $("#realms-op-alert").show();
                $("#realms-op-leave-caret")
                        .removeClass("fa-caret-right")
                        .addClass("fa-caret-down");
            }

            ev.preventDefault();
        });

        $(".realms-op-leave-only-row").show();
        $(".realms-op-join-only").hide();
        $(".realms-op-apply").hide();
    }

    $(".realms-op-title").text(title);
    $(".realms-op-field").val("");

    function check(name) {
        var dfd = $.Deferred();

        if (name === undefined)
            name = $("#realms-op-address").val();

        if (name) {
            $(".realms-op-address-spinner")
                    .removeClass("fa fa-check")
                    .addClass("spinner spinner-xs spinner-inline")
                    .show();
            $(".realms-op-address-error").text(_("Validating address"));
        }

        realmd.call(MANAGER, PROVIDER, "Discover", [name, { }])
                .always(function() {
                    if ($("#realms-op-address").val() != name) {
                        dfd.reject();
                        check();
                        return;
                    }

                    var error, path;
                    var result = [];
                    if (this.state() == "rejected") {
                        error = arguments[0];
                        $(".realms-op-message")
                                .empty()
                                .text(error.message);
                        dfd.reject(error);
                    }

                    if (arguments[0][1])
                        result = arguments[0][1];
                    path = result[0]; /* the first realm */

                    if (!path) {
                        if (name) {
                            error_message = cockpit.format(_("Domain $0 could not be contacted"), name);
                            $(".realms-op-address-spinner").hide();
                            $(".realms-op-address-error").text(error_message);
                            $("#realms-op-address").parent()
                                    .removeClass("has-success")
                                    .addClass("has-error");
                        }

                        realm = null;
                        kerberos_membership = null;
                        kerberos = null;

                        dfd.reject(new Error(error_message));
                    } else {
                        kerberos_membership = realmd.proxy(KERBEROS_MEMBERSHIP, path);
                        $(kerberos_membership).on("changed", update);

                        kerberos = realmd.proxy(KERBEROS, path);

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

        if ($("#realms-op-address").val() === checked) {
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

        if (realm && kerberos_membership) {
            if (kerberos_membership.valid) {
                $(".realms-op-address-spinner")
                        .removeClass("spinner spinner-xs spinner-inline")
                        .addClass("fa fa-check")
                        .show();
                $(".realms-op-address-error").text(_("Contacted domain"));
                $("#realms-op-address").parent()
                        .removeClass("has-error")
                        .addClass("has-success");
            } else {
                message = cockpit.format(_("Domain $0 is not supported"), realm.Name);
                $(".realms-op-address-spinner").hide();
                $(".realms-op-address-error").text(message);
                $("#realms-op-address").parent()
                        .removeClass("has-success")
                        .addClass("has-error");
            }
        }

        if (operation)
            button.attr('disabled', 'disabled');
        else
            button.removeAttr('disabled');

        if (mode != 'join')
            return;

        $(".realm-active-directory-only").toggle(!server || server == "active-directory");

        if (realm && realm.Name && !$("#realms-op-address")[0].placeholder) {
            $("#realms-op-address")[0].placeholder = cockpit.format(_("e.g. \"$0\""), realm.Name);
        }

        var placeholder = "";
        if (kerberos_membership) {
            if (kerberos_membership.SuggestedAdministrator)
                placeholder = cockpit.format(_("e.g. \"$0\""), kerberos_membership.SuggestedAdministrator);
        }
        $("#realms-op-admin")[0].placeholder = placeholder;

        var list = $("#realms-op-auth .dropdown-menu");
        var supported = (kerberos_membership && kerberos_membership.SupportedJoinCredentials) || [];
        supported.push(["password", "administrator"]);

        var first = true;
        var count = 0;

        function add_choice(owner, type, text) {
            var item, choice, i;
            var length = supported.length;
            for (i = 0; i < length; i++) {
                if ((!owner || owner == supported[i][1]) && type == supported[i][0]) {
                    choice = type + "/" + supported[i][1];
                    item = $("<li>").attr("data-value", choice)
                            .append($("<a tabindex='0'>").text(text));
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
        $("#realms-op-auth").toggle(count > 1);
        $("#realms-op-auth").prev()
                .toggle(count > 1);
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
                cockpit.variant('(ss)', [$("#realms-op-user").val(), $("#realms-op-user-password").val()])
            ];
        } else if (owner == "administrator" && type == "password") {
            creds = [
                type, owner,
                cockpit.variant('(ss)', [$("#realms-op-admin").val(), $("#realms-op-admin-password").val()])
            ];
        } else if (type == "secret") {
            secret = $("#realms-op-ot-password").val();
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

    // Request and install a kerberos keytab and an SSL certificate for cockpit-ws (with IPA)
    // This is opportunistic: Some realms might not use IPA, or an unsupported auth mechanism
    function install_ws_credentials() {
        // skip this on remote ssh hosts, only set up ws hosts
        if (cockpit.transport.host !== "localhost")
            return cockpit.resolve();

        if (auth !== "password/administrator") {
            console.log("Installing kerberos keytab and SSL certificate not supported for auth mode", auth);
            return cockpit.resolve();
        }

        var user = $("#realms-op-admin").val();
        var password = $("#realms-op-admin-password").val();

        // ipa-getkeytab needs root to create the file, same for cert installation
        var script = 'set -eu; [ $(id -u) = 0 ] || exit 0; ';
        // not an IPA setup? cannot handle this
        script += 'type ipa >/dev/null 2>&1 || exit 0; ';

        script += 'HOST=$(hostname -f); ';

        // IPA operations require auth; read password from stdin to avoid quoting issues
        // if kinit fails, we can't handle this setup, exit cleanly
        script += 'kinit ' + user + '@' + kerberos.RealmName + ' || exit 0; ';

        // ensure this gets run with a non-C locale; ipa fails otherwise
        // C.UTF-8 exists on most OSes now, except for RHEL 7
        script += "if [ $(sh -c 'eval `locale`; echo $LC_CTYPE') = 'C' ]; then " +
                  "    locale -a | grep -iq ^'C.utf' && export LC_CTYPE=C.UTF-8 || export LC_CTYPE=en_US.UTF-8; " +
                  "fi; ";

        // create a kerberos Service Principal Name for cockpit-ws, unless already present
        script += 'service="HTTP/${HOST}@' + kerberos.RealmName + '"; ' +
                  'ipa service-show "$service" || ipa service-add --ok-as-delegate=true --force "$service"; ';

        // add cockpit-ws key, unless already present
        script += 'mkdir -p /etc/cockpit; ';
        script += 'klist -k /etc/cockpit/krb5.keytab | grep -qF "$service" || ' +
                  'ipa-getkeytab -p HTTP/$HOST -k /etc/cockpit/krb5.keytab; ';

        // request an SSL certificate; be sure to not leave traces of the .key on disk or
        // get race conditions with file permissions; also, ipa-getcert
        // cannot directly write into /etc/cockpit due to SELinux
        script += 'if ipa-getcert request -f /run/cockpit/ipa.crt -k /run/cockpit/ipa.key -K HTTP/$HOST -w -v; then ' +
                  '    mv /run/cockpit/ipa.crt /etc/cockpit/ws-certs.d/10-ipa.cert; ' +
                  '    cat /run/cockpit/ipa.key  >> /etc/cockpit/ws-certs.d/10-ipa.cert; ' +
                  '    rm -f /run/cockpit/ipa.key; ' +
                  'fi; ';

        // use a temporary keytab to avoid interfering with the system one
        var proc = cockpit.script(script, [], { superuser: "require", err: "message",
                                                environ: ["KRB5CCNAME=/run/cockpit/keytab-setup"] });
        proc.input(password);
        return proc;
    }

    // Remove SPN from cockpit-ws keytab and SSL cert
    function cleanup_ws_credentials() {
        // skip this on remote ssh hosts, only set up ws hosts
        if (cockpit.transport.host !== "localhost")
            return cockpit.resolve();

        var dfd = cockpit.defer();

        kerberos = realmd.proxy(KERBEROS, realm.path);
        kerberos.wait()
                .done(function() {
                // ipa-rmkeytab needs root
                    var script = 'set -eu; [ $(id -u) = 0 ] || exit 0; ';

                    // clean up keytab
                    script += '[ ! -e /etc/cockpit/krb5.keytab ] || ipa-rmkeytab -k /etc/cockpit/krb5.keytab -p ' +
                    '"HTTP/$(hostname -f)@' + kerberos.RealmName + '"; ';

                    // clean up certificate
                    script += 'ipa-getcert stop-tracking -f /run/cockpit/ipa.crt -k /run/cockpit/ipa.key; ' +
                          'rm -f /etc/cockpit/ws-certs.d/10-ipa.cert; ';

                    cockpit.script(script, [], { superuser: "require", err: "message" })
                            .done(dfd.resolve)
                            .fail(function(ex) {
                                console.log("Failed to clean up SPN from /etc/cockpit/krb5.keytab:", JSON.stringify(ex));
                                dfd.resolve();
                            });
                })
                .fail(dfd.resolve); // no Kerberos domain? nevermind then

        return dfd.promise();
    }

    var unique = 1;

    function perform() {
        var id = "cockpit-" + unique;
        unique += 1;
        busy(id);
        $(".realms-op-error").hide();

        ensure()
                .fail(function() {
                    busy(null);
                })
                .done(function(realm) {
                    var options = { operation: cockpit.variant('s', id) };

                    $(".realms-op-message").empty();
                    $(".realms-op-diagnostics").empty()
                            .hide();

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
                        if (kerberos_membership.valid) {
                            call = kerberos_membership.call("Join", [credentials(), options]).then(install_ws_credentials);
                        } else {
                            busy(null);
                            $(".realms-op-message").empty()
                                    .text(_("Joining this domain is not supported"));
                            $(".realms-op-error").show();
                        }
                    } else if (mode == 'leave') {
                        call = cleanup_ws_credentials().then(function() { realm.Deconfigure(options) });
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
                                    console.log("Failed to " + mode + " domain: " + realm.Name + ": " + ex);
                                    $(".realms-op-message").empty()
                                            .text(ex + " ");
                                    $(".realms-op-error").show();
                                    if (diagnostics) {
                                        $(".realms-op-message")
                                                .append('<a tabindex="0" class="realms-op-more-diagnostics">' + _("More") + '</a>');
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
            realmd.call(MANAGER, SERVICE, "Cancel", [operation]);
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

    var element = $("<span>");
    var link = $("<a tabindex='0'>");
    element.append(link);
    var hostname_link = $("#system_information_hostname_button");

    var realmd = null;
    var realms = null;

    /* The realm we are joined to */
    var joined = null;

    var permission = null;
    var install_realmd = false;

    function setTooltip(message) {
        element
                .attr('title', message)
                .tooltip({ container: 'body' })
                .tooltip('fixTitle');
    }

    function update_realms() {
        var text, path, realm;
        joined = [];
        for (path in realms) {
            realm = realms[path];
            if (realm.Configured)
                joined.push(realm);
        }

        if (!joined || !joined.length) {
            text = _("Join Domain");
            hostname_link.removeAttr('disabled');
        } else {
            text = joined.map(function(x) { return x.Name }).join(", ");
            hostname_link.attr('disabled', 'disabled');
            hostname_link.attr('title', _("Host name should not be changed in a domain")).tooltip('fixTitle');
        }
        link.text(text);
    }

    function setup_realms_proxy() {
        // HACK: need to reinitialize after installing realmd (https://github.com/cockpit-project/cockpit/pull/9125)
        realmd = cockpit.dbus("org.freedesktop.realmd");
        realmd.watch(MANAGER);

        $(realmd).on("close", function(ev, options) {
            if (options.problem == "not-found") {
                /* see if we can install it */
                packagekit.detect().then(function (exists) {
                    if (exists) {
                        setTooltip("Joining a domain requires installation of realmd");
                        link.removeClass("disabled");
                        install_realmd = true;
                    } else {
                        setTooltip("Cannot join a domain because realmd is not available on this system");
                        link.addClass("disabled");
                    }
                });
            } else {
                setTooltip(cockpit.message(options));
                link.addClass("disabled");
            }
            $(realmd).off();
            realmd.close();
            realmd = null;
        });

        realms = realmd.proxies("org.freedesktop.realmd.Realm");
        realms.wait(function() {
            if (!realmd)
                return;

            permission = cockpit.permission({ admin: true });

            function update_realm_privileged() {
                $(link).update_privileged(permission,
                                          cockpit.format(_("The user <b>$0</b> is not permitted to modify realms"),
                                                         permission.user ? permission.user.name : ''), null, element);
            }

            $(permission).on("changed", update_realm_privileged);
        });

        $(realms).on("changed", update_realms);
    }

    function handle_install_realmd() {
        install_dialog("realmd")
                .then(function() {
                    install_realmd = false;
                    setup_realms_proxy();
                    element.tooltip('disable');
                    // proceed to domain join dialog after realmd initialized
                    realms.wait().done(handle_link_click);
                })
                .catch(function() { }); // dialog cancelled
    }

    var dialog = null;
    function handle_link_click() {
        if (dialog)
            $(dialog).remove();

        if (install_realmd) {
            handle_install_realmd();
            return;
        }

        if (joined && joined.length)
            dialog = instance(realmd, 'leave', joined[0], link);
        else
            dialog = instance(realmd, 'join', null, link);

        $(dialog)
                .attr("id", "realms-op")
                .appendTo("body")
                .modal('show');
        cockpit.translate();
    }

    setup_realms_proxy();
    update_realms();
    link.on("click", handle_link_click);

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
        placeholder.append(setup());
        placeholder.removeAttr('hidden');
        placeholder.prev().removeAttr('hidden');
    }
});
