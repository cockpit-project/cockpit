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

import {
    Card, CardBody, CardTitle, CardHeader, CardActions, Checkbox,
    Form, FormGroup,
    DataListItem, DataListItemRow, DataListItemCells, DataListCell, DataList,
    Text, TextVariants, TextInput as TextInputPF, Stack,
} from "@patternfly/react-core";
import { EditIcon, MinusIcon, PlusIcon, ExclamationTriangleIcon } from "@patternfly/react-icons";

import sha1 from "js-sha1";
import sha256 from "js-sha256";
import stable_stringify from "json-stable-stringify-without-jsonify";

import {
    dialog_open,
    SelectOneRadio, TextInput, PassInput, Skip
} from "./dialog.jsx";
import { array_find, decode_filename, block_name } from "./utils.js";
import { fmt_to_fragments } from "./utilsx.jsx";
import { StorageButton } from "./storage-controls.jsx";

import clevis_luks_passphrase_sh from "raw-loader!./clevis-luks-passphrase.sh";

const _ = cockpit.gettext;

/* Tang advertisement utilities
 */

function get_tang_adv(url) {
    return cockpit.spawn(["curl", "-sSf", url + "/adv"], { err: "message" })
            .then(JSON.parse)
            .catch(error => {
                return cockpit.reject(error.toString().replace(/^curl: \([0-9]+\) /, ""));
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
    var REQUIRED_ATTRS = {
        RSA: ['kty', 'p', 'd', 'q', 'dp', 'dq', 'qi', 'oth'],
        EC:  ['kty', 'crv', 'x', 'y'],
        oct: ['kty', 'k'],
    };

    if (!jwk.kty)
        return "(no key type attribute=";
    if (!REQUIRED_ATTRS[jwk.kty])
        return cockpit.format("(unknown keytype $0)", jwk.kty);

    var req = REQUIRED_ATTRS[jwk.kty];
    var norm = { };
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
    var dev = decode_filename(block.Device);
    return cockpit.spawn(["clevis", "luks", "bind", "-f", "-k", "-", "-d", dev, pin, JSON.stringify(cfg)],
                         { superuser: true, err: "message" }).input(passphrase);
}

function clevis_remove(block, key) {
    // clevis-luks-unbind needs a tty on stdin for some reason.
    return cockpit.spawn(["clevis", "luks", "unbind", "-d", decode_filename(block.Device), "-s", key.slot, "-f"],
                         { superuser: true, pty: true, err: "message" });
}

export function clevis_recover_passphrase(block, just_type) {
    var dev = decode_filename(block.Device);
    var args = [];
    if (just_type)
        args.push("--type");
    args.push(dev);
    return cockpit.script(clevis_luks_passphrase_sh, args,
                          { superuser: true, err: "message" })
            .then(output => output.trim());
}

export function clevis_unlock(block) {
    var dev = decode_filename(block.Device);
    var clear_dev = "luks-" + block.IdUUID;
    return cockpit.spawn(["clevis", "luks", "unlock", "-d", dev, "-n", clear_dev],
                         { superuser: true })
            .catch(() => {
            // HACK - https://github.com/latchset/clevis/issues/36
            // Clevis-luks-unlock before version 10 always exit 1, so
            // we check whether the expected device exists afterwards.
                return cockpit.spawn(["test", "-e", "/dev/mapper/" + clear_dev],
                                     { superuser: true });
            });
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
    var dev = decode_filename(block.Device);
    return cockpit.spawn(["cryptsetup", "luksAddKey", dev],
                         { superuser: true, err: "message" }).input(old_passphrase + "\n" + new_passphrase);
}

function passphrase_change(block, key, new_passphrase, old_passphrase) {
    var dev = decode_filename(block.Device);
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
    var dev = decode_filename(block.Device);
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
                      explanation: explanation
                  })
    ];
}

function get_stored_passphrase(block, just_type) {
    const pub_config = array_find(block.Configuration, function (c) { return c[0] == "crypttab" });
    if (pub_config && pub_config[1]["passphrase-path"] && decode_filename(pub_config[1]["passphrase-path"].v) != "") {
        if (just_type)
            return Promise.resolve("stored");
        return block.GetSecretConfiguration({}).then(function (items) {
            for (var i = 0; i < items.length; i++) {
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

export function get_existing_passphrase_for_dialog(dlg, block, just_type) {
    const prom = get_existing_passphrase(block, just_type).then(passphrase => {
        if (!passphrase)
            dlg.set_values({ needs_explicit_passphrase: true });
        return passphrase;
    });

    dlg.run(_("Unlocking disk..."), prom);
    return prom;
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

function parse_url(url) {
    // clevis-encrypt-tang defaults to "http://" (via curl), so we do the same here.
    if (!RegExp("^[a-zA-Z]+://").test(url))
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

    const dlg = dialog_open({
        Title: _("Add key"),
        Fields: [
            SelectOneRadio("type", _("Key source"),
                           {
                               value: "tang",
                               widest_title: _("Repeat passphrase"),
                               choices: [
                                   { value: "luks-passphrase", title: _("Passphrase") },
                                   { value: "tang", title: _("Tang keyserver") }
                               ]
                           }),
            Skip("medskip"),
            PassInput("new_passphrase", _("New passphrase"),
                      {
                          visible: vals => vals.type == "luks-passphrase",
                          validate: val => !val.length && _("Passphrase cannot be empty"),
                      }),
            PassInput("new_passphrase2", _("Repeat passphrase"),
                      {
                          visible: vals => vals.type == "luks-passphrase",
                          validate: (val, vals) => {
                              return (vals.new_passphrase.length &&
                                                        vals.new_passphrase != val &&
                                                        _("Passphrases do not match"));
                          }
                      }),
            TextInput("tang_url", _("Keyserver address"),
                      {
                          visible: vals => vals.type == "tang",
                          validate: validate_url
                      })
        ].concat(existing_passphrase_fields(_("Saving a new passphrase requires unlocking the disk. Please provide a current disk passphrase."))),
        Action: {
            Title: _("Add"),
            action: function (vals) {
                const existing_passphrase = vals.passphrase || recovered_passphrase;
                if (vals.type == "luks-passphrase") {
                    return passphrase_add(block, vals.new_passphrase, existing_passphrase);
                } else {
                    return get_tang_adv(vals.tang_url).then(function (adv) {
                        edit_tang_adv(client, block, null,
                                      vals.tang_url, adv, existing_passphrase);
                    });
                }
            }
        }
    });

    get_existing_passphrase_for_dialog(dlg, block).then(pp => { recovered_passphrase = pp });
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

    const dlg = dialog_open({
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
        }
    });

    get_existing_passphrase_for_dialog(dlg, block).then(pp => { recovered_passphrase = pp });
}

function edit_tang_adv(client, block, key, url, adv, passphrase) {
    var parsed = parse_url(url);
    var cmd = cockpit.format("ssh $0 tang-show-keys $1", parsed.hostname, parsed.port);

    var sigkey_thps = compute_sigkey_thps(tang_adv_payload(adv));

    const dlg = dialog_open({
        Title: _("Verify key"),
        Body: (
            <div>
                <div>{_("Make sure the key hash from the Tang server matches one of the following:")}</div>
                <br />
                <div>{_("SHA256")}</div>
                { sigkey_thps.map(s => <div key={s} className="sigkey-hash">{s.sha256}</div>) }
                <br />
                <div>{_("SHA1")}</div>
                { sigkey_thps.map(s => <div key={s} className="sigkey-hash">{s.sha1}</div>) }
                <br />
                <div>{_("Manually check with SSH: ")}<pre className="inline-pre">{cmd}</pre></div>
            </div>
        ),
        Fields: existing_passphrase_fields(_("Saving a new passphrase requires unlocking the disk. Please provide a current disk passphrase.")),
        Action: {
            Title: _("Trust key"),
            action: function (vals) {
                return clevis_add(block, "tang", { url: url, adv: adv }, vals.passphrase || passphrase).then(() => {
                    if (key)
                        return clevis_remove(block, key);
                })
                        .catch(request_passphrase_on_error_handler(dlg, vals, passphrase, block));
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
        tag: tag,
        title: null,
        options: { validate: validate },
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
        Title: <><ExclamationTriangleIcon className="ct-icon-exclamation-triangle" /> {cockpit.format(_("Remove passphrase in key slot $0"), key.slot)}</>,
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
        tag: tag,
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
        Title: <><ExclamationTriangleIcon className="ct-icon-exclamation-triangle" /> {_("Remove Tang keyserver")}</>,
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
        var { client, block, slots, slot_error, max_slots } = this.props;

        if (!client.features.clevis)
            return null;

        if ((slots == null && slot_error == null) || slot_error == "not-found")
            return null;

        function decode_clevis_slot(slot) {
            if (slot.ClevisConfig) {
                var clevis = JSON.parse(slot.ClevisConfig.v);
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

        var keys = slots.map(decode_clevis_slot).filter(k => !!k);

        var rows;
        if (keys.length == 0) {
            var text;
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

            var add_row = (slot, type, desc, edit, edit_excuse, remove) => {
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
