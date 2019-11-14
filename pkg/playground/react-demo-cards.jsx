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
import ReactDOM from "react-dom";

import {
    Button, Card, CardHeader, CardBody, CardFooter,
    CardHead, CardActions, Gallery, GalleryItem
} from '@patternfly/react-core';

const CardsDemo = () => {
    const cards = [
        <GalleryItem key="card1">
            <Card isCompact>
                <CardBody>I'm a card in a gallery</CardBody>
            </Card>
        </GalleryItem>,
        <GalleryItem key="card2">
            <Card isCompact>
                <CardBody>I'm a card in a gallery</CardBody>
                <CardFooter>I have a footer</CardFooter>
            </Card>
        </GalleryItem>,
        <GalleryItem key="card3">
            <Card isCompact>
                <CardBody>I'm a card in a gallery</CardBody>
            </Card>
        </GalleryItem>,
        <GalleryItem key="card4">
            <Card isCompact>
                <CardHeader>I have a header too</CardHeader>
                <CardBody>I'm a card in a gallery</CardBody>
            </Card>
        </GalleryItem>,
        <GalleryItem key="card5">
            <Card>
                <CardHead>
                    <CardActions>
                        <input type="checkbox" />
                        <Button className="btn">click</Button>
                    </CardActions>
                    <CardHeader>This is a card header</CardHeader>
                </CardHead>
                <CardBody>I'm a card in a gallery</CardBody>
            </Card>
        </GalleryItem>,
    ];
    return (
        <>
            <h4>PF4 cards arranged using a PF4 Gallery</h4>
            <Gallery gutter="md">
                { cards }
            </Gallery>
        </>
    );
};

export function showCardsDemo(rootElement) {
    ReactDOM.render(<CardsDemo />, rootElement);
}
