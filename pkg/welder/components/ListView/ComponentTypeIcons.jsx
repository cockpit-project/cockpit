import React from 'react';
import PropTypes from 'prop-types';

const ComponentTypeIcons = props => {
  let icon = '';
  let type = '';
  let indicator = '';
  const context = props.compDetails ? 'pf-icon-small' : 'list-pf-icon list-pf-icon-small';
  switch (props.componentType) {
    case 'Module Stack':
      type = 'Type&nbsp;<strong>Module Stack</strong>';
      icon = 'fa fa-cubes';
      break;
    case 'Module':
      type = 'Type&nbsp;<strong>Module</strong>';
      icon = 'fa fa-cube';
      break;
    case 'RPM':
      type = 'Type&nbsp;<strong>RPM</strong>';
      icon = 'fa fa-sticky-note-o';
      break;
    default:
      type = 'Type&nbsp;<strong>RPM</strong>';
      icon = 'fa fa-sticky-note-o';
  }
  if (props.componentInRecipe === true) {
    indicator = 'list-pf-icon-bordered';
    // TODO - Identify icon as belonging to dependency in the recipe
    // if (props.isDependency) {
    //   indicator += ' list-pf-icon-bordered-dotted';
    // }
  }

  return (
    <span>
      <span
        className={`${icon} ${indicator} ${context}`}
        data-html="true"
        data-toggle="tooltip"
        title=""
        data-original-title={type}
      />
    </span>
  );
};

ComponentTypeIcons.propTypes = {
  componentType: PropTypes.string,
  compDetails: PropTypes.bool,
  componentInRecipe: PropTypes.bool,
};

export default ComponentTypeIcons;
