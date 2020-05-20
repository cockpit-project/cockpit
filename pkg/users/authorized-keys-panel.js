/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

import cockpit from 'cockpit';
import React, { useState, useEffect } from 'react';

import { Modal } from 'patternfly-react';
import { Button } from '@patternfly/react-core';
import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import { show_unexpected_error } from "./dialog-utils.js";
import * as authorized_keys from './authorized-keys.js';

const _ = cockpit.gettext;

function AddAuthorizedKeyDialogBody({ state, change }) {
    const { text } = state;

    return (
        <Modal.Body>
            <textarea id="authorized-keys-text"
                      placeholder={_("Paste the contents of your public SSH key file here")}
                      className="form-control"
                      value={text} onChange={event => change("text", event.target.value)} />
        </Modal.Body>);
}

function add_authorized_key_dialog(keys) {
    let dlg = null;
    const state = {
        text: ""
    };

    function change(field, value) {
        state[field] = value;
        update();
    }

    function update() {
        const props = {
            id: "add-authorized-key-dialog",
            title: _("Add public key"),
            body: <AddAuthorizedKeyDialogBody state={state} change={change} />
        };

        const footer = {
            actions: [
                {
                    caption: _("Add"),
                    style: "primary",
                    clicked: () => {
                        return keys.add_key(state.text);
                    }
                }
            ]
        };

        if (!dlg)
            dlg = show_modal_dialog(props, footer);
        else {
            dlg.setProps(props);
            dlg.setFooterProps(footer);
        }
    }

    update();
}

export function AuthorizedKeys({ name, home, allow_mods }) {
    const [manager, setManager] = useState(null);
    const [state, setState] = useState(null);
    const [keys, setKeys] = useState([]);

    useEffect(() => {
        const manager = authorized_keys.instance(name, home);
        setManager(manager);
        setState(manager.state);
        setKeys(manager.keys);
        manager.addEventListener("changed", () => {
            setState(manager.state);
            setKeys(manager.keys);
        });
        return () => {
            manager.close();
        };
    }, [name, home]);

    function remove_key(raw) {
        manager.remove_key(raw).catch(show_unexpected_error);
    }

    let key_items;

    if (state == "access-denied") {
        key_items = [
            <div key={state} className="list-group-item">
                <div className="fingerprint">
                    <span>{_("You do not have permission to view the authorized public keys for this account.")}</span>
                </div>
            </div>
        ];
    } else if (state == "failed") {
        key_items = [
            <div key={state} className="list-group-item">
                <div className="fingerprint">
                    <span>{_("Failed to load authorized keys.")}</span>
                </div>
            </div>
        ];
    } else if (state == "ready") {
        if (keys.length === 0) {
            key_items = [
                <div key="empty" className="list-group-item">
                    <div className="fingerprint">
                        <span>{_("There are no authorized public keys for this account.")}</span>
                    </div>
                </div>
            ];
        } else {
            key_items = keys.map(k =>
                <div key={k.raw} className="list-group-item">
                    <div className="comment">
                        { k.comment || <em>{_("Unnamed")}</em> }
                    </div>
                    <div className="fingerprint">
                        { k.fp || <span>{_("Invalid key")}</span> }
                    </div>
                    <div className="action">
                        { allow_mods &&
                        <Button variant="secondary" onClick={() => remove_key(k.raw)}
                                className="account-remove-key">
                            <span className="fa fa-minus" />
                        </Button>
                        }
                    </div>
                </div>);
        }
    } else
        return null;

    return (
        <div className="panel panel-default" id="account-authorized-keys">
            <div className="panel-heading">
                <div className="pull-right">
                    { allow_mods &&
                    <Button onClick={() => add_authorized_key_dialog(manager)}
                        id="authorized-key-add">
                        <span className="fa fa-plus" />
                    </Button>
                    }
                </div>
                <span>{_("Authorized Public SSH Keys")}</span>
            </div>
            <div className="list-group" id="account-authorized-keys-list">
                { key_items }
            </div>
        </div>);
}
