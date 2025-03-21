/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import React from "react";
import PropTypes from 'prop-types';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import type { ButtonProps } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import {
    EmptyStateActions, EmptyState, EmptyStateBody, EmptyStateFooter, EmptyStateVariant
} from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import type { EmptyStateProps } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import "./cockpit-components-empty-state.css";

export const EmptyStatePanel = ({
    title,
    paragraph,
    loading = false,
    icon,
    action,
    isActionInProgress = false,
    onAction,
    actionVariant = "primary",
    secondary,
    headingLevel = "h1"
}: {
    title?: EmptyStateProps["titleText"],
    paragraph?: React.ReactNode,
    loading?: boolean,
    icon?: EmptyStateProps["icon"],
    action?: React.ReactNode | string,
    isActionInProgress?: boolean,
    onAction?: ButtonProps["onClick"],
    actionVariant?: ButtonProps["variant"],
    secondary?: React.ReactNode,
    headingLevel?: EmptyStateProps['headingLevel'],
}) => {
    const slimType = title || paragraph ? "" : "slim";
    const emptyStateHeaderIcon = loading ? Spinner : icon;

    return (
        <EmptyState headingLevel={headingLevel} titleText={title} variant={EmptyStateVariant.full} {...emptyStateHeaderIcon && { icon: emptyStateHeaderIcon }}>
            <EmptyStateBody>
                {paragraph}
            </EmptyStateBody>
            {(action || secondary) &&
                <EmptyStateFooter>
                    { action && (typeof action == "string"
                        ? <Button variant={actionVariant} className={slimType}
                              isLoading={isActionInProgress}
                              isDisabled={isActionInProgress}
                              onClick={onAction}>
                            {action}
                        </Button>
                        : action)}
                    { secondary && <EmptyStateActions>{secondary}</EmptyStateActions> }
                </EmptyStateFooter>}
        </EmptyState>
    );
};

EmptyStatePanel.propTypes = {
    loading: PropTypes.bool,
    icon: PropTypes.oneOfType([PropTypes.string, PropTypes.object, PropTypes.func]),
    title: PropTypes.string,
    paragraph: PropTypes.node,
    action: PropTypes.oneOfType([PropTypes.node, PropTypes.string]),
    actionVariant: PropTypes.string,
    isActionInProgress: PropTypes.bool,
    onAction: PropTypes.func,
    secondary: PropTypes.node,
};
