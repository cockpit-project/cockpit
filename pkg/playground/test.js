import cockpit from "cockpit";

import '../lib/patternfly/patternfly-5-cockpit.scss';
import "../../node_modules/@patternfly/patternfly/components/Button/button.css";
import "../../node_modules/@patternfly/patternfly/components/Page/page.css";

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("hammer").addEventListener("click", e => e.target.setAttribute("hidden", "hidden"));

    document.querySelector(".cockpit-internal-reauthorize .pf-v5-c-button").addEventListener("click", () => {
        document.querySelector(".cockpit-internal-reauthorize span").textContent = "checking...";
        cockpit.script("pkcheck --action-id org.freedesktop.policykit.exec --process $$ -u 2>&1", { superuser: "try" })
                .stream(data => console.debug(data))
                .then(() => {
                    document.querySelector(".cockpit-internal-reauthorize span").textContent = "result: authorized";
                })
                .catch(() => {
                    document.querySelector(".cockpit-internal-reauthorize span").textContent = "result: access-denied";
                });
    });

    document.querySelector(".super-channel .pf-v5-c-button").addEventListener("click", () => {
        document.querySelector(".super-channel span").textContent = "checking...";
        cockpit.spawn(["id"], { superuser: true })
                .then(data => {
                    console.log("done");
                    document.querySelector(".super-channel span").textContent = "result: " + data;
                })
                .catch(ex => {
                    console.log("fail");
                    document.querySelector(".super-channel span").textContent = "result: " + ex.problem;
                });
    });

    document.querySelector(".lock-channel .pf-v5-c-button").addEventListener("click", () => {
        document.querySelector(".lock-channel span").textContent = "locking...";
        cockpit.spawn(["flock", "-o", "/tmp/playground-test-lock", "-c", "echo locked; sleep infinity"],
                      { superuser: "try", err: "message" })
                .stream(data => {
                    document.querySelector(".lock-channel span").textContent = data;
                })
                .catch(ex => {
                    document.querySelector(".lock-channel span").textContent = "failed: " + ex.toString();
                });
    });

    function update_nav() {
        document.getElementById("nav").textContent = '';
        const path = ["top"].concat(cockpit.location.path);
        const e_nav = document.getElementById("nav");
        path.forEach((p, i) => {
            if (i < path.length - 1) {
                const e_link = document.createElement("a");
                e_link.setAttribute("tabindex", "0");
                e_link.textContent = p;
                e_link.addEventListener("click", () => cockpit.location.go(path.slice(1, i + 1)));
                e_nav.append(e_link, " >> ");
            } else {
                const e_span = document.createElement("span");
                e_span.textContent = p;
                e_nav.appendChild(e_span);
            }
        });
    }

    cockpit.addEventListener('locationchanged', update_nav);
    update_nav();

    document.getElementById('go-down').addEventListener("click", () => {
        const len = cockpit.location.path.length;
        cockpit.location.go(cockpit.location.path.concat(len.toString()), { length: len.toString() });
    });

    const counter = cockpit.file("/tmp/counter", { syntax: JSON });

    function normalize_counter(obj) {
        obj = obj || { };
        obj.counter = obj.counter || 0;
        return obj;
    }

    function complain(error) {
        document.getElementById('file-error').textContent = error.toString();
    }

    function changed(content, tag, error) {
        if (error)
            return complain(error);
        document.getElementById('file-content').textContent = normalize_counter(content).counter;
        document.getElementById('file-error').textContent = "";
    }

    counter.watch(changed);

    document.getElementById('modify-file').addEventListener("click", () => {
        counter
                .modify(obj => {
                    obj = normalize_counter(obj);
                    obj.counter += 1;
                    return obj;
                })
                .catch(complain);
    });

    function load_file() {
        cockpit.file("/tmp/counter").read()
                .then(content => {
                    document.getElementById('edit-file').value = content;
                });
    }

    function save_file() {
        cockpit.file("/tmp/counter").replace(document.getElementById('edit-file').value);
    }

    document.getElementById('load-file').addEventListener("click", load_file);
    document.getElementById('save-file').addEventListener("click", save_file);
    load_file();

    document.getElementById('delete-file').addEventListener("click", () => cockpit.spawn(["rm", "-f", "/tmp/counter"]));

    document.body.removeAttribute("hidden");

    function show_hidden() {
        document.getElementById("hidden").textContent = cockpit.hidden ? "hidden" : "visible";
    }

    cockpit.addEventListener("visibilitychange", show_hidden);
    show_hidden();
});
