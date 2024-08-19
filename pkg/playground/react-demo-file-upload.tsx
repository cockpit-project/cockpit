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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React, { useRef, useState } from "react";
import { Container, createRoot } from 'react-dom/client';

import { Alert, AlertActionCloseButton } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Progress } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { TimesIcon, UploadIcon } from "@patternfly/react-icons";

import { FileAutoComplete } from "cockpit-components-file-autocomplete.jsx";
import { upload } from "cockpit-upload-helper";

const _ = cockpit.gettext;

export const UploadButton = () => {
    const ref = useRef<HTMLInputElement>(null);
    const [files, setFiles] = useState<{[name: string]: {file: File, progress: number, cancel:() => void}}>({});
    const [alert, setAlert] = useState<{variant: "warning" | "danger", title: string, message: string} | null>(null);
    const [dest, setDest] = useState("/home/admin/");
    let next_progress = 0;

    const handleClick = () => {
        if (ref.current) {
            ref.current.click();
        }
    };

    const onUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        cockpit.assert(event.target.files, "not an <input type='file'>?");
        setAlert(null);
        await Promise.allSettled(Array.from(event.target.files).map(async (file: File) => {
            const destination = `${dest}${file.name}`;
            const abort = new AbortController();

            setFiles(oldFiles => {
                return {
                    [file.name]: { file, progress: 0, cancel: () => abort.abort() },
                    ...oldFiles,
                };
            });

            try {
                await upload(destination, file, (progress) => {
                    const now = performance.now();
                    if (now < next_progress)
                        return;
                    next_progress = now + 200; // only rerender every 200ms
                    setFiles(oldFiles => {
                        const oldFile = oldFiles[file.name];
                        return {
                            ...oldFiles,
                            [file.name]: { ...oldFile, progress },
                        };
                    });
                }, abort.signal);
            } catch (exc) {
                cockpit.assert(exc instanceof Error, "Unknown exception type");
                if (exc instanceof DOMException && exc.name == 'AbortError') {
                    setAlert({ variant: "warning", title: 'Aborted', message: '' });
                } else {
                    setAlert({ variant: "danger", title: 'Upload Error', message: exc.message });
                }
            } finally {
                setFiles(oldFiles => {
                    const copy = { ...oldFiles };
                    delete copy[file.name];
                    return copy;
                });
            }
        }));

        // Reset input field in the case a download was cancelled and has to be re-uploaded
        // https://stackoverflow.com/questions/26634616/filereader-upload-same-file-again-not-working
        event.target.value = "";
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
            >
                <p>{alert.message}</p>
            </Alert>
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

export const showUploadDemo = (rootElement: Container) => {
    const root = createRoot(rootElement);
    root.render(<UploadButton />);
};
