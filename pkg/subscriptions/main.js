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

var cockpit = require("cockpit");
var React = require("react");
var subscriptionsClient = require("./subscriptions-client");
var subscriptionsRegister = require("./subscriptions-register.jsx");
var subscriptionsView = require("./subscriptions-view.jsx");
var Dialog = require("cockpit-components-dialog.jsx");

var _ = cockpit.gettext;

var dataStore = { };

function dismissStatusError() {
    subscriptionsClient.subscriptionStatus.error = undefined;
    dataStore.render();
}

var registerDialogDetails;

function registerSystem () {
    return subscriptionsClient.registerSystem(registerDialogDetails);
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
                    // input from the ui, so we don't need to re-render
                    return;
                }
            } else {
                registerDialogDetails[prop] = data;
            }
        }

        registerDialogDetails.onChange = updatedData;

        var dialogProps = {
              'title': _("Register system"),
              'body': React.createElement(subscriptionsRegister.dialogBody, registerDialogDetails),
          };

        if (renderDialog)
            renderDialog.setProps(dialogProps);
        else
            renderDialog = Dialog.show_modal_dialog(dialogProps, footerProps);
    };
    updatedData();
}

function unregisterSystem() {
    subscriptionsClient.unregisterSystem();
}

function initStore(rootElement) {
    subscriptionsClient.addEventListener("dataChanged",
        function() {
            dataStore.render();
        }
    );

    subscriptionsClient.init();

    dataStore.render = function() {
        React.render(React.createElement(
            subscriptionsView.page,
            {
                status: subscriptionsClient.subscriptionStatus.status,
                products:subscriptionsClient.subscriptionStatus.products,
                error: subscriptionsClient.subscriptionStatus.error,
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
