/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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

import React from "react";
import { createRoot } from 'react-dom/client';
import { Radio, TextInput } from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Td, Tbody } from '@patternfly/react-table';

import cockpit from "cockpit";
import { useDeepEqualMemo } from "hooks";

import '../lib/patternfly/patternfly-5-cockpit.scss';
import "page.scss";

const FSList1 = function ({ path, attrs }) {
    const memoAttrs = useDeepEqualMemo(attrs);
    const [files, setFiles] = React.useState([]);

    React.useEffect(() => {
        const fslist = cockpit.fslist(path, memoAttrs);
        function updateState() {
            setFiles(Object.entries(fslist.members));
        }
        fslist.addEventListener("changed", updateState);
        updateState();
        return () => { fslist.removeEventListener("changed", updateState) };
    }, [path, memoAttrs]);

    return (<Table>
        <Thead>
            <Tr><Th>Path</Th>{ attrs.map(attr => <Th key={attr}>{attr}</Th>) }</Tr>
        </Thead>
        <Tbody>
            { files.map(([name, file]) => <Tr key={name + file.tag}><Th>{name}</Th>{ attrs.map(attr => <Td key={attr}>{file[attr] }</Td>)}</Tr>) }
        </Tbody>
    </Table>);
};

const FileSystemChannel = () => {
    const [path, setPath] = React.useState("/tmp");
    const [attributes, setAttributes] = React.useState("type,owner,group,target");

    return (
        <>
            <TextInput id="attributes" placeholder="Comma seperated list of attributes" value={attributes}
                       onChange={(_event, value) => setAttributes(value)} />
            <TextInput id="path" value={path} onChange={(_event, value) => setPath(value)} />
            <FSList1 path={path} attrs={attributes.split(',')} />
        </>
    );
};

document.addEventListener("DOMContentLoaded", function() {
    const root = createRoot(document.getElementById('filesystem'));
    root.render(<FileSystemChannel />);
});
