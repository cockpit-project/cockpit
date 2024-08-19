/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

import React, { useState } from "react";
import { ListingTable } from "cockpit-components-table.jsx";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { useInit } from "hooks";

const _ = cockpit.gettext;

export const ActivePagesDialog = ({ dialogResult, frames }) => {
    function get_pages() {
        const result = [];
        for (const address in frames.iframes) {
            for (const component in frames.iframes[address]) {
                const iframe = frames.iframes[address][component];
                result.push({
                    frame: iframe,
                    component,
                    address,
                    name: iframe.getAttribute("name"),
                    active: iframe.getAttribute("data-active") === 'true',
                    selected: iframe.getAttribute("data-active") === 'true',
                    displayName: address === "localhost" ? "/" + component : address + ":/" + component
                });
            }
        }

        // sort the frames by displayName, active ones first
        result.sort(function(a, b) {
            return (a.active ? -2 : 0) + (b.active ? 2 : 0) +
                   ((a.displayName < b.displayName) ? -1 : 0) + ((b.displayName < a.displayName) ? 1 : 0);
        });

        return result;
    }

    const init_pages = useInit(get_pages, [frames]);
    const [pages, setPages] = useState(init_pages);

    function onRemove() {
        pages.forEach(element => {
            if (element.selected)
                frames.remove(element.host, element.component);
        });
        dialogResult.resolve();
    }

    const rows = pages.map(page => {
        const columns = [{
            title: <Split>
                <SplitItem isFilled>
                    {page.displayName}
                </SplitItem>
                <SplitItem>
                    {page.active && <Label color="blue">{_("active")}</Label>}
                </SplitItem>
            </Split>,
        }];
        return ({
            props: {
                key: page.name,
                'data-row-id': page.name
            },
            columns,
            selected: page.selected,
        });
    });

    return (
        <Modal isOpen position="top" variant="small"
               id="active-pages-dialog"
               onClose={() => dialogResult.resolve()}
               title={_("Active pages")}
               footer={<>
                   <Button variant='primary' onClick={onRemove}>{_("Close selected pages")}</Button>
                   <Button variant='link' onClick={() => dialogResult.resolve()}>{_("Cancel")}</Button>
               </>}
        >
            <ListingTable showHeader={false}
                          columns={[{ title: _("Page name") }]}
                          aria-label={_("Active pages")}
                          emptyCaption={ _("There are currently no active pages") }
                              onSelect={(_event, isSelected, rowIndex) => {
                                  const new_pages = [...pages];
                                  new_pages[rowIndex].selected = isSelected;
                                  setPages(new_pages);
                              }}
                          rows={rows} />
        </Modal>
    );
};
