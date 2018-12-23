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

import cockpit from "cockpit";

import React from "react";

import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import { ActivePagesDialogBody } from "./active-pages-dialog.jsx";

const _ = cockpit.gettext;

// The argument is a Frames object from base_index.js
export function showDialog (frames) {
    var dataStore = { };

    // we omit the host for all pages on our current system
    function displayName(address, component) {
        if (address == "localhost")
            return "/" + component;
        return address + ":/" + component;
    }

    function gatherIframes() {
        var result = [ ];
        var address, component, iframe;
        for (address in frames.iframes) {
            for (component in frames.iframes[address]) {
                iframe = frames.iframes[address][component];
                result.push({
                    frame: iframe,
                    component: component,
                    address: address,
                    name: iframe.getAttribute("name"),
                    visible: iframe.style.display.indexOf("block") !== -1,
                    displayName: displayName(address, component)
                });
            }
        }
        return result;
    }

    var selectedFrames = [];

    dataStore.closePage = function() {
        // the user wants to close the selected pages
        selectedFrames.forEach(function(element) {
            frames.remove(element.host, element.component);
        });
        return cockpit.resolve();
    };

    function selectionChanged(frame, selected) {
        var index = selectedFrames.indexOf(frame);
        if (selected) {
            if (index === -1)
                selectedFrames.push(frame);
        } else {
            if (index !== -1)
                selectedFrames.splice(index, 1);
        }
    }

    var iframes = gatherIframes();
    // by default, select currently active (visible) frame
    iframes.forEach(function(f, index) {
        if (f.visible) {
            if (!(f in selectedFrames))
                selectedFrames.push(f);
        }
        f.selected = f.visible;
    });
    // sort the frames by displayName, visible ones first
    iframes.sort(function(a, b) {
        return (a.visible ? -2 : 0) + (b.visible ? 2 : 0) +
               ((a.displayName < b.displayName) ? -1 : 0) + ((b.displayName < a.displayName) ? 1 : 0);
    });
    dataStore.dialogProps = {
        title: _("Active Pages"),
        id: "active-pages-dialog",
        body: React.createElement(ActivePagesDialogBody, { iframes: iframes, selectionChanged: selectionChanged }),
    };

    dataStore.footerProps = {
        'actions': [
            { 'clicked': dataStore.closePage,
              'caption': _("Close Selected Pages"),
              'style': 'primary',
            }
        ],
    };

    dataStore.dialogObj = show_modal_dialog(dataStore.dialogProps, dataStore.footerProps);

    dataStore.update = function() {
        dataStore.dialogProps.body = React.createElement(ActivePagesDialogBody, { });
        dataStore.dialogObj.setProps(dataStore.dialogProps);
    };

    return dataStore;
}
