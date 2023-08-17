import React from 'react';
import PropTypes from 'prop-types';
import { Button } from "@patternfly/react-core/dist/esm/components/Button";
import { EmptyState, EmptyStateBody } from "@patternfly/react-core/dist/esm/components/EmptyState";
import { FormFieldGroup, FormFieldGroupHeader } from "@patternfly/react-core/dist/esm/components/Form";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText";

import './DynamicListForm.scss';

export class DynamicListForm extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            list: [],
        };
        this.keyCounter = 0;
        this.removeItem = this.removeItem.bind(this);
        this.addItem = this.addItem.bind(this);
        this.onItemChange = this.onItemChange.bind(this);
    }

    removeItem(idx, field, value) {
        this.setState(state => {
            const items = state.list.concat();
            items.splice(idx, 1);
            return { list: items };
        }, () => this.props.onChange(this.state.list.concat()));
    }

    addItem() {
        this.setState(state => {
            return { list: [...state.list, Object.assign({ key: this.keyCounter++ }, this.props.default)] };
        }, () => this.props.onChange(this.state.list.concat()));
    }

    onItemChange(idx, field, value) {
        this.setState(state => {
            const items = state.list.concat();
            items[idx][field] = value || null;
            return { list: items };
        }, () => this.props.onChange(this.state.list.concat()));
    }

    render () {
        const { id, label, actionLabel, formclass, emptyStateString, helperText } = this.props;
        const dialogValues = this.state;
        return (
            <FormFieldGroup header={
                <FormFieldGroupHeader
                    titleText={{ text: label }}
                    actions={<Button variant="secondary" className="btn-add" onClick={this.addItem}>{actionLabel}</Button>}
                />
            } className={"dynamic-form-group " + formclass}>
                {
                    dialogValues.list.length
                        ? <>
                            {dialogValues.list.map((item, idx) => {
                                return React.cloneElement(this.props.itemcomponent, {
                                    idx,
                                    item,
                                    id: id + "-" + idx,
                                    key: idx,
                                    onChange: this.onItemChange,
                                    removeitem: this.removeItem,
                                    additem: this.addItem,
                                    options: this.props.options,
                                    itemCount: Object.keys(dialogValues.list).length,
                                });
                            })
                            }
                            {helperText &&
                            <HelperText>
                                <HelperTextItem>{helperText}</HelperTextItem>
                            </HelperText>
                            }
                        </>
                        : <EmptyState>
                            <EmptyStateBody>
                                {emptyStateString}
                            </EmptyStateBody>
                        </EmptyState>
                }
            </FormFieldGroup>
        );
    }
}
DynamicListForm.propTypes = {
    emptyStateString: PropTypes.string.isRequired,
    onChange: PropTypes.func.isRequired,
    id: PropTypes.string.isRequired,
    itemcomponent: PropTypes.object.isRequired,
    formclass: PropTypes.string,
    options: PropTypes.object,
};
