import cockpit from "cockpit";

import lister from "raw-loader!./ssh-list-public-keys.sh";
import adder from "raw-loader!./ssh-add-public-key.sh";

const _ = cockpit.gettext;

function AuthorizedKeys (user_name, home_dir) {
    const self = this;
    const dir = home_dir + "/.ssh";
    const filename = dir + "/authorized_keys";
    let file = null;
    let watch = null;
    let last_tag = null;

    cockpit.event_target(self);

    self.keys = [];
    self.state = "loading";

    function process_failure (ex) {
        self.keys = [];
        if (ex.problem == "access-denied") {
            self.state = ex.problem;
        } else if (ex.problem == "not-found") {
            self.state = "ready";
        } else {
            self.state = "failed";
            console.warn("Error processing authentication keys: " + ex);
        }
        self.dispatchEvent("changed");
    }

    function update_keys(keys, tag) {
        if (tag !== last_tag)
            return;

        self.keys = keys;
        self.state = "ready";
        self.dispatchEvent("changed");
    }

    /*
     * Splits up a strings like:
     *
     * 2048 SHA256:AAAAB3NzaC1yc2EAAAADAQ Comment Here (RSA)
     * 2048 SHA256:AAAAB3NzaC1yc2EAAAADAQ (RSA)
     */
    const PUBKEY_RE = /^(\S+)\s+(\S+)\s+(.*)\((\S+)\)$/;

    function parse_pubkeys(input) {
        const keys = [];

        return cockpit.script(lister)
                .input(input + "\n")
                .then(output => {
                    const lines = output.split("\n");

                    for (let i = 0; i + 1 < lines.length; i += 2) {
                        const obj = { raw: lines[i + 1] };
                        keys.push(obj);
                        const match = lines[i].trim().match(PUBKEY_RE);
                        obj.valid = !!match && !!obj.raw;
                        if (match) {
                            obj.size = match[1];
                            obj.fp = match[2];
                            obj.comment = match[3].trim();
                            if (obj.comment == "authorized_keys" || obj.comment == "no comment")
                                obj.comment = null;
                            obj.algorithm = match[4];

                            /* Old ssh-keygen versions need us to find the comment ourselves */
                            if (!obj.comment && obj.raw)
                                obj.comment = obj.raw
                                        .split(" ")
                                        .splice(0, 2)
                                        .join(" ") || null;
                        }
                    }
                    return keys;
                })
                .catch(ex => { // not-covered: OS error
                    cockpit.warn("Failed to list public keys:", ex.toString()); // not-covered: OS error
                    return []; // not-covered: OS error
                });
    }

    function parse_keys(content, tag, ex) {
        last_tag = tag;

        if (ex)
            return process_failure(ex);

        if (!content)
            return update_keys([], tag);

        parse_pubkeys(content)
                .then(keys => update_keys(keys, tag));
    }

    self.add_key = function(key) {
        return parse_pubkeys(key)
                .then(keys => {
                    const obj = keys[0];
                    if (obj?.valid) {
                        return cockpit
                                .script(adder, [user_name, home_dir], { superuser: "try", err: "message" })
                                .input(obj.raw + "\n")
                                // eslint-disable-next-line prefer-promise-reject-errors
                                .catch(ex => Promise.reject(_("Error saving authorized keys: ") + ex)); // not-covered: OS error
                    } else {
                        return Promise.reject(_("The key you provided was not valid."));
                    }
                });
    };

    self.remove_key = function(key) {
        return file.modify(function(content) {
            let lines = null;
            const new_lines = [];

            if (!content)
                return "";

            lines = content.trim().split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i] === key)
                    key = undefined;
                else
                    new_lines.push(lines[i]);
            }
            return new_lines.join("\n");
        });
    };

    self.close = function() {
        if (watch)
            watch.remove();

        if (file)
            file.close();
    };

    file = cockpit.file(filename, { superuser: 'try' });
    watch = file.watch(parse_keys);
}

export function instance(user_name, home_dir) {
    return new AuthorizedKeys(user_name, home_dir);
}
