/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import React, { useState } from "react";
import { createRoot } from 'react-dom/client';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Gallery, GalleryItem } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";

const CardsDemo = () => {
    const [toggle, setToggle ] = useState(true);

    const array_1 = [
        <div key="1">
            {"I'm just a div."}
        </div>,
        <p key="2">
            {"I'm just a paragraph."}
        </p>,
    ];

    const array_2 = [
        <p key="1">
            {"I'm just a paragraph."}
        </p>,
        <div key="2">
            {"I'm just a div."}
        </div>,
    ];

    return (
        <>
            <h4>PF4 cards arranged using a PF4 Gallery</h4>
            <Button onClick={() => setToggle(!toggle)}>Toggle</Button>
            { toggle ? array_1 : array_2  }
        </>
    );
};

export function showCardsDemo(rootElement) {
    const root = createRoot(rootElement);
    root.render(<CardsDemo />);
}
