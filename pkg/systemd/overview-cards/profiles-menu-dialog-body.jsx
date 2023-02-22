/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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
import PropTypes from "prop-types";

import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { LabelGroup } from "@patternfly/react-core/dist/esm/components/LabelGroup/index.js";
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
export class ProfilesMenuDialogBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            selected_profile: this.props.active_profile,
        };
    }

    render() {
        const profiles = this.props.profiles.map((itm) => {
            return (
                <MenuItem itemId={itm.name} key={itm.name} data-value={itm.name}
                          description={itm.description} isDisabled={this.props.isDisabled}
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
                      this.setState({ selected_profile: selected });
                      this.props.change_selected(selected);
                  }}
                  selected={this.state.selected_profile}>
                <MenuContent>
                    <MenuList>
                        {profiles}
                    </MenuList>
                </MenuContent>
            </Menu>
        );
    }
}
ProfilesMenuDialogBody.propTypes = {
    active_profile: PropTypes.string.isRequired,
    change_selected: PropTypes.func.isRequired,
    profiles: PropTypes.array.isRequired,
    isDisabled: PropTypes.bool,
};
