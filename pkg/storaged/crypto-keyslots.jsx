/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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
import React from "react";

import { Card, CardActions, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { ClipboardCopy } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { DataList, DataListCell, DataListItem, DataListItemCells, DataListItemRow } from "@patternfly/react-core/dist/esm/components/DataList/index.js";
import { Text, TextContent, TextList, TextListItem, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { TextInput as TextInputPF } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { EditIcon, MinusIcon, PlusIcon } from "@patternfly/react-icons";

import sha1 from "js-sha1";
import sha256 from "js-sha256";
import stable_stringify from "json-stable-stringify-without-jsonify";
import { check_missing_packages, install_missing_packages, Enum as PkEnum } from "packagekit";

import {
    dialog_open,
    SelectOneRadio, TextInput, PassInput, Skip
} from "./dialog.jsx";
import { array_find, decode_filename, encode_filename, block_name, for_each_async } from "./utils.js";
import { fmt_to_fragments } from "utils.jsx";
import { StorageButton } from "./storage-controls.jsx";
import { parse_options, unparse_options } from "./format-dialog.jsx";
import { edit_config } from "./crypto-tab.jsx";

import clevis_luks_passphrase_sh from "raw-loader!./clevis-luks-passphrase.sh";

const _ = cockpit.gettext;

/* Tang advertisement utilities
 */

function get_tang_adv(url) {
    return cockpit.spawn(["curl", "-sSf", url + "/adv"], { err: "message" })
            .then(JSON.parse)
            .catch(error => {
                return Promise.reject(error.toString().replace(/^curl: \([0-9]+\) /, ""));
            });
}

function tang_adv_payload(adv) {
    return JSON.parse(cockpit.utf8_decoder().decode(cockpit.base64_decode(adv.payload)));
}

function jwk_b64_encode(bytes) {
    // Use the urlsafe character set, and strip the padding.
    return cockpit.base64_encode(bytes).replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, '');
}

function compute_thp(jwk) {
    const REQUIRED_ATTRS = {
        RSA: ['kty', 'p', 'd', 'q', 'dp', 'dq', 'qi', 'oth'],
        EC: ['kty', 'crv', 'x', 'y'],
        oct: ['kty', 'k'],
    };

    if (!jwk.kty)
        return "(no key type attribute=";
    if (!REQUIRED_ATTRS[jwk.kty])
        return cockpit.format("(unknown keytype $0)", jwk.kty);

    const req = REQUIRED_ATTRS[jwk.kty];
    const norm = { };
    req.forEach(k => { if (k in jwk) norm[k] = jwk[k]; });
    return {
        sha256: jwk_b64_encode(sha256.digest(stable_stringify(norm))),
        sha1: jwk_b64_encode(sha1.digest(stable_stringify(norm)))
    };
}

function compute_sigkey_thps(adv) {
    function is_signing_key(jwk) {
        if (!jwk.use && !jwk.key_ops)
            return true;
        if (jwk.use == "sig")
            return true;
        if (jwk.key_ops && jwk.key_ops.indexOf("verify") >= 0)
            return true;
        return false;
    }

    return adv.keys.filter(is_signing_key).map(compute_thp);
}

/* Clevis operations
 */

function clevis_add(block, pin, cfg, passphrase) {
    const dev = decode_filename(block.Device);
    return cockpit.spawn(["clevis", "luks", "bind", "-f", "-k", "-", "-d", dev, pin, JSON.stringify(cfg)],
                         { superuser: true, err: "message" }).input(passphrase);
}

function clevis_remove(block, key) {
    // clevis-luks-unbind needs a tty on stdin for some reason.
    return cockpit.spawn(["clevis", "luks", "unbind", "-d", decode_filename(block.Device), "-s", key.slot, "-f"],
                         { superuser: true, pty: true, err: "message" });
}

export function clevis_recover_passphrase(block, just_type) {
    const dev = decode_filename(block.Device);
    const args = [];
    if (just_type)
        args.push("--type");
    args.push(dev);
    return cockpit.script(clevis_luks_passphrase_sh, args,
                          { superuser: true, err: "message" })
            .then(output => output.trim());
}

function clevis_unlock(block) {
    const dev = decode_filename(block.Device);
    const clear_dev = "luks-" + block.IdUUID;
    return cockpit.spawn(["clevis", "luks", "unlock", "-d", dev, "-n", clear_dev],
                         { superuser: true });
}

export function unlock_with_type(client, block, passphrase, passphrase_type) {
    const crypto = client.blocks_crypto[block.path];
    if (passphrase)
        return crypto.Unlock(passphrase, {});
    else if (passphrase_type == "stored")
        return crypto.Unlock("", {});
    else if (passphrase_type == "clevis")
        return clevis_unlock(block);
    else {
        // This should always be caught and should never show up in the UI
        return Promise.reject(new Error("No passphrase"));
    }
}

/* Passphrase operations
 */

function passphrase_add(block, new_passphrase, old_passphrase) {
    const dev = decode_filename(block.Device);
    return cockpit.spawn(["cryptsetup", "luksAddKey", dev],
                         { superuser: true, err: "message" }).input(old_passphrase + "\n" + new_passphrase);
}

function passphrase_change(block, key, new_passphrase, old_passphrase) {
    const dev = decode_filename(block.Device);
    return cockpit.spawn(["cryptsetup", "luksChangeKey", dev, "--key-slot", key.slot.toString()],
                         { superuser: true, err: "message" }).input(old_passphrase + "\n" + new_passphrase + "\n");
}

function slot_remove(block, slot, passphrase) {
    const dev = decode_filename(block.Device);
    const opts = { superuser: true, err: "message" };
    const cmd = ["cryptsetup", "luksKillSlot", dev, slot.toString()];
    if (passphrase === false) {
        cmd.splice(2, 0, "-q");
        opts.pty = true;
    }

    const spawn = cockpit.spawn(cmd, opts);
    if (passphrase !== false)
        spawn.input(passphrase + "\n");

    return spawn;
}

function passphrase_test(block, passphrase) {
    const dev = decode_filename(block.Device);
    return (cockpit.spawn(["cryptsetup", "luksOpen", "--test-passphrase", dev],
                          { superuser: true, err: "message" }).input(passphrase)
            .then(() => true)
            .catch(() => false));
}

/* Dialogs
 */

export function existing_passphrase_fields(explanation) {
    return [
        Skip("medskip", { visible: vals => vals.needs_explicit_passphrase }),
        PassInput("passphrase", _("Disk passphrase"),
                  {
                      visible: vals => vals.needs_explicit_passphrase,
                      validate: val => !val.length && _("Passphrase cannot be empty"),
                      explanation
                  })
    ];
}

function get_stored_passphrase(block, just_type) {
    const pub_config = array_find(block.Configuration, function (c) { return c[0] == "crypttab" });
    if (pub_config && pub_config[1]["passphrase-path"] && decode_filename(pub_config[1]["passphrase-path"].v) != "") {
        if (just_type)
            return Promise.resolve("stored");
        return block.GetSecretConfiguration({}).then(function (items) {
            for (let i = 0; i < items.length; i++) {
                if (items[i][0] == 'crypttab' && items[i][1]['passphrase-contents'])
                    return decode_filename(items[i][1]['passphrase-contents'].v);
            }
            return "";
        });
    }
}

export function get_existing_passphrase(block, just_type) {
    return clevis_recover_passphrase(block, just_type).then(passphrase => {
        return passphrase || get_stored_passphrase(block, just_type);
    });
}

export function request_passphrase_on_error_handler(dlg, vals, recovered_passphrase, block) {
    return function (error) {
        if (vals.passphrase === undefined) {
            return (passphrase_test(block, recovered_passphrase)
                    .then(good => {
                        if (!good)
                            dlg.set_values({ needs_explicit_passphrase: true });
                        return Promise.reject(error);
                    }));
        } else
            return Promise.reject(error);
    };
}

export function init_existing_passphrase(block, just_type, callback) {
    return {
        title: _("Unlocking disk"),
        func: dlg => {
            return get_existing_passphrase(block, just_type).then(passphrase => {
                if (!passphrase)
                    dlg.set_values({ needs_explicit_passphrase: true });
                if (callback)
                    callback(passphrase);
                return passphrase;
            });
        }
    };
}

/* Getting the system ready for NBDE on the root filesystem.

   We need the clevis module in the initrd.  If it is not there, the
   clevis-dracut package should be installed and the initrd needs to
   be regenerated.  We do this only after the user has agreed to it.

   The kernel command line needs to have rd.neednet=1 in it.  We just
   do this unconditionally because it's so fast.
*/

function ensure_package_installed(steps, progress, package_name) {
    function status_callback(progress) {
        return p => {
            let text = null;
            if (p.waiting) {
                text = _("Waiting for other software management operations to finish");
            } else if (p.package) {
                let fmt;
                if (p.info == PkEnum.INFO_DOWNLOADING)
                    fmt = _("Downloading $0");
                else if (p.info == PkEnum.INFO_REMOVING)
                    fmt = _("Removing $0");
                else
                    fmt = _("Installing $0");
                text = cockpit.format(fmt, p.package);
            }
            progress(text, p.cancel);
        };
    }

    progress(cockpit.format(_("Checking for $0 package"), package_name), null);
    return check_missing_packages([package_name], null)
            .then(data => {
                progress(null, null);
                if (data.missing_names.length + data.unavailable_names.length > 0)
                    steps.push({
                        title: cockpit.format(_("The $0 package must be installed."), package_name),
                        func: progress => {
                            if (data.remove_names.length > 0)
                                return Promise.reject(cockpit.format(_("Installing $0 would remove $1."), name, data.remove_names[0]));
                            else if (data.unavailable_names.length > 0)
                                return Promise.reject(cockpit.format(_("The $0 package is not available from any repository."), name));
                            else
                                return install_missing_packages(data, status_callback(progress));
                        }
                    });
            });
}

function ensure_initrd_clevis_support(steps, progress, package_name) {
    const task = cockpit.spawn(["lsinitrd", "-m"], { superuser: true, err: "message" });
    progress(_("Checking for NBDE support in the initrd"), () => task.close());
    return task.then(data => {
        progress(null, null);
        if (data.indexOf("clevis") < 0) {
            return ensure_package_installed(steps, progress, package_name)
                    .then(() => {
                        steps.push({
                            title: _("The initrd must be regenerated."),
                            func: progress => {
                                // dracut doesn't react to SIGINT, so let's not enable our Cancel button
                                progress(_("Regenerating initrd"), null);
                                return cockpit.spawn(["dracut", "--force", "--regenerate-all"],
                                                     { superuser: true, err: "message" });
                            }
                        });
                    });
        }
    });
}

function ensure_root_nbde_support(steps, progress) {
    progress(_("Adding rd.neednet=1 to kernel command line"), null);
    return cockpit.spawn(["grubby", "--update-kernel=ALL", "--args=rd.neednet=1"],
                         { superuser: true, err: "message" })
            .then(() => ensure_initrd_clevis_support(steps, progress, "clevis-dracut"));
}

function ensure_fstab_option(steps, progress, client, block, option) {
    const cleartext = client.blocks_cleartext[block.path];
    const crypto = client.blocks_crypto[block.path];
    const fsys_config = (cleartext
        ? array_find(cleartext.Configuration, function (c) { return c[0] == "fstab" })
        : array_find(crypto.ChildConfiguration, function (c) { return c[0] == "fstab" }));
    const fsys_options = fsys_config && parse_options(decode_filename(fsys_config[1].opts.v));

    if (!fsys_options || fsys_options.indexOf(option) >= 0)
        return Promise.resolve();

    const new_fsys_options = fsys_options.concat([option]);
    const new_fsys_config = [
        "fstab",
        Object.assign({ }, fsys_config[1],
                      {
                          opts: {
                              t: 'ay',
                              v: encode_filename(unparse_options(new_fsys_options))
                          }
                      })
    ];
    progress(cockpit.format(_("Adding \"$0\" to filesystem options"), option), null);
    return block.UpdateConfigurationItem(fsys_config, new_fsys_config, { });
}

function ensure_crypto_option(steps, progress, client, block, option) {
    const crypto_config = array_find(block.Configuration, function (c) { return c[0] == "crypttab" });
    const crypto_options = crypto_config && parse_options(decode_filename(crypto_config[1].options.v));
    if (!crypto_options || crypto_options.indexOf(option) >= 0)
        return Promise.resolve();

    const new_crypto_options = crypto_options.concat([option]);
    progress(cockpit.format(_("Adding \"$0\" to encryption options"), option), null);
    return edit_config(block, (config, commit) => {
        config.options = { t: 'ay', v: encode_filename(unparse_options(new_crypto_options)) };
        return commit();
    });
}

function ensure_systemd_unit_enabled(steps, progress, name, package_name) {
    progress(cockpit.format(_("Enabling $0"), name));
    return cockpit.spawn(["systemctl", "is-enabled", name], { err: "message" })
            .catch((err, output) => {
                if (err && (output == "" || output.trim() == "not-found") && package_name) {
                    // We assume that installing the package will enable the unit.
                    return ensure_package_installed(steps, progress, package_name);
                } else
                    return cockpit.spawn(["systemctl", "enable", name],
                                         { superuser: true, err: "message" });
            });
}

function ensure_non_root_nbde_support(steps, progress, client, block) {
    return ensure_systemd_unit_enabled(steps, progress, "remote-cryptsetup.target")
            .then(() => ensure_systemd_unit_enabled(steps, progress, "clevis-luks-askpass.path", "clevis-systemd"))
            .then(() => ensure_fstab_option(steps, progress, client, block, "_netdev"))
            .then(() => ensure_crypto_option(steps, progress, client, block, "_netdev"));
}

function ensure_nbde_support(steps, progress, client, block) {
    const cleartext = client.blocks_cleartext[block.path];
    const crypto = client.blocks_crypto[block.path];
    const fsys_config = (cleartext
        ? array_find(cleartext.Configuration, function (c) { return c[0] == "fstab" })
        : array_find(crypto.ChildConfiguration, function (c) { return c[0] == "fstab" }));
    const dir = decode_filename(fsys_config[1].dir.v);

    if (dir == "/") {
        if (client.get_config("nbde_root_help", false)) {
            steps.is_root = true;
            return ensure_root_nbde_support(steps, progress);
        } else
            return Promise.resolve();
    } else
        return ensure_non_root_nbde_support(steps, progress, client, block);
}

function ensure_nbde_support_dialog(steps, client, block, url, adv, old_key, existing_passphrase) {
    const dlg = dialog_open({
        Title: _("Add Network Bound Disk Encryption"),
        Body: (
            <TextContent>
                <Text compmonent={TextVariants.p}>
                    { steps.is_root
                        ? _("The system does not currently support unlocking the root filesystem with a Tang keyserver.")
                        : _("The system does not currently support unlocking a filesystem with a Tang keyserver during boot.")
                    }
                </Text>
                <Text compmonent={TextVariants.p}>
                    {_("These additional steps are necessary:")}
                </Text>
                <TextList>
                    { steps.map((s, i) => <TextListItem key={i}>{s.title}</TextListItem>) }
                </TextList>
            </TextContent>),
        Fields: existing_passphrase_fields(_("Saving a new passphrase requires unlocking the disk. Please provide a current disk passphrase.")),
        Action: {
            Title: _("Fix NBDE support"),
            action: (vals, progress) => {
                return for_each_async(steps, s => s.func(progress))
                        .then(() => {
                            steps = [];
                            progress(_("Adding key"), null);
                            return add_or_update_tang(dlg, vals, block,
                                                      url, adv, old_key,
                                                      vals.passphrase || existing_passphrase);
                        });
            }
        }
    });
}

function parse_url(url) {
    // clevis-encrypt-tang defaults to "http://" (via curl), so we do the same here.
    if (!/^[a-zA-Z]+:\/\//.test(url))
        url = "http://" + url;
    try {
        return new URL(url);
    } catch (e) {
        if (e instanceof TypeError)
            return null;
        throw e;
    }
}

function validate_url(url) {
    if (url.length === 0)
        return _("Address cannot be empty");
    if (!parse_url(url))
        return _("Address is not a valid URL");
}

function add_dialog(client, block) {
    let recovered_passphrase;

    dialog_open({
        Title: _("Add key"),
        Fields: [
            SelectOneRadio("type", _("Key source"),
                           {
                               value: "luks-passphrase",
                               visible: vals => client.features.clevis,
                               widest_title: _("Repeat passphrase"),
                               choices: [
                                   { value: "luks-passphrase", title: _("Passphrase") },
                                   { value: "tang", title: _("Tang keyserver") }
                               ]
                           }),
            Skip("medskip"),
            PassInput("new_passphrase", _("New passphrase"),
                      {
                          visible: vals => !client.features.clevis || vals.type == "luks-passphrase",
                          validate: val => !val.length && _("Passphrase cannot be empty"),
                      }),
            PassInput("new_passphrase2", _("Repeat passphrase"),
                      {
                          visible: vals => !client.features.clevis || vals.type == "luks-passphrase",
                          validate: (val, vals) => {
                              return (vals.new_passphrase.length &&
                                                        vals.new_passphrase != val &&
                                                        _("Passphrases do not match"));
                          }
                      }),
            TextInput("tang_url", _("Keyserver address"),
                      {
                          visible: vals => client.features.clevis && vals.type == "tang",
                          validate: validate_url
                      })
        ].concat(existing_passphrase_fields(_("Saving a new passphrase requires unlocking the disk. Please provide a current disk passphrase."))),
        Action: {
            Title: _("Add"),
            action: function (vals, progress) {
                const existing_passphrase = vals.passphrase || recovered_passphrase;
                if (!client.features.clevis || vals.type == "luks-passphrase") {
                    return passphrase_add(block, vals.new_passphrase, existing_passphrase);
                } else {
                    return get_tang_adv(vals.tang_url)
                            .then(adv => {
                                edit_tang_adv(client, block, null,
                                              vals.tang_url, adv, existing_passphrase);
                            });
                }
            }
        },
        Inits: [
            init_existing_passphrase(block, false, pp => { recovered_passphrase = pp })
        ]
    });
}

function edit_passphrase_dialog(block, key) {
    dialog_open({
        Title: _("Change passphrase"),
        Fields: [
            PassInput("old_passphrase", _("Old passphrase"),
                      { validate: val => !val.length && _("Passphrase cannot be empty") }),
            Skip("medskip"),
            PassInput("new_passphrase", _("New passphrase"),
                      { validate: val => !val.length && _("Passphrase cannot be empty") }),
            PassInput("new_passphrase2", _("Repeat passphrase"),
                      { validate: (val, vals) => vals.new_passphrase.length && vals.new_passphrase != val && _("Passphrases do not match") })
        ],
        Action: {
            Title: _("Save"),
            action: vals => passphrase_change(block, key, vals.new_passphrase, vals.old_passphrase)
        }
    });
}

function edit_clevis_dialog(client, block, key) {
    let recovered_passphrase;

    dialog_open({
        Title: _("Edit Tang keyserver"),
        Fields: [
            TextInput("tang_url", _("Keyserver address"),
                      {
                          validate: validate_url,
                          value: key.url
                      })
        ].concat(existing_passphrase_fields(_("Saving a new passphrase requires unlocking the disk. Please provide a current disk passphrase."))),
        Action: {
            Title: _("Save"),
            action: function (vals) {
                const existing_passphrase = vals.passphrase || recovered_passphrase;
                return get_tang_adv(vals.tang_url).then(adv => {
                    edit_tang_adv(client, block, key, vals.tang_url, adv, existing_passphrase);
                });
            }
        },
        Inits: [
            init_existing_passphrase(block, false, pp => { recovered_passphrase = pp })
        ]
    });
}

function add_or_update_tang(dlg, vals, block, url, adv, old_key, passphrase) {
    return clevis_add(block, "tang", { url, adv }, vals.passphrase || passphrase).then(() => {
        if (old_key)
            return clevis_remove(block, old_key);
    })
            .catch(request_passphrase_on_error_handler(dlg, vals, passphrase, block));
}

function edit_tang_adv(client, block, key, url, adv, passphrase) {
    const parsed = parse_url(url);
    const cmd = cockpit.format("ssh $0 tang-show-keys $1", parsed.hostname, parsed.port);

    const sigkey_thps = compute_sigkey_thps(tang_adv_payload(adv));

    const dlg = dialog_open({
        Title: _("Verify key"),
        Body: (
            <>
                <p>{_("Make sure the key hash from the Tang server matches one of the following:")}</p>

                <h2 className="sigkey-heading">{_("SHA256")}</h2>
                { sigkey_thps.map(s => <p key={s} className="sigkey-hash">{s.sha256}</p>) }

                <h2 className="sigkey-heading">{_("SHA1")}</h2>
                { sigkey_thps.map(s => <p key={s} className="sigkey-hash">{s.sha1}</p>) }

                <p>
                    {_("Manually check with SSH: ")}
                    <ClipboardCopy hoverTip={_("Copy to clipboard")}
                                   clickTip={_("Successfully copied to clipboard!")}
                                   variant="inline-compact"
                                   isCode>
                        {cmd}
                    </ClipboardCopy>
                </p>
            </>
        ),
        Fields: existing_passphrase_fields(_("Saving a new passphrase requires unlocking the disk. Please provide a current disk passphrase.")),
        Action: {
            Title: _("Trust key"),
            action: function (vals, progress) {
                if (key) {
                    return add_or_update_tang(dlg, vals, block,
                                              url, adv, key,
                                              passphrase);
                } else {
                    const steps = [];
                    return ensure_nbde_support(steps, progress, client, block)
                            .then(() => {
                                if (steps.length > 0)
                                    ensure_nbde_support_dialog(steps, client, block, url,
                                                               adv, key, passphrase);
                                else {
                                    progress(null, null);
                                    return add_or_update_tang(dlg, vals, block,
                                                              url, adv, key,
                                                              passphrase);
                                }
                            });
                }
            }
        }
    });
}

const RemovePassphraseField = (tag, key, dev) => {
    function validate(val) {
        if (val === "")
            return _("Passphrase can not be empty");
    }

    return {
        tag,
        title: null,
        options: { validate },
        initial_value: "",
        bare: true,

        render: (val, change, validated, error) => {
            return (
                <Stack hasGutter>
                    <p>{ fmt_to_fragments(_("Passphrase removal may prevent unlocking $0."), <b>{dev}</b>) }</p>
                    <Form>
                        <Checkbox id="force-remove-passphrase"
                                  isChecked={val !== false}
                                  label={_("Confirm removal with an alternate passphrase")}
                                  onChange={checked => change(checked ? "" : false)}
                                  body={val === false
                                      ? <p className="slot-warning">
                                          {_("Removing a passphrase without confirmation of another passphrase may prevent unlocking or key management, if other passphrases are forgotten or lost.")}
                                      </p>
                                      : <FormGroup label={_("Passphrase from any other key slot")} fieldId="remove-passphrase">
                                          <TextInputPF id="remove-passphrase" type="password" value={val} onChange={value => change(value)} />
                                      </FormGroup>
                                  }
                        />
                    </Form>
                </Stack>
            );
        }
    };
};

function remove_passphrase_dialog(block, key) {
    dialog_open({
        Title: cockpit.format(_("Remove passphrase in key slot $0?"), key.slot),
        Fields: [
            RemovePassphraseField("passphrase", key, block_name(block))
        ],
        isFormHorizontal: false,
        Action: {
            DangerButton: true,
            Title: _("Remove"),
            action: function (vals) {
                return slot_remove(block, key.slot, vals.passphrase);
            }
        }
    });
}

const RemoveClevisField = (tag, key, dev) => {
    return {
        tag,
        title: null,
        options: { },
        initial_value: "",
        bare: true,

        render: (val, change) => {
            return (
                <div data-field={tag}>
                    <p>{ fmt_to_fragments(_("Remove $0?"), <b>{key.url}</b>) }</p>
                    <p className="slot-warning">{ fmt_to_fragments(_("Keyserver removal may prevent unlocking $0."), <b>{dev}</b>) }</p>
                </div>
            );
        }
    };
};

function remove_clevis_dialog(client, block, key) {
    dialog_open({
        Title: _("Remove Tang keyserver?"),
        Fields: [
            RemoveClevisField("keyserver", key, block_name(block))
        ],
        Action: {
            DangerButton: true,
            Title: _("Remove"),
            action: function () {
                return clevis_remove(block, key);
            }
        }
    });
}

export class CryptoKeyslots extends React.Component {
    render() {
        const { client, block, slots, slot_error, max_slots } = this.props;

        if ((slots == null && slot_error == null) || slot_error == "not-found")
            return null;

        function decode_clevis_slot(slot) {
            if (slot.ClevisConfig) {
                const clevis = JSON.parse(slot.ClevisConfig.v);
                if (clevis.pin && clevis.pin == "tang" && clevis.tang) {
                    return {
                        slot: slot.Index.v,
                        type: "tang",
                        url: clevis.tang.url
                    };
                } else {
                    return {
                        slot: slot.Index.v,
                        type: "unknown",
                        pin: clevis.pin
                    };
                }
            } else {
                return {
                    slot: slot.Index.v,
                    type: "luks-passphrase"
                };
            }
        }

        const keys = slots ? slots.map(decode_clevis_slot).filter(k => !!k) : [];

        let rows;
        if (keys.length == 0) {
            let text;
            if (slot_error) {
                if (slot_error.problem == "access-denied")
                    text = _("The currently logged in user is not permitted to see information about keys.");
                else
                    text = slot_error.toString();
            } else {
                text = _("No keys added");
            }
            rows = <tr><td className="text-center">{text}</td></tr>;
        } else {
            rows = [];

            const add_row = (slot, type, desc, edit, edit_excuse, remove) => {
                rows.push(
                    <DataListItem key={slot}>
                        <DataListItemRow>
                            <DataListItemCells
                                dataListCells={[
                                    <DataListCell key="key-type">
                                        { type }
                                    </DataListCell>,
                                    <DataListCell key="desc" isFilled={false}>
                                        { desc }
                                    </DataListCell>,
                                    <DataListCell key="key-slot">
                                        { cockpit.format(_("Slot $0"), slot) }
                                    </DataListCell>,
                                    <DataListCell key="text-right" isFilled={false} alignRight>
                                        <StorageButton onClick={edit}
                                                       ariaLabel={_("Edit")}
                                                       excuse={(keys.length == max_slots)
                                                           ? _("Editing a key requires a free slot")
                                                           : null}>
                                            <EditIcon />
                                        </StorageButton>
                                        { "\n" }
                                        <StorageButton onClick={remove}
                                                       ariaLabel={_("Remove")}
                                                       excuse={keys.length == 1 ? _("The last key slot can not be removed") : null}>
                                            <MinusIcon />
                                        </StorageButton>
                                    </DataListCell>,
                                ]}
                            />
                        </DataListItemRow>
                    </DataListItem>
                );
            };

            keys.sort((a, b) => a.slot - b.slot).forEach(key => {
                if (key.type == "luks-passphrase") {
                    add_row(key.slot,
                            _("Passphrase"), "",
                            () => edit_passphrase_dialog(block, key), null,
                            () => remove_passphrase_dialog(block, key));
                } else if (key.type == "tang") {
                    add_row(key.slot,
                            _("Keyserver"), key.url,
                            () => edit_clevis_dialog(client, block, key), null,
                            () => remove_clevis_dialog(client, block, key));
                } else {
                    add_row(key.slot,
                            _("Unknown type"), "",
                            null, _("Key slots with unknown types can not be edited here"),
                            () => remove_clevis_dialog(client, block, key));
                }
            });
        }

        const remaining = max_slots - keys.length;

        return (
            <Card className="key-slot-panel">
                <CardHeader>
                    <CardActions>
                        <span className="key-slot-panel-remaining">
                            { remaining < 6 ? (remaining ? cockpit.format(cockpit.ngettext("$0 slot remains", "$0 slots remain", remaining), remaining) : _("No available slots")) : null }
                        </span>
                        <StorageButton onClick={() => add_dialog(client, block)}
                                       ariaLabel={_("Add")}
                                       excuse={(keys.length == max_slots)
                                           ? _("No free key slots")
                                           : null}>
                            <PlusIcon />
                        </StorageButton>
                    </CardActions>
                    <CardTitle><Text component={TextVariants.h2}>{_("Keys")}</Text></CardTitle>
                </CardHeader>
                <CardBody className="contains-list">
                    <DataList isCompact className="crypto-keyslots-list" aria-label={_("Keys")}>
                        {rows}
                    </DataList>
                </CardBody>
            </Card>
        );
    }
}
