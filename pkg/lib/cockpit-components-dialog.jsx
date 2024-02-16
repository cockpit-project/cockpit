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

import cockpit from "cockpit";
import React from "react";
import { createRoot } from "react-dom/client";
import PropTypes from "prop-types";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { HelpIcon, ExternalLinkAltIcon } from '@patternfly/react-icons';

import "cockpit-components-dialog.scss";

const _ = cockpit.gettext;

/*
 * React template for a Cockpit dialog footer
 * It can wait for an action to complete,
 * has a 'Cancel' button and an action button (defaults to 'OK')
 * Expected props:
 *  - cancel_clicked optional
 *     Callback called when the dialog is canceled
 *  - cancel_button optional, defaults to 'Cancel' text styled as a link
 *  - list of actions, each an object with:
 *      - clicked
 *         Callback function that is expected to return a promise.
 *         parameter: callback to set the progress text
 *      - caption optional, defaults to 'Ok'
 *      - disabled optional, defaults to false
 *      - style defaults to 'secondary', other options: 'primary', 'danger'
 *  - idle_message optional, always show this message on the last row when idle
 *  - dialog_done optional, callback when dialog is finished (param true if success, false on cancel)
 *  - set_error: required, callback to set/clear error message from actions
 */
class DialogFooter extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            action_in_progress: false,
            action_in_progress_promise: null,
            action_progress_message: '',
            action_progress_cancel: null,
            action_canceled: false,
        };
        this.update_progress = this.update_progress.bind(this);
        this.cancel_click = this.cancel_click.bind(this);
    }

    update_progress(msg, cancel) {
        this.setState({ action_progress_message: msg, action_progress_cancel: cancel });
    }

    action_click(handler, caption, e) {
        this.setState({
            action_progress_message: '',
            action_in_progress: true,
            action_caption_in_progress: caption,
            action_canceled: false,
        });

        const p = handler(this.update_progress)
                .then(() => {
                    this.props.set_error(null);
                    this.setState({ action_in_progress: false });
                    if (this.props.dialog_done)
                        this.props.dialog_done(true);
                })
                .catch(error => {
                    if (this.state.action_canceled) {
                        if (this.props.dialog_done)
                            this.props.dialog_done(false);
                    } else {
                        this.props.set_error(error);
                        this.setState({ action_in_progress: false });
                    }
                    /* Always log global dialog errors for easier debugging */
                    if (error)
                        console.warn(error.message || error.toString());
                });

        if (p.progress)
            p.progress(this.update_progress);

        this.setState({ action_in_progress_promise: p });
        if (e)
            e.stopPropagation();
    }

    cancel_click(e) {
        this.setState({ action_canceled: true });

        if (this.props.cancel_clicked)
            this.props.cancel_clicked();

        // an action might be in progress, let that handler decide what to do if they added a cancel function
        if (this.state.action_in_progress && this.state.action_progress_cancel) {
            this.state.action_progress_cancel();
            return;
        }
        if (this.state.action_in_progress && 'cancel' in this.state.action_in_progress_promise) {
            this.state.action_in_progress_promise.cancel();
            return;
        }

        if (this.props.dialog_done)
            this.props.dialog_done(false);
        if (e)
            e.stopPropagation();
    }

    render() {
        const cancel_text = this.props?.cancel_button?.text ?? _("Cancel");
        const cancel_variant = this.props?.cancel_button?.variant ?? "link";

        // If an action is in progress, show the spinner with its message and disable all actions.
        // Cancel is only enabled when the action promise has a cancel method, or we get one
        // via the progress reporting.

        let wait_element;
        let actions_disabled;
        let cancel_disabled;
        if (this.state.action_in_progress) {
            actions_disabled = true;
            if (!(this.state.action_in_progress_promise && this.state.action_in_progress_promise.cancel) && !this.state.action_progress_cancel)
                cancel_disabled = true;
            wait_element = <div className="dialog-wait-ct">
                <span>{ this.state.action_progress_message }</span>
            </div>;
        } else if (this.props.idle_message) {
            wait_element = <div className="dialog-wait-ct">
                { this.props.idle_message }
            </div>;
        }

        const action_buttons = this.props.actions.map(action => {
            let caption;
            if ('caption' in action)
                caption = action.caption;
            else
                caption = _("Ok");

            let variant = action.style || "secondary";
            if (variant == "primary" && action.danger)
                variant = "danger";

            return (<Button
                key={ caption }
                className="apply"
                variant={ variant }
                isLoading={ this.state.action_in_progress && this.state.action_caption_in_progress == caption }
                isDanger={ action.danger }
                onClick={ this.action_click.bind(this, action.clicked, caption) }
                isDisabled={ actions_disabled || action.disabled }
            >{ caption }</Button>
            );
        });

        return (
            <>
                { this.props.extra_element }
                { action_buttons }
                <Button variant={cancel_variant} className="cancel" onClick={this.cancel_click} isDisabled={cancel_disabled}>{ cancel_text }</Button>
                { wait_element }
            </>
        );
    }
}

DialogFooter.propTypes = {
    cancel_clicked: PropTypes.func,
    cancel_button: PropTypes.object,
    actions: PropTypes.array.isRequired,
    dialog_done: PropTypes.func,
    set_error: PropTypes.func.isRequired,
};

/*
 * React template for a Cockpit dialog
 * The primary action button is disabled while its action is in progress (waiting for promise)
 * Removes focus on other elements on showing
 * Expected props:
 *  - title (string)
 *  - body (react element, top element should be of class modal-body)
 *      It is recommended for information gathering dialogs to pass references
 *      to the input components to the controller. That way, the controller can
 *      extract all necessary information (e.g. for input validation) when an
 *      action is triggered.
 *  - static_error optional, always show this error after the body element
 *  - footer (react element, top element should be of class modal-footer)
 *  - id optional, id that is assigned to the top level dialog node, but not the backdrop
 *  - variant: See PF4 Modal component's 'variant' property
 *  - titleIconVariant: See PF4 Modal component's 'titleIconVariant' property
 *  - showClose optional, specifies if 'X' button for closing the dialog is present
 */
class Dialog extends React.Component {
    componentDidMount() {
        // For the scenario that cockpit-storage is used inside anaconda Web UI
        // We need to know if there is an open dialog in order to create the backdrop effect
        // on the parent window
        window.sessionStorage.setItem("cockpit_has_modal", true);

        // if we used a button to open this, make sure it's not focused anymore
        if (document.activeElement)
            document.activeElement.blur();
    }

    componentWillUnmount() {
        window.sessionStorage.setItem("cockpit_has_modal", false);
    }

    render() {
        let help = null;
        let footer = null;
        if (this.props.helpLink)
            footer = <a href={this.props.helpLink} target="_blank" rel="noopener noreferrer">{_("Learn more")} <ExternalLinkAltIcon /></a>;

        if (this.props.helpMessage)
            help = <Popover
                  bodyContent={this.props.helpMessage}
                  footerContent={footer}
            >
                <Button variant="plain" aria-label={_("Learn more")}>
                    <HelpIcon />
                </Button>
            </Popover>;

        const error = this.props.error || this.props.static_error;
        const error_alert = error && <Alert variant='danger' isInline title={error} />;

        return (
            <Modal position="top" variant={this.props.variant || "medium"}
                   titleIconVariant={this.props.titleIconVariant}
                   onEscapePress={() => undefined}
                   showClose={!!this.props.showClose}
                   id={this.props.id}
                   isOpen
                   help={help}
                   footer={this.props.footer} title={this.props.title}>
                <Stack hasGutter>
                    { error_alert }
                    <StackItem>
                        { this.props.body }
                    </StackItem>
                </Stack>
            </Modal>
        );
    }
}
Dialog.propTypes = {
    // TODO: fix following by refactoring the logic showing modal dialog (recently show_modal_dialog())
    title: PropTypes.string, // is effectively required, but show_modal_dialog() provides initially no props and resets them later.
    body: PropTypes.element, // is effectively required, see above
    static_error: PropTypes.string,
    error: PropTypes.string,
    footer: PropTypes.element, // is effectively required, see above
    id: PropTypes.string,
    showClose: PropTypes.bool,
};

/* Create and show a dialog
 * For this, create a containing DOM node at the body level
 * The returned object has the following methods:
 *     - setFooterProps replace the current footerProps and render
 *     - setProps       replace the current props and render
 *     - render         render again using the stored props
 * The DOM node and React metadata are freed once the dialog has closed
 */
export function show_modal_dialog(props, footerProps) {
    const dialogName = 'cockpit_modal_dialog';
    // don't allow nested dialogs, just close whatever is open
    const curElement = document.getElementById(dialogName);
    let root;
    if (curElement) {
        root = createRoot(curElement);
        root.unmount();
        curElement.remove();
    }
    // create an element to render into
    const rootElement = document.createElement("div");
    root = createRoot(rootElement);
    rootElement.id = dialogName;
    document.body.appendChild(rootElement);

    // register our own on-close callback
    let origCallback;
    const closeCallback = function() {
        if (origCallback)
            origCallback.apply(this, arguments);
        root.unmount();
        rootElement.remove();
    };

    const dialogObj = { };
    let error = null;
    dialogObj.props = props;
    dialogObj.footerProps = null;
    dialogObj.render = function() {
        dialogObj.props.footer = <DialogFooter {...dialogObj.footerProps} />;
        // Don't render if we are no longer part of the document.
        // This would be mostly harmless except that it will remove
        // the input focus from whatever element has it, which is
        // unpleasant and also disrupts the tests.
        if (rootElement.offsetParent)
            root.render(<Dialog {...dialogObj.props} error={error} />);
    };
    function updateFooterAndRender() {
        if (dialogObj.props === null || dialogObj.props === undefined)
            dialogObj.props = { };
        dialogObj.props.footer = <DialogFooter {...dialogObj.footerProps} />;
        dialogObj.render();
    }
    dialogObj.setFooterProps = function(footerProps) {
        dialogObj.footerProps = footerProps;
        if (dialogObj.footerProps.dialog_done != closeCallback) {
            origCallback = dialogObj.footerProps.dialog_done;
            dialogObj.footerProps.dialog_done = closeCallback;
        }
        dialogObj.footerProps.set_error = e => {
            error = typeof e === 'object' && e !== null ? (e.message || e.toString()) : e;
            dialogObj.render();
        };
        updateFooterAndRender();
    };
    dialogObj.setProps = function(props) {
        dialogObj.props = props;
        updateFooterAndRender();
    };
    dialogObj.setFooterProps(footerProps);
    dialogObj.setProps(props);

    // now actually render
    dialogObj.render();

    return dialogObj;
}

export function apply_modal_dialog(event) {
    const dialog = event.target?.closest("[role=dialog]");
    const button = dialog?.querySelector("button.apply");

    if (button) {
        const event = new MouseEvent('click', {
            view: window,
            bubbles: true,
            cancelable: true,
            button: 0
        });
        button.dispatchEvent(event);
    }

    event.preventDefault();
    return false;
}
