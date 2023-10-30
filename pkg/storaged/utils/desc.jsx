/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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

import React from "react";

import { DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

export const SDesc = ({ title, value, action, children }) => {
    if (!value && !action && !children)
        return null;

    let content;
    if (action && value) {
        content = (
            <Flex>
                <FlexItem>{value}</FlexItem>
                <FlexItem>{action}</FlexItem>
            </Flex>);
    } else {
        content = value || action;
    }

    return (
        <DescriptionListGroup data-test-desc-title={title}>
            <DescriptionListTerm>{title}</DescriptionListTerm>
            <DescriptionListDescription>{content}{children}</DescriptionListDescription>
        </DescriptionListGroup>);
};
