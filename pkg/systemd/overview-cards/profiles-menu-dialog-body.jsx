/*
 * Copyright (C) 2016 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React from "react";
import PropTypes from "prop-types";

import { Label, LabelGroup } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Menu, MenuContent, MenuItem, MenuList } from "@patternfly/react-core/dist/esm/components/Menu/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import "menu-select-widget.scss";

const _ = cockpit.gettext;

/* dialog body with list of profiles
 * Expected props:
 *  - active_profile (key of the active profile)
 *  - change_selected callback, called with profile name each time the selected entry changes
 *  - profiles (array of entries)
 *    - name (string, key)
 *    - recommended (boolean)
 *    - active (boolean)
 *    - title (string)
 *    - description (string)
 */
export const ProfilesMenuDialogBody = ({ active_profile, profiles, change_selected, isDisabled }) => {
    const [selected_profile, setSelectedProfile] = React.useState(active_profile);

    const menuProfiles = profiles.map((itm) => {
        return (
            <MenuItem itemId={itm.name} key={itm.name} data-value={itm.name}
                      description={itm.description} isDisabled={isDisabled}
                      isActive={itm.active}>
                <Flex alignItems={{ default: 'alignItemsCenter' }}>
                    <p>{ itm.title }</p>
                    <FlexItem>
                        <LabelGroup>
                            {itm.recommended && <Label color="green" variant='filled'>{_("recommended")}</Label>}
                            {itm.active && <Label color="blue" variant='filled'>{_("active")}</Label>}
                            {itm.inconsistent && <Label color="orange" variant='filled'>{_("inconsistent")}</Label>}
                        </LabelGroup>
                    </FlexItem>
                </Flex>
            </MenuItem>
        );
    });
    return (
        <Menu className="ct-menu-select-widget"
              isPlain
              isScrollable
              onSelect={(_, selected) => {
                  setSelectedProfile(selected);
                  change_selected(selected);
              }}
              selected={selected_profile}>
            <MenuContent>
                <MenuList>
                    {menuProfiles}
                </MenuList>
            </MenuContent>
        </Menu>
    );
};

ProfilesMenuDialogBody.propTypes = {
    active_profile: PropTypes.string.isRequired,
    change_selected: PropTypes.func.isRequired,
    profiles: PropTypes.array.isRequired,
    isDisabled: PropTypes.bool,
};
