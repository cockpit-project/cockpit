/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

import cockpit from "cockpit";
import React from "react";
import ReactDOM from "react-dom";
import { client } from "./subscriptions-client";
import * as subscriptionsRegister from "./subscriptions-register.jsx";
import { SubscriptionsPage } from "./subscriptions-view.jsx";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

var dataStore = { };

function dismissStatusError() {
    client.subscriptionStatus.error = undefined;
    dataStore.render();
}

var registerDialogDetails;

function registerSystem () {
    return client.registerSystem(registerDialogDetails);
}

var footerProps = {
    'actions': [
        { 'clicked': registerSystem,
          'caption': _("Register"),
          'style': 'primary',
        },
    ]
};

function openRegisterDialog() {
    registerDialogDetails = subscriptionsRegister.defaultSettings();

    // show dialog to register
    var renderDialog;
    var updatedData = function(prop, data) {
        if (prop) {
            if (data.target) {
                if (data.target.type == "checkbox") {
                    registerDialogDetails[prop] = data.target.checked;
                } else {
                    registerDialogDetails[prop] = data.target.value;
                }
            } else {
                registerDialogDetails[prop] = data;
            }
        }

        registerDialogDetails.onChange = updatedData;

        var dialogProps = {
            'title': _("Register system"),
            'body': React.createElement(subscriptionsRegister.DialogBody, registerDialogDetails),
        };

        if (renderDialog)
            renderDialog.setProps(dialogProps);
        else
            renderDialog = show_modal_dialog(dialogProps, footerProps);
    };
    updatedData();
}

function unregisterSystem() {
    client.unregisterSystem();
}

function initStore(rootElement) {
    client.addEventListener("dataChanged",
                            function() {
                                dataStore.render();
                            }
    );

    client.init();

    dataStore.render = function() {
        ReactDOM.render(React.createElement(
            SubscriptionsPage,
            {
                status: client.subscriptionStatus.status,
                products:client.subscriptionStatus.products,
                error: client.subscriptionStatus.error,
                dismissError: dismissStatusError,
                register: openRegisterDialog,
                unregister: unregisterSystem,
            }),
                        rootElement
        );
    };
}

document.addEventListener("DOMContentLoaded", function() {
    initStore(document.getElementById('app'));
    dataStore.render();
});
