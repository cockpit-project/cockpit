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
import {
    Title,
    Button,
    EmptyState,
    EmptyStateVariant,
    EmptyStateIcon,
    EmptyStateBody,
} from '@patternfly/react-core';
import { ExclamationCircleIcon } from '@patternfly/react-icons';
import "./cockpit-components-empty-state.css";

export class EmptyStatePanel extends React.Component {
    render() {
        const Spinner = () => (
            <span className="pf-c-spinner" role="progressbar" aria-valuetext="Loading...">
                <span className="pf-c-spinner__clipper" />
                <span className="pf-c-spinner__lead-ball" />
                <span className="pf-c-spinner__tail-ball" />
            </span>
        );
        const slimType = this.props.title || this.props.paragraph ? "" : "slim";
        return (
            <EmptyState variant={EmptyStateVariant.full}>
                {this.props.showIcon && (this.props.loading ? <EmptyStateIcon variant="container" component={Spinner} /> : <EmptyStateIcon icon={ExclamationCircleIcon} />)}
                <Title headingLevel="h5" size="lg">
                    {this.props.title}
                </Title>
                <EmptyStateBody>
                    {this.props.paragraph}
                </EmptyStateBody>
                {this.props.action && <Button variant="primary" className={slimType} onClick={this.props.onAction}>{this.props.action}</Button>}
            </EmptyState>
        );
    }
}

EmptyStatePanel.propTypes = {
    loading: PropTypes.bool,
    showIcon: PropTypes.bool,
    title: PropTypes.string,
    paragraph: PropTypes.string,
    action: PropTypes.string,
    onAction: PropTypes.func,
};
