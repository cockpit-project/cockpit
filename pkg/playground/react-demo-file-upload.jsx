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

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Progress } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { UploadIcon } from "@patternfly/react-icons";

import { UploadHelper } from "cockpit-components-upload";

const _ = cockpit.gettext;

export const UploadButton = () => {
    const BLOCK_SIZE = 16 * 1024;
    const ref = useRef();
    const [isUploading, setIsUploading] = useState(false);
    const [progress, setProgress] = useState([]);
    const [files, setFiles] = useState([]);

    let helper = null;

    const handleClick = () => {
        ref.current.click();
    };

    const handleCancel = () => {
        console.log("cancel upload");
        helper.cancel();
    };

    const handleUploadDone = () => {
        console.log("upload finished");
    };

    const handleProgressIndex = (index, progress) => {
        console.log("progress for index", index, progress);
        setProgress(oldProgress => {
            const newProgress = oldProgress.slice();
            newProgress[index] = progress;
            return newProgress;
        });
    };

    const onUpload = async event => {
        console.log("files", event.target.files);
        setFiles(Array.from(event.target.files));
        setIsUploading(true);
        setProgress(new Array(event.target.files.length).map(() => 0));
        const promises = [];

        await Promise.all(Array.from(event.target.files).map(async (file, index) => {
            console.log("lolol", index);
            helper = new UploadHelper(file, `/root/${file.name}`, BLOCK_SIZE, (progress) => handleProgressIndex(index, progress), handleUploadDone);
            await helper.upload();
        }));

        await Promise.allSettled(promises);

        setFiles([]);
        setProgress([]);
        setIsUploading(false);
    };

    console.log("upload progress in component", progress);

    return (
        <>
            <div>
                <Button
              variant="secondary"
              icon={<UploadIcon />}
              isDisabled={isUploading}
              isLoading={isUploading}
              onClick={handleClick}
                >
                    {_("Upload")}
                </Button>
                {isUploading &&
                <Button
              variant="secondary"
              onClick={handleCancel}
                >
                    {_("Cancel upload")}
                </Button>
                }
                <input
              ref={ref} type="file"
              hidden multiple onChange={onUpload}
                />
            </div>
            {files.map((file, index) => <Progress key={file.name} value={progress[index]} title={file.name} />)}
        </>
    );
};

export const showUploadDemo = (rootElement) => {
    const root = createRoot(rootElement);
    root.render(<UploadButton />);
};
