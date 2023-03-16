/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

import cockpit from "cockpit";

import lister from "credentials-ssh-private-keys.sh";
import remove_key from "credentials-ssh-remove-key.sh";

const _ = cockpit.gettext;

function Keys() {
    const self = this;

    self.path = null;
    self.items = { };

    let watch = null;
    let proc = null;
    let timeout = null;

    cockpit.event_target(this);

    cockpit.user()
            .then(user => {
                self.path = user.home + '/.ssh';
                refresh();
            });

    function refresh() {
        function on_message(ev, payload) {
            const item = JSON.parse(payload);
            const name = item.path;
            if (name && name.indexOf("/") === -1 && name.slice(-4) === ".pub") {
                if (item.event === "present" || item.event === "created" ||
                item.event === "changed" || item.event === "deleted") {
                    window.clearInterval(timeout);
                    timeout = window.setTimeout(refresh, 100);
                }
            }
        }

        function on_close(ev, data) {
            watch.removeEventListener("close", on_close);
            watch.removeEventListener("message", on_message);
            if (!data.problem || data.problem == "not-found") {
                watch = null; /* Watch again */
            } else {
                console.warn("couldn't watch " + self.path + ": " + (data.message || data.problem));
                watch = false; /* Don't watch again */
            }
        }

        if (watch === null) {
            watch = cockpit.channel({ payload: "fswatch1", path: self.path });
            watch.addEventListener("close", on_close);
            watch.addEventListener("message", on_message);
        }

        if (proc)
            return;

        window.clearTimeout(timeout);
        timeout = null;

        proc = cockpit.script(lister, [self.path], { err: "message" });
        proc
                .then(data => process(data))
                .catch(ex => console.warn("failed to list keys in home directory: " + ex.message))
                .finally(() => {
                    proc = null;

                    if (!timeout)
                        timeout = window.setTimeout(refresh, 5000);
                });
    }

    function process(data) {
        const blocks = data.split('\v');
        let key;
        const items = { };

        /* First block is the data from ssh agent */
        blocks[0].trim().split("\n")
                .forEach(function(line) {
                    key = parse_key(line, items);
                    if (key)
                        key.loaded = true;
                });

        /* Next come individual triples of blocks */
        blocks.slice(1).forEach(function(block, i) {
            switch (i % 3) {
            case 0:
                key = parse_key(block, items);
                break;
            case 1:
                if (key) {
                    block = block.trim();
                    if (block.slice(-4) === ".pub")
                        key.name = block.slice(0, -4);
                    else if (block)
                        key.name = block;
                    else
                        key.agent_only = true;
                }
                break;
            case 2:
                if (key)
                    parse_info(block, key);
                break;
            }
        });

        self.items = items;
        self.dispatchEvent("changed");
    }

    function parse_key(line, items) {
        const parts = line.trim().split(" ");
        let id, type, comment;

        /* SSHv1 keys */
        if (!isNaN(parseInt(parts[0], 10))) {
            id = parts[2];
            type = "RSA1";
            comment = parts.slice(3).join(" ");
        } else if (parts[0].indexOf("ssh-") === 0) {
            id = parts[1];
            type = parts[0].substring(4).toUpperCase();
            comment = parts.slice(2).join(" ");
        } else if (parts[0].indexOf("ecdsa-") === 0) {
            id = parts[1];
            type = "ECDSA";
            comment = parts.slice(2).join(" ");
        } else {
            return;
        }

        let key = items[id];
        if (!key)
            key = items[id] = { };

        key.type = type;
        key.comment = comment;
        key.data = line;
        return key;
    }

    function parse_info(line, key) {
        const parts = line.trim().split(" ")
                .filter(n => !!n);

        key.size = parseInt(parts[0], 10);
        if (isNaN(key.size))
            key.size = null;

        key.fingerprint = parts[1];

        if (!key.name && parts[2] && parts[2].indexOf("/") !== -1)
            key.name = parts[2];
    }

    function ensure_ssh_directory(file) {
        return cockpit.script('dir=$(dirname "$1"); test -e "$dir" || mkdir -m 700 "$dir"', [file]);
    }

    function run_keygen(file, new_type, old_pass, new_pass, two_pass) {
        const old_exps = [/.*Enter old passphrase: $/];
        const new_exps = [/.*Enter passphrase.*/, /.*Enter new passphrase.*/, /.*Enter same passphrase again: $/];
        const bad_exps = [/.*failed: passphrase is too short.*/];

        return new Promise((resolve, reject) => {
            let buffer = "";
            let sent_new = false;
            let failure = _("No such file or directory");

            if (new_pass !== two_pass) {
                reject(new Error(_("The passwords do not match.")));
                return;
            }

            // Exactly one of new_type or old_pass must be given
            console.assert((new_type == null) != (old_pass == null));

            const cmd = ["ssh-keygen", "-f", file];
            if (new_type)
                cmd.push("-t", new_type);
            else
                cmd.push("-p");

            const proc = cockpit.spawn(cmd, { pty: true, environ: ["LC_ALL=C"], err: "out", directory: self.path });

            const timeout = window.setTimeout(() => {
                failure = _("Prompting via ssh-keygen timed out");
                proc.close("terminated");
            }, 10 * 1000);

            proc
                    .stream(data => {
                        buffer += data;
                        if (old_pass) {
                            for (let i = 0; i < old_exps.length; i++) {
                                if (old_exps[i].test(buffer)) {
                                    buffer = "";
                                    failure = _("Old password not accepted");
                                    proc.input(old_pass + "\n", true);
                                    return;
                                }
                            }
                        }

                        for (let i = 0; i < new_exps.length; i++) {
                            if (new_exps[i].test(buffer)) {
                                buffer = "";
                                proc.input(new_pass + "\n", true);
                                failure = _("Failed to change password");
                                sent_new = true;
                                return;
                            }
                        }

                        if (sent_new) {
                            for (let i = 0; i < bad_exps.length; i++) {
                                if (bad_exps[i].test(buffer)) {
                                    failure = _("New password was not accepted");
                                    return;
                                }
                            }
                        }
                    })
                    .then(resolve)
                    .catch(ex => {
                        if (ex.exit_status)
                            ex = new Error(failure);
                        reject(ex);
                    })
                    .finally(() => window.clearInterval(timeout));
        });
    }

    self.change = function change(name, old_pass, new_pass, two_pass) {
        return run_keygen(name, null, old_pass, new_pass, two_pass);
    };

    self.create = function create(name, type, new_pass, two_pass) {
        return ensure_ssh_directory(name)
                .then(() => run_keygen(name, type, null, new_pass, two_pass));
    };

    self.get_pubkey = function get_pubkey(name) {
        return cockpit.file(name + ".pub").read();
    };

    self.load = function(name, password) {
        const ask_exp = /.*Enter passphrase for .*/;
        const perm_exp = /.*UNPROTECTED PRIVATE KEY FILE.*/;
        const bad_exp = /.*Bad passphrase.*/;

        let buffer = "";
        let output = "";
        let failure = _("Not a valid private key");
        let sent_password = false;

        return new Promise((resolve, reject) => {
            const proc = cockpit.spawn(["ssh-add", name],
                                       { pty: true, environ: ["LC_ALL=C"], err: "out", directory: self.path });

            const timeout = window.setTimeout(() => {
                failure = _("Prompting via ssh-add timed out");
                proc.close("terminated");
            }, 10 * 1000);

            proc
                    .stream(data => {
                        buffer += data;
                        output += data;
                        if (perm_exp.test(buffer)) {
                            failure = _("Invalid file permissions");
                            buffer = "";
                        } else if (ask_exp.test(buffer)) {
                            buffer = "";
                            failure = _("Password not accepted");
                            proc.input(password + "\n", true);
                            sent_password = true;
                        } else if (bad_exp.test(buffer)) {
                            buffer = "";
                            proc.input("\n", true);
                        }
                    })
                    .then(() => {
                        refresh();
                        resolve();
                    })
                    .catch(ex => {
                        console.log(output);
                        if (ex.exit_status)
                            ex = new Error(failure);

                        ex.sent_password = sent_password;
                        reject(ex);
                    })
                    .finally(() => window.clearInterval(timeout));
        });
    };

    self.unload = function unload(key) {
        const options = { pty: true, err: "message", directory: self.path };

        const proc = (key.name && !key.agent_only)
            ? cockpit.spawn(["ssh-add", "-d", key.name], options)
            : cockpit.script(remove_key, [key.data], options);

        return proc.then(refresh);
    };

    self.close = function close() {
        if (watch)
            watch.close();
        if (proc)
            proc.close();
        window.clearTimeout(timeout);
        timeout = null;
    };
}

export function keys_instance() {
    return new Keys();
}
