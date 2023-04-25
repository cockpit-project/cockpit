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

import cockpit from "cockpit";
import React, { useState } from "react";
import { AboutModal } from "@patternfly/react-core/dist/esm/components/AboutModal/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Divider } from "@patternfly/react-core/dist/esm/components/Divider/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Menu, MenuContent, MenuSearch, MenuSearchInput, MenuItem, MenuList } from "@patternfly/react-core/dist/esm/components/Menu/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Text, TextContent, TextList, TextListItem, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";

import { useInit } from "hooks";
import { useDialogs } from "dialogs.jsx";

import "menu-select-widget.scss";

const _ = cockpit.gettext;

export const AboutCockpitModal = () => {
    const Dialogs = useDialogs();
    const [packages, setPackages] = useState(null);

    useInit(() => {
        const packages = [];
        const cmd = "(set +e; rpm -qa --qf '%{NAME} %{VERSION}\\n'; dpkg-query -f '${Package} ${Version}\n' --show; pacman -Q) 2> /dev/null | grep cockpit | sort";
        cockpit.spawn(["bash", "-c", cmd], [], { err: "message" })
                .then(pkgs =>
                    pkgs.trim().split("\n")
                            .forEach(p => {
                                const parts = p.split(" ");
                                packages.push({ name: parts[0], version: parts[1] });
                            })
                )
                .catch(error => console.error("Could not read packages versions:", error))
                .finally(() => setPackages(packages));
    });

    return (
        <AboutModal
            isOpen
            onClose={Dialogs.close}
            id="about-cockpit-modal"
            trademark={_("Licensed under GNU LGPL version 2.1")}
            productName={_("Web Console")}
            brandImageSrc="../shell/images/cockpit-icon.svg"
            brandImageAlt={_("Web console logo")}
        >
            <TextContent>
                <Text component={TextVariants.p}>
                    {_("Cockpit is an interactive Linux server admin interface.")}
                </Text>
                <Text component={TextVariants.p}>
                    <Text component={TextVariants.a} href="https://cockpit-project.org" target="_blank" rel="noopener noreferrer">
                        {_("Project website")}
                    </Text>
                </Text>
                <TextList component="dl">
                    {packages === null && <span>{_("Loading packages...")}</span>}
                    {packages !== null && packages.map(p =>
                        <React.Fragment key={p.name}>
                            <TextListItem key={p.name} component="dt">{p.name}</TextListItem>
                            <TextListItem component="dd">{p.version}</TextListItem>
                        </React.Fragment>
                    )}
                </TextList>
            </TextContent>
        </AboutModal>
    );
};

export const LangModal = () => {
    const language = document.cookie.replace(/(?:(?:^|.*;\s*)CockpitLang\s*=\s*([^;]*).*$)|^.*$/, "$1") || "en-us";

    const Dialogs = useDialogs();
    const [selected, setSelected] = useState(language);
    const [searchInput, setSearchInput] = useState("");

    function onSelect() {
        if (!selected)
            return;

        const cookie = "CockpitLang=" + encodeURIComponent(selected) + "; path=/; expires=Sun, 16 Jul 3567 06:23:41 GMT";
        document.cookie = cookie;
        window.localStorage.setItem("cockpit.lang", selected);
        window.location.reload(true);
    }

    const manifest = cockpit.manifests.shell || { };

    return (
        <Modal isOpen position="top" variant="small"
               id="display-language-modal"
               className="display-language-modal"
               onClose={Dialogs.close}
               title={_("Display language")}
               footer={<>
                   <Button variant='primary' onClick={onSelect}>{_("Select")}</Button>
                   <Button variant='link' onClick={Dialogs.close}>{_("Cancel")}</Button>
               </>}
        >
            <Flex direction={{ default: 'column' }}>
                <p>{_("Choose the language to be used in the application")}</p>
                <Menu id="display-language-list"
                      isPlain
                      isScrollable
                      className="ct-menu-select-widget"
                      onSelect={(_, selected) => setSelected(selected)}
                      activeItemId={selected}
                      selected={selected}>
                    <MenuSearch>
                        <MenuSearchInput>
                            <TextInput
                                value={searchInput}
                                aria-label={_("Filter menu items")}
                                iconVariant="search"
                                type="search"
                                onChange={setSearchInput}
                            />
                        </MenuSearchInput>
                    </MenuSearch>
                    <Divider />
                    <MenuContent>
                        <MenuList>
                            {Object.keys(manifest.locales || { })
                                    .filter(key => !searchInput || manifest.locales[key].toLowerCase().includes(searchInput.toString().toLowerCase()))
                                    .map(key => {
                                        return <MenuItem itemId={key} key={key} data-value={key}>{manifest.locales[key]}</MenuItem>;
                                    })}
                        </MenuList>
                    </MenuContent>
                </Menu>
            </Flex>
        </Modal>
    );
};

export function TimeoutModal(props) {
    return (
        <Modal isOpen position="top" variant="medium"
               showClose={false}
               title={_("Session is about to expire")}
               id="session-timeout-modal"
               footer={<Button variant='primary' onClick={props.onClose}>{_("Continue session")}</Button>}
        >
            {props.text}
        </Modal>
    );
}

export function OopsModal(props) {
    const Dialogs = useDialogs();
    return (
        <Modal isOpen position="top" variant="medium"
               onClose={Dialogs.close}
               title={_("Unexpected error")}
               footer={<Button variant='secondary' onClick={Dialogs.close}>{_("Close")}</Button>}
        >
            {_("Cockpit had an unexpected internal error.")}
            <br />
            <br />
            <span>{("You can try restarting Cockpit by pressing refresh in your browser. The javascript console contains details about this error") + " ("}
                <b>{_("Ctrl-Shift-J")}</b>
                {" " + _("in most browsers") + ")."}
            </span>
        </Modal>
    );
}
