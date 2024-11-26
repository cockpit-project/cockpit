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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Progress, ProgressMeasureLocation } from "@patternfly/react-core/dist/esm/components/Progress/index.js";
import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";

const _ = cockpit.gettext;

export function debug(...args: unknown[]) {
    if (window.debugging == "all" || window.debugging?.includes("apps")) {
        console.debug("apps:", ...args);
    }
}

export function icon_url(path_or_url: string): string {
    if (!path_or_url)
        return "default.png";

    if (path_or_url[0] != '/')
        return path_or_url;

    interface QueryObj {
        payload: string,
        binary: "raw",
        path: string,
        external?: { [key: string]: string }
    }

    const queryobj: QueryObj = {
        payload: "fsread1",
        binary: "raw",
        path: path_or_url,
    };

    if (path_or_url.endsWith(".svg")) {
        queryobj.external = { "content-type": "image/svg+xml" };
    }

    const prefix = (new URL(cockpit.transport.uri("channel/" + cockpit.transport.csrf_token))).pathname;
    const query = window.btoa(JSON.stringify(queryobj));
    return prefix + '?' + query;
}

export interface JobProgress {
    percentage: number,
    waiting: boolean,
    cancel: React.MouseEventHandler,
}

export const ProgressBar = ({ size, data, ariaLabelledBy }: {
    size?: "lg" | "md" | "sm",
    data: JobProgress,
    ariaLabelledBy?: string,
}) => {
    if (data.waiting) {
        return (<Split>
            <SplitItem className="progress-title" isFilled>
                {_("Waiting for other programs to finish using the package manager...")}
            </SplitItem>
            <SplitItem>
                <Spinner size="md" />
            </SplitItem>
        </Split>);
    } else {
        return <Progress className="progress-bar" value={data.percentage} size={size} measureLocation={ProgressMeasureLocation.inside} aria-labelledby={ariaLabelledBy} />;
    }
};

export const CancelButton = ({ data }: { data: JobProgress }) => (
    <Button variant="secondary" isDisabled={!data.cancel} onClick={data.cancel}>
        {_("Cancel")}
    </Button>);

// ex is a PackageKit error; requires typing pkg/lib/packagekit.js first
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const show_error = (ex: any) => {
    if (ex.code == "cancelled")
        return;

    if (ex.code == "not-found")
        ex.detail = _("No installation package found for this application.");

    show_modal_dialog(
        {
            title: _("Error"),
            body: (
                <p>{typeof ex == 'string' ? ex : (ex.detail || ex.message)}</p>
            )
        },
        {
            cancel_button: { text: _("Close"), variant: "secondary" },
            actions: []
        });
};

export interface Launchable {
    type: string,
    name: string,
}

// see pkg/apps/watch-appstream.py
export interface Component {
    id: string,
    pkgname: string,
    name: string,
    summary: string,
    description: string,
    icon: string, // this is a path
    screenshots: { full: string }[],
    launchables: Launchable[],
    urls: { type: string, link: string }[],
    installed?: boolean,
}

export const launch = (comp: Component) => {
    for (let i = 0; i < comp.launchables.length; i++) {
        if (comp.launchables[i].type == "cockpit-manifest") {
            debug("launching", comp.launchables[i].name, "in component", JSON.stringify(comp));
            cockpit.jump([comp.launchables[i].name]);
            return;
        }
    }
};
