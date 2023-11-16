/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2022 Red Hat, Inc.
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

/* DIALOG PRESENTATION PROTOCOL
 *
 * Example:
 *
 * import { WithDialogs, useDialogs } from "dialogs.jsx";
 *
 * const App = () =>
 *   <WithDialogs>
 *     <Page>
 *       <ExampleButton />
 *     </Page>
 *   </WithDialogs>;
 *
 * const ExampleButton = () => {
 *   const Dialogs = useDialogs();
 *   return <Button onClick={() => Dialogs.show(<MyDialog />)}>Open dialog</Button>;
 * };
 *
 * const MyDialog = () => {
 *   const Dialogs = useDialogs();
 *   return (
 *     <Modal title="My dialog"
 *            isOpen
 *            onClose={Dialogs.close}>
 *       <p>Hello!</p>
 *     </Modal>);
 * };
 *
 * This does two things: It maintains the state of whether the dialog
 * is open, and it does it high up in the DOM, in a stable place.
 * Even if ExampleButton is no longer part of the DOM, the dialog will
 * stay open and remain useable.
 *
 * The "WithDialogs" component enables all its children to show
 * dialogs.  Such a dialog will stay open as long as the WithDialogs
 * component itself is mounted.  Thus, you should put the WithDialogs
 * component somewhere high up in your component tree, maybe even as
 * the very top-most component.
 *
 * If your Cockpit application has multiple pages and navigation
 * between these pages is controlled by the browser URL, then each of
 * these pages should have its own WithDialogs wrapper. This way, a
 * dialog opened on one page closes when the user navigates away from
 * that page. To make sure that React maintains separate states for
 * WithDialogs components, give them unique "key" properties.
 *
 * A component that wants to show a dialogs needs to get hold of the
 * current "Dialogs" context and then call it's "show" method.  For a
 * function component the Dialogs context is returned by
 * "useDialogs()", as shown above in the example.
 *
 * A class component can declare a static context type and then use
 * "this.context" to find the Dialogs object:
 *
 * import { DialogsContext } from "dialogs.jsx";
 *
 * class ExampleButton extends React.Component {
 *   static contextType = DialogsContext;
 *
 *   function render() {
 *     const Dialogs = this.context;
 *     return <Button onClick={() => Dialogs.show(<MyDialog />)}>Open dialog</Button>;
 *   }
 * }
 *
 *
 * - Dialogs.show(component)
 *
 * Calling "Dialogs.show" will render the given component as a direct
 * child of the inner-most enclosing "WithDialogs" component.  The
 * component is of course intended to be a dialog, such as
 * Patternfly's "Modal".  There is only ever one of these; a second
 * call to "show" will remove the previously rendered component.
 * Passing "null" will remove the currently rendered componenet, if any.
 *
 * - Dialogs.close()
 *
 * Same as "Dialogs.show(null)".
 */

import React, { useContext, useRef, useState } from "react";

export const DialogsContext = React.createContext();
export const useDialogs = () => useContext(DialogsContext);

export const WithDialogs = ({ children }) => {
    const is_open = useRef(false); // synchronous
    const [dialog, setDialog] = useState(null);

    const Dialogs = {
        show: component => {
            if (component && is_open.current)
                console.error("Dialogs.show() called for",
                              JSON.stringify(component),
                              "while a dialog is already open:",
                              JSON.stringify(dialog));
            is_open.current = !!component;
            setDialog(component);
        },
        close: () => {
            is_open.current = false;
            setDialog(null);
        },
        isActive: () => dialog !== null
    };

    return (
        <DialogsContext.Provider value={Dialogs}>
            {children}
            {dialog}
        </DialogsContext.Provider>);
};
