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

import { Alert } from 'patternfly-react';
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
        const { text, detail, textId } = this.props;

        let detailButton = null;
        if (detail) {
            let detailButtonText = _("show more");
            if (this.state.isDetail) {
                detailButtonText = _("show less");
            }

            detailButton = (<a href='#' className='alert-link more-button'
                onClick={mouseClick(this.toggleDetail)}>{detailButtonText}</a>);
        }

        return (
            <React.Fragment>
                <strong id={textId}>
                    {text}
                </strong>
                {detailButton}
                {this.state.isDetail && (<p>{detail}</p>)}
            </React.Fragment>
        );
    }
}

InlineNotification.propTypes = {
    text: PropTypes.string.isRequired, // main information to render
    detail: PropTypes.string, // optional, more detailed information. If empty, the more/less button is not rendered.
    textId: PropTypes.string, // optional, element id for the text
};

export const ExpandableNotification = ({ onDismiss, text, textId, detail, type }) => {
    return (
        <Alert type={type} onDismiss={onDismiss}>
            <InlineNotification text={text} textId={textId} detail={detail} />
        </Alert>

    );
};

export const ModalError = ({ dialogError, dialogErrorDetail }) => {
    return (
        <Alert>
            <strong>
                {dialogError}
            </strong>
            { dialogErrorDetail && <p> Error message: <samp>{dialogErrorDetail}</samp> </p> }
        </Alert>
    );
};
