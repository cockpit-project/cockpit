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

import cockpit from 'cockpit';
import React, { useState } from 'react';
import { superuser } from "superuser";
import { apply_modal_dialog } from "cockpit-components-dialog.jsx";
import { show_unexpected_error } from "./dialog-utils.js";

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardActions, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { LabelGroup } from "@patternfly/react-core/dist/esm/components/LabelGroup/index.js";
import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Select, SelectOption, SelectVariant } from "@patternfly/react-core/dist/esm/components/Select/index.js";
import { Text, TextVariants } from "@patternfly/react-core/dist/esm/components/Text/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { UndoIcon } from '@patternfly/react-icons';

import { GroupActions } from "./group-actions.jsx";

const _ = cockpit.gettext;

export function GroupDetails({ groups, accounts, group }) {
    const current_group = groups.find(g => g.name == group);
    return (
        <Page groupProps={{ sticky: 'top' }}
              isBreadcrumbGrouped
              id="group"
              breadcrumb={
                  <Breadcrumb>
                      <BreadcrumbItem to="#/">{_("Groups")}</BreadcrumbItem>
                      <BreadcrumbItem isActive>{group}</BreadcrumbItem>
                  </Breadcrumb>}>
            <PageSection>
                <Card className="group-details" id="group-details">
                    <CardHeader>
                        <CardTitle id="group-title"><Text component={TextVariants.h2}>{group}</Text></CardTitle>
                        {superuser.allowed && <CardActions>
                            <GroupActions group={current_group} accounts={accounts} />
                        </CardActions>}
                    </CardHeader>
                    <CardBody>
                        <Form isHorizontal onSubmit={apply_modal_dialog}>
                            <FormGroup fieldId="group-name" hasNoPaddingTop label={_("Name")}>
                                <output id="group-name">{group}</output>
                            </FormGroup>
                            <GroupAccountsSelect accounts={accounts} group={group} groups={groups} />
                        </Form>
                    </CardBody>
                </Card>
            </PageSection>
        </Page>
    );
}

export const GroupAccountsSelect = ({ accounts, group, groups }) => {
    const current_group = groups.find(g => g.name == group);
    const [isOpenAccount, setIsOpenAccount] = useState(false);
    const [selected, setSelected] = useState([...current_group.userlist, ...current_group.userlistPrimary]);
    const [history, setHistory] = useState([]);
    const [loggedInUsersAffected, setLoggedInUsersAffected] = useState(false);

    const undoAccountChanges = () => {
        const undoItem = history[history.length - 1];
        if (undoItem.type === 'added') {
            removeAccount(undoItem.name, true).then(() => setHistory(history.slice(0, -1)));
        } else if (undoItem.type === 'removed') {
            addAccount(undoItem.name, true).then(() => setHistory(history.slice(0, -1)));
        }
    };

    const removeAccount = (account, isUndo) => {
        if (!isUndo)
            setHistory([...history, { type: 'removed', name: account }]);

        const current_account = accounts.find(a => a.name == account);
        if (current_account.loggedIn)
            setLoggedInUsersAffected(true);

        return cockpit.spawn(["gpasswd", "-d", account, group], { superuser: "require", err: "message" })
                .then(() => {
                    setSelected(selected.filter(item => item !== account));
                    setIsOpenAccount(false);
                }, show_unexpected_error);
    };

    const addAccount = (account, isUndo) => {
        if (!isUndo)
            setHistory([...history, { type: 'added', name: account }]);

        const current_account = accounts.find(a => a.name == account);
        if (current_account.loggedIn) setLoggedInUsersAffected(true);

        return cockpit.spawn(["gpasswd", "-a", account, group], { superuser: "require", err: "message" })
                .then(() => {
                    setSelected([...selected, account]);
                    setIsOpenAccount(false);
                }, show_unexpected_error);
    };

    const onSelectAccount = (event, selection) => {
        if (selected.includes(selection)) {
            removeAccount(selection);
        } else {
            addAccount(selection);
        }
    };

    const chipGroupComponent = () => {
        return (
            <LabelGroup numLabels={10}>
                {(selected || []).map((currentLabel, index) => {
                    const optional = !current_group.userlistPrimary.includes(currentLabel) && superuser.allowed ? { onClose: () => removeAccount(currentLabel) } : {};

                    return (
                        <Label key={currentLabel}
                               color={accounts.find(ac => ac.name === currentLabel).isAdmin ? "gold" : "cyan"}
                               {...optional}
                        >
                            {currentLabel}
                        </Label>
                    );
                })}
            </LabelGroup>
        );
    };

    return (
        <FormGroup
            fieldId="group-accounts"
            helperText={
                (history.length > 0)
                    ? <HelperText className="pf-c-form__helper-text">
                        <Flex>
                            {loggedInUsersAffected && <HelperTextItem id="group-accounts-helper" variant="warning">{_("To take effect, the changed users must log out.")}</HelperTextItem>}
                            {history.length > 0 && <Button variant="link" id="group-undo-btn" isInline icon={<UndoIcon />} onClick={undoAccountChanges}>{_("Undo")}</Button>}
                        </Flex>
                    </HelperText>
                    : ''
            }
            id="group-accounts-form-group"
            label={_("Accounts")}
            validated={history.length > 0 ? "warning" : "default"}
        >
            {superuser.allowed
                ? <Select
                   chipGroupComponent={chipGroupComponent()}
                   isDisabled={!superuser.allowed}
                   isOpen={isOpenAccount}
                   onSelect={onSelectAccount}
                   onToggle={setIsOpenAccount}
                   selections={selected}
                   toggleId="group-accounts"
                   variant={SelectVariant.typeaheadMulti}
                >
                    {accounts.map((option, index) => (
                        <SelectOption
                            isDisabled={current_group.userlistPrimary.includes(option.name)}
                            key={index}
                            value={option.name}
                        />
                    ))}
                </Select>
                : chipGroupComponent()}
        </FormGroup>
    );
};
