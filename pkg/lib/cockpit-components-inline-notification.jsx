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
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';

import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import './cockpit-components-inline-notification.css';

const _ = cockpit.gettext;

function mouseClick(fun) {
    return function (event) {
        if (!event || event.button !== 0)
            return;
        event.preventDefault();
        return fun(event);
    };
}

export class InlineNotification extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            isDetail: false,
        };

        this.toggleDetail = this.toggleDetail.bind(this);
    }

    toggleDetail () {
        this.setState({
            isDetail: !this.state.isDetail,
        });
    }

    render () {
        const { text, detail, type, onDismiss } = this.props;

        let detailButton = null;
        if (detail) {
            let detailButtonText = _("show more");
            if (this.state.isDetail) {
                detailButtonText = _("show less");
            }

            detailButton = (<Button variant="link" isInline className='alert-link more-button'
                onClick={mouseClick(this.toggleDetail)}>{detailButtonText}</Button>);
        }
        const extraProps = {};
        if (onDismiss)
            extraProps.actionClose = <AlertActionCloseButton onClose={onDismiss} />;

        return (
            <Alert variant={type || 'danger'}
                isLiveRegion={this.props.isLiveRegion}
                isInline={this.props.isInline != undefined ? this.props.isInline : true}
                title={<> {text} {detailButton} </>} {...extraProps}>
                {this.state.isDetail && (<p>{detail}</p>)}
            </Alert>
        );
    }
}

InlineNotification.propTypes = {
    onDismiss: PropTypes.func,
    isInline: PropTypes.bool,
    text: PropTypes.string.isRequired, // main information to render
    detail: PropTypes.string, // optional, more detailed information. If empty, the more/less button is not rendered.
    type: PropTypes.string,
};

export const ModalError = ({ dialogError, dialogErrorDetail, id, isExpandable }) => {
    return (
        <Alert id={id} variant='danger' isInline title={dialogError} isExpandable={!!isExpandable}>
            { typeof dialogErrorDetail === 'string' ? <p>{dialogErrorDetail}</p> : dialogErrorDetail }
        </Alert>
    );
};
