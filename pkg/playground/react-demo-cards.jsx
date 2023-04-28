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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import React from "react";
import { createRoot } from 'react-dom/client';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Gallery, GalleryItem } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";

const CardsDemo = () => {
    const cards = [
        <Card isCompact key="card1">
            <CardBody>I'm a card in a gallery</CardBody>
        </Card>,
        <Card isCompact key="card2">
            <CardBody>I'm a card in a gallery</CardBody>
            <CardFooter>I have a footer</CardFooter>
        </Card>,
        <Card isCompact key="card3">
            <CardBody>I'm a card in a gallery</CardBody>
        </Card>,
        <Card isCompact key="card4">
            <CardTitle>I have a header too</CardTitle>
            <CardBody>I'm a card in a gallery</CardBody>
        </Card>,
        <Card key="card5">
            <CardHeader actions={{
                actions: <><input type="checkbox" />
                    <Button className="btn">click</Button></>,
            }} />
            <CardTitle>This is a card header</CardTitle>
            <CardBody>I'm a card in a gallery</CardBody>
        </Card>,
        <GalleryItem key="card6">
            I'm not a card, but I'm in the gallery too, as a generic GalleryItem.
        </GalleryItem>,
    ];
    return (
        <>
            <h4>PF4 cards arranged using a PF4 Gallery</h4>
            <Gallery hasGutter>
                { cards }
            </Gallery>
        </>
    );
};

export function showCardsDemo(rootElement) {
    const root = createRoot(rootElement);
    root.render(<CardsDemo />);
}
