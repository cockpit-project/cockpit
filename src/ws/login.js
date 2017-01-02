/* global XMLHttpRequest */

var phantom_checkpoint = phantom_checkpoint || function () { };

(function(console) {
    var url_root;
    window.localStorage.removeItem('url-root');
    var environment = window.environment || { };
    var oauth = environment.OAuth || null;
    if (oauth) {
        if (!oauth.TokenParam)
            oauth.TokenParam = "access_token";
        if (!oauth.ErrorParam)
            oauth.ErrorParam = "error_description";
    }

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

    function unquote(str) {
        str = str.trim();
        if (str[0] == '"')
            str = str.substr(1, str.length - 2);
        return str;
    }

    if (!console)
        console = function() { };

    /* Determine if we are nested or not, and switch styles */
    if (window.location.pathname.indexOf("/cockpit/") === 0 ||
        window.location.pathname.indexOf("/cockpit+") === 0)
        document.documentElement.setAttribute("class", "inline");

    function id(name) {
        return document.getElementById(name);
    }

    function fatal(msg) {
        if (window.console)
            console.warn("fatal:", msg);

        id("login-again").style.display = "none";
        id("login-wait-validating").style.display = "none";

        if (oauth_redirect_to) {
            id("login-again").href = oauth_redirect_to;
            id("login-again").style.display = "block";
        }

        id("login").style.display = 'none';
        id("login-details").style.display = 'none';
        id("login-fatal").style.display = 'block';

        var el = id("login-fatal-message");
        el.textContent = "";
        el.appendChild(document.createTextNode(msg));
    }

    var fmt_re = /\$\{([^}]+)\}|\$([a-zA-Z0-9_]+)/g;
    function format(fmt, args) {
        return fmt.replace(fmt_re, function(m, x, y) { return args[x || y] || ""; });
    }

    function brand(_id, def) {
        var style, elt = id(_id);
        if (elt)
            style = window.getComputedStyle(elt);
        if (!style)
            return;

        var len, content = style.content;
        if (content && content != "none" && content != "normal") {
            len = content.length;
            if ((content[0] === '"' || content[0] === '\'') &&
                len > 2 && content[len - 1] === content[0])
                content = content.substr(1, len - 2);
            elt.innerHTML = format(content) || def;
        }
    }

    function requisites() {
        function req(name, obj) {
            var ret;
            try {
                ret = (obj[name]);
            } catch(ex) {
                fatal("The web browser configuration prevents Cockpit from running (inaccessible " + name + ")");
                throw ex;
            }
            if (ret === undefined) {
                fatal("This web browser is too old to run Cockpit (missing " + name + ")");
                return false;
            }
            return true;
        }
        return ("MozWebSocket" in window || req("WebSocket", window)) &&
               req("XMLHttpRequest", window) &&
               req("localStorage", window) &&
               req("sessionStorage", window) &&
               req("JSON", window) &&
               req("defineProperty", Object) &&
               req("console", window) &&
               req("pushState", window.history) &&
               req("textContent", document);
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
            base_tags = document.getElementsByTagName ("base");
            if (base_tags.length > 0)
                base = base_tags[0].href;
            else
                base = "/";
        }

        path = path || "/";
        parser.href = base;
        if (parser.pathname != "/") {
            url_root = parser.pathname.replace(/^\/+|\/+$/g, '');
            window.localStorage.setItem('url-root', url_root);
            if (url_root && path.indexOf('/' + url_root) === 0)
                path = path.replace('/' + url_root, '') || '/';
        }

        if (path.indexOf("/=") === 0) {
            environment.hostname = path.substring(2);
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
        if (show === undefined)
            show = id("server-group").style.display === "none";

        id("option-group").setAttribute("data-state", show);
        if (show) {
            id("server-group").style.display = 'block';
            id("option-caret").setAttribute("class", "caret caret-down");
            id("option-caret").setAttribute("className", "caret caret-down");
        } else {
            id("server-group").style.display = 'none';
            id("option-caret").setAttribute("class", "caret caret-right");
            id("option-caret").setAttribute("className", "caret caret-right");
        }
    }

    function boot() {
        window.onload = null;

        setup_path_globals (window.location.pathname);

        // Setup title
        var title = environment.page.title;
        if (!title)
            title = environment.hostname;
        document.title = title;

        if (application.indexOf("cockpit+=") === 0) {
            id("brand").style.display = "none";
            id("badge").style.visibility = "hidden";
        } else {
            brand("badge", "");
            brand("brand", "Cockpit");
        }

        id("option-group").addEventListener("click", toggle_options);
        id("server-clear").addEventListener("click", function () {
            var el = id("server-field");
            el.value = "";
            el.focus();
        });

        if (!requisites())
            return;

        /* Setup the user's last choice about the authorized button */
        var authorized = window.localStorage.getItem('authorized-default') || "";
        if (authorized.indexOf("password") !== -1)
            id("authorized-input").checked = true;

        var os_release = JSON.stringify(environment["os-release"]);
        var logout_intent = window.sessionStorage.getItem("logout-intent") == "explicit";
        if (logout_intent)
            window.sessionStorage.removeItem("logout-intent");
        window.localStorage.setItem('os-release', os_release);

        /* Try automatic/kerberos authentication? */
        if (oauth) {
            id("login-details").style.display = 'none';
            id("login").style.display = 'none';
            if (logout_intent) {
                build_oauth_redirect_to();
                id("login-again").textContent = "Login Again";
                fatal("Logout Successful");
            } else {
                oauth_auto_login();
            }
        } else if (logout_intent) {
            show_login();
        } else {
            standard_auto_login();
        }
    }

    function standard_auto_login() {
        var xhr = new XMLHttpRequest();
        xhr.open("GET", login_path, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState != 4) {
                return;
            } else if (xhr.status == 200) {
                run(JSON.parse(xhr.responseText));
            } else if (xhr.status == 401) {
                show_login();
            } else if (xhr.statusText) {
                fatal(decodeURIComponent(xhr.statusText));
            } else if (xhr.status === 0) {
                show_login();
            } else {
                fatal(xhr.status + " error");
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
            return fatal("Cockpit authentication is configured incorrectly.");

        var query = QueryParams(window.location.search);
        if (!window.location.search && window.location.hash)
            query = QueryParams(window.location.hash.slice(1));

        /* Not all providers allow hashes in redirect urls */

        var token_val, prompt_data, xhr;
        build_oauth_redirect_to();

        if (query[oauth.TokenParam]) {
            if (window.sessionStorage.getItem('login-wanted')) {
                parser.href = window.sessionStorage.getItem('login-wanted');
                setup_path_globals (parser.pathname);
            }

            token_val = query[oauth.TokenParam];
            id("login-wait-validating").style.display = "block";
            xhr = new XMLHttpRequest();
            xhr.open("GET", login_path, true);
            xhr.setRequestHeader("Authorization", "Bearer " + token_val);
            xhr.onreadystatechange = function () {
                if (xhr.readyState != 4) {
                    return;
                } else if (xhr.status == 200) {
                    run(JSON.parse(xhr.responseText));
                } else {
                    prompt_data = get_prompt_from_challenge(xhr.getResponseHeader("WWW-Authenticate"),
                                                            xhr.responseText);
                    if (prompt_data)
                        show_converse(prompt_data);
                    else
                        fatal(xhr.statusText);
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
        id("error-group").style.display = "none";
        id("login-error-message").textContent = "";
    }

    function login_failure(msg, in_conversation) {
        clear_errors();
        if (msg) {
            /* OAuth failures are always fatal */
            if (oauth) {
                fatal(msg);
            } else {
                show_form(in_conversation);
                id("login-error-message").textContent = msg;
                id("error-group").style.display = "block";
            }
        }
    }

    function host_failure(msg) {
        var host = id("server-field").value;
        if (!host) {
            login_failure(msg, false);
        } else {
            clear_errors();
            id("login-error-message").textContent = msg;
            id("error-group").style.display = "block";
            toggle_options(null, true);
            show_form();
        }
    }

    function login_note(msg) {
        var el = id("login-note");
        if (msg) {
            el.style.display = 'block';
            el.textContent = msg;
        } else {
            el.innerHTML = '&nbsp;';
        }
    }

    function call_login() {
        login_failure(null);
        var machine, user = trim(id("login-user-input").value);
        if (user === "") {
            login_failure("User name cannot be empty");
        } else {
            machine = id("server-field").value;
            if (machine) {
                application = "cockpit+=" + machine;
                login_path = org_login_path.replace("/" + org_application + "/", "/" + application + "/");
            } else {
                application = org_application;
                login_path = org_login_path;
            }

            id("server-name").textContent = machine || environment.hostname;
            id("login-button").removeEventListener("click", call_login);


            /* When checked we tell the server to keep authentication */
            var authorized = id("authorized-input").checked ? "password" : "";
            var password = id("login-password-input").value;
            window.localStorage.setItem('authorized-default', authorized);

            var headers = {
                "Authorization": "Basic " + window.btoa(utf8(user + ":" + password)),
                "X-Authorize": authorized,
            };

            send_login_request("GET", headers, false);
        }
    }

    function show_form(in_conversation) {
        var connectable = environment.page.connect;
        var expanded = id("option-group").getAttribute("data-state");
        id("login-wait-validating").style.display = "none";
        id("login").style.visibility = 'visible';
        id("login").style.display = "block";
        id("user-group").style.display = in_conversation ? "none" : "block";
        id("password-group").style.display = in_conversation ? "none" : "block";
        id("option-group").style.display = !connectable || in_conversation ? "none" : "block";
        id("conversation-group").style.display = in_conversation ? "block" : "none";
        id("login-button-text").textContent = "Log In";
        id("login-password-input").value = '';

        if (!connectable || in_conversation) {
            id("server-group").style.display = "none";
        } else {
            id("server-group").style.display = expanded ? "block" : "none";
        }


        id("login-button").removeAttribute('disabled');

        if (!in_conversation)
            id("login-button").addEventListener("click", call_login);
    }

    function show_login() {
        /* Show the login screen */
        id("server-name").textContent = document.title;
        login_note("Log in with your server user account.");
        id("login-user-input").addEventListener("keydown", function(e) {
            login_failure(null);
            if (e.which == 13)
                id("login-password-input").focus();
        }, false);

        id("login-password-input").addEventListener("keydown", function(e) {
            login_failure(null);
            if (e.which == 13)
                call_login();
        });
        show_form();
        id("login-user-input").focus();
        phantom_checkpoint();
    }

    function show_converse(prompt_data) {
        var type = prompt_data.echo ? "text" : "password";
        id("conversation-prompt").textContent = prompt_data.prompt;

        var em = id("conversation-message");
        var msg = prompt_data.error || prompt_data.message;
        if (msg) {
            em.textContent = msg;
            em.style.display = "block";
        } else {
            em.style.display = "none";
        }

        var ei = id("conversation-input");
        ei.value = "";
        if (prompt_data.default)
            ei.value = prompt_data.default;
        ei.setAttribute('type', type);
        ei.focus();

        login_failure("");

        function call_converse() {
            id("conversation-input").removeEventListener("keydown", key_down);
            id("login-button").removeEventListener("click", call_converse);
            login_failure(null, true);
            converse(prompt_data.id, id("conversation-input").value);
        }

        function key_down(e) {
            login_failure(null, true);
            if (e.which == 13) {
                call_converse();
            }
        }

        id("conversation-input").addEventListener("keydown", key_down);
        id("login-button").addEventListener("click", call_converse);
        show_form(true);
        phantom_checkpoint();
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
                        fatal("Internal Error: Invalid challenge header");
                } else {
                    if (window.console)
                        console.log(xhr.statusText);
                    if (xhr.statusText.indexOf("authentication-not-supported") > -1) {
                        var user = trim(id("login-user-input").value);
                        fatal("The server refused to authenticate '" + user + "' using password authentication, and no other supported authentication methods are available.");
                    } else if (xhr.statusText.indexOf("terminated") > -1) {
                        login_failure("Authentication Failed: Server closed connection");
                    } else if (xhr.statusText.indexOf("no-host") > -1) {
                        host_failure("Unable to connect to that address");
                    } else if (xhr.statusText.indexOf("unknown-hostkey") > -1) {
                        host_failure("Refusing to connect. Hostkey is unknown");
                    } else if (xhr.statusText.indexOf("unknown-host") > -1) {
                        host_failure("Refusing to connect. Host is unknown");
                    } else if (xhr.statusText.indexOf("invalid-hostkey") > -1) {
                        host_failure("Refusing to connect. Hostkey does not match");
                    } else if (is_conversation) {
                        login_failure("Authentication failed");
                    } else {
                        login_failure("Wrong user name or password");
                    }
                }
            } else if (xhr.status == 403) {
                login_failure(decodeURIComponent(xhr.statusText) || "Permission denied");
            } else if (xhr.statusText) {
                fatal(decodeURIComponent(xhr.statusText));
            } else {
                fatal(xhr.status + " error");
            }
            id("login-button").removeAttribute('disabled');
            phantom_checkpoint();
        };
        xhr.send();
    }

    function converse(id, msg) {
        var headers = {
            "Authorization": "X-Conversation " + id + " " + window.btoa(utf8(msg))
        };
        send_login_request("GET", headers, true);
    }

    function login_reload (wanted) {
        if (wanted && wanted != window.location.href)
            window.location = wanted;

        // Force a reload if the above didn't trigger it
        window.setTimeout(function() {
            window.location.reload(true);
        }, 100);
    }

    function machine_application_login_reload (wanted) {
        var base = '/' + application + '/@localhost/';
        if (url_root)
            base = '/' + url_root + base;
        var embeded_url = base + 'shell/index.html';
        var xhr = new XMLHttpRequest();
        xhr.open("GET", base + 'manifests.json', true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState != 4) {
                return;
            } else if (xhr.status == 200) {
                var resp = JSON.parse(xhr.responseText);
                var base1 = resp ? resp['base1'] : {};
                if (!base1['version'] || base1['version'] < "119.x") {
                    login_reload (embeded_url);
                } else
                    login_reload (wanted);
            } else {
                login_reload (embeded_url);
            }
            phantom_checkpoint();
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
        clear_storage (window.sessionStorage, application, true);

        /* Clear anything prefixed with our application
         * and login-data, but not other non-application values.
         */
        window.localStorage.removeItem('login-data');
        clear_storage (window.localStorage, application, false);

        var str;
        if (response && response["login-data"]) {
            str = JSON.stringify(response["login-data"]);
            try {
                /* login-data is tied to the auth cookie, since
                 * cookies are available after the page
                 * session ends login-data should be too.
                 */
                window.localStorage.setItem(application + 'login-data', str);
                /* Backwards compatbility for packages that aren't application prefixed */
                window.localStorage.setItem('login-data', str);
            } catch(ex) {
                console.warn("Error storing login-data:", ex);
            }
        }

        /* URL Root is set by cockpit ws and shouldn't be prefixed
         * by application
         */
        if (url_root)
            window.localStorage.setItem('url-root', url_root);
    }

    function run(response) {
        var wanted = window.sessionStorage.getItem('login-wanted');
        var machine = id("server-field").value;
        var str;

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
            machine_application_login_reload (wanted);
        } else {
            login_reload (wanted);
        }
    }

    window.onload = boot;
})(window.console);
