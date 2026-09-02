/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */
import React from "react";

import { Content } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

export const TwoColumnContent = ({ list, flexClassName }: { list: string[], flexClassName?: string }) => {
    const half = Math.round(list.length / 2);
    const col1 = list.slice(0, half);
    const col2 = list.slice(half);
    return (
        <Flex {...(flexClassName && { className: flexClassName })}>
            <FlexItem flex={{ default: 'flex_1' }}>
                <Content component="ul">
                    {col1.map(item => (<Content component="li" key={item}>{item}</Content>))}
                </Content>
            </FlexItem>
            {col2.length > 0 && <FlexItem flex={{ default: 'flex_1' }}>
                <Content component="ul">
                    {col2.map(item => (<Content component="li" key={item}>{item}</Content>))}
                </Content>
            </FlexItem>}
        </Flex>
    );
};

export const TwoColumnTitle = ({ icon, str }: { icon: React.ReactNode, str: string }) => {
    return (<>
        {icon}
        <span className="update-success-table-title">
            {str}
        </span>
    </>);
};
