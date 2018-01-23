/*jshint esversion: 6 */
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
import cockpit from 'cockpit';
import React, { PropTypes } from "react";
import { mouseClick } from '../helpers.es6';

const _ = cockpit.gettext;

import './inlineNotification.css';

class InlineNotification extends React.Component {
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
        const { notificationClass, iconClass, text, detail, textId, onDismiss } = this.props;

        let detailButton = null;
        if (detail) {
            let detailButtonText = _("show more");
            if (this.state.isDetail) {
                detailButtonText = _("show less");
            }

            detailButton = (<a href='#' className='alert-link machines-more-button'
                                     onClick={mouseClick(this.toggleDetail)}>{detailButtonText}</a>);
        }

        const dismissableClass = this.props.onDismiss ? ' alert-dismissable' : '';
        let closeButton = null;
        if (this.props.onDismiss) {
            // do not use "data-dismiss='alert'" to close the notification
            closeButton = (
                <button type='button' className='close' aria-hidden='true' onClick={onDismiss}>
                    <span className='pficon pficon-close'/>
                </button>
            );
        }

        return (
            <div className={notificationClass + dismissableClass}>
                {closeButton}
                <span className={iconClass}/>
                <strong id={textId}>
                    {text}
                </strong>
                {detailButton}
                {this.state.isDetail && detail}
            </div>
        );
    }
}

InlineNotification.propTypes = {
    notificationClass: PropTypes.string, // classname for the notification type; see defaultProps
    iconClass: PropTypes.string, // classname for the icon; see defaultProps
    onDismiss: PropTypes.func, // callback to be called when 'close-button' is clicked. If undefined, then the buttun (means "cross") is not rendered.

    text: PropTypes.string.isRequired, // main information to render
    detail: PropTypes.string, // optional, more detailed information. If empty, the more/less button is not rendered.
    textId: PropTypes.string, // optional, element id for the text
};

InlineNotification.defaultProps = {
    notificationClass: 'alert alert-warning',
    iconClass: 'pficon pficon-warning-triangle-o',
};

export const Alert = ({ onDismiss, text, textId, detail }) => {
    return (
        <InlineNotification onDismiss={onDismiss} text={text} textId={textId} detail={detail}
                            notificationClass='alert alert-warning'
                            iconClass='pficon pficon-warning-triangle-o' />
    );
};

export const Info = ({ onDismiss, text, textId, detail }) => {
    return (
        <InlineNotification onDismiss={onDismiss} text={text} textId={textId} detail={detail}
                            notificationClass='alert alert-info'
                            iconClass='pficon pficon-info' />
    );
};
