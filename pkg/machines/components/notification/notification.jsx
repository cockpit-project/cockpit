/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import { mouseClick } from "../../helpers.es6";

import './notification.css';

export const NotificationMessage = ({ description, message }) => {
    const messageNode = message ? (
        <strong>
            {`${message} `}
        </strong>
    ) : null;

    return (
        <div className="notification-message">
            {messageNode}
            {description}
        </div>
    );
};

NotificationMessage.propTypes = {
    description: PropTypes.string,
    message: PropTypes.string,
};

export const Notification = ({ notificationClass, iconClass, onDismiss, id, children }) => {
    if (React.Children.count(children) === 0) {
        return null;
    }

    const dismissableClass = onDismiss ? ' alert-dismissable' : '';
    let closeButton = null;

    const identifier = id ? `${id}-close` : null;

    if (onDismiss) {
        // do not use "data-dismiss='alert'" to close the notification
        closeButton = (
            <button id={identifier} type='button' className='close' aria-hidden='true' onClick={mouseClick(onDismiss)}>
                <span className='pficon pficon-close' />
            </button>
        );
    }

    return (
        <div className={notificationClass + dismissableClass} id={id}>
            {closeButton}
            <span className={iconClass} />
            {children}
        </div>
    );
};

Notification.propTypes = {
    notificationClass: PropTypes.string, // classname for the notification type; see defaultProps
    iconClass: PropTypes.string, // classname for the icon; see defaultProps
    onDismiss: PropTypes.func, // callback to be called when 'close-button' is clicked. If undefined, then the button (means "cross") is not rendered.
    id: PropTypes.string,
};

Notification.defaultProps = {
    notificationClass: 'alert alert-info',
    iconClass: 'pficon pficon-info',
};
