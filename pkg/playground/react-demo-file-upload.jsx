/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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
import React, { useRef, useState } from "react";
import { createRoot } from 'react-dom/client';

import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Progress } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { TimesIcon, UploadIcon } from "@patternfly/react-icons";

import { FileAutoComplete } from "cockpit-components-file-autocomplete.jsx";
import { UploadHelper } from "cockpit-upload-helper";

const _ = cockpit.gettext;

export const UploadButton = () => {
    const ref = useRef();
    const [files, setFiles] = useState({});
    const [alert, setAlert] = useState(null);
    const [dest, setDest] = useState("/home/admin/");

    const handleClick = () => {
        ref.current.click();
    };

    const handleProgressIndex = (file, progress) => {
        setFiles(oldFiles => {
            const oldFile = oldFiles[file.name];
            return {
                ...oldFiles,
                [file.name]: { ...oldFile, progress },
            };
        });
    };

    const onUpload = async event => {
        setAlert(null);
        await Promise.all(Array.from(event.target.files).map(async (file) => {
            const helper = new UploadHelper(`${dest}${file.name}`, (progress) => handleProgressIndex(file, progress));

            setFiles(oldFiles => {
                return {
                    [file.name]: { file, progress: 0, cancel: helper.cancel.bind(helper) },
                    ...oldFiles,
                };
            });

            try {
                const status = await helper.upload(file);
                console.debug("upload status", status);
            } catch (exc) {
                console.debug("upload exception", exc.toString());
                setAlert({ variant: "danger", title: exc.toString() });
            }

            setFiles(oldFiles => {
                const copy = { ...oldFiles };
                delete copy[file.name];
                return copy;
            });
        }));

        // Reset input field in the case a download was cancelled and has to be re-uploaded
        // https://stackoverflow.com/questions/26634616/filereader-upload-same-file-again-not-working
        event.target.value = null;
    };

    return (
        <>
            <Flex direction={{ default: "column" }}>
                <FileAutoComplete className="upload-file-dest" value={dest} onChange={setDest} />
                <Button
                  id="upload-file-btn"
                  variant="secondary"
                  icon={<UploadIcon />}
                  isDisabled={Object.keys(files).length !== 0}
                  isLoading={Object.keys(files).length !== 0}
                  onClick={handleClick}
                >
                    {_("Upload")}
                </Button>
                <input
                  ref={ref} type="file"
                  hidden multiple onChange={onUpload}
                />
            </Flex>
            {alert !== null &&
            <Alert variant={alert.variant}
                   title={alert.title}
                   timeout={3000}
                   actionClose={<AlertActionCloseButton onClose={() => setAlert(null)} />}
            />
            }
            {Object.keys(files).map((key, index) => {
                const file = files[key];
                return (
                    <React.Fragment key={index}>
                        <Progress className={`upload-progress-${index}`} key={file.file.name} value={file.progress} title={file.file.name} max={file.file.size} />
                        <Button className={`cancel-button-${index}`} icon={<TimesIcon />} onClick={file.cancel} />
                    </React.Fragment>
                );
            })}
        </>
    );
};

export const showUploadDemo = (rootElement) => {
    const root = createRoot(rootElement);
    root.render(<UploadButton />);
};
