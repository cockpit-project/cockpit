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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit, { SpawnOptions } from "cockpit";

// @ts-expect-error: magic verbatim string import, not a JS module
import lister from "credentials-ssh-private-keys.sh";
// @ts-expect-error: magic verbatim string import, not a JS module
import remove_key from "credentials-ssh-remove-key.sh";

const _ = cockpit.gettext;

export interface Key {
    type: string;
    comment: string;
    data: string;
    name?: string;
    loaded?: boolean;
    agent_only?: boolean;
    size?: number | null;
    fingerprint?: string;
}

export class KeyLoadError extends Error {
    sent_password: boolean;

    constructor(sent_password: boolean, message: string) {
        super(message);
        this.sent_password = sent_password;
    }
}

export class Keys extends EventTarget {
    path: string | null = null;
    items: Record<string, Key> = { };

    #p_have_path: Promise<void>;

    constructor() {
        super();
        this.#p_have_path = cockpit.user()
                .then(user => {
                    this.path = user.home + '/.ssh';
                    this.#refresh();
                });
    }

    #proc: cockpit.Spawn<string> | null = null;
    #timeout: number | null = null;

    #refresh(): void {
        if (this.#proc || !this.path)
            return;

        if (this.#timeout)
            window.clearTimeout(this.#timeout);
        this.#timeout = null;

        this.#proc = cockpit.script(lister, [this.path], { err: "message" });
        this.#proc
                .then(data => this.#process(data))
                .catch(ex => console.warn("failed to list keys in home directory: " + ex.message))
                .finally(() => {
                    this.#proc = null;

                    if (!this.#timeout)
                        this.#timeout = window.setTimeout(() => this.#refresh(), 5000);
                });
    }

    #process(data: string): void {
        const blocks = data.split('\v');
        let key: Key | undefined;
        const items = { };

        /* First block is the data from ssh agent */
        blocks[0].trim().split("\n")
                .forEach(line => {
                    key = this.#parse_key(line, items);
                    if (key)
                        key.loaded = true;
                });

        /* Next come individual triples of blocks */
        blocks.slice(1).forEach((block, i) => {
            switch (i % 3) {
            case 0:
                key = this.#parse_key(block, items);
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
                    this.#parse_info(block, key);
                break;
            }
        });

        this.items = items;
        this.dispatchEvent(new CustomEvent("changed"));
    }

    #parse_key(line: string, items: Record<string, Key>): Key | undefined {
        const parts = line.trim().split(" ");
        let id;
        let type;
        let comment;

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
        if (key) {
            key.type = type;
            key.comment = comment;
            key.data = line;
        } else {
            key = items[id] = {
                type,
                comment,
                data: line,
            };
        }

        return key;
    }

    #parse_info(line: string, key: Key): void {
        const parts = line.trim().split(" ")
                .filter(n => !!n);

        key.size = parseInt(parts[0], 10);
        if (isNaN(key.size))
            key.size = null;

        key.fingerprint = parts[1];

        if (!key.name && parts[2] && parts[2].indexOf("/") !== -1)
            key.name = parts[2];
    }

    async #run_keygen(file: string, new_type: string | null, old_pass: string | null, new_pass: string): Promise<void> {
        const old_exps = [/.*Enter old passphrase: $/];
        const new_exps = [/.*Enter passphrase.*/, /.*Enter new passphrase.*/, /.*Enter same passphrase again: $/];
        const bad_exps = [/.*failed: passphrase is too short.*/];

        let buffer = "";
        let sent_new = false;
        let failure = _("No such file or directory");

        // Exactly one of new_type or old_pass must be given
        console.assert((new_type == null) != (old_pass == null));

        const cmd = ["ssh-keygen", "-f", file];
        if (new_type)
            cmd.push("-t", new_type);
        else
            cmd.push("-p");

        await this.#p_have_path;
        cockpit.assert(this.path);

        const proc = cockpit.spawn(cmd, { pty: true, environ: ["LC_ALL=C"], err: "out", directory: this.path });

        proc.stream(data => {
            buffer += data;
            if (old_pass && old_exps.some(exp => exp.test(buffer))) {
                buffer = "";
                failure = _("Old password not accepted");
                proc.input(old_pass + "\n", true);
                return;
            }

            if (new_exps.some(exp => exp.test(buffer))) {
                buffer = "";
                proc.input(new_pass + "\n", true);
                failure = _("Failed to change password");
                sent_new = true;
                return;
            }

            if (sent_new && bad_exps.some(exp => exp.test(buffer))) {
                failure = _("New password was not accepted");
            }
        });

        const timeout = window.setTimeout(() => {
            failure = _("Prompting via ssh-keygen timed out");
            proc.close("terminated");
        }, 10 * 1000);

        try {
            await proc;
        } catch (ex) {
            if (ex instanceof cockpit.ProcessError && ex.exit_status)
                throw new Error(failure);
            throw ex;
        } finally {
            window.clearInterval(timeout);
        }
    }

    async change(name: string, old_pass: string, new_pass: string): Promise<void> {
        await this.#run_keygen(name, null, old_pass, new_pass);
    }

    async create(name: string, type: string, new_pass: string): Promise<void> {
        // ensure ~/.ssh directory  exists
        await cockpit.script('dir=$(dirname "$1"); test -e "$dir" || mkdir -m 700 "$dir"', [name]);
        await this.#run_keygen(name, type, null, new_pass);
    }

    async get_pubkey(name: string): Promise<string> {
        return await cockpit.file(name + ".pub").read();
    }

    async load(name: string, password: string): Promise<void> {
        const ask_exp = /.*Enter passphrase for .*/;
        const perm_exp = /.*UNPROTECTED PRIVATE KEY FILE.*/;
        const bad_exp = /.*Bad passphrase.*/;

        let buffer = "";
        let output = "";
        let failure = _("Not a valid private key");
        let sent_password = false;

        await this.#p_have_path;
        cockpit.assert(this.path);

        const proc = cockpit.spawn(["ssh-add", name],
                                   { pty: true, environ: ["LC_ALL=C"], err: "out", directory: this.path });

        const timeout = window.setTimeout(() => {
            failure = _("Prompting via ssh-add timed out");
            proc.close("terminated");
        }, 10 * 1000);

        proc.stream(data => {
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
        });

        try {
            await proc;
            this.#refresh();
        } catch (error) {
            console.log(output);
            let ex: KeyLoadError | unknown;
            if (error instanceof cockpit.ProcessError && error.exit_status) {
                ex = new KeyLoadError(sent_password, failure);
            } else if (error instanceof Error) {
                ex = new KeyLoadError(sent_password, error.message);
            } else {
                ex = error;
            }
            throw ex;
        } finally {
            window.clearTimeout(timeout);
        }
    }

    async unload(key: Key): Promise<void> {
        await this.#p_have_path;
        cockpit.assert(this.path);

        const options: SpawnOptions & { binary?: false; } = { pty: true, err: "message", directory: this.path };

        if (key.name && !key.agent_only)
            await cockpit.spawn(["ssh-add", "-d", key.name], options);
        else
            await cockpit.script(remove_key, [key.data], options);

        this.#refresh();
    }

    close() {
        if (this.#proc)
            this.#proc.close();
        if (this.#timeout)
            window.clearTimeout(this.#timeout);
        this.#timeout = null;
    }
}

export function keys_instance() {
    return new Keys();
}
