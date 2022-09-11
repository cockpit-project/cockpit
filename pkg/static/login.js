(function(console) {
    let localStorage;

    /* Some browsers fail localStorage access due to corruption, preventing Cockpit login */
    try {
        localStorage = window.localStorage;
        window.localStorage.removeItem('url-root');
        window.localStorage.removeItem('standard-login');
    } catch (ex) {
        localStorage = window.sessionStorage;
        console.warn(String(ex));
    }

    let url_root;
    const environment = window.environment || { };
    const oauth = environment.OAuth || null;
    if (oauth) {
        if (!oauth.TokenParam)
            oauth.TokenParam = "access_token";
        if (!oauth.ErrorParam)
            oauth.ErrorParam = "error_description";
    }

    const fmt_re = /\$\{([^}]+)\}|\$([a-zA-Z0-9_]+)/g;
    function format(fmt /* ... */) {
        const args = Array.prototype.slice.call(arguments, 1);
        return fmt.replace(fmt_re, function(m, x, y) { return args[x || y] || "" });
    }

    function gettext(key) {
        if (window.cockpit_po) {
            const translated = window.cockpit_po[key];
            if (translated && translated[1])
                return translated[1];
        }
        return key;
    }

    function translate() {
        if (!document.querySelectorAll)
            return;
        const list = document.querySelectorAll("[translate]");
        for (let i = 0; i < list.length; i++)
            list[i].textContent = gettext(list[i].textContent);
    }

    const _ = gettext;

    let login_path, application, org_login_path, org_application;
    const qs_re = /[?&]?([^=]+)=([^&]*)/g;
    let oauth_redirect_to = null;

    function QueryParams(qs) {
        qs = qs.split('+').join(' ');

        const params = {};

        for (;;) {
            const tokens = qs_re.exec(qs);
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
        // If it's a single selector, convert it to an array for the loop
        if (typeof elements === "string")
            elements = [elements];

        // >= 1 arguments (of type element or string (for CSS selectors))
        // (passed in "arguments" isn't a a true array, so forEach wouldn't always work)
        for (let i = 0; i < elements.length; i++) {
            if (typeof elements[i] === "string") {
                // Support CSS selectors as a string
                const els = document.querySelectorAll(elements[i]);

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

    function show_captured_stderr(msg) {
        if (window.console)
            console.warn("stderr:", msg);

        hide("#login-wait-validating");

        hide("#login", "#login-details");
        show("#login-fatal");

        id("login-again").onclick = () => { hide('#login-fatal'); show_login() };
        show("#login-again");

        const el = id("login-fatal-message");
        el.textContent = "";
        el.appendChild(document.createTextNode(msg));
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

        const el = id("login-fatal-message");
        el.textContent = "";
        el.appendChild(document.createTextNode(msg));
    }

    function brand(_id, def) {
        const elt = id(_id);
        const style = (elt && window.getComputedStyle) ? window.getComputedStyle(elt, ":before") : null;

        if (!style)
            return;

        let content = style.content;
        if (content && content != "none" && content != "normal") {
            const len = content.length;
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
            const errorString = format(_("This web browser is too old to run the Web Console (missing $0)"), name);

            if (window.console)
                console.warn(errorString);
            id("login-error-message").textContent = errorString;
            hide("#login", "#login-details");
            show("#unsupported-browser", "#error-group");
            document.body.classList.add("brand-unsupported-browser");
        }

        function req(name, obj) {
            let ret;
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
            const args = [].join.call(arguments, ": ");

            if (!window.CSS || !window.CSS.supports.apply(this, arguments)) {
                disableLogin(args);
                return false;
            }
            return true;
        }

        return req("WebSocket", window) &&
               req("XMLHttpRequest", window) &&
               req("sessionStorage", window) &&
               req("JSON", window) &&
               req("defineProperty", Object) &&
               req("console", window) &&
               req("pushState", window.history) &&
               req("textContent", document) &&
               req("replaceAll", String.prototype) &&
               req("finally", Promise.prototype) &&
               req("supports", window.CSS) &&
               css("display", "flex") &&
               css("display", "grid") &&
               css("selector(test)") &&
               css("selector(:is(*):where(*))");
    }

    function trim(s) {
        return s.replace(/^\s+|\s+$/g, '');
    }

    /* Sets values for application, url_root and login_path */
    function setup_path_globals (path) {
        const parser = document.createElement('a');
        // send_login_html() sets <base> to UrlRoot
        const base = document.baseURI;

        path = path || "/";
        parser.href = base;
        if (parser.pathname != "/") {
            url_root = parser.pathname.replace(/^\/+|\/+$/g, '');
            // deprecated: for connecting to cockpit.js < 272
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

    function toggle_password(event) {
        const input = id("login-password-input");

        input.setAttribute("type", (input.getAttribute("type") === "password") ? "text" : "password");
        event.stopPropagation();
    }

    function boot() {
        window.onload = null;

        translate();
        if (window.cockpit_po && window.cockpit_po[""])
            document.documentElement.lang = window.cockpit_po[""].language || "en-us";

        setup_path_globals(window.location.pathname);

        /* Determine if we are nested or not, and switch styles */
        if (window.location.pathname.indexOf("/" + url_root + "/cockpit/") === 0 ||
            window.location.pathname.indexOf("/" + url_root + "/cockpit+") === 0)
            document.documentElement.setAttribute("class", "inline");

        // Setup title
        let title = environment.page.title;
        if (environment.is_cockpit_client)
            title = _("Login");
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
            const el = id("server-field");
            el.value = "";
            el.focus();
        });

        const logout_intent = window.sessionStorage.getItem("logout-intent") == "explicit";
        if (logout_intent)
            window.sessionStorage.removeItem("logout-intent");

        const logout_reason = window.sessionStorage.getItem("logout-reason");
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
        } else if (need_host()) {
            show_login();
        } else {
            standard_auto_login();
        }
    }

    function standard_auto_login() {
        const xhr = new XMLHttpRequest();
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
        const url_parts = window.location.href.split('#', 2);
        oauth_redirect_to = oauth.URL;
        if (oauth.URL.indexOf("?") > -1)
            oauth_redirect_to += "&";
        else
            oauth_redirect_to += "?";
        oauth_redirect_to += "redirect_uri=" + encodeURIComponent(url_parts[0]);
    }

    function oauth_auto_login() {
        const parser = document.createElement('a');
        if (!oauth.URL)
            return fatal(_("Cockpit authentication is configured incorrectly."));

        const query = (!window.location.search && window.location.hash)
            ? QueryParams(window.location.hash.slice(1))
            : QueryParams(window.location.search);

        /* Not all providers allow hashes in redirect urls */

        build_oauth_redirect_to();

        if (query[oauth.TokenParam]) {
            if (window.sessionStorage.getItem('login-wanted')) {
                parser.href = window.sessionStorage.getItem('login-wanted');
                setup_path_globals(parser.pathname);
            }

            const token_val = query[oauth.TokenParam];
            show("#login-wait-validating");
            const xhr = new XMLHttpRequest();
            xhr.open("GET", login_path, true);
            xhr.setRequestHeader("Authorization", "Bearer " + token_val);
            xhr.onreadystatechange = function () {
                if (xhr.readyState == 4) {
                    if (xhr.status == 200) {
                        run(JSON.parse(xhr.responseText));
                    } else {
                        const prompt_data = get_prompt_from_challenge(xhr.getResponseHeader("WWW-Authenticate"), xhr.responseText);
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
        const host = id("server-field").value;
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
        const el = id("login-note");
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

    function get_recent_hosts() {
        let hosts = [];
        try {
            hosts = JSON.parse(localStorage.getItem("cockpit-client-sessions") || "[]");
        } catch (e) {
            console.log("Failed to parse 'cockpit-client-sessions':", e);
        }

        return hosts;
    }

    function call_login() {
        login_failure(null);
        const user = trim(id("login-user-input").value);
        if (user === "" && !environment.is_cockpit_client) {
            login_failure(_("User name cannot be empty"));
        } else if (need_host() && id("server-field").value === "") {
            login_failure(_("Please specify the host to connect to"));
        } else {
            const machine = id("server-field").value;
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

            const password = id("login-password-input").value;

            const superuser_key = "superuser:" + user + (machine ? ":" + machine : "");
            const superuser = localStorage.getItem(superuser_key) || "none";
            localStorage.setItem("superuser-key", superuser_key);
            localStorage.setItem(superuser_key, superuser);

            /* Keep information if login page was used */
            localStorage.setItem('standard-login', true);

            const headers = {
                Authorization: "Basic " + window.btoa(utf8(user + ":" + password)),
                "X-Superuser": superuser,
            };
            // allow unknown remote hosts with interactive logins with "Connect to:"
            if (machine)
                headers["X-SSH-Connect-Unknown-Hosts"] = "yes";

            send_login_request("GET", headers, false);
        }
    }

    function render_recent_hosts() {
        const hosts = get_recent_hosts();

        const list = id("recent-hosts-list");
        list.innerHTML = "";
        hosts.forEach(host => {
            const wrapper = document.createElement("div");
            wrapper.classList.add("host-line");

            const b1 = document.createElement("button");
            b1.textContent = host;
            b1.classList.add("pf-c-button", "pf-m-tertiary", "host-name");
            b1.addEventListener("click", () => {
                id("server-field").value = host;
                call_login();
            });

            const b2 = document.createElement("button");
            b2.title = _("Remove host");
            b2.ariaLabel = b2.title;
            b2.classList.add("host-remove");
            b2.addEventListener("click", () => {
                const i = hosts.indexOf(host);
                hosts.splice(i, 1);
                localStorage.setItem('cockpit-client-sessions', JSON.stringify(hosts));
                render_recent_hosts();
            });

            wrapper.append(b1, b2);
            list.append(wrapper);
        });
        hideToggle("#recent-hosts", hosts.length == 0);
    }

    function show_form(form) {
        const connectable = environment.page.connect;
        let expanded = id("option-group").getAttribute("data-state");

        hide("#login-wait-validating");
        show("#login");
        hideToggle("#login-details", environment.is_cockpit_client);
        hideToggle("#server-field-label", environment.is_cockpit_client);
        if (environment.is_cockpit_client) {
            const brand = id("brand");
            brand.textContent = _("Connect to:");
            brand.classList.add("text-brand");
        }

        hideToggle(["#user-group", "#password-group"], form != "login" || environment.is_cockpit_client);
        hideToggle("#conversation-group", form != "conversation");
        hideToggle("#hostkey-group", form != "hostkey");

        id("login-button-text").textContent = (form == "hostkey") ? _("Accept key and log in") : _("Log in");
        id("login-password-input").value = '';

        if (environment.page.require_host) {
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

        if (environment.is_cockpit_client) {
            render_recent_hosts();
            document.body.classList.add("cockpit-client");
        }
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

        const do_login = function(e) {
            login_failure(null);
            if (e.which == 13)
                call_login();
        };

        id("login-password-input").addEventListener("keydown", do_login);
        id("login-password-toggle").addEventListener("click", toggle_password);

        show_form("login");

        if (!environment.is_cockpit_client) {
            id("login-user-input").focus();
        } else if (environment.page.require_host) {
            id("server-field").focus();
        }
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
        const key_db = get_known_hosts_db();
        const key = data["host-key"];
        const key_key = key.split(" ")[0];
        const key_type = key.split(" ")[1];

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

        const type = prompt_data.echo ? "text" : "password";
        id("conversation-prompt").textContent = prompt_data.prompt;

        const em = id("conversation-message");
        const msg = prompt_data.error || prompt_data.message;
        if (msg) {
            em.textContent = msg;
            show(em);
        } else {
            hide(em);
        }

        const ei = id("conversation-input");
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
        if (!header)
            return null;

        const parts = header.split(' ');
        if (parts[0].toLowerCase() !== 'x-conversation' && parts.length != 3)
            return null;

        const id = parts[1];
        let prompt;
        try {
            prompt = window.atob(parts[2]);
        } catch (err) {
            if (window.console)
                console.error("Invalid prompt data", err);
            return null;
        }

        let resp;
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
        const xhr = new XMLHttpRequest();
        xhr.open(method, login_path, true);

        for (const k in headers)
            xhr.setRequestHeader(k, headers[k]);

        xhr.onreadystatechange = function () {
            if (xhr.readyState != 4) {
                return;
            }
            if (xhr.status == 200) {
                const resp = JSON.parse(xhr.responseText);
                run(resp);
            } else if (xhr.status == 401) {
                const challenge = xhr.getResponseHeader("WWW-Authenticate");
                if (challenge && challenge.toLowerCase().indexOf("x-conversation") === 0) {
                    const prompt_data = get_prompt_from_challenge(challenge, xhr.responseText);
                    if (prompt_data)
                        show_converse(prompt_data);
                    else
                        fatal(_("Internal error: Invalid challenge header"));
                } else {
                    if (window.console)
                        console.log(xhr.statusText);
                    if (xhr.statusText.startsWith("captured-stderr:")) {
                        show_captured_stderr(decodeURIComponent(xhr.statusText.replace(/^captured-stderr:/, '')));
                    } else if (xhr.statusText.indexOf("authentication-not-supported") > -1) {
                        const user = trim(id("login-user-input").value);
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
                login_failure(_(decodeURIComponent(xhr.statusText)) || _("Permission denied"));
            } else if (xhr.statusText) {
                fatal(decodeURIComponent(xhr.statusText));
            } else {
                fatal(format(_("$0 error"), xhr.status));
            }
        };
        xhr.send();
    }

    function converse(id, msg) {
        const headers = {
            Authorization: "X-Conversation " + id + " " + window.btoa(utf8(msg))
        };
        send_login_request("GET", headers, true);
    }

    function login_reload (wanted) {
        // Force a reload if not triggered below
        // because only the hash part of the url
        // changed
        let timer = window.setTimeout(function() {
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

    function clear_storage (storage, prefix, full) {
        let i = 0;
        while (i < storage.length) {
            const k = storage.key(i);
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

        if (response && response["login-data"]) {
            const str = JSON.stringify(response["login-data"]);
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
         * deprecated: for connecting to cockpit.js < 272
         */
        if (url_root)
            localStorage.setItem('url-root', url_root);

        const ca_cert_url = environment.CACertUrl;
        if (ca_cert_url)
            window.sessionStorage.setItem('CACertUrl', ca_cert_url);
    }

    function run(response) {
        let wanted = window.sessionStorage.getItem('login-wanted');
        const machine = id("server-field").value;

        /* When using cockpit client remember all the addresses being used */
        if (machine && environment.is_cockpit_client) {
            const hosts = get_recent_hosts();
            if (hosts.indexOf(machine) < 0) {
                hosts.push(machine);
                localStorage.setItem('cockpit-client-sessions', JSON.stringify(hosts));
            }
        }

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
        login_reload(wanted);
    }

    window.onload = boot;
})(window.console);
