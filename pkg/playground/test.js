import cockpit from "cockpit";

import { Channel } from '../lib/cockpit/channel';

import '../lib/patternfly/patternfly-6-cockpit.scss';
import "../../node_modules/@patternfly/patternfly/components/Button/button.css";
import "../../node_modules/@patternfly/patternfly/components/Page/page.css";

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("hammer").addEventListener("click", e => e.target.setAttribute("hidden", "hidden"));

    document.querySelector(".cockpit-internal-reauthorize .pf-v6-c-button").addEventListener("click", () => {
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

    document.querySelector(".super-channel .pf-v6-c-button").addEventListener("click", () => {
        document.querySelector(".super-channel span").textContent = "checking...";
        cockpit.spawn(["id"], { superuser: "require" })
                .then(data => {
                    console.log("done");
                    document.querySelector(".super-channel span").textContent = "result: " + data;
                })
                .catch(ex => {
                    console.log("fail");
                    document.querySelector(".super-channel span").textContent = "result: " + ex.problem;
                });
    });

    document.querySelector(".lock-channel .pf-v6-c-button").addEventListener("click", () => {
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

    cockpit.user().then(info => {
        console.log(info);
        document.getElementById("user-info").textContent = JSON.stringify(info);
    });

    cockpit.addEventListener("visibilitychange", show_hidden);
    show_hidden();

    // HACK: The user/group/mode options are not part yet of the Cockpit File API so
    // we resort to creating our own channel here. We can't use the new `Channel`
    // API as importing it with cockpit leads to the wrong cockpit.Channel being
    // used instead of the new class.
    const replace = (filename, content, tag, attrs) => {
        const channel = new Channel({ payload: "fsreplace1", superuser: 'try', path: filename, tag, attrs });
        channel.wait();

        return new Promise((resolve, reject) => {
            channel.on('close', message => {
                if (message.problem) {
                    reject(message);
                } else {
                    resolve();
                }
            });

            channel.send_data(content);
            channel.send_control({ command: 'done' });
        });
    };

    const fsreplace_btn = document.getElementById("fsreplace1-create");
    const fsreplace_error = document.getElementById("fsreplace1-error");
    fsreplace_btn.addEventListener("click", e => {
        fsreplace_btn.disabled = true;
        fsreplace_error.textContent = '';
        const filename = document.getElementById("fsreplace1-filename").value;
        const content = document.getElementById("fsreplace1-content").value;
        const use_tag = document.getElementById("fsreplace1-use-tag").checked;
        const file = cockpit.file(filename, { superuser: "try" });
        const attrs = { };
        for (const field of ["user", "group", "mode"]) {
            const val = document.getElementById(`fsreplace1-${field}`).value;
            if (!val)
                continue;

            attrs[field] = val;
        }

        if ('mode' in attrs)
            attrs.mode = Number.parseInt(attrs.mode);

        file.read().then((_content, tag) => {
            replace(filename, content, use_tag ? tag : undefined, attrs).catch(exc => {
                fsreplace_error.textContent = cockpit.message(exc);
            })
                    .finally(() => {
                        fsreplace_btn.disabled = false;
                    });
        });
    });
});
