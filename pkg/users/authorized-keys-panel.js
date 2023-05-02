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
import React, { useState } from 'react';
import { useObject, useEvent } from 'hooks.js';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Dropdown, KebabToggle } from '@patternfly/react-core/dist/esm/deprecated/components/Dropdown/index.js';
import { OverflowMenu, OverflowMenuContent, OverflowMenuControl, OverflowMenuDropdownItem, OverflowMenuGroup, OverflowMenuItem } from "@patternfly/react-core/dist/esm/components/OverflowMenu/index.js";
import { TextArea } from "@patternfly/react-core/dist/esm/components/TextArea/index.js";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import { ListingTable } from 'cockpit-components-table.jsx';
import { show_unexpected_error } from "./dialog-utils.js";
import * as authorized_keys from './authorized-keys.js';

const _ = cockpit.gettext;

function AddAuthorizedKeyDialogBody({ state, change }) {
    const { text } = state;

    return (
        <TextArea id="authorized-keys-text"
                  placeholder={_("Paste the contents of your public SSH key file here")}
                  className="form-control"
                  value={text} onChange={value => change("text", value)} />
    );
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
    const manager = useObject(() => authorized_keys.instance(name, home),
                              manager => manager.close(),
                              [name, home]);
    useEvent(manager, "changed");
    const [openedMenu, setOpenedMenu] = useState([]);

    function remove_key(raw) {
        manager.remove_key(raw).catch(show_unexpected_error);
    }

    const { state, keys } = manager;
    let error = "";

    if (state == "access-denied")
        error = _("You do not have permission to view the authorized public keys for this account.");
    else if (state == "failed")
        error = _("Failed to load authorized keys.");
    else if (state == "ready")
        error = _("There are no authorized public keys for this account.");
    else
        return null;

    const actions = allow_mods && (
        <Button variant="secondary" id="authorized-key-add" onClick={() => add_authorized_key_dialog(manager)}>
            {_("Add key")}
        </Button>
    );

    return (
        <Card id="account-authorized-keys">
            <CardHeader actions={{ actions }}>
                <CardTitle component="h2">{_("Authorized public SSH keys")}</CardTitle>
            </CardHeader>
            <ListingTable
                aria-label={ _("Authorized public SSH keys") }
                id="account-authorized-keys-list"
                showHeader={false}
                emptyCaption={error}
                columns={ [
                    { title: _("Name"), header: true },
                    { title: _("Fingerprint") },
                    { title: "" },
                ] }
                rows={keys.map(k => {
                    return {
                        columns: [
                            { title: k.comment || _("Unnamed"), props: { width: 20 } },
                            { title: k.fp || _("Invalid key"), props: { width: 80 } },
                            {
                                title: <OverflowMenu breakpoint="lg">
                                    <OverflowMenuContent>
                                        <OverflowMenuGroup groupType="button">
                                            <OverflowMenuItem>
                                                <Button key={k.fp} variant="secondary" onClick={() => remove_key(k.raw)}>
                                                    {_("Remove")}
                                                </Button>
                                            </OverflowMenuItem>
                                        </OverflowMenuGroup>
                                    </OverflowMenuContent>
                                    <OverflowMenuControl>
                                        <Dropdown position="right"
                                                  onSelect={() => {
                                                      if (openedMenu.indexOf(k.fp) >= 0)
                                                          setOpenedMenu(openedMenu.filter(m => m !== k.fp));
                                                      else
                                                          setOpenedMenu([...openedMenu, k.fp]);
                                                  }}
                                                  toggle={
                                                      <KebabToggle
                                                      onToggle={(_event, open) => {
                                                          if (open)
                                                              setOpenedMenu([...openedMenu, k.fp]);
                                                          else
                                                              setOpenedMenu(openedMenu.filter(m => m !== k.fp));
                                                      }}
                                                      />
                                                  }
                                                  isOpen={openedMenu.indexOf(k.fp) >= 0}
                                                  isPlain
                                                  dropdownItems={[<OverflowMenuDropdownItem key="delete" isShared onClick={() => remove_key(k.raw)}>
                                                      {_("Remove")}
                                                  </OverflowMenuDropdownItem>]}
                                        />
                                    </OverflowMenuControl>
                                </OverflowMenu>,
                                props: { className: "pf-c-table__action" }
                            }
                        ],
                        props: { key: k.fp }
                    };
                })} />
        </Card>
    );
}
