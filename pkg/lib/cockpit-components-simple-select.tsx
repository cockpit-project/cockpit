/*

MIT License

Copyright (c) 2019 Red Hat, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

/* This is a copy of SimpleSelect.tsx from

       https://github.com/patternfly/patternfly-react/blob/v5/packages/react-templates/src/components/Select/SimpleSelect.tsx

   We don't use it directly from the @patternfly/react-templates node
   module since we might want to add features to it, and also to
   isolate us from gratuitous upstream changes.

*/

/* eslint-disable */

import React from 'react';
import {
  Select,
  SelectList,
  SelectOption,
  SelectOptionProps,
  SelectProps
} from '@patternfly/react-core/dist/esm/components/Select';
import { MenuToggle, MenuToggleElement, MenuToggleProps } from '@patternfly/react-core/dist/esm/components/MenuToggle';

export interface SimpleSelectOption extends Omit<SelectOptionProps, 'content'> {
  /** Content of the select option. */
  content: React.ReactNode;
  /** Value of the select option. */
  value: string | number;
}

export interface SimpleSelectProps extends Omit<SelectProps, 'toggle'> {
  /** @hide Forwarded ref */
  innerRef?: React.Ref<any>;
  /** Initial options of the select. */
  initialOptions?: SimpleSelectOption[];
  /** Callback triggered on selection. */
  onSelect?: (_event: React.MouseEvent<Element, MouseEvent>, selection: string | number) => void;
  /** Callback triggered when the select opens or closes. */
  onToggle?: (nextIsOpen: boolean) => void;
  /** Flag indicating the select should be disabled. */
  isDisabled?: boolean;
  /** Content of the toggle. Defaults to the selected option. */
  toggleContent?: React.ReactNode;
  /** Placeholder text for the select input. */
  placeholder?: string;
  /** Width of the toggle. */
  toggleWidth?: string;
  /** Additional props passed to the toggle. */
  toggleProps?: MenuToggleProps;
}

const SimpleSelectBase: React.FunctionComponent<SimpleSelectProps> = ({
  innerRef,
  initialOptions,
  isDisabled,
  onSelect,
  onToggle,
  toggleContent,
  toggleWidth = '200px',
  toggleProps,
  placeholder = 'Select a value',
  ...props
}: SimpleSelectProps) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<SimpleSelectOption | undefined>();

  React.useEffect(() => {
    const selectedOption = initialOptions?.find((option) => option.selected);
    setSelected(selectedOption);
  }, [initialOptions]);

  const simpleSelectOptions = initialOptions?.map((option) => {
    const { content, value, ...props } = option;
    const isSelected = selected?.value === value;
    return (
      <SelectOption value={value} key={value} isSelected={isSelected} {...props}>
        {content}
      </SelectOption>
    );
  });

  const onToggleClick = () => {
    onToggle && onToggle(!isOpen);
    setIsOpen(!isOpen);
  };

  const _onSelect = (_event: React.MouseEvent<Element, MouseEvent> | undefined, value: string | number | undefined) => {
    onSelect && onSelect(_event, value);
    setSelected(initialOptions.find((o) => o.value === value));
    onToggle && onToggle(true);
    setIsOpen(false);
  };

  const toggle = (toggleRef: React.Ref<MenuToggleElement>) => (
    <MenuToggle
      ref={toggleRef}
      onClick={onToggleClick}
      isExpanded={isOpen}
      isDisabled={isDisabled}
      style={
        {
          width: toggleWidth
        } as React.CSSProperties
      }
      {...toggleProps}
    >
      {toggleContent ? toggleContent : selected?.content || placeholder}
    </MenuToggle>
  );

  return (
    <Select
      isOpen={isOpen}
      selected={selected}
      onSelect={_onSelect}
      onOpenChange={(isOpen) => {
        onToggle && onToggle(isOpen);
        setIsOpen(isOpen);
      }}
      toggle={toggle}
      shouldFocusToggleOnSelect
      ref={innerRef}
      {...props}
    >
      <SelectList>{simpleSelectOptions}</SelectList>
    </Select>
  );
};

export const SimpleSelect = React.forwardRef((props: SimpleSelectProps, ref: React.Ref<any>) => (
  <SimpleSelectBase {...props} innerRef={ref} />
));

SimpleSelect.displayName = 'SimpleSelect';
