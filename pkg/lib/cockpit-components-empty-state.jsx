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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import React from "react";
import PropTypes from 'prop-types';
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { EmptyState, EmptyStateBody, EmptyStateIcon, EmptyStateSecondaryActions, EmptyStateVariant } from "@patternfly/react-core/dist/esm/components/EmptyState/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import "./cockpit-components-empty-state.css";

export const EmptyStatePanel = ({ title, paragraph, loading, icon, action, isActionInProgress, onAction, secondary, headingLevel, titleSize }) => {
    const slimType = title || paragraph ? "" : "slim";
    return (
        <EmptyState variant={EmptyStateVariant.full}>
            { loading && <Spinner className="ct-spinner" isSVG size="xl" /> }
            { icon && <EmptyStateIcon icon={icon} /> }
            <Title headingLevel={headingLevel} size={titleSize}>
                {title}
            </Title>
            <EmptyStateBody>
                {paragraph}
            </EmptyStateBody>
            { action && (typeof action == "string"
                ? <Button variant="primary" className={slimType}
                          isLoading={isActionInProgress}
                          isDisabled={isActionInProgress}
                          onClick={onAction}>{action}</Button>
                : action)}
            { secondary && <EmptyStateSecondaryActions>{secondary}</EmptyStateSecondaryActions> }
        </EmptyState>
    );
};

EmptyStatePanel.propTypes = {
    loading: PropTypes.bool,
    icon: PropTypes.oneOfType([PropTypes.string, PropTypes.func]),
    title: PropTypes.string,
    paragraph: PropTypes.node,
    action: PropTypes.node,
    isActionInProgress: PropTypes.bool,
    onAction: PropTypes.func,
    secondary: PropTypes.node,
};

EmptyStatePanel.defaultProps = {
    headingLevel: "h1",
    titleSize: "lg",
    isActionInProgress: false,
};
