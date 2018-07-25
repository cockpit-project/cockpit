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

import React, { PropTypes } from "react";
import { Notification, NotificationMessage } from "./notification.jsx";

const NotificationArea = ({ notifications, onDismiss, id }) => {
    if (!notifications || notifications.length === 0) {
        return null;
    }

    const notificationList = [...notifications].sort((a, b) => a.id < b.id).map((notification) => {
        const isError = notification.type === 'error';
        const clazz = isError ? 'alert-danger' : 'alert-info';
        const icon = isError ? 'pficon-error-circle-o' : 'pficon pficon-info';

        return (<Notification onDismiss={onDismiss ? onDismiss.bind(onDismiss, notification.id) : null}
                              id={`${id}-notification-${notification.id}`}
                              notificationClass={'alert ' + clazz}
                              iconClass={'pficon ' + icon}>
            <NotificationMessage description={notification.description} message={notification.message} />
        </Notification>);
    });

    return (
        <div id={id}>
            {notificationList}
        </div>
    );
};

Notification.propTypes = {
    notifications: PropTypes.array.isRequired,
    messages: PropTypes.string,
    onErrorsDismiss: PropTypes.func,
    onMessagesDismiss: PropTypes.func,
    id: PropTypes.string,
};

export default NotificationArea;
