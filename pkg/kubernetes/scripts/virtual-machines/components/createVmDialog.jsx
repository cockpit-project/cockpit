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

import cockpit from 'cockpit';
import React from 'react';

import './createVmDialog.less';
import { preventDefault } from '../utils.jsx';

const _ = cockpit.gettext;

const MAX_IMPORT_FILE_SIZE_MIB = 50;
const DROP_ZONE_ID = 'drop-zone';

class CreateVmDialog extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            resource: '',
            resourceError: null,
            isDragging: false,
            isOverDropZone: false,
            dragOverElements: [],
        };

        this.onDragEnter = this.onDragEnter.bind(this);
        this.onDragLeave = this.onDragLeave.bind(this);
        this.onDrop = this.onDrop.bind(this);
        this.onNewFile = this.onNewFile.bind(this);
        this.onNewFileEvent = this.onNewFileEvent.bind(this);

        this.onResourceChanged = this.onResourceChanged.bind(this);
    }

    onResourceChanged(e) {
        if (e && e.target && typeof e.target.value !== 'undefined') {
            this.setState({ resource: e.target.value });
        }
    }

    componentDidMount() {
        window.addEventListener('dragenter', this.onDragEnter);
        window.addEventListener('dragleave', this.onDragLeave);
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', preventDefault);
    }

    componentWillUnmount() {
        window.removeEventListener('dragenter', this.onDragEnter);
        window.removeEventListener('dragleave', this.onDragLeave);
        window.removeEventListener('dragover', preventDefault);
        window.removeEventListener('drop', preventDefault);
    }

    validate() {
        let success = true;
        let errors = {
            resourceError: null,
        };
        let result = {
            resource: null,
        };

        if (!this.state.resource) {
            errors.resourceError = _("VM definition is required.");
        } else {
            try {
                let res = JSON.parse(this.state.resource);
                if (res === null || typeof res !== "object") {
                    errors.resourceError = _("VM definition is not a valid JSON.");
                } else if (res instanceof Array) {
                    errors.resourceError = _("VM definition must be an object.");
                } else {
                    result.resource = res;
                }
            } catch (e) {
                errors.resourceError = _("VM definition is not a valid JSON.");
            }
        }

        for (const key in errors) {
            if (errors[key]) {
                success = false;
                break;
            }
        }

        return {
            success,
            errors,
            result,
        };
    }

    showErrors(errors) {
        this.setState(errors);
    }

    onNewFile(file) {
        if (file.size > MAX_IMPORT_FILE_SIZE_MIB * 1024 * 1024) {
            this.setState({
                resourceError: cockpit.format(_("Only files of size $0 MiB and less are supported"), MAX_IMPORT_FILE_SIZE_MIB),
            });
            return;
        }
        let reader = new FileReader();
        reader.onload = (e) => this.setState({ resource: e.target.result });
        reader.readAsText(file);
    }

    onNewFileEvent(e) {
        if (e.target.files.length > 0) {
            this.onNewFile(e.target.files[0]);
        }
    }

    onDrop(e) {
        e.preventDefault();
        this.setState({ isDragging: false });
        const dt = e.dataTransfer;
        if (dt.items) {
            for (let i = 0; i < dt.items.length; i++) {
                if (dt.items[i].kind === "file") {
                    this.onNewFile(dt.items[i].getAsFile());
                    break;
                }
            }
        } else {
            if (dt.files.length > 0) {
                this.onNewFile(dt.files[0].getAsFile());
            }
        }
        this.setState({
            isOverDropZone: false,
            dragOverElements: [],
        });
    }

    onDragEnter(e) {
        console.log(e.target);
        const elements = [...this.state.dragOverElements, e.target];
        this.setState({
            isDragging: elements.length > 0,
            isOverDropZone: e.target.id === DROP_ZONE_ID || this.state.isOverDropZone,
            dragOverElements: elements,
        });
    }

    onDragLeave(e) {
        const elements = this.state.dragOverElements.filter(elem => elem !== e.target);
        this.setState({
            isDragging: elements.length > 0,
            isOverDropZone: e.target.id === DROP_ZONE_ID ? false : this.state.isOverDropZone,
            dragOverElements: elements,
        });
    }

    render() {
        let formGroupClassNames = '';
        let textAreaClassName = '';
        let resourceErrorLabel = null;

        let dropZoneOverlay = null;
        let overDropZoneOverlay = null;

        if (this.state.resourceError) {
            formGroupClassNames += ' has-error';
            resourceErrorLabel = (
                <label className="help-block" id='resource-text-error'>{this.state.resourceError}</label>);
        }

        if (this.state.isDragging) {
            formGroupClassNames += ' disable-events';
            const dropHere = this.state.isOverDropZone ? (
                <div>
                    {_("Drop file here to upload.")}
                </div>
            ) : null;

            dropZoneOverlay = (
                <div className="overlay drop-overlay drop-area">
                    {dropHere}
                </div>
            );
        }

        if (this.state.isOverDropZone) {
            overDropZoneOverlay = (<div className="overlay drop-overlay drop-area-over" />);
            textAreaClassName = "text-area-opacity";
        }

        return (
            <div className="modal-body modal-dialog-body-table">
                <div className={"description"}>
                    {_("Paste JSON below, ")}
                    <label htmlFor="file-input" className="unstyled-label">
                        <a>
                            {_("upload a JSON file")}
                            <input id="file-input" type="file" className="hide"
                                   accept=".json,.txt"
                                   onChange={this.onNewFileEvent} />
                        </a>
                    </label>
                    {_(" or drag & drop.")}
                </div>
                <div id={DROP_ZONE_ID}
                     onDrop={this.onDrop}>
                    <div className={"form-group " + formGroupClassNames}>
                        <div className="drop-container">
                            {dropZoneOverlay}
                            {overDropZoneOverlay}
                            <textarea id="resource-text"
                                      key="resource-text"
                                      className={"form-control " + textAreaClassName}
                                      value={this.state.resource}
                                      onChange={this.onResourceChanged} />
                        </div>
                        {resourceErrorLabel}
                    </div>
                </div>
            </div>
        );
    }
}

export default CreateVmDialog;
