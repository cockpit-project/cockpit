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
import { Notification, NotificationMessage } from "./notification.jsx";

const NotificationArea = ({ notifications, onDismiss, id }) => {
    if (!notifications || notifications.length === 0) {
        return null;
    }

    const notificationList = [...notifications].sort((a, b) => a.id < b.id)
            .map((notification) => {
                const isError = notification.type === 'error';
                const clazz = isError ? 'alert-danger' : 'alert-info';
                const icon = isError ? 'pficon-error-circle-o' : 'pficon pficon-info';

                const description = notification.description ? notification.description.toString() : notification.description;
                const message = notification.message ? notification.message.toString() : notification.message;

                return (<Notification onDismiss={onDismiss ? onDismiss.bind(onDismiss, notification.id) : null}
                                  id={`${id}-notification-${notification.id}`}
                                  notificationClass={'alert ' + clazz}
                                  iconClass={'pficon ' + icon}
                                  key={notification}>
                    <NotificationMessage description={description} message={message} />
                </Notification>);
            });

    return (
        <div id={id}>
            {notificationList}
        </div>
    );
};

NotificationArea.propTypes = {
    notifications: PropTypes.array.isRequired,
    onDismiss: PropTypes.func,
    id: PropTypes.string,
};

export default NotificationArea;
