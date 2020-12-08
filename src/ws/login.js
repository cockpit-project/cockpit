/* Patch IE to support forEach on NodeLists, used in show/hide */
if (window.NodeList && !NodeList.prototype.forEach)
    NodeList.prototype.forEach = Array.prototype.forEach;

(function(console) {
    var localStorage;

    /* Some browsers fail localStorage access due to corruption, preventing Cockpit login */
    try {
        localStorage = window.localStorage;
        window.localStorage.removeItem('url-root');
        window.localStorage.removeItem('standard-login');
    } catch (ex) {
        localStorage = window.sessionStorage;
        console.warn(String(ex));
    }

    var url_root;
    var environment = window.environment || { };
    var oauth = environment.OAuth || null;
    if (oauth) {
        if (!oauth.TokenParam)
            oauth.TokenParam = "access_token";
        if (!oauth.ErrorParam)
            oauth.ErrorParam = "error_description";
    }

    var fmt_re = /\$\{([^}]+)\}|\$([a-zA-Z0-9_]+)/g;
    function format(fmt /* ... */) {
        var args = Array.prototype.slice.call(arguments, 1);
        return fmt.replace(fmt_re, function(m, x, y) { return args[x || y] || "" });
    }

    function gettext(key) {
        if (window.cockpit_po) {
            var translated = window.cockpit_po[key];
            if (translated && translated[1])
                return translated[1];
        }
        return key;
    }

    function translate() {
        if (!document.querySelectorAll)
            return;
        var list = document.querySelectorAll("[translate]");
        for (var i = 0; i < list.length; i++)
            list[i].textContent = gettext(list[i].textContent);
    }

    var _ = gettext;

    var login_path, application, org_login_path, org_application;
    var qs_re = /[?&]?([^=]+)=([^&]*)/g;
    var oauth_redirect_to = null;

    function QueryParams(qs) {
        qs = qs.split('+').join(' ');

        var params = {};
        var tokens;

        for (;;) {
            tokens = qs_re.exec(qs);
            if (!tokens)
                break;
            params[decodeURIComponent(tokens[1])] = decodeURIComponent(tokens[2]);
        }
        return params;
    }

    if (!console)
        console = function() { };

    function id(name) {
        return document.getElementById(name);
    }

    // Hide an element (or set of elements) based on a boolean
    // true: element is hidden, false: element is shown
    function hideToggle(elements, toggle) {
        var els;

        // If it's a single selector, convert it to an array for the loop
        if (typeof elements === "string")
            elements = [elements];

        // >= 1 arguments (of type element or string (for CSS selectors))
        // (passed in "arguments" isn't a a true array, so forEach wouldn't always work)
        for (var i = 0; i < elements.length; i++) {
            if (typeof elements[i] === "string") {
                // Support CSS selectors as a string
                els = document.querySelectorAll(elements[i]);

                if (els)
                    els.forEach(function(element) {
                        if (element.hidden !== !!toggle)
                            element.hidden = !!toggle;
                    });
            } else {
                // Hide specific elements
                if (elements[i].hidden !== !!toggle)
                    elements[i].hidden = !!toggle;
            }
        }
    }

    // Show >=1 arguments (element or CSS selector)
    function show() {
        hideToggle(arguments, false);
    }

    // Hide >=1 arguments (element or CSS selector)
    function hide() {
        hideToggle(arguments, true);
    }

    function fatal(msg) {
        if (window.console)
            console.warn("fatal:", msg);

        hide("#login-again", "#login-wait-validating");

        if (oauth_redirect_to) {
            id("login-again").href = oauth_redirect_to;
            show("#login-again");
        }

        hide("#login", "#login-details");
        show("#login-fatal");

        var el = id("login-fatal-message");
        el.textContent = "";
        el.appendChild(document.createTextNode(msg));
    }

    function brand(_id, def) {
        var style;
        var elt = id(_id);
        if (elt && window.getComputedStyle)
            style = window.getComputedStyle(elt, ":before");

        if (!style)
            return;

        var len;
        var content = style.content;
        if (content && content != "none" && content != "normal") {
            len = content.length;
            if ((content[0] === '"' || content[0] === '\'') &&
                len > 2 && content[len - 1] === content[0])
                content = content.substr(1, len - 2);
            elt.innerHTML = content || def;
        } else {
            elt.removeAttribute("class");
        }
    }

    function requisites() {
        function disableLogin(name) {
            if (name === "supports")
                name = "@supports API";
            var errorString = format(_("This web browser is too old to run the Web Console (missing $0)"), name);

            if (window.console)
                console.warn(errorString);
            id("login-error-message").textContent = errorString;
            hide("#login", "#login-details");
            show("#unsupported-browser", "#error-group");
            document.body.classList.add("brand-unsupported-browser");
        }

        function req(name, obj) {
            var ret;
            try {
                ret = (obj && obj[name]);
            } catch (ex) {
                fatal(format(_("The web browser configuration prevents Cockpit from running (inaccessible $0)"), name));
                throw ex;
            }
            if (ret === undefined) {
                disableLogin(name);
                return false;
            }
            return true;
        }

        function css() {
            /*
             * Be certain to use parenthesis when checking CSS strings
             * as Edge is oddly particular.
             *
             * Instead of "display: inline", use:
             * "(display: inline)"
             *        or
             * "display", "inline"
             */
            var args = [].join.call(arguments, ": ");

            if (!window.CSS || !window.CSS.supports.apply(this, arguments)) {
                disableLogin(args);
                return false;
            }
            return true;
        }

        return ("MozWebSocket" in window || req("WebSocket", window)) &&
               req("XMLHttpRequest", window) &&
               req("sessionStorage", window) &&
               req("JSON", window) &&
               req("defineProperty", Object) &&
               req("console", window) &&
               req("pushState", window.history) &&
               req("textContent", document) &&
               req("supports", window.CSS) &&
               css("display", "flex") &&
               css("display", "grid");
    }

    function trim(s) {
        return s.replace(/^\s+|\s+$/g, '');
    }

    /* Sets values for application, url_root and login_path */
    function setup_path_globals (path) {
        var parser = document.createElement('a');
        var base = document.baseURI;
        var base_tags;
        /* Some IEs don't support baseURI */
        if (!base) {
            base_tags = document.getElementsByTagName("base");
            if (base_tags.length > 0)
                base = base_tags[0].href;
            else
                base = "/";
        }

        path = path || "/";
        parser.href = base;
        if (parser.pathname != "/") {
            url_root = parser.pathname.replace(/^\/+|\/+$/g, '');
            localStorage.setItem('url-root', url_root);
            if (url_root && path.indexOf('/' + url_root) === 0)
                path = path.replace('/' + url_root, '') || '/';
        }

        if (path.indexOf("/=") === 0) {
            environment.hostname = path.substring(2).split("/")[0];
            id("server-field").value = environment.hostname;
            toggle_options(null, true);
            path = "/cockpit+" + path.split("/")[1];
        } else if (path.indexOf("/cockpit/") !== 0 && path.indexOf("/cockpit+") !== 0) {
            path = "/cockpit";
        }

        application = path.split("/")[1];
        login_path = "/" + application + "/login";
        if (url_root)
            login_path = "/" + url_root + login_path;

        org_application = application;
        org_login_path = login_path;
    }

    function toggle_options(ev, show) {
        // On keypress, only accept spacebar (enter acts as a click)
        if (ev && ev.type === 'keypress' && ev.key !== ' ')
            return;
        // Stop the <a>'s click handler, otherwise it causes a page reload
        if (ev && ev.type === 'click')
            ev.preventDefault();

        if (show === undefined)
            show = id("server-group").hidden;

        hideToggle("#server-group", !show);

        id("option-group").setAttribute("data-state", show);
        if (show) {
            id("option-caret").classList.add("caret-down");
            id("option-caret").classList.remove("caret-right");
        } else {
            id("option-caret").classList.add("caret-right");
            id("option-caret").classList.remove("caret-down");
        }
    }

    function boot() {
        window.onload = null;

        hide(".noscript");

        translate();
        if (window.cockpit_po && window.cockpit_po[""])
            document.documentElement.lang = window.cockpit_po[""].language || "en-us";

        setup_path_globals(window.location.pathname);

        /* Determine if we are nested or not, and switch styles */
        if (window.location.pathname.indexOf("/" + url_root + "/cockpit/") === 0 ||
            window.location.pathname.indexOf("/" + url_root + "/cockpit+") === 0)
            document.documentElement.setAttribute("class", "inline");

        // Setup title
        var title = environment.page.title;
        if (!title || application.indexOf("cockpit+=") === 0)
            title = environment.hostname;
        document.title = title;

        if (application.indexOf("cockpit+=") === 0) {
            hide("#brand", "#badge");
        } else {
            brand("badge", "");
            brand("brand", "Cockpit");
        }

        if (!requisites())
            return;

        if (environment.banner) {
            show("#banner");
            id("banner-message").textContent = environment.banner.trimEnd();
        }

        id("show-other-login-options").addEventListener("click", toggle_options);
        id("show-other-login-options").addEventListener("keypress", toggle_options);
        id("server-clear").addEventListener("click", function () {
            var el = id("server-field");
            el.value = "";
            el.focus();
        });

        var os_release = environment["os-release"];
        if (os_release)
            localStorage.setItem('os-release', JSON.stringify(os_release));

        var logout_intent = window.sessionStorage.getItem("logout-intent") == "explicit";
        if (logout_intent)
            window.sessionStorage.removeItem("logout-intent");

        var logout_reason = window.sessionStorage.getItem("logout-reason");
        if (logout_reason)
            window.sessionStorage.removeItem("logout-reason");

        /* Try automatic/kerberos authentication? */
        if (oauth) {
            hide("#login-details", "#login");
            if (logout_intent) {
                build_oauth_redirect_to();
                id("login-again").textContent = _("Login again");
                fatal(_("Logout successful"));
            } else {
                oauth_auto_login();
            }
        } else if (logout_intent) {
            show_login(logout_reason);
        } else {
            standard_auto_login();
        }
    }

    function standard_auto_login() {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", login_path, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState == 4) {
                if (xhr.status == 200) {
                    run(JSON.parse(xhr.responseText));
                } else if (xhr.status == 401) {
                    show_login();
                } else if (xhr.statusText) {
                    fatal(decodeURIComponent(xhr.statusText));
                } else if (xhr.status === 0) {
                    show_login();
                } else {
                    fatal(format(_("$0 error"), xhr.status));
                }
            }
        };
        xhr.send();
    }

    function build_oauth_redirect_to() {
        var url_parts = window.location.href.split('#', 2);
        oauth_redirect_to = oauth.URL;
        if (oauth.URL.indexOf("?") > -1)
            oauth_redirect_to += "&";
        else
            oauth_redirect_to += "?";
        oauth_redirect_to += "redirect_uri=" + encodeURIComponent(url_parts[0]);
    }

    function oauth_auto_login() {
        var parser = document.createElement('a');
        if (!oauth.URL)
            return fatal(_("Cockpit authentication is configured incorrectly."));

        var query = QueryParams(window.location.search);
        if (!window.location.search && window.location.hash)
            query = QueryParams(window.location.hash.slice(1));

        /* Not all providers allow hashes in redirect urls */

        var token_val, prompt_data, xhr;
        build_oauth_redirect_to();

        if (query[oauth.TokenParam]) {
            if (window.sessionStorage.getItem('login-wanted')) {
                parser.href = window.sessionStorage.getItem('login-wanted');
                setup_path_globals(parser.pathname);
            }

            token_val = query[oauth.TokenParam];
            show("#login-wait-validating");
            xhr = new XMLHttpRequest();
            xhr.open("GET", login_path, true);
            xhr.setRequestHeader("Authorization", "Bearer " + token_val);
            xhr.onreadystatechange = function () {
                if (xhr.readyState == 4) {
                    if (xhr.status == 200) {
                        run(JSON.parse(xhr.responseText));
                    } else {
                        prompt_data = get_prompt_from_challenge(xhr.getResponseHeader("WWW-Authenticate"),
                                                                xhr.responseText);
                        if (prompt_data)
                            show_converse(prompt_data);
                        else
                            fatal(decodeURIComponent(xhr.statusText));
                    }
                }
            };
            xhr.send();
        } else if (query[oauth.ErrorParam]) {
            fatal(query[oauth.ErrorParam]);
        } else {
            /* Store url we originally wanted in case we
             * had to strip a hash or query params
             */
            window.sessionStorage.setItem('login-wanted',
                                          window.location.href);
            window.location = oauth_redirect_to;
        }
    }

    function clear_errors() {
        hide("#error-group");
        id("login-error-message").textContent = "";
    }

    function clear_info() {
        hide("#info-group");
        id("login-info-message").textContent = "";
    }

    function login_failure(msg, form) {
        clear_errors();
        if (msg) {
            /* OAuth failures are always fatal */
            if (oauth) {
                fatal(msg);
            } else {
                show_form(form || "login");
                id("login-error-message").textContent = msg;
                show("#error-group");
            }
        }
    }

    function login_info(msg) {
        clear_info();
        if (msg) {
            id("login-info-message").textContent = msg;
            show("#info-group");
        }
    }

    function host_failure(msg) {
        var host = id("server-field").value;
        if (!host) {
            login_failure(msg);
        } else {
            clear_errors();
            id("login-error-message").textContent = msg;
            show("#error-group");
            toggle_options(null, true);
            show_form("login");
        }
    }

    function login_note(msg) {
        var el = id("login-note");
        if (msg) {
            show(el);
            el.textContent = msg;
        } else {
            el.innerHTML = '&nbsp;';
        }
    }

    function need_host() {
        return environment.page.require_host &&
            org_application.indexOf("cockpit+=") === -1;
    }

    function call_login() {
        login_failure(null);
        var machine;
        var user = trim(id("login-user-input").value);
        if (user === "") {
            login_failure(_("User name cannot be empty"));
        } else if (need_host() && id("server-field").value === "") {
            login_failure(_("Please specify the host to connect to"));
        } else {
            machine = id("server-field").value;
            if (machine) {
                application = "cockpit+=" + machine;
                login_path = org_login_path.replace("/" + org_application + "/", "/" + application + "/");
                id("brand").style.display = "none";
                id("badge").style.visibility = "hidden";
            } else {
                application = org_application;
                login_path = org_login_path;
                brand("badge", "");
                brand("brand", "Cockpit");
            }

            id("server-name").textContent = machine || environment.hostname;
            id("login-button").removeEventListener("click", call_login);

            var password = id("login-password-input").value;

            var superuser_key = "superuser:" + user + (machine ? ":" + machine : "");
            var superuser = localStorage.getItem(superuser_key) || "any";
            localStorage.setItem("superuser-key", superuser_key);
            localStorage.setItem(superuser_key, superuser);

            /* Keep information if login page was used */
            localStorage.setItem('standard-login', true);

            var headers = {
                Authorization: "Basic " + window.btoa(utf8(user + ":" + password)),
                "X-Superuser": superuser,
            };
            // allow unknown remote hosts with interactive logins with "Connect to:"
            if (machine)
                headers["X-SSH-Connect-Unknown-Hosts"] = "yes";

            send_login_request("GET", headers, false);
        }
    }

    function show_form(form) {
        var connectable = environment.page.connect;
        var expanded = id("option-group").getAttribute("data-state");

        hide("#login-wait-validating");
        show("#login", "#login-details");

        hideToggle(["#user-group", "#password-group"], form != "login");
        hideToggle("#conversation-group", form != "conversation");
        hideToggle("#hostkey-group", form != "hostkey");

        id("login-button-text").textContent = (form == "hostkey") ? _("Accept key and log in") : _("Log in");
        id("login-password-input").value = '';

        if (need_host()) {
            hide("#option-group");
            expanded = true;
        } else {
            hideToggle("#option-group", !connectable || form != "login");
        }

        if (!connectable || form != "login") {
            hide("#server-group");
        } else {
            hideToggle("#server-group", !expanded);
        }

        id("login-button").removeAttribute('disabled');
        id("login-button").removeAttribute('spinning');
        id("login-button").classList.remove("pf-m-danger");
        id("login-button").classList.add("pf-m-primary");
        hide("#get-out-link");

        if (form == "login")
            id("login-button").addEventListener("click", call_login);
    }

    function show_login(message) {
        /* Show the login screen */
        login_info(message);
        id("server-name").textContent = document.title;
        login_note(_("Log in with your server user account."));
        id("login-user-input").addEventListener("keydown", function(e) {
            login_failure(null);
            clear_info();
            if (e.which == 13)
                id("login-password-input").focus();
        }, false);

        var do_login = function(e) {
            login_failure(null);
            if (e.which == 13)
                call_login();
        };

        id("login-password-input").addEventListener("keydown", do_login);

        show_form("login");
        id("login-user-input").focus();
    }

    function get_known_hosts_db() {
        try {
            return JSON.parse(localStorage.getItem("known_hosts") || "{ }");
        } catch (ex) {
            console.warn("Can't parse known_hosts database in localStorage", ex);
            return { };
        }
    }

    function set_known_hosts_db(db) {
        try {
            localStorage.setItem("known_hosts", JSON.stringify(db));
        } catch (ex) {
            console.warn("Can't write known_hosts database to localStorage", ex);
        }
    }

    function do_hostkey_verification(data) {
        var key_db = get_known_hosts_db();
        var key = data["host-key"];
        var key_key = key.split(" ")[0];
        var key_type = key.split(" ")[1];

        if (key_db[key_key] == key) {
            converse(data.id, data.default);
            return;
        }

        if (key_db[key_key]) {
            id("hostkey-title").textContent = format(_("$0 key changed"), id("server-field").value);
            show("#hostkey-warning-group");
            id("hostkey-message-1").textContent = "";
        } else {
            id("hostkey-title").textContent = _("New host");
            hide("#hostkey-warning-group");
            id("hostkey-message-1").textContent = format(_("You are connecting to $0 for the first time."), id("server-field").value);
        }

        id("hostkey-verify-help-1").textContent = format(_("To verify a fingerprint, run the following on $0 while physically sitting at the machine or through a trusted network:"), id("server-field").value);
        id("hostkey-verify-help-cmds").textContent = format("ssh-keyscan$0 localhost | ssh-keygen -lf -",
                                                            key_type ? " -t " + key_type : "");

        id("hostkey-fingerprint").textContent = data.default;

        if (key_type) {
            id("hostkey-type").textContent = format("($0)", key_type);
            show("#hostkey-type");
        } else {
            hide("#hostkey-type");
        }

        login_failure("");

        function call_converse() {
            id("login-button").removeEventListener("click", call_converse);
            login_failure(null, "hostkey");
            key_db[key_key] = key;
            set_known_hosts_db(key_db);
            converse(data.id, data.default);
        }

        id("login-button").addEventListener("click", call_converse);

        show_form("hostkey");
        show("#get-out-link");

        if (key_db[key_key]) {
            id("login-button").classList.add("pf-m-danger");
            id("login-button").classList.remove("pf-m-primary");
        }
    }

    function show_converse(prompt_data) {
        if (prompt_data["host-key"]) {
            do_hostkey_verification(prompt_data);
            return;
        }

        var type = prompt_data.echo ? "text" : "password";
        id("conversation-prompt").textContent = prompt_data.prompt;

        var em = id("conversation-message");
        var msg = prompt_data.error || prompt_data.message;
        if (msg) {
            em.textContent = msg;
            show(em);
        } else {
            hide(em);
        }

        var ei = id("conversation-input");
        ei.value = "";
        if (prompt_data.default)
            ei.value = prompt_data.default;
        ei.setAttribute('type', type);

        login_failure("");

        function call_converse() {
            id("conversation-input").removeEventListener("keydown", key_down);
            id("login-button").removeEventListener("click", call_converse);
            login_failure(null, "conversation");
            converse(prompt_data.id, id("conversation-input").value);
        }

        function key_down(e) {
            login_failure(null, "conversation");
            if (e.which == 13) {
                call_converse();
            }
        }

        id("conversation-input").addEventListener("keydown", key_down);
        id("login-button").addEventListener("click", call_converse);
        show_form("conversation");
        ei.focus();
    }

    function utf8(str) {
        return window.unescape(encodeURIComponent(str));
    }

    function get_prompt_from_challenge (header, body) {
        var parts;
        var prompt;
        var resp;
        var id;

        if (!header)
            return null;

        parts = header.split(' ');
        if (parts[0].toLowerCase() !== 'x-conversation' && parts.length != 3)
            return null;

        id = parts[1];
        try {
            prompt = window.atob(parts[2]);
        } catch (err) {
            if (window.console)
                console.error("Invalid prompt data", err);
            return null;
        }

        try {
            resp = JSON.parse(body);
        } catch (err) {
            if (window.console)
                console.log("Got invalid JSON response for prompt data", err);
            resp = {};
        }

        resp.id = id;
        resp.prompt = prompt;
        return resp;
    }

    function send_login_request(method, headers, is_conversation) {
        id("login-button").setAttribute('disabled', "true");
        id("login-button").setAttribute('spinning', "true");
        var xhr = new XMLHttpRequest();
        xhr.open("GET", login_path, true);
        var prompt_data;
        var challenge;

        var k;
        for (k in headers)
            xhr.setRequestHeader(k, headers[k]);

        xhr.onreadystatechange = function () {
            if (xhr.readyState != 4) {
                return;
            } else if (xhr.status == 200) {
                var resp = JSON.parse(xhr.responseText);
                run(resp);
            } else if (xhr.status == 401) {
                challenge = xhr.getResponseHeader("WWW-Authenticate");
                if (challenge && challenge.toLowerCase().indexOf("x-conversation") === 0) {
                    prompt_data = get_prompt_from_challenge(challenge, xhr.responseText);
                    if (prompt_data)
                        show_converse(prompt_data);
                    else
                        fatal(_("Internal error: Invalid challenge header"));
                } else {
                    if (window.console)
                        console.log(xhr.statusText);
                    if (xhr.statusText.indexOf("authentication-not-supported") > -1) {
                        var user = trim(id("login-user-input").value);
                        fatal(format(_("The server refused to authenticate '$0' using password authentication, and no other supported authentication methods are available."), user));
                    } else if (xhr.statusText.indexOf("terminated") > -1) {
                        login_failure(_("Authentication failed: Server closed connection"));
                    } else if (xhr.statusText.indexOf("no-host") > -1) {
                        host_failure(_("Unable to connect to that address"));
                    } else if (xhr.statusText.indexOf("unknown-hostkey") > -1) {
                        host_failure(_("Refusing to connect. Hostkey is unknown"));
                    } else if (xhr.statusText.indexOf("unknown-host") > -1) {
                        host_failure(_("Refusing to connect. Host is unknown"));
                    } else if (xhr.statusText.indexOf("invalid-hostkey") > -1) {
                        host_failure(_("Refusing to connect. Hostkey does not match"));
                    } else if (is_conversation) {
                        login_failure(_("Authentication failed"));
                    } else {
                        login_failure(_("Wrong user name or password"));
                    }
                }
            } else if (xhr.status == 403) {
                login_failure(decodeURIComponent(xhr.statusText) || _("Permission denied"));
            } else if (xhr.statusText) {
                fatal(decodeURIComponent(xhr.statusText));
            } else {
                fatal(format(_("$0 error"), xhr.status));
            }
        };
        xhr.send();
    }

    function converse(id, msg) {
        var headers = {
            Authorization: "X-Conversation " + id + " " + window.btoa(utf8(msg))
        };
        send_login_request("GET", headers, true);
    }

    function login_reload (wanted) {
        // Force a reload if not triggered below
        // because only the hash part of the url
        // changed
        var timer = window.setTimeout(function() {
            timer = null;
            window.location.reload(true);
        }, 100);

        if (wanted && wanted != window.location.href)
            window.location = wanted;

        // cancel forced reload if we are reloading
        window.onbeforeunload = function() {
            if (timer)
                window.clearTimeout(timer);
            timer = null;
        };
    }

    function machine_application_login_reload (wanted) {
        var base = '/' + application + '/@localhost/';
        if (url_root)
            base = '/' + url_root + base;
        var embedded_url = base + 'shell/index.html';
        var xhr = new XMLHttpRequest();
        xhr.open("GET", base + 'manifests.json', true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState == 4) {
                if (xhr.status == 200) {
                    var resp = JSON.parse(xhr.responseText);
                    var base1 = resp ? resp.base1 : {};
                    if (!base1.version || base1.version < "119.x") {
                        login_reload(embedded_url);
                    } else
                        login_reload(wanted);
                } else {
                    login_reload(embedded_url);
                }
            }
        };
        xhr.send();
    }

    function clear_storage (storage, prefix, full) {
        var i = 0;
        while (i < storage.length) {
            var k = storage.key(i);
            if (full && k.indexOf("cockpit") !== 0)
                storage.removeItem(k);
            else if (k.indexOf(prefix) === 0)
                storage.removeItem(k);
            else
                i++;
        }
    }

    function setup_localstorage (response) {
        /* Clear anything not prefixed with
         * different application from sessionStorage
         */
        clear_storage(window.sessionStorage, application, true);

        /* Clear anything prefixed with our application
         * and login-data, but not other non-application values.
         */
        localStorage.removeItem('login-data');
        clear_storage(localStorage, application, false);

        var str;
        if (response && response["login-data"]) {
            str = JSON.stringify(response["login-data"]);
            /* login-data is tied to the auth cookie, since
             * cookies are available after the page
             * session ends login-data should be too.
             */
            localStorage.setItem(application + 'login-data', str);
            /* Backwards compatibility for packages that aren't application prefixed */
            localStorage.setItem('login-data', str);
        }

        /* URL Root is set by cockpit ws and shouldn't be prefixed
         * by application
         */
        if (url_root)
            localStorage.setItem('url-root', url_root);

        var ca_cert_url = environment.CACertUrl;
        if (ca_cert_url)
            window.sessionStorage.setItem('CACertUrl', ca_cert_url);
    }

    function run(response) {
        var wanted = window.sessionStorage.getItem('login-wanted');
        var machine = id("server-field").value;

        if (machine && application != org_application) {
            wanted = "/=" + machine;
            if (url_root)
                wanted = "/" + url_root + wanted;
        }

        /* clean up sessionStorage. clear anything that isn't prefixed
         * with an application and anything prefixed with our application.
         */
        clear_storage(window.sessionStorage, application, false);

        setup_localstorage(response);

        /* Make sure that the base1 version is new enough to handle
         * urls that reference machines.
         */
        if (application.indexOf("cockpit+=") === 0) {
            machine_application_login_reload(wanted);
        } else {
            login_reload(wanted);
        }
    }

    window.onload = boot;
})(window.console);
